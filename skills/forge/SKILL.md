---
name: forge
description: "Ore in, steel out. Planning pipeline with independent verification, persistent memory, and compounding knowledge. Use for 3+ files or unclear scope."
---

# Forge — Ore In, Steel Out

Two machines: **Plan Forge** (refine until bulletproof) + **Verification Chain** (prove it's actually done). Ralph provides persistence.

## When to Use
- Task touches 3+ files or has unclear scope
- Architecture decisions needed
- User says "beast-forge", "beast plan", or task needs verified planning
- Previous attempt failed — need to reassess

## Scaling
```
Quick fix (<3 files, clear)    → skip forge, direct executor + MICRO-VERIFY
Standard (3-10 files)          → PLAN FORGE → EXECUTE → VERIFICATION CHAIN
Complex (10+, architectural)   → PLAN FORGE --full → EXECUTE with checkpoints → CHAIN
Vague input                    → PLAN FORGE --discuss → rest as standard
```

## State
Use `mode: "ralph"` with session_id. Phase prefix `bf-` distinguishes from plain ralph.
```json
{"mode":"ralph","session_id":"<session>","current_phase":"bf-forge|bf-execute|bf-verify",
 "state":{"planning_mode":"beast-forge","forge_iteration":1,
  "gates":{"skeptic":null,"integration":null,"second_opinion":null},
  "verify":{"evidence":null,"auditor":null},
  "completed_steps":[],"slug":"task-name"}}
```

## HUD Integration

Beast-forge writes status to **two channels** on every phase transition:

### 1. Statusline (via `state_write`)

Shows `ralph:N/M` in the terminal statusbar. N = current forge iteration, M = max (default 5).

Call `state_write` at each phase transition:
```
state_write(
  mode: "ralph",
  active: true,
  iteration: <forge_iteration>,
  max_iterations: <total_phases>,
  current_phase: "bf-<phase>",
  task_description: "<slug>",
  session_id: <session_id>,
  state: {
    planning_mode: "beast-forge",
    gates: { skeptic: "PASS"|"FAIL"|null, integration: ..., second_opinion: ... },
    steps_done: N,
    steps_total: M
  }
)
```

### 2. Rich status (via `notepad_write_priority`)

Shows detailed progress in notepad (visible via `notepad_read`). Update at each transition:

```
notepad_write_priority(
  content: "[FORGE] <PHASE> v<iter> | <gate_summary> | <steps_done>/<steps_total> steps"
)
```

**Examples at each stage:**
```
[FORGE] PRECEDENT          | — | 0/8 stages
[FORGE] RESEARCH           | — | 1/8 stages
[FORGE] CHALLENGE          | — | 2/8 stages
[FORGE] PLAN v1            | — | 3/8 stages
[FORGE] REVIEW v1          | Skeptic:PASS Integration:— 2nd:— | 3/8 stages
[FORGE] REVIEW v1          | Skeptic:PASS Integration:PASS 2nd:FAIL | 3/8 stages
[FORGE] PLAN v2            | ↑ revising: 2nd opinion found P1 issue | 3/8 stages
[FORGE] REVIEW v2          | Skeptic:PASS Integration:PASS 2nd:PASS | 3/8 stages
[FORGE] EXECUTE            | ALL GATES PASSED | 5/7 steps done | 5/8 stages
[FORGE] VERIFY             | Evidence:— Auditor:— | 6/8 stages
[FORGE] VERIFY             | Evidence:PASS Auditor:PASS | 7/8 stages
[FORGE] DOCS-REFRESH       | VERIFIED | 8/8 stages
```

### Phase map (for progress tracking)

| # | Phase | Statusline `iteration` |
|---|-------|----------------------|
| 1 | PRECEDENT | 1 |
| 2 | RESEARCH | 1 |
| 3 | CHALLENGE | 1 |
| 4 | PLAN | 1 |
| 5 | REVIEW (loop) | forge_iteration |
| 6 | EXECUTE | forge_iteration |
| 7 | VERIFY | forge_iteration |
| 8 | DOCS-REFRESH | forge_iteration |

For the statusline `max_iterations`: use forge iteration cap (default 5) during PLAN/REVIEW loop. Switch to `8` (total stages) during EXECUTE onward.

### On completion/failure

```
state_write(mode: "ralph", active: false, completed_at: <ISO>)
notepad_write_priority(content: "[FORGE] DONE ✓ | <slug> | <total_time>")
```

On failure:
```
notepad_write_priority(content: "[FORGE] BLOCKED | <slug> | <reason>")
```

---

## Machine 1: Plan Forge

Refinement loop. Two phases: draft the plan, then gate it. Cycles until all 3 gates pass.

```
PRECEDENT → RESEARCH → CHALLENGE (approach) → CLARIFY → PLAN (draft)
    → REVIEW: 3 gates (Skeptic + Integration + Second Opinion)
    → ALL PASS? → FINAL-PLAN
    → ANY FAIL? → fix specific issue → re-run failed gate(s) only
    → Max 5 iterations total
```

### PRECEDENT — search institutional knowledge first

Before touching code, search what the project already knows:
1. **Grep CLAUDE.md** for gotchas mentioning touched files/systems. Surface them explicitly.
2. **Grep `.omc/plans/`** (if exists) for past plans touching same systems. Note approach + outcome.
3. **Read `docs/architecture/{system}.md`** (if exists) to understand current design.
4. **Read CLAUDE.md `## Common Failures`** section (if exists) for known failure patterns.
5. **Query `.omc/forge.db`** (if exists) — past forge runs, risk scores, cached spikes:
   ```sql
   -- Past runs on these systems
   SELECT slug, status, iteration, json_extract(context, '$.lesson') as lesson
   FROM forges WHERE systems LIKE '%<system>%' AND status IN ('completed','abandoned')
   ORDER BY completed_at DESC LIMIT 5;

   -- Risk scores
   SELECT system, fail_rate, avg_iterations FROM system_risk
   WHERE system IN ('<system1>', '<system2>');

   -- Cached spikes (don't re-test confirmed assumptions)
   SELECT assumption, result, actual FROM spikes
   WHERE permanent = 1 OR tested_at > datetime('now', '-30 days');

   -- Co-failure warnings
   SELECT system_a, system_b, gate,
     ROUND(1.0 * fail_count / total_count, 2) as fail_rate
   FROM co_failures
   WHERE (system_a IN ('<systems>') OR system_b IN ('<systems>'))
     AND CAST(fail_count AS REAL) / total_count > 0.3;
   ```
   Surface: "reply-worker + engage-scheduler fail Integration 60% — include both in scope?"
6. For large codebase scans, prefer `ctx_batch_execute` to keep research results in sandbox.

### RESEARCH — verify everything, assume nothing

- Read EVERY file being touched. Grep ALL usages: calls, type refs, imports, re-exports, barrel files, mocks, string references.
- `scc --by-file <dirs>` (if installed) — flag high-complexity files for careful reading.
- External API/lib → fetch docs via context7 or WebSearch. Don't assume — verify.
- **Spike anything testable in <5 minutes.** One assumption per spike. Disposable.
  - Record: `✅ confirmed: [assumption]` or `❌ refuted — actual: [reality]`
  - Refuted spike = immediate adjustment. Never carry known-false assumptions.
- Spikes happen in ANY phase. If testable in <5 min → test it NOW.

### CHALLENGE — challenge the approach BEFORE writing the plan

Self-challenge first: What am I assuming? What's the simplest approach? What breaks?

Then get an independent challenge on the APPROACH (not the plan yet — that comes at REVIEW):
- Check if codex is available: `which codex`
- If available: write approach summary to /tmp, run `codex exec "Review this approach. What are the 3 most likely failure modes?" -C <repo> -s read-only -c 'model_reasoning_effort="high"'`
- If unavailable: `Agent(model="opus", prompt="You are a senior engineer who has NEVER seen this codebase. Here is the proposed approach: [approach]. Find the 3 most likely failure modes.")`

If challenge reveals a fundamental flaw → revise approach before writing the plan.

### CLARIFY — ask user only for genuine design decisions

- Classify unknowns: **self-decidable** vs **needs user input**.
- Self-decide where possible. Document decision + rationale in plan.
- Ask user ONLY for genuine design choices.
- Format: structured questions with 2-3 options + recommendation + reasoning.

### PLAN — write the plan draft

Each step:
```
### Step N: [Title]
Do: [specific action]
Files: [exact paths, verified in RESEARCH]
Acceptance criteria:
  - static: [type check, lsp diagnostics, semgrep — whatever project uses]
  - unit: [specific test command + expected output]
  - e2e: [command that proves the feature works end-to-end] (where applicable)
Failure mode: [what goes wrong]
Fallback: [what to do]
Checkpoint: true/false [true = verify before proceeding to next step]
Depends on: [step numbers]
```

Plan MUST include:
- Execution order (parallel-safe vs serial steps)
- Rollback strategy
- E2E verification scenario: the ONE flow proving everything works together
- Blast radius estimate

Read the project's CLAUDE.md for test/build/deploy commands. Don't invent — use what the project already has.
E2E criteria use REAL commands the project actually uses (curl APIs, DB queries, CLI tools). NEVER wait for cron.

### REVIEW — 3 binary gates on the WRITTEN plan

All three must pass. Run Skeptic + Integration in parallel, then Second Opinion.

| Gate | Agent | What it checks | Pass | Fail → |
|------|-------|----------------|------|--------|
| **Skeptic** | Fresh opus agent | Mirage detection: do referenced files, APIs, functions actually exist? | 0 mirages | → RESEARCH |
| **Integration** | Fresh sonnet agent | Cross-system contracts: do types match, imports work, schemas align? | All contracts verified | → RESEARCH |
| **Second Opinion** | Codex or fresh opus | Adversarial: what breaks in production? What's missing? | No P1 findings | → PLAN |

#### Second Opinion gate — detailed

**Step 1:** Check codex availability
```bash
which codex
```

**Step 2a (codex available):** Write plan to temp file, then:
```bash
# Review the plan for critical issues
codex review "Review this implementation plan. Find critical issues, 
  missing edge cases, race conditions, security holes, integration failures.
  Score: PASS if no critical issues, FAIL with list if any found." \
  --base $(git branch --show-current) \
  -c 'model_reasoning_effort="high"'
```

If specific files are already identified in the plan:
```bash
# Challenge specific approach decisions
codex exec "Read FINAL-PLAN at [path]. For each step, find how it could 
  fail in production. Focus on: data integrity, concurrency, error handling, 
  missing rollback. Be ruthless." \
  -C $(pwd) -s read-only \
  -c 'model_reasoning_effort="high"'
```

**Step 2b (codex unavailable — fresh opus fallback):**
```
Agent(model="opus", prompt="You are a principal engineer who has NEVER 
  seen this codebase or this plan before. Read the plan at [path]. 
  For each step: how does it fail in production? What's missing? 
  What would you push back on in a design review? 
  Verdict: PASS (no critical issues) or FAIL [list].")
```

**Gate result:** PASS = no P1 critical findings. FAIL = revise the specific steps flagged, then re-run this gate only.

### Output

FINAL-PLAN saved to `.omc/plans/FINAL-PLAN-{slug}.md` (or project root if .omc doesn't exist). Present approval summary including all 3 gate results. User reviews → "ok" or corrects → proceed to EXECUTE.

---

## Execute (ralph persistence, TDD)

1. Load FINAL-PLAN. Parse steps into tasks.
2. Per step: **RED** (write failing test from acceptance criteria) → **GREEN** (minimal code to pass) → **REFACTOR**.
3. Parallel where steps are independent. Serial where dependent.
4. **Checkpoint steps** (`checkpoint: true`): run that step's acceptance criteria before proceeding. If fail → fix before next step.
5. Static analysis on every change (whatever project has: tsc, lsp, semgrep, eslint...).
6. After all steps → VERIFICATION CHAIN.

---

## Machine 2: Verification Chain

### Layer 0: Static (instant, whatever project has)
Run the project's static analysis tools. Common:
```
tsc --noEmit                    # TypeScript
lsp_diagnostics <files>         # IDE diagnostics
semgrep scan --config=.semgrep/ # Custom gotcha rules (if .semgrep/ exists)
```

### Layer 1: Unit Tests
Run project's test command on changed modules. If no tests exist for changed code → flag as GAP.

### Layer 2: E2E System Checks
Where the plan has e2e acceptance criteria, run them. ACTIVELY trigger — never wait for cron or scheduled runs. Use whatever mechanism the project has.

### Layer 3: Independent Agents

**Evidence Collector** (fresh sonnet agent, `agents/evidence-collector.md`):
- Input: FINAL-PLAN.md ONLY. No executor output. No contamination.
- Runs every acceptance criterion independently.
- Records: {criterion, command, output, verdict: PASS|FAIL|NOT_FOUND}
- Checks criteria sufficiency: "proves feature WORKS, not just code WRITTEN?"

**Auditor** (fresh opus agent, `agents/auditor.md`):
- Input: Evidence Report + FINAL-PLAN.md. NOT executor output.
- Spot-checks 30-50% (weighted toward integration/runtime).
- Coverage check: every criterion → evidence entry.
- E2E: runs the plan's full E2E scenario.
- Clean state check: git status clean?
- Verdict: VERIFIED | GAPS [list]

### Gap Handling
```
GAPS FOUND →
  1. Check CLAUDE.md "Common Failures" — new pattern? Add it.
  2. Back to EXECUTE with specific gaps list.
  3. Ralph iteration++.

VERIFIED →
  E8: Docs Refresh (final stage — see below).
  Done.
```

---

## Machine 3: Docs Refresh (final stage)

After verification passes, run a scoped documentation hygiene pass. This is the `/docs-refresh` skill integrated as beast-forge's closing stage.

### What to check (scoped to touched systems)

1. **CLAUDE.md gotchas** — did this work fix a gotcha? Remove it. Did it introduce a new danger? Add it. Still under 40-line target?
2. **Memory files** — do any `arch-*` or `lesson-*` files reference systems that changed? Update or flag.
3. **MEMORY.md index** — still under 180 lines? Any new entries needed? Any entries now stale?
4. **docs/ vault** — do architecture docs, specs, or runbooks need updating for what changed?
5. **Common Failures** — new pattern discovered during execution? Add it.

### Scaling

```
Quick fix (<3 files)    → CLAUDE.md gotcha check only (30 seconds)
Standard (3-10 files)   → CLAUDE.md + touched memory files + docs/ for affected systems
Complex (10+)           → full /docs-refresh --scan-only, present triage to user
```

### Auto-create (forge-driven documentation)

Machine 3 doesn't just audit — it GENERATES docs from forge results:

1. **Permanent refuted spike → lesson file.** If a spike with `permanent=1` has no corresponding `lesson-*.md`, auto-create one in memory with the assumption, actual result, and "How to apply" section.
2. **Gate finding repeated 3+ times → CLAUDE.md gotcha.** Query forge.db: `SELECT findings FROM gates WHERE result='FAIL' GROUP BY findings HAVING COUNT(*) >= 3`. If a finding repeats across forges, add it to CLAUDE.md gotchas section.
3. **Architecture changed → update/create docs.** If the forge modified architecture files (new tables, new services, new data flow), update `docs/architecture/{system}.md` or create if missing.
4. **Forge lesson → memory file.** On `--complete`, if a lesson was recorded, check if it's already in memory. If not, auto-create `lesson-{slug}.md`.

### Rules

- NEVER skip this stage. Even a 30-second gotcha check catches stale docs early.
- For complex work, run `/docs-refresh --scan-only` and include the triage in the completion report.
- New gotcha? Add to CLAUDE.md. Fixed gotcha? Remove from CLAUDE.md.
- Memory approaching 180 lines? Flag to user, suggest `/docs-refresh` standalone run.
- Auto-created docs are DRAFTS — present to user before committing. Exception: CLAUDE.md gotchas from 3+ repeated findings can be auto-added.

---

## Micro-Verify (for quick fixes)

After ANY direct executor completes (non-forge work):
```
- Static analysis on changed files (whatever project has)
- Reference check on changed exports (callers updated?)
- Run tests on changed modules (if fast, <30s)
Verdict: CLEAN | SUSPECT [list]
```

---

## Iron Rules (IMMUTABLE — meta-learning CANNOT override)

These rules prevent the self-optimizing system from removing its own safety checks.

1. **2+ independent review gates on every plan.** No exceptions.
   Meta-learning may reorder, add, specialize — NEVER reduce below 2.
2. **Gates = separate agents.** Planner ≠ reviewer. No shared context between planner and gate agent.
3. **Pipeline adaptation is project-scoped.** Gate ordering, risk thresholds — NEVER auto-propagate between projects.
4. **Additive = auto. Subtractive = human.** Adding a checkpoint: auto. Removing a gate: requires explicit human approval.

---

## Forge Commands

Beast-forge manages persistent work units ("forges") that survive across sessions.

```
/forge "task"              — create new forge, start pipeline
/forge --park [reason]     — park current forge, save context to forge.db
/forge --resume [slug]     — resume parked forge, restore context
/forge --spawn "sub-task"  — create child forge (optionally --blocks-parent)
/forge --switch [slug]     — park current + resume another (atomic)
/forge --list              — show all forges with status
/forge --status            — deep status of current forge + dependency tree
/forge --complete          — mark done, record lesson, unblock dependents
/forge --abandon [reason]  — mark abandoned, preserve context
/forge --full "task"       — extended RESEARCH + mandatory spike
/forge --discuss "task"    — extended CLARIFY for vague input
/forge --plan-only         — stop after FINAL-PLAN
/forge --execute           — load existing FINAL-PLAN, skip forge
/forge --no-docs           — skip docs-refresh final stage
```

### Forge persistence

All forge state lives in `.omc/forge.db` (SQLite). This is the sole source of truth.
`ralph-state.json` is a HUD display cache only — OMC may delete it on SessionEnd.

On every phase transition:
1. Update forge.db (via SQL or forge-crud.mjs functions)
2. Update ralph-state.json (via state_write MCP tool) for HUD display
3. forge.db `current_state` table tracks the active forge for compaction recovery

### Compaction recovery

If `/compact` happens mid-forge, the PreCompact hook saves state to forge.db and injects a recovery prompt. After compaction, read forge.db `current_state` and resume:
```sql
SELECT value FROM current_state WHERE key = 'active_forge';
```

### Recording gate results and spikes

After each gate completes, record to forge.db:
```sql
INSERT INTO gates (forge_id, iteration, gate, result, findings)
VALUES (<id>, <iter>, 'skeptic', 'PASS', '["no mirages found"]');
```

After each spike:
```sql
INSERT INTO spikes (forge_id, assumption, result, actual, permanent)
VALUES (<id>, 'Dolphin supports concurrent tabs', 'refuted', '1 tab per profile', 1);
```

### Spawn workflow

During RESEARCH or EXECUTE, if a sub-task is discovered:
```
/forge --spawn "fix batch recovery" --blocks-parent
```
- Creates child forge with parent_id = current forge
- If `--blocks-parent`: current forge → status 'blocked', blocked_by = child
- When child completes → SQL trigger auto-unblocks parent
- Child's findings available to parent's PRECEDENT via forge.db queries

---

## Flags (legacy, see Forge Commands above)
```
/forge "task"            — standard: forge → execute → verify → docs-refresh
/forge --full "task"     — extended RESEARCH + mandatory spike on riskiest assumption
/forge --discuss "task"  — extended CLARIFY for vague input
/forge --plan-only       — stop after FINAL-PLAN, don't execute
/forge --execute         — load existing FINAL-PLAN, skip forge
/forge --no-docs         — skip docs-refresh final stage
```

---

## Project Setup

Run `/beast setup` once per project to get the most from beast-forge:
- Creates docs/ vault structure with INDEX.md navigation
- Creates .semgrep/ with starter rules (if semgrep installed)
- Adds Common Failures + Project Docs sections to CLAUDE.md
- Checks for optional tools (semgrep, scc, codex)

Beast-forge works WITHOUT setup — it just greps whatever exists. Setup makes it better.
