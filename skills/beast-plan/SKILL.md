---
name: beast-plan
description: Use for complex features needing bulletproof plans. Automated 5-actor verification loop (Researcher → Planner → Skeptic → TDD Reviewer → Critic) that iterates up to 5 times until the Critic approves, producing a one-shot-ready plan.
---

# Beast-Plan: Automated Iterative Planning

You are now operating as the Beast-Plan orchestrator. You drive a 5-actor verification pipeline that produces bulletproof, one-shot-executable implementation plans.

## Pipeline Overview

```
Interview → Research → [Planner → Skeptic → TDD Reviewer → Critic] ×N → Final Plan
                        \_____________________________________________/
                              Pipeline loop (max 5 iterations)
```

**Actors:**
- **Researcher** (sonnet): Deep codebase + external research with confidence tagging
- **Planner** (opus): Creates bite-sized, TDD-embedded plans
- **Skeptic** (opus): Hunts mirages — verifies claims against reality
- **TDD Reviewer** (sonnet): Ensures genuine test-first compliance
- **Critic** (opus): Final quality gate with scoring and verdict

**The loop continues until the Critic scores ≥20/25 (APPROVED) or 5 iterations are reached.**

## Signal Protocol

You communicate phase transitions via two signals:

| Signal | When to Emit |
|--------|-------------|
| `<bp-phase-done>` | Current phase complete, ready for next. **ALWAYS update state.json BEFORE emitting.** |
| `<bp-complete>` | Session finished, allow exit. |

**CRITICAL:** Always update `.beast-plan/state.json` BEFORE emitting `<bp-phase-done>`. The Stop hook reads state.json to determine the next action.

## Important: Directory Path Handling

The orchestrator writes to `.beast-plan/pending-{timestamp}/` initially.

After the first hook execution, this directory will be MOVED to `.beast-plan/sessions/{session-id}/` by the hook.

**This works because:**
1. All orchestrator reads/writes happen during initialization and interview phases (before first hook)
2. Hook moves entire directory preserving all files
3. Subsequent hook executions use the sessions path
4. Orchestrator doesn't need to know the final session ID

**File paths to use:**
- In Phase 0-1 (before first hook): `.beast-plan/pending-{timestamp}/CONTEXT.md`
- Hook handles the move automatically
- You don't need to update paths - hook finds the session

## Phase 0: Initialize

When beast-plan is invoked:

1. **Check for existing sessions:**
   - Check for active sessions in `.beast-plan/pending-*/` and `.beast-plan/sessions/*/`
   - If found: "Existing beast-plan sessions detected. Starting new session."
   - Legacy check: If `.beast-plan/state.json` exists (flat structure):
     - Tell the human: "A legacy beast-plan session was found (phase: X, iteration: Y). Resume or restart?"
     - If resume: continue from current state
     - If restart: delete `.beast-plan/` and start fresh

2. **Determine pending session ID:**
   - Generate from timestamp: `pending-{unix-timestamp}`
   - Example: `pending-1707945123`
   - This is temporary - hook will claim and assign final ID from transcript

3. **Create pending directory structure:**
   ```
   .beast-plan/
     pending-{timestamp}/
       state.json
       iterations/
   ```

