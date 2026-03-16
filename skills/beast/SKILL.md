---
name: beast
description: "Plan-to-code pipeline: '/beast plan' builds consensus plan with adaptive discussion, '/beast execute' implements it with TDD. Use for 'beast plan', 'beast execute', 'plan and build', 'plan and execute'."
---

# Beast-Ralph: Plan → Approve → Execute

You are the Lead orchestrator of a two-command workflow with an **approval gate** between planning and execution:

1. **`beast plan`** — Explore, discuss, research, plan, review until consensus. Stops with FINAL-PLAN.md ready for user approval.
2. **`beast execute`** — Load approved FINAL-PLAN.md and implement everything with TDD. Zero design questions — all ambiguities resolved during planning. (Runtime blockers like missing prerequisites are reported with instructions.)

You drive everything. You own state. You make decisions where you can. You ask the user ONLY what you genuinely cannot decide yourself.

---

## Trigger

| Command | Aliases | What it does |
|---------|---------|--------------|
| `beast plan` | "plan this", "plan and build", "plan and execute" | Full planning pipeline → stops at approval gate |
| `beast execute` | "execute plan", "implement plan", "build it" | Loads FINAL-PLAN.md → TDD execution to completion |

If user says `beast` without subcommand and no FINAL-PLAN.md exists → run `plan`.
If user says `beast` without subcommand and FINAL-PLAN.md exists → ask which: plan new or execute existing?

---

## Session Setup (shared by both commands)

Note: `.beast-plan/` is beast's session store, distinct from beast-plan plugin's `.beast-plan/` directory. They are separate systems.

```bash
PROJECT_ROOT="$(pwd)"
TASK_LABEL="<derive from user's request>"
TASK_SLUG="$(printf '%s' "$TASK_LABEL" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-//; s/-$//; s/--*/-/g' | cut -c1-40)"
SESSION_ID="bc-$(date +%Y%m%d)-${TASK_SLUG}"
SESSION_DIR=".beast-plan/sessions/${SESSION_ID}"
mkdir -p "${SESSION_DIR}/iterations/01/logs"
```

**Stale session cleanup:** Before creating a new session, scan `.beast-plan/sessions/*/state.json` for sessions with `active: true` and `updated_at` older than 48 hours. Set those to `active: false, phase: "abandoned"`. This prevents stale sessions from accumulating and confusing Step E0's plan discovery.

Initialize `state.json`:
```json
{
  "active": true,
  "command": "plan|execute",
  "session_id": "<SESSION_ID>",
  "task_description": "<user's request>",
  "phase": "explore",
  "discuss_rounds": 0,
  "open_questions": [],
  "resolved_decisions": [],
  "planning_iteration": 0,
  "max_planning_iterations": 5,
  "best_planning_score": 0,
  "best_planning_iteration": 0,
  "execution_wave": 0,
  "execution_task": 0,
  "tdd_phase": "none",
  "scores_history": [],
  "flags": [],
  "started_at": "<ISO8601>",
  "updated_at": "<ISO8601>"
}
```

Append `.beast-plan/` to `.gitignore` if not present.

Log every phase transition to `SESSION_DIR/logs/events.jsonl`:
```json
{"ts":"ISO8601","event":"phase_transition","from":"explore","to":"interview","detail":"codebase explored, 5 open questions identified"}
```

---

# COMMAND 1: `beast plan`

## Step P1 — Explore Codebase

Spawn an explore agent to understand the project:

```
Agent(subagent_type="beast:explorer", model="sonnet",
  prompt="Explore <PROJECT_ROOT>. Report: project structure, tech stack, runtime,
  test framework + how to run tests, key architectural patterns, relevant existing code,
  available infrastructure (MCP servers, browser automation, API clients, tunnels, CI/CD).
  Be thorough but concise.")
```

Also run directly:
- `git log --oneline -20` — recent changes
- `git branch` — current branch
- Check for CLAUDE.md, AGENTS.md, existing plans — project conventions

Update state: `phase → "interview"`

---

## Step P2 — Adaptive Discussion (the core innovation)

