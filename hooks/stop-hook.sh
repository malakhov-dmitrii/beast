#!/bin/bash
set -euo pipefail

# Resolve hook directory for discover-skills.sh
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read hook input ONCE at the start
HOOK_INPUT=$(cat)

# Session ID extraction from transcript path
get_transcript_session_id() {
  local hook_input="$1"
  local transcript_path=$(echo "$hook_input" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

  if [[ -n "$transcript_path" ]]; then
    # Extract session ID from transcript path
    # /var/folders/.../transcript-abc123.json -> abc123
    local filename=$(basename "$transcript_path" .json)
    local session_id=$(echo "$filename" | sed 's/^transcript-//')
    echo "$session_id"
  else
    # Fallback for testing/development
    echo "fallback-$(date +%s)-$$"
  fi
}

# Claim pending session if not already claimed
claim_session() {
  local session_id="$1"
  local transcript_path="$2"
  local final_dir=".beast-plan/sessions/$session_id"

  # Already claimed?
  if [[ -d "$final_dir" ]]; then
    echo "$final_dir"
    return 0
  fi

  # Find pending session to claim
  local pending_dir=""
  local newest_time=0

  for dir in .beast-plan/pending-*; do
    if [[ ! -d "$dir" ]]; then
      continue
    fi

    local state_file="$dir/state.json"
    if [[ ! -f "$state_file" ]]; then
      continue
    fi

    # Check if already claimed (has transcript_path)
    local has_transcript=$(jq -r '.transcript_path // empty' "$state_file")
    if [[ -n "$has_transcript" ]]; then
      continue  # Already claimed by another session
    fi

    # Check if active
    local is_active=$(jq -r '.active // false' "$state_file")
    if [[ "$is_active" != "true" ]]; then
      continue
    fi

    # Get updated_at timestamp
    local updated_at=$(jq -r '.updated_at // ""' "$state_file")
    local timestamp=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${updated_at:0:19}" "+%s" 2>/dev/null || echo "0")

    if [[ $timestamp -gt $newest_time ]]; then
      newest_time=$timestamp
      pending_dir="$dir"
    fi
  done

  if [[ -z "$pending_dir" ]]; then
    # No pending session found - check for legacy flat structure
    if [[ -f ".beast-plan/state.json" ]] && [[ ! -d ".beast-plan/sessions" ]]; then
      echo ".beast-plan"
      return 0
    fi

    # No session found at all
    echo ""
    return 1
  fi

  # Claim it: move to sessions directory
  mkdir -p ".beast-plan/sessions"
  mv "$pending_dir" "$final_dir" 2>/dev/null || {
    # Move failed (race condition), check if someone else claimed it
    if [[ -d "$final_dir" ]]; then
      echo "$final_dir"
      return 0
    else
      echo ""
      return 1
    fi
  }

  # Update state.json with final session ID and transcript path
  jq --arg sid "$session_id" --arg tp "$transcript_path" \
     '.session_id = $sid | .transcript_path = $tp | .updated_at = (now | todate)' \
     "$final_dir/state.json" > "$final_dir/state.json.tmp" && \
     mv "$final_dir/state.json.tmp" "$final_dir/state.json"

  echo "$final_dir"
  return 0
}

# Extract transcript session ID
TRANSCRIPT_SESSION_ID=$(get_transcript_session_id "$HOOK_INPUT")
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

# Claim or find session directory
BASE_DIR=$(claim_session "$TRANSCRIPT_SESSION_ID" "$TRANSCRIPT_PATH")

if [[ -z "$BASE_DIR" ]]; then
  # No active session, allow exit
  exit 0
fi

STATE_FILE="$BASE_DIR/state.json"

# No active session → allow exit
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

ACTIVE=$(jq -r '.active // false' "$STATE_FILE")
if [[ "$ACTIVE" != "true" ]]; then
  exit 0
fi

# Read state
PHASE=$(jq -r '.phase // ""' "$STATE_FILE")
ACTOR=$(jq -r '.pipeline_actor // ""' "$STATE_FILE")
ITERATION=$(jq -r '.iteration // 1' "$STATE_FILE")
MAX_ITER=$(jq -r '.max_iterations // 5' "$STATE_FILE")
VERDICT=$(jq -r '.critic_verdict // ""' "$STATE_FILE")
FLAGS=$(jq -r '.flags // [] | join(",")' "$STATE_FILE")
COMMAND=$(jq -r '.command // "plan"' "$STATE_FILE")
EXEC_WAVE=$(jq -r '.execution_wave // 0' "$STATE_FILE")
EXEC_TASK=$(jq -r '.execution_task // 0' "$STATE_FILE")

LAST_OUTPUT=""
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  LAST_LINE=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -1 || echo "")
  if [[ -n "$LAST_LINE" ]]; then
    LAST_OUTPUT=$(echo "$LAST_LINE" | jq -r '
      .message.content |
      map(select(.type == "text")) |
      map(.text) |
      join("\n")
    ' 2>/dev/null || echo "")
  fi
fi

# Safety: max iterations reached
if [[ "$ITERATION" -gt "$MAX_ITER" ]]; then
  jq '.phase = "max_iterations"' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  PROMPT="BEAST-PLAN: Maximum iterations ($MAX_ITER) reached.

Present the BEST plan from all iterations to the human for review.

1. Read ${BASE_DIR}/iterations/ and find the highest-scoring iteration
2. Present a summary: iteration count, final scores, what improved vs what couldn't be resolved
3. Ask the human whether to:
   a) Accept the plan as-is
   b) Provide additional guidance for one more iteration
   c) Cancel the session

