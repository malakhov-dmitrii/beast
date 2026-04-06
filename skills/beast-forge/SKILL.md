---
name: beast-forge
description: "Ironclad planning + independent verification. Turns any input into a bulletproof plan, executes with TDD, verifies with independent agents. Use for 3+ files or unclear scope."
---

# Beast Forge — Plan Iron, Verify Real

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
  E8: Doc sweep (update affected docs/, CLAUDE.md gotchas, INDEX.md).
  Done.
```

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

## Flags
```
/beast-forge "task"            — standard: forge → execute → verify
/beast-forge --full "task"     — extended RESEARCH + mandatory spike on riskiest assumption
/beast-forge --discuss "task"  — extended CLARIFY for vague input
/beast-forge --plan-only       — stop after FINAL-PLAN, don't execute
/beast-forge --execute         — load existing FINAL-PLAN, skip forge
```

---

## Project Setup

Run `/beast setup` once per project to get the most from beast-forge:
- Creates docs/ vault structure with INDEX.md navigation
- Creates .semgrep/ with starter rules (if semgrep installed)
- Adds Common Failures + Project Docs sections to CLAUDE.md
- Checks for optional tools (semgrep, scc, codex)

Beast-forge works WITHOUT setup — it just greps whatever exists. Setup makes it better.