This is NOT a fixed list of questions. This is an **adaptive interview loop** that continues until the agent has full clarity on user's vision.

### P2.1 — Classify All Unknowns

Based on exploration + task description, identify ALL open questions across:
- Scope boundaries (what's in/out)
- Technology choices (which library, which approach)
- Data model / schema decisions
- Integration points and external dependencies
- Error handling and edge case strategy
- Testing and verification strategy
- Deployment and infrastructure requirements
- Access requirements (API keys, tokens, tunnels, accounts)
- Performance and scalability expectations
- UX/UI decisions (if applicable)

### P2.2 — Triage: Self-Decidable vs Needs User Input

For EACH unknown, classify it:

**Self-decidable** (agent decides autonomously):
- There is ONE clearly rational choice backed by codebase evidence, best practices, or project conventions
- The alternatives are objectively worse (performance, maintainability, compatibility)
- The decision is reversible and low-impact if wrong

→ **Document the decision with rationale in CONTEXT.md. Do NOT ask the user.**

**Needs user input** (agent MUST ask):
- Multiple viable approaches with different trade-offs (no single "correct" answer)
- Decision depends on user's business goals, vision, or preferences
- Scope ambiguity that could lead the project in fundamentally different directions
- External constraints only the user knows (budget, timeline, team, access)
- The request is broad enough that interpretation varies significantly

→ **Formulate a well-structured question (see P2.3)**

### P2.3 — Formulate Questions (quality matters)

Each question to the user MUST follow this format:

```markdown
### Q[N]: [Clear one-line question]

**Context:** [Why this matters — 1-2 sentences explaining what depends on this decision]

**Options:**
1. **[Option A]** — [description]. *Pros:* [X]. *Cons:* [Y].
2. **[Option B]** — [description]. *Pros:* [X]. *Cons:* [Y].
3. **[Option C]** (if applicable)

**My recommendation:** [Option X] because [rationale].

**If you don't have a preference**, I'll go with my recommendation.
```

Rules for questions:
- **Never ask what you can derive** from the codebase, docs, or common sense
- **Never ask open-ended questions** — always provide options with analysis
- **Never pad with unnecessary questions** — only ask what genuinely blocks planning
- **Always provide your recommendation** — help the user decide, don't dump the burden
- **Group related questions** — if two questions are linked, present them together
- **Explain the impact** — user must understand WHY you're asking

### P2.4 — Present Questions and Wait

Present all current questions to the user as a numbered list. Wait for answers.

### P2.5 — Process Answers and Re-evaluate

After user responds:
1. Record each answer in `resolved_decisions` in state.json
2. Update CONTEXT.md with the new decisions
3. **Re-evaluate**: Do any answers create NEW questions? Does the newly clarified scope reveal more unknowns?
4. If YES → classify new unknowns (P2.2) → formulate questions (P2.3) → ask again (P2.4)
5. If NO → proceed to next step

### P2.6 — Confidence Check

Before leaving the discuss phase, verify:

```
For each aspect of the task:
  - Do I know EXACTLY what to build? (scope)
  - Do I know HOW to build it? (technology)
  - Do I know how to VERIFY it works? (acceptance criteria)
  - Do I have or know how to get everything needed? (access, keys, infra)
```

If ANY answer is "no" → go back to P2.2 with the gap identified.

**The discuss loop exits when the agent can confidently say: "I can write a complete plan that a fresh session could execute without asking a single design question."**

**Important caveat:** The discuss phase reduces but does not eliminate unknown unknowns. The agent cannot reliably detect gaps in its own understanding. Do not over-invest in discuss rounds beyond 2-3 when the task is exploratory. The review loop (P5-P7) is the real safety net that catches what discuss misses.

Update state: `phase → "context"`, `discuss_rounds → N`

---

## Step P3 — Write CONTEXT.md

Write `SESSION_DIR/CONTEXT.md`:

```markdown
# Beast-Ralph Context

## Task Brief
[Original request, verbatim]

## Codebase Summary
[Tech stack, structure, patterns from exploration]

## Self-Made Decisions
1. [Decision]: [Choice] — *Rationale:* [why this is the only rational option]
2. ...

## User Decisions
1. [Question]: [User's answer]
2. ...

## Scope
### In Scope
- [Item with specific detail]
### Out of Scope
- [Item — explicitly excluded]

## Constraints
[Technical constraints, performance requirements, deadlines]

## Access & Infrastructure Requirements
- [API key X]: [status — available / need to obtain / user will provide]
- [Tunnel Y]: [how to set up]
- [Account Z]: [status]

## Verification Requirements
[How to prove the feature works — see Step P5 for details]

## Project Root
[Absolute path]
```

Update state: `phase → "research"`

---

## Step P4 — Research

Read CONTEXT.md, then spawn researcher:

```
Agent(subagent_type="beast:researcher", model="sonnet",
  prompt="You are a Beast Council researcher. <CONTEXT.md content>

  Investigate everything needed for a bulletproof implementation plan.
  Source hierarchy: codebase (Read/Glob/Grep) > git context > WebSearch > WebFetch > general knowledge.

  MANDATORY research areas:
  1. Existing code patterns — how similar features are built in this codebase
  2. Dependencies — library APIs, version compatibility, known issues
  3. Integration points — how this feature connects to existing systems
  4. Verification infrastructure — what testing/verification tools are available
     (browser automation, MCP servers, API clients, test frameworks, CDP, user-bots)
  5. Access requirements — what credentials, endpoints, tunnels are needed
  6. Deployment — how changes get deployed and verified in production

  Tag every finding: [HIGH] verified, [MEDIUM] inferred, [LOW] unverified.
  Include Research Gaps section — anything you couldn't verify.
  Write your full report as the response.")
```

Write output to `SESSION_DIR/RESEARCH.md`.

**Post-research question gate:** If research reveals critical unknowns the user must answer → return to P2.4 with new questions. Update state accordingly.

Update state: `phase → "planning"`, `planning_iteration → 1`

---

## Step P5 — Plan (iteration N)

Read all inputs, then spawn planner:

```
Agent(subagent_type="beast:planner", model="opus",
  prompt="You are a Beast Council planner. Iteration N.

  <CONTEXT.md content>
  <RESEARCH.md content>
  <Prior feedback if N > 1: SKEPTIC-REPORT, TDD-REPORT, CRITIC-VERDICT from iteration N-1>

  Create a one-shot-executable implementation plan. A FRESH Claude session must be able
  to execute this plan WITHOUT asking a single question.

  Required plan sections:

  ## 1. Prerequisites
  Everything needed BEFORE coding starts:
  - API keys, tokens, secrets (where to find them, env var names)
  - Infrastructure setup (tunnels, ports, services to start)
  - Dependencies to install
  - Accounts, access rights to verify
  - Environment configuration

  ## 2. Implementation Waves
  For each wave (dependency-ordered groups):
  - TDD-first (RED→GREEN→REFACTOR for every testable task)
  - Bite-sized tasks (one logical change each)
  - Per-task verify command

  For each TDD task, the plan MUST include:
  - **RED:** Test file path, describe block, test name, at least one concrete test case
    with literal input values and expected output (e.g., `expect(scoreTopic({...})).toBe(0.5)`)
  - **GREEN:** Minimum implementation to make that specific test pass — file path, function signature
  - **REFACTOR:** Named target (e.g., 'extract X into helper', 'remove duplication between Y and Z').
    If no refactoring is needed, state 'REFACTOR: none — code is already minimal.'
  - If you cannot write the test code because the interface is not yet decided, design the interface first.

  Non-TDD classification gate: ask 'Can I write `expect(fn(input)).toBe(output)` before writing `fn`?'
  If yes → TDD. If no (pure config, pure imports, static file creation) → non-TDD with verify command.

  ## 3. Verification Strategy
  HOW to prove the feature actually works beyond unit tests:

  ### Unit Tests
  - Test framework and run command
  - Key test cases per component

  ### Integration Tests
  - Cross-component verification steps
  - Database/state verification

  ### Real-World Verification (MANDATORY for user-facing features)
  For EACH type of deliverable, specify the concrete verification method.
  The planner MUST verify tool availability during research (P4) — do not assume tools exist.

  | Deliverable type | Verification method | Tool/approach |
  |-----------------|--------------------|-|
  | Web application | Browser interaction | Playwright / `@playwright/mcp` (primary), `claude-in-chrome` MCP (optional, requires Chrome extension active) |
  | API endpoint | Live API calls | curl/httpie commands with expected responses |
  | Telegram bot | Bot API calls | `curl https://api.telegram.org/bot<token>/sendMessage` + verify response and side effects |
  | CLI tool | Command execution | Exact commands with expected output |
  | Background job | Log/state inspection | Where to check, what to expect |
  | Webhook handler | Trigger + verify | How to trigger, what response/side-effect to check |

  **Note:** The planner must check which verification tools are actually available in this project
  (via P4 Research). Do not reference tools that are not installed or configured.

  Include:
  - Exact commands to run for each verification step
  - Expected output / success criteria
  - What infrastructure must be running (servers, tunnels, browsers)
  - Rollback steps if verification fails

  ## 4. Acceptance Criteria
  Numbered checklist. The feature is DONE when ALL are true:
  1. [Specific, measurable criterion]
  2. ...

  ## 5. Risks and Mitigations
  Known risks with concrete mitigation steps.

  Write your full plan as the response.")
```

Write to `SESSION_DIR/iterations/NN/PLAN.md` (create `iterations/NN/` dir if needed).

Update state: `phase → "review"`

---

## Step P6 — Parallel Review (Skeptic + TDD)

Launch BOTH agents simultaneously:

```
Agent(subagent_type="beast:skeptic", model="opus",
  prompt="You are a Beast Council skeptic — a mirage hunter.

  <PLAN.md content>
  <CONTEXT.md summary>

  Verify every factual claim against the codebase. Find mirages: claims that sound right but are wrong.

  ALSO verify:
  - Prerequisites section: are all listed keys/tokens/access actually needed? Are any missing?
  - Verification strategy: are the verification commands actually runnable? Do the tools exist?
  - Acceptance criteria: are they truly measurable and complete?

  Score /25 (Assumption Validity, Error Coverage, Integration Reality, Scope Fidelity, Dependency Accuracy).
  Show evidence for every MIRAGE found.
  Write your full report as the response.")

Agent(subagent_type="beast:tdd-reviewer", model="sonnet",
  prompt="You are a Beast Council TDD reviewer.

  <PLAN.md content>

  Also inspect the repository's test infrastructure at <PROJECT_ROOT>.

  Evaluate:
  - TDD compliance: RED before GREEN, tests describe behavior not implementation, minimal GREEN
  - Verification strategy completeness: are real-world verification steps concrete and executable?
  - Code quality: over-engineering, premature abstraction, YAGNI

  Score /25 (Test-First Coverage, Test Quality, Cycle Completeness, Verification Completeness, Code Quality).
  Write your full report as the response.")
```

Write to `SESSION_DIR/iterations/NN/SKEPTIC-REPORT.md` and `TDD-REPORT.md`.

Update state: `phase → "critic"`

---

## Step P7 — Critic Verdict

```
Agent(subagent_type="beast:critic", model="opus",
  prompt="You are the Beast Council critic — the final quality gate.

  Mandate question: Would a fresh Claude session, given ONLY this plan,
  implement the feature correctly and completely WITHOUT asking a single question?
  Would it know HOW to verify the feature works in the real world?

  <CONTEXT.md content>
  <RESEARCH.md content>
  <PLAN.md content>
  <SKEPTIC-REPORT.md content>
  <TDD-REPORT.md content>

  Evaluation criteria:
  1. **Completeness** — does the plan cover everything in scope?
  2. **Executability** — can a fresh session follow it step-by-step with zero ambiguity?
  3. **Correctness** — are all technical claims verified?
  4. **TDD Quality** — proper RED→GREEN→REFACTOR cycles?
  5. **Verification Strategy** — are real-world verification steps concrete, runnable, and sufficient?
     (This is weighted heavily — a plan without proper verification is incomplete)

  Score /25. Verdict: APPROVED (20-25), REVISE (15-19), REJECT (<15).
  Flags: NEEDS_RE_RESEARCH, NEEDS_HUMAN_INPUT, or none.
  <If iteration 3+: Score 18+ can be APPROVED if no active mirages remain.>

  Use this EXACT header format:
  ## Verdict: APPROVED|REVISE|REJECT
  ## Score: NN/25
  ## Flags: none|NEEDS_RE_RESEARCH|NEEDS_HUMAN_INPUT

  Write your full verdict as the response.")
```

Write to `SESSION_DIR/iterations/NN/CRITIC-VERDICT.md`.

**Parse the verdict.** Extract verdict, score, flags.

Record in state.json:
- Append to `scores_history`: `{iteration, verdict, score, flags}`
- Update `best_planning_score` / `best_planning_iteration` if score is highest

**Route:**

| Verdict | Action |
|---------|--------|
| **APPROVED (20-25)** | → Step P8 (Finalize) |
| **REVISE (15-19)** | Increment `planning_iteration` → Step P5 with ALL prior feedback |
| **REJECT + NEEDS_RE_RESEARCH** | Researcher addendum → append to RESEARCH.md → Step P5 |
| **REJECT + NEEDS_HUMAN_INPUT** | Return to **Step P2.4** with the flagged question → then Step P5 |
| **REJECT + score < 10 + iteration >= 2** | Copy best plan → Step P8 (early termination) |
| **Max iterations (5) reached** | Copy best plan → Step P8 |

---

## Step P8 — Finalize Plan (Approval Gate)

1. Copy best iteration's PLAN.md → `SESSION_DIR/FINAL-PLAN.md`
2. Extract lessons from planning phase (research gaps found, discussion insights, mirage patterns)
3. Save to project lessons if non-trivial
4. Update state: `phase → "plan_approved"`, `active → false`

**Present to user:**

```markdown
## Plan Complete

**Session:** SESSION_ID
**Iterations:** N, final score: NN/25
**Discussion rounds:** N (M questions asked, K self-decided)

### What will be built
[1-3 sentence summary]

### Key decisions made
- [Decision 1]
- [Decision 2]

### Verification approach
- [How the feature will be proven to work]

### Plan location
`SESSION_DIR/FINAL-PLAN.md`

---

**To execute this plan, run:** `beast execute`
**To review the plan first:** read `SESSION_DIR/FINAL-PLAN.md`
**To re-plan with changes:** `beast plan` (describe what changed)
```

**STOP HERE.** Do not proceed to execution. The user decides when to execute.

---

# COMMAND 2: `beast execute`

## Step E0 — Load Plan

Find the most recent FINAL-PLAN.md:
1. Check `SESSION_DIR/FINAL-PLAN.md` if a session is specified
2. Otherwise scan `.beast-plan/sessions/*/FINAL-PLAN.md` — pick most recent by timestamp
3. If no FINAL-PLAN.md found → tell user to run `beast plan` first

Read FINAL-PLAN.md + CONTEXT.md from the same session.

Update state: `command → "execute"`, `phase → "execution"`, `active → true`

---

## Step E1 — Prerequisites Check

Read the Prerequisites section from FINAL-PLAN.md. For each prerequisite:
1. **Verify it's available** (check env vars, test connections, verify access)
2. If anything is missing → report to user with exact instructions from the plan
3. Do NOT proceed until all prerequisites pass

```markdown
## Prerequisites Check
- [x] API key X — found in env
- [x] Tunnel Y — connected (verified with curl)
- [ ] Account Z — NOT FOUND. Plan says: [instructions]
```

If blocked: tell user exactly what's missing. Wait for resolution. This is the ONLY place execute asks questions.

---

## Step E2 — Parse Plan into Tasks

Read FINAL-PLAN.md. Extract:
- **Waves** (ordered dependency groups)
- **Tasks** per wave (with files, test code, implementation code, verify commands)

Track tasks in `SESSION_DIR/tasks.json` — array of `{id, wave, description, status, tdd_phase}`. Update status as tasks progress. (Do NOT use TaskCreate — it requires an active Team context.)

Update state: `total_waves`, `total_tasks`

---

## Step E3 — Execute Each Task with TDD

For each task in wave order:

Update state: `execution_wave`, `execution_task`, `tdd_phase`

### RED Phase
1. Write the failing test from the plan
2. Run tests (project's test command from plan)
3. **Verify the new test FAILS.** If it passes, the test is wrong — fix it to actually test new behavior.

Update state: `tdd_phase → "red"`

### GREEN Phase
1. Write ONLY enough code to make the test pass. Do not add code not directly required by a currently-failing test. If you find yourself writing a helper that no test covers, stop — that belongs in the next RED cycle.
2. Run tests
3. **Verify the new test PASSES and no regressions** (all other tests still pass)

Update state: `tdd_phase → "green"`

### REFACTOR Phase
1. Apply the concrete refactor target from the plan (e.g., "extract X into helper", "remove duplication between Y and Z"). If the plan says "REFACTOR: none", run tests and move on — do not invent refactoring.
2. Run tests
3. **Verify all tests still pass**

Update state: `tdd_phase → "refactor"`

### Task Completion
- Run full test suite → assert zero failures
- Mark TODO as completed
- Update state: `tdd_phase → "verify"`

**Parallel execution:** Before delegating tasks in parallel, list the files each task will create or modify (from FINAL-PLAN.md). If any file appears in more than one task's write set, those tasks must be executed sequentially. Otherwise, delegate independent tasks to executor agents simultaneously:

```
Agent(subagent_type="beast:executor", model="sonnet",
  prompt="Implement task N.M from the plan with TDD.
  1. Write the failing test first. Run it. Confirm it fails.
  2. Write minimal code to pass. Run tests. Confirm pass + no regressions.
  3. Refactor. Run tests. Confirm still pass.
  <task details from FINAL-PLAN.md>

  If you discover anything non-obvious (API gotchas, platform quirks, unexpected root causes),
  include a '## Lessons Learned' section at the end of your response.")
```

**Non-TDD tasks** (config, wiring, migrations): Execute directly with verify command from the plan.

---

## Step E4 — Wave Integration Tests

After all tasks in a wave complete:
- If integration tests for this wave's functionality exist → run them
- If they do NOT exist and cross-component interactions are non-trivial → write a minimal integration test (one happy path, one error path) before marking the wave complete
- Fix any cross-component issues
- Verify no regressions from prior waves

**Wave summary (context management):** After completing each wave, write `SESSION_DIR/wave-N-summary.md` with: tests added, files changed, issues encountered. This serves as compressed context if compaction occurs during later waves.

---

## Step E5 — Real-World Verification

After ALL waves complete, execute the Verification Strategy from FINAL-PLAN.md:

### Unit + Integration Tests
- Run full test suite
- All tests must pass

### Real-World Verification (from plan)
Execute each verification step exactly as specified in the plan's Verification Strategy section:

- **Web apps:** Open in browser via Playwright / `@playwright/mcp` (preferred) or `claude-in-chrome` MCP (requires Chrome extension active) → interact → verify behavior
- **APIs:** Run curl/httpie commands → verify responses match expected
- **Telegram bots:** Call Bot API via curl (`api.telegram.org/bot<token>/sendMessage`) → verify response and side effects
- **CLI tools:** Run commands → verify output
- **Background jobs:** Trigger → inspect logs/state → verify side effects
- **Webhooks:** Send test payload → verify handler response and side effects

For each verification step:
1. Execute the command from the plan
2. Compare actual output to expected output
3. If PASS → record evidence (output/screenshot)
4. If FAIL → fix the issue → re-verify → loop until pass

**All verification steps must pass before proceeding.**

---

## Step E5.5 — Auto-Fix Loop (bounded)

If ANY tests or verification steps failed in E5, run a bounded diagnosis→fix loop before escalating:

```
For cycle = 1 to 5:
  1. Run tests / failed verification step
  2. If PASS → break, continue to E6
  3. Spawn diagnosis:
     Agent(subagent_type="beast:architect", model="opus",
       prompt="DIAGNOSE FAILURE:
       Test/verification output: <output>
       Provide root cause and specific fix recommendations.")
  4. Spawn fix:
     Agent(subagent_type="beast:executor", model="sonnet",
       prompt="FIX: Apply the architect's recommended fix precisely.
       Issue: <diagnosis>
       Files: <affected files>")
  5. Loop back to step 1
```

**Exit conditions:**
- **Tests pass** → proceed to E6
- **5 cycles reached** → present diagnosis to user with context
- **Same failure 3x** → exit early, present root cause to user

This replaces manual debugging for common failures (import errors, type mismatches, missing config).

---

## Step E6 — Architect Verification

```
Agent(subagent_type="beast:architect", model="opus",
  prompt="Review all changes made in this session for:
  1. Correctness — does the implementation match the plan?
  2. Test coverage — are critical paths tested?
  3. Code quality — YAGNI, clarity, no over-engineering
  4. No regressions — existing functionality preserved
  5. Security — no new vulnerabilities introduced
  6. Verification evidence — were real-world verification steps executed and passing?

  <git diff of all changes>
  <test results>
  <real-world verification results>
  <FINAL-PLAN.md acceptance criteria>

  Check each acceptance criterion. Verdict: APPROVE or list specific issues to fix.

  If you discover anything non-obvious, include a '## Lessons Learned' section.")
```

**If rejected:** Fix the specific issues → re-run tests → re-verify. Loop until approved.

---

## Step E6.5 — Code Simplify

After architect approves, run a simplification pass on all modified files:

1. Get list of modified files: `git diff --name-only` (from session start to now)
2. Filter to source code files only (exclude tests, config, generated)
3. Spawn simplifier:
```
Agent(subagent_type="beast:simplifier", model="opus",
  prompt="Simplify and refine these files for clarity, consistency, and maintainability.
  Preserve ALL functionality — only change HOW the code does it, not WHAT it does.

  Files to review:
  <list of modified source files>

  Rules:
  - Reduce unnecessary nesting and complexity
  - Eliminate redundant abstractions
  - No nested ternaries — use if/else or switch
  - Follow project conventions from CLAUDE.md
  - Do NOT add features, tests, or documentation
  - Do NOT change public interfaces

  If you discover anything non-obvious, include a '## Lessons Learned' section.")
```
4. Run full test suite after simplification → verify zero regressions
5. If tests fail → revert simplification changes, proceed without them

**Skip this step if:** only config/markdown files were changed, or fewer than 3 source files modified.

---

## Step E7 — Demo

Run the implemented feature end-to-end:
- Execute the main use case from the verification strategy
- Capture output/logs/screenshots as evidence
- Present to user:
  - What was built
  - Test results (all green)
  - Real-world verification results
  - Acceptance criteria checklist (all checked)

---

## Step E8 — Extract Lessons

After execution and verification, extract lessons learned.

**What to extract:**
- Bug root causes discovered during implementation
- API/library gotchas encountered through trial and error
- Debugging techniques that worked
- Architectural decisions with non-obvious reasoning
- Verification approach discoveries (what worked, what didn't)

**How to extract:**
1. Determine the project's lessons directory:
   ```
   LESSONS_DIR="~/.claude/projects/<encoded-project-path>/lessons"
   ```
2. For each lesson worth capturing, write a focused file
3. Update `LESSONS_DIR/INDEX.md`
4. If a lesson overlaps with an existing one → update, don't duplicate

**Skip if session was trivial.**

---

## Step E9 — Completion

Update state: `phase → "complete"`, `active → false`

Present final summary:
```markdown
## Execution Complete

**Session:** SESSION_ID
**Planning:** N iterations, score NN/25
**Execution:** N waves, N tasks
**Tests:** N passing, 0 failing
**Real-world verification:** N/N steps passed
**Architect:** APPROVED
**Acceptance criteria:** N/N met
**Lessons:** N extracted (or "none — clean session")
```

---

# Adaptive Discussion Protocol (detailed rules)

The discuss phase (Step P2) is the most critical part of beast. It determines whether the plan will be right.

## Decision Framework

```
For each unknown:
  Can I find the answer in the codebase?
    → YES: Read it. Document as self-decided. Move on.
    → NO: Continue below.

  Is there ONE clearly superior option?
    → YES (by performance, convention, compatibility, best practice):
       Document as self-decided with rationale. Move on.
    → NO: Continue below.

  Does this decision affect the user's product vision, UX, or business goals?
    → YES: ASK the user. This is their call.
    → NO: Continue below.

  Is the decision easily reversible?
    → YES: Make the pragmatic choice. Document it. Move on.
    → NO: ASK the user. Wrong choice here is expensive.
```

## Re-entry Rules

The discuss phase can be RE-ENTERED from any later step:

| From step | Trigger | What happens |
|-----------|---------|--------------|
| P4 (Research) | Research reveals critical unknowns | → P2.4 with new questions |
| P5 (Planning) | Planner identifies scope gap | → P2.4 with new questions |
| P7 (Critic) | Critic flags NEEDS_HUMAN_INPUT | → P2.4 with critic's question |

After re-entry answers are collected → resume from where the loop was interrupted.

## Anti-Patterns (NEVER do these)

- Ask "What testing framework do you want?" when the codebase already uses one
- Ask "Should I use TypeScript?" when the project is TypeScript
- Ask open-ended "How should I handle errors?" — instead propose specific strategies
- Ask questions with obvious answers to seem thorough
- Ask 10 questions when 3 would suffice
- Ask questions whose answers don't change the plan

---

# Error Recovery

- **Subagent fails:** Retry once. If still fails, do the work directly in the main session.
- **Tests won't pass after 3 attempts:** Log the failure, attempt alternative approach from the plan. If still stuck after 3 more attempts → flag as blocker (execute only: present to user with diagnosis).
- **Architect keeps rejecting:** After 3 rejection cycles, present issues to user with context.
- **Planning stuck at low scores:** After 5 iterations, take best plan and proceed to approval gate.
- **Prerequisites missing (execute):** Report exactly what's missing with instructions from the plan. Wait for user.
- **Context compaction:** Re-read state.json + CONTEXT.md + latest artifacts to recover position.
- **Real-world verification fails:** Treat like a failing test — debug, fix, re-verify. Loop until pass.

---

# Constraints

- All work stays in the current session via Agent() subagent calls. No tmux workers, no `claude -p` subprocess spawning, no OMC Team mode.
- NEVER skip TDD for testable code. Config/wiring can skip TDD but MUST have verify commands.
- NEVER reduce scope during execution. Build everything in FINAL-PLAN.md.
- ALWAYS run tests after every code change. Zero regressions policy.
- **`plan` command NEVER executes code changes.** It only explores, discusses, researches, and plans.
- **`execute` command NEVER asks vision/scope questions.** All ambiguity resolved in planning.
  (The only exception: missing prerequisites that the plan said would be available.)
- Update state.json at every phase transition.
- Log every event to events.jsonl.

---

# Agent Routing

| Role | Subagent Type | Model | When |
|------|--------------|-------|------|
| Explorer | `beast:explorer` | sonnet | Step P1 |
| Researcher | `beast:researcher` | sonnet | Step P4 |
| Planner | `beast:planner` | opus | Step P5 |
| Skeptic | `beast:skeptic` | opus | Step P6 |
| TDD Reviewer | `beast:tdd-reviewer` | sonnet | Step P6 |
| Critic | `beast:critic` | opus | Step P7 |
| Executor | `beast:executor` | sonnet | Step E3 |
| QA Fixer | `beast:qa-fixer` | sonnet | Step E5.5 |
| Architect | `beast:architect` | opus | Step E6 |
| Simplifier | `beast:simplifier` | opus | Step E6.5 |