Do NOT emit any signals. Wait for human input."
  jq -n --arg reason "$PROMPT" '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Signal: complete — allow exit
if echo "$LAST_OUTPUT" | grep -q "<bp-complete>"; then
  jq '.active = false | .phase = "complete"' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  exit 0
fi

# Signal: phase-done — route based on state
if echo "$LAST_OUTPUT" | grep -q "<bp-phase-done>"; then
  # Re-read state (Claude updated it before emitting signal)
  PHASE=$(jq -r '.phase // ""' "$STATE_FILE")
  ACTOR=$(jq -r '.pipeline_actor // ""' "$STATE_FILE")
  VERDICT=$(jq -r '.critic_verdict // ""' "$STATE_FILE")
  ITERATION=$(jq -r '.iteration // 1' "$STATE_FILE")
  FLAGS=$(jq -r '.flags // [] | join(",")' "$STATE_FILE")

  case "$PHASE:$ACTOR" in
    "interview:")
      # Domain detection: discover relevant skills for this task
      TASK_DESC=$(jq -r '.task_description // ""' "$STATE_FILE")
      DISCOVERED_SKILLS=$(bash "$HOOK_DIR/discover-skills.sh" "$TASK_DESC" 2>/dev/null || echo "[]")

      # Build skill content injection
      SKILL_CONTENT=""
      if [[ "$DISCOVERED_SKILLS" != "[]" ]] && echo "$DISCOVERED_SKILLS" | jq -e '. | length > 0' >/dev/null 2>&1; then
        SKILL_CONTENT="\n\n## Detected Domain Skills\n\nThe following skills were automatically discovered for this task:\n\n"

        # Read first 100 lines of each skill
        while IFS= read -r skill_path; do
          skill_name=$(echo "$DISCOVERED_SKILLS" | jq -r ".[] | select(.path == \"$skill_path\") | .name")
          if [[ -f "$skill_path" ]] && [[ -n "$skill_name" ]]; then
            skill_preview=$(head -100 "$skill_path" 2>/dev/null || true)
            SKILL_CONTENT="${SKILL_CONTENT}\n### Skill: $skill_name\n\n\`\`\`\n${skill_preview}\n\`\`\`\n\n"
          fi
        done < <(echo "$DISCOVERED_SKILLS" | jq -r '.[].path')

        # Update state.json with detected skills
        DETECTED_NAMES=$(echo "$DISCOVERED_SKILLS" | jq -c '[.[].name]')
        jq ".detected_skills = $DETECTED_NAMES" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
      fi

      read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Interview complete. Now run the RESEARCH phase.