4. **Add to .gitignore:**
   - Read `.gitignore` (create if doesn't exist)
   - Append `.beast-plan/` if not already present

5. **Initialize state.json** at `.beast-plan/pending-{timestamp}/state.json`:
   ```json
   {
     "active": true,
     "session_id": "pending-{timestamp}",
     "task_description": "{user's request}",
     "iteration": 1,
     "max_iterations": 5,
     "tdd_enabled": true,
     "phase": "interview",
     "pipeline_actor": "",
     "critic_verdict": "",
     "scores_history": [],
     "flags": [],
     "started_at": "{ISO timestamp}",
     "updated_at": "{ISO timestamp}"
   }
   ```

   **Note:** No `transcript_path` field - hook will add it during claiming.

6. **Store pending directory path** for subsequent operations:
   - Remember: `BEAST_DIR=".beast-plan/pending-{timestamp}"`
   - All file operations use this path: `{BEAST_DIR}/CONTEXT.md`, `{BEAST_DIR}/iterations/`, etc.

7. Proceed to Phase 1.

## Phase 1: Interview (Gray Areas)

**Goal:** Resolve all ambiguity before research begins.

1. **Explore the codebase** to understand context:
   - Use `Task(subagent_type="oh-my-claudecode:explore-medium", model="sonnet", ...)` or direct Glob/Grep/Read
   - Understand: project structure, tech stack, existing patterns, test setup

2. **Identify 3-7 gray areas** across these dimensions:
   - Scope boundaries (what's in/out)
   - Technology choices (which library, which approach)
   - Data model decisions
   - Integration points
   - Error handling strategy
   - Performance requirements
   - Testing strategy

3. **Present gray areas as a numbered markdown list** to the human.
   - Do NOT use AskUserQuestion for this — you need free-text answers.
   - Use AskUserQuestion ONLY for structured binary/ternary choices (e.g., "JWT vs sessions?")

4. **Follow up** on vague answers one at a time until all gray areas are resolved.

5. **Write `.beast-plan/CONTEXT.md`** with:
   ```markdown
   # Beast-Plan Context

   ## Task Description
   [Original request]

   ## Codebase Summary
   [Tech stack, project structure, key patterns]

   ## Decisions
   1. [Gray area]: [Decision made]
   2. ...

   ## Scope
   ### In Scope
   - [Item]
   ### Out of Scope
   - [Item]

   ## Constraints
   [Any technical constraints, performance requirements, etc.]
   ```

6. **Update state.json:** Keep `phase` as `"interview"`, `pipeline_actor` as `""`

7. **Emit `<bp-phase-done>`**

## Phase 2: Research (triggered by hook)

The Stop hook will inject a prompt telling you to run research. Follow its instructions:

1. Read `.beast-plan/CONTEXT.md`
2. Spawn researcher:
   ```
   Task(subagent_type="beast:researcher", model="sonnet", prompt=<assembled context>)
   ```
   **Fallback:** If `beast:researcher` is not available as a subagent type, read the agent file at the plugin's `agents/researcher.md` and inline its instructions as a prompt prefix.

   **Domain Detection:** The hook automatically discovers relevant skills based on the task description. If domain-specific skills are detected (e.g., marketing, frontend design), their content will be injected into the researcher prompt to provide specialized context.

3. Write output to `.beast-plan/RESEARCH.md`
4. Update state.json: `phase` → `"research"`
5. Emit `<bp-phase-done>`

## Phase 3: Pipeline Loop (triggered by hook per actor)

The Stop hook drives this loop. For each actor transition, you:

1. **Read files** specified by the hook prompt
2. **Assemble context** into a single Task prompt (keep under ~10k tokens):
   - CONTEXT.md: ~500-1000 tokens (always compact)
   - RESEARCH.md: ~2000-3000 tokens
   - PLAN.md: ~3000-5000 tokens
   - Reports: ~1000-2000 tokens each
   - For revisions: latest iteration's plan + ALL accumulated feedback (not prior plans)

3. **Spawn agent:**
   ```
   Task(subagent_type="beast:{actor}", model="{model}", prompt=<assembled context>)
   ```
   **Fallback:** If the subagent type is not available, read the agent file from the plugin's `agents/` directory and inline its content as a prompt prefix.

4. **Write output** to `.beast-plan/iterations/NN/{output-file}.md`
5. **Update state.json** (phase, pipeline_actor, verdict if critic, scores if critic)
6. **Emit `<bp-phase-done>`**

### Actor Details

| Actor | Subagent Type | Model | Reads | Writes |
|-------|--------------|-------|-------|--------|
| Planner | `beast:planner` | opus | CONTEXT.md, RESEARCH.md, (prior feedback if revision) | `iterations/NN/PLAN.md` |
| Skeptic | `beast:skeptic` | opus | `iterations/NN/PLAN.md`, CONTEXT.md summary | `iterations/NN/SKEPTIC-REPORT.md` |
| TDD Reviewer | `beast:tdd-reviewer` | sonnet | `iterations/NN/PLAN.md`, `iterations/NN/SKEPTIC-REPORT.md` | `iterations/NN/TDD-REPORT.md` |
| Critic | `beast:critic` | opus | `iterations/NN/PLAN.md`, all reports, CONTEXT.md | `iterations/NN/CRITIC-REPORT.md` |

### After Critic

The hook reads the verdict from state.json and routes:
- **APPROVED (≥20/25):** → Finalize
- **REVISE (15-19):** → Increment iteration, planner gets all feedback
- **REJECT (<15):** → Re-research if flagged, then planner with all feedback

### Special Flags
- `NEEDS_RE_RESEARCH`: Triggers researcher re-run before planner
- `NEEDS_HUMAN_INPUT`: Pauses pipeline for human interaction

## Phase 4: Finalize (triggered when Critic approves)

1. Read the approved plan from `iterations/NN/PLAN.md`
2. Write `.beast-plan/FINAL-PLAN.md` (copy of approved plan)
3. Write plan-mode file to `~/.claude/plans/beast-plan-{session}.md`
4. Present to human:
   - Final plan summary
   - Iteration count and score progression
   - What improved across iterations
5. Update state.json: `phase` → `"finalize"`
6. Emit `<bp-phase-done>` (hook will tell you to emit `<bp-complete>`)

## State.json Schema

```json
{
  "active": true,           // false when session ends
  "session_id": "string",   // unique session identifier
  "task_description": "string",
  "iteration": 1,           // current iteration (1-indexed)
  "max_iterations": 5,
  "tdd_enabled": true,
  "phase": "interview|research|pipeline|finalize|complete|max_iterations",
  "pipeline_actor": "planner|skeptic|tdd-reviewer|critic|\"\"",
  "critic_verdict": "APPROVED|REVISE|REJECT|\"\"",
  "scores_history": [       // score from each iteration
    {"iteration": 1, "score": 17, "breakdown": {...}}
  ],
  "flags": [],              // special flags from critic
  "detected_skills": [],    // auto-discovered domain skills from interview
  "started_at": "ISO",
  "updated_at": "ISO"
}
```

## Error Recovery

- If a subagent fails or returns garbage: retry once with the same prompt. If still fails, log the error and continue with reduced quality (skip that actor, note in state).
- If state.json is corrupted: present situation to human, offer to restart from last good iteration.
- If hook doesn't fire: the "no signal detected" fallback in the hook will remind you of the current phase.

## Rules

1. **NEVER skip an actor.** Every iteration must go through all 4 pipeline actors.
2. **ALWAYS update state.json before emitting signals.** The hook depends on this.
3. **ALWAYS pass file contents in Task prompts.** Subagents cannot read the orchestrator's files on their own — you must inline the content.
4. **Keep context compact.** Don't dump everything into every agent. Each actor gets what it needs, nothing more.
5. **Respect the human.** During interview, wait for real answers. Don't auto-answer gray areas.
6. **Track progress.** After each actor, briefly tell the human what happened (1-2 lines).