1. Read \`${BASE_DIR}/CONTEXT.md\` to understand the requirements and decisions.
2. Spawn the researcher agent:
   \`\`\`
   Task(subagent_type="beast:researcher", model="sonnet", prompt=<CONTEXT.md content + research instructions>)
   \`\`\`
   Pass the full CONTEXT.md content in the prompt. Tell the researcher to investigate everything needed for a bulletproof implementation plan.${SKILL_CONTENT}
3. Write the researcher's output to \`${BASE_DIR}/RESEARCH.md\`
4. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"research"\`, \`pipeline_actor\` to \`""\`
5. Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "research:")
      read -r -d '' PROMPT << 'HEREDOC' || true
BEAST-PLAN: Research complete. Now run the PLANNING phase (iteration starts).

1. Read `${BASE_DIR}/CONTEXT.md` and `${BASE_DIR}/RESEARCH.md`
2. Spawn the planner agent:
   ```
   Task(subagent_type="beast:planner", model="opus", prompt=<CONTEXT.md + RESEARCH.md content>)
   ```
   Pass both files' content in the prompt. The planner creates a detailed, TDD-embedded, one-shot-executable implementation plan.
3. Create directory `${BASE_DIR}/iterations/01/` (use current iteration number, zero-padded)
4. Write the planner's output to `${BASE_DIR}/iterations/01/PLAN.md`
5. Update `${BASE_DIR}/state.json`: set `phase` to `"pipeline"`, `pipeline_actor` to `"planner"`
6. Emit `<bp-phase-done>`
HEREDOC
      ;;

    "pipeline:planner")
      ITER_DIR=$(printf "%02d" "$ITERATION")
      read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan created. Now run PARALLEL REVIEW (Skeptic + TDD simultaneously).

1. Read \`${BASE_DIR}/iterations/${ITER_DIR}/PLAN.md\`
2. Spawn BOTH agents simultaneously (in parallel):

   Agent 1 - Skeptic:
   \`\`\`
   Task(subagent_type="beast:skeptic", model="opus", prompt=<PLAN.md content + CONTEXT.md summary>)
   \`\`\`

   Agent 2 - TDD Reviewer:
   \`\`\`
   Task(subagent_type="beast:tdd-reviewer", model="sonnet", prompt=<PLAN.md content>)
   \`\`\`

3. Wait for BOTH to complete.
4. Write outputs:
   - Skeptic output to \`${BASE_DIR}/iterations/${ITER_DIR}/SKEPTIC-REPORT.md\`
   - TDD Reviewer output to \`${BASE_DIR}/iterations/${ITER_DIR}/TDD-REPORT.md\`
5. Update \`${BASE_DIR}/state.json\`: set \`pipeline_actor\` to \`"tdd-reviewer"\`
6. Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "pipeline:skeptic")
      ITER_DIR=$(printf "%02d" "$ITERATION")
      read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Skeptic review complete. Now run the TDD REVIEW.

1. Read \`${BASE_DIR}/iterations/${ITER_DIR}/PLAN.md\` and \`${BASE_DIR}/iterations/${ITER_DIR}/SKEPTIC-REPORT.md\`
2. Spawn the TDD reviewer agent:
   \`\`\`
   Task(subagent_type="beast:tdd-reviewer", model="sonnet", prompt=<PLAN.md content + SKEPTIC-REPORT.md content>)
   \`\`\`
   Pass the plan and skeptic report. The TDD reviewer checks test-first compliance and test quality.
3. Write the TDD reviewer's output to \`${BASE_DIR}/iterations/${ITER_DIR}/TDD-REPORT.md\`
4. Update \`${BASE_DIR}/state.json\`: set \`pipeline_actor\` to \`"tdd-reviewer"\`
5. Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "pipeline:tdd-reviewer")
      ITER_DIR=$(printf "%02d" "$ITERATION")
      read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: TDD review complete. Now run the CRITIC evaluation.

1. Read these files:
   - \`${BASE_DIR}/iterations/${ITER_DIR}/PLAN.md\`
   - \`${BASE_DIR}/iterations/${ITER_DIR}/SKEPTIC-REPORT.md\`
   - \`${BASE_DIR}/iterations/${ITER_DIR}/TDD-REPORT.md\`
   - \`${BASE_DIR}/CONTEXT.md\` (requirements summary)
2. Spawn the critic agent:
   \`\`\`
   Task(subagent_type="beast:critic", model="opus", prompt=<all file contents assembled>)
   \`\`\`
   Pass ALL files' content. The critic scores the plan, aggregates feedback, and issues a verdict.
3. Write the critic's output to \`${BASE_DIR}/iterations/${ITER_DIR}/CRITIC-REPORT.md\`
4. Parse the critic's verdict (APPROVED, REVISE, or REJECT) and scores from the output.
5. Update \`${BASE_DIR}/state.json\`:
   - Set \`pipeline_actor\` to \`"critic"\`
   - Set \`critic_verdict\` to the verdict string
   - Append scores to \`scores_history\` array
   - Set \`flags\` to any special flags from the critic (NEEDS_RE_RESEARCH, NEEDS_HUMAN_INPUT)
6. Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "pipeline:critic")
      case "$VERDICT" in
        "APPROVED")
          ITER_DIR=$(printf "%02d" "$ITERATION")
          read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan APPROVED by the Critic! Now FINALIZE.

1. Read the approved plan from \`${BASE_DIR}/iterations/${ITER_DIR}/PLAN.md\`
2. Copy it to \`${BASE_DIR}/FINAL-PLAN.md\`
3. Also write a plan-mode compatible version to a file the user can use:
   - Create \`~/.claude/plans/beast-plan-\$(date +%Y%m%d-%H%M%S).md\` with the plan content
4. Present the final plan to the human with:
   - Total iterations: ${ITERATION}
   - Final score and breakdown from \`${BASE_DIR}/iterations/${ITER_DIR}/CRITIC-REPORT.md\`
   - Summary of what was improved across iterations (if iteration > 1)
5. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"finalize"\`, \`pipeline_actor\` to \`""\`
6. Emit \`<bp-phase-done>\`
HEREDOC
          ;;

        "REVISE")
          NEW_ITER=$((ITERATION + 1))
          jq ".iteration = $NEW_ITER | .critic_verdict = \"\" | .pipeline_actor = \"planner\"" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
          OLD_ITER_DIR=$(printf "%02d" "$ITERATION")
          NEW_ITER_DIR=$(printf "%02d" "$NEW_ITER")

          # Check for NEEDS_RE_RESEARCH flag
          if echo "$FLAGS" | grep -q "NEEDS_RE_RESEARCH"; then
            read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan needs REVISION with RE-RESEARCH (iteration ${NEW_ITER} of ${MAX_ITER}).

The Critic flagged NEEDS_RE_RESEARCH. Run targeted research first.

1. Read the Critic report at \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/CRITIC-REPORT.md\` to identify what needs re-research.
2. Spawn the researcher agent with targeted scope:
   \`\`\`
   Task(subagent_type="beast:researcher", model="sonnet", prompt=<targeted research questions from critic report>)
   \`\`\`
3. Append the new findings to \`${BASE_DIR}/RESEARCH.md\` under a "## Supplemental Research (Iteration ${NEW_ITER})" heading.
4. Then read ALL feedback:
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/SKEPTIC-REPORT.md\`
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/TDD-REPORT.md\`
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/CRITIC-REPORT.md\`
   - Updated \`${BASE_DIR}/RESEARCH.md\`
   - \`${BASE_DIR}/CONTEXT.md\`
5. Spawn the planner agent:
   \`\`\`
   Task(subagent_type="beast:planner", model="opus", prompt=<all feedback + research + context>)
   \`\`\`
   Tell the planner: "Address EVERY issue from prior reports. Include a Revision Notes section."
6. Create directory \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/\`
7. Write the planner's output to \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/PLAN.md\`
8. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"pipeline"\`, \`pipeline_actor\` to \`"planner"\`, clear \`flags\`
9. Emit \`<bp-phase-done>\`
HEREDOC
          else
            read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan needs REVISION (iteration ${NEW_ITER} of ${MAX_ITER}).

1. Read ALL feedback from the previous iteration:
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/PLAN.md\` (previous plan for reference)
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/SKEPTIC-REPORT.md\`
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/TDD-REPORT.md\`
   - \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/CRITIC-REPORT.md\`
   - \`${BASE_DIR}/CONTEXT.md\`
   - \`${BASE_DIR}/RESEARCH.md\`
2. Spawn the planner agent:
   \`\`\`
   Task(subagent_type="beast:planner", model="opus", prompt=<all feedback + context + research>)
   \`\`\`
   Tell the planner: "This is iteration ${NEW_ITER}. Address EVERY issue from the Skeptic, TDD, and Critic reports. Include a Revision Notes section at the top listing each issue and how it was addressed. Do not silently ignore feedback."
3. Create directory \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/\`
4. Write the planner's output to \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/PLAN.md\`
5. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"pipeline"\`, \`pipeline_actor\` to \`"planner"\`, clear \`flags\`
6. Emit \`<bp-phase-done>\`
HEREDOC
          fi
          ;;

        "REJECT")
          NEW_ITER=$((ITERATION + 1))
          jq ".iteration = $NEW_ITER | .critic_verdict = \"\" | .pipeline_actor = \"planner\"" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
          OLD_ITER_DIR=$(printf "%02d" "$ITERATION")
          NEW_ITER_DIR=$(printf "%02d" "$NEW_ITER")

          # Check for NEEDS_HUMAN_INPUT flag
          if echo "$FLAGS" | grep -q "NEEDS_HUMAN_INPUT"; then
            read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan REJECTED with NEEDS_HUMAN_INPUT flag (iteration ${NEW_ITER} of ${MAX_ITER}).

The Critic needs human guidance before continuing.

1. Read the Critic report at \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/CRITIC-REPORT.md\`
2. Present the specific questions/decisions that need human input
3. Wait for human response — do NOT proceed automatically
4. After receiving human input, update \`${BASE_DIR}/CONTEXT.md\` with the new decisions
5. Then spawn the researcher if NEEDS_RE_RESEARCH is also flagged, otherwise go straight to planner
6. Continue the pipeline as normal after human input is incorporated

Do NOT emit any signals until human responds.
HEREDOC
          else
            read -r -d '' PROMPT << HEREDOC || true
BEAST-PLAN: Plan REJECTED (iteration ${NEW_ITER} of ${MAX_ITER}).

Fundamental issues require re-research.

1. Read the Critic report at \`${BASE_DIR}/iterations/${OLD_ITER_DIR}/CRITIC-REPORT.md\`
2. Spawn the researcher agent with targeted scope based on the rejection reasons:
   \`\`\`
   Task(subagent_type="beast:researcher", model="sonnet", prompt=<rejection reasons + targeted research questions>)
   \`\`\`
3. Append findings to \`${BASE_DIR}/RESEARCH.md\` under "## Re-Research (Iteration ${NEW_ITER})"
4. Read ALL prior feedback and updated research
5. Spawn the planner agent with all context
6. Create \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/\`
7. Write output to \`${BASE_DIR}/iterations/${NEW_ITER_DIR}/PLAN.md\`
8. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"pipeline"\`, \`pipeline_actor\` to \`"planner"\`, clear \`flags\`
9. Emit \`<bp-phase-done>\`
HEREDOC
          fi
          ;;

        *)
          # Unknown verdict — ask Claude to re-parse
          read -r -d '' PROMPT << 'HEREDOC' || true
BEAST-PLAN: Could not parse Critic verdict. Re-read the latest CRITIC-REPORT.md, extract the verdict (must be APPROVED, REVISE, or REJECT), update state.json with the correct critic_verdict, and emit <bp-phase-done>.
HEREDOC
          ;;
      esac
      ;;

    "finalize:")
      read -r -d '' PROMPT << 'HEREDOC' || true
BEAST-PLAN: Finalization complete. The plan has been delivered to the human.

Emit <bp-complete> to end the session.
HEREDOC
      ;;

    # === EXECUTE PHASE CASES ===

    "execute:prerequisites")
      read -r -d '' PROMPT << HEREDOC || true
BEAST: Prerequisites checked. Now parse the plan into tasks.

1. Read \`${BASE_DIR}/FINAL-PLAN.md\`
2. Extract all waves and tasks into \`${BASE_DIR}/tasks.json\`
3. Update \`${BASE_DIR}/state.json\`: set \`phase\` to \`"execute"\`, \`pipeline_actor\` to \`"running"\`
4. Begin executing Wave 1 tasks with TDD (follow the beast skill instructions)
5. Emit \`<bp-phase-done>\` after the current wave completes
HEREDOC
      ;;

    "execute:running")
      read -r -d '' PROMPT << HEREDOC || true
BEAST: Wave ${EXEC_WAVE} complete. Continue execution.

1. Check \`${BASE_DIR}/tasks.json\` for remaining waves
2. If more waves remain:
   - Run integration tests for the completed wave if applicable
   - Write \`${BASE_DIR}/wave-${EXEC_WAVE}-summary.md\` with tests added, files changed, issues encountered
   - Begin next wave's tasks with TDD
   - Update \`${BASE_DIR}/state.json\`: increment \`execution_wave\`
   - Emit \`<bp-phase-done>\` after the wave completes
3. If all waves done:
   - Update \`${BASE_DIR}/state.json\`: set \`pipeline_actor\` to \`"verify"\`
   - Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "execute:verify")
      read -r -d '' PROMPT << HEREDOC || true
BEAST: All waves executed. Run verification.

1. Run the full test suite -- all tests must pass
2. Execute each real-world verification step from FINAL-PLAN.md's Verification Strategy
3. Record results in \`${BASE_DIR}/verification-results.md\`
4. Update \`${BASE_DIR}/state.json\`: set \`pipeline_actor\` to \`"architect"\`
5. Emit \`<bp-phase-done>\`
HEREDOC
      ;;

    "execute:architect")
      read -r -d '' PROMPT << HEREDOC || true
BEAST: Verification complete. Run architect review.

1. Spawn the architect agent:
   \`\`\`
   Task(subagent_type="beast:architect", model="opus", prompt=<git diff + test results + verification results + FINAL-PLAN.md acceptance criteria>)
   \`\`\`
2. Write output to \`${BASE_DIR}/ARCHITECT-REVIEW.md\`
3. If APPROVED:
   - Update \`${BASE_DIR}/state.json\`: set \`pipeline_actor\` to \`""\`, \`phase\` to \`"complete"\`
   - Present completion summary to user
   - Emit \`<bp-complete>\`
4. If ISSUES found:
   - Fix the specific issues
   - Re-run tests
   - Re-verify
   - Emit \`<bp-phase-done>\` to re-trigger architect review
HEREDOC
      ;;

    *)
      # Unknown state — try to recover
      read -r -d '' PROMPT << 'HEREDOC' || true
BEAST-PLAN: Unknown state encountered. Read .beast-plan/state.json to understand current phase and continue the pipeline. If state is corrupted, present the situation to the human and ask for guidance.
HEREDOC
      ;;
  esac

  # Output the block decision with full prompt in reason field
  jq -n --arg reason "$PROMPT" '{"decision": "block", "reason": $reason}'
  exit 0
fi

# No signal detected — handle based on phase
case "$PHASE:$ACTOR" in
  "interview:")
    # Don't block during interview — let Claude wait for user input
    exit 0
    ;;
  *)
    # Autonomous phases — remind Claude to continue
    case "$PHASE:$ACTOR" in
      "research:")
        PROMPT="BEAST-PLAN: You are in the RESEARCH phase. Spawn the researcher agent and write results to RESEARCH.md. When done, update state.json and emit <bp-phase-done>."
        ;;
      "pipeline:planner")
        PROMPT="BEAST-PLAN: You are in the PLANNING phase. Spawn the planner agent and write PLAN.md. When done, update state.json and emit <bp-phase-done>."
        ;;
      "pipeline:skeptic")
        PROMPT="BEAST-PLAN: You are in the SKEPTIC phase. Spawn the skeptic agent and write SKEPTIC-REPORT.md. When done, update state.json and emit <bp-phase-done>."
        ;;
      "pipeline:tdd-reviewer")
        PROMPT="BEAST-PLAN: You are in the TDD REVIEW phase. Spawn the TDD reviewer agent and write TDD-REPORT.md. When done, update state.json and emit <bp-phase-done>."
        ;;
      "pipeline:critic")
        PROMPT="BEAST-PLAN: You are in the CRITIC phase. Spawn the critic agent and write CRITIC-REPORT.md. When done, update state.json with the verdict and emit <bp-phase-done>."
        ;;
      "finalize:")
        PROMPT="BEAST-PLAN: Finalization in progress. Complete the finalization steps and emit <bp-phase-done>."
        ;;
      "execute:prerequisites")
        PROMPT="BEAST: You are checking prerequisites. Verify all prerequisites from FINAL-PLAN.md, then update state.json and emit <bp-phase-done>."
        ;;
      "execute:running")
        PROMPT="BEAST: You are executing wave ${EXEC_WAVE}. Continue implementing tasks with TDD. When the wave is complete, update state.json and emit <bp-phase-done>."
        ;;
      "execute:verify")
        PROMPT="BEAST: You are in the verification phase. Run all verification steps from FINAL-PLAN.md, then update state.json and emit <bp-phase-done>."
        ;;
      "execute:architect")
        PROMPT="BEAST: You are in the architect review phase. Spawn the architect agent, then update state.json and emit <bp-phase-done>."
        ;;
      *)
        PROMPT="BEAST-PLAN: Session is active but state is unclear. Read .beast-plan/state.json and continue the current phase. Emit <bp-phase-done> when the current phase is complete."
        ;;
    esac
    jq -n --arg reason "$PROMPT" '{"decision": "block", "reason": $reason}'
    ;;
esac
