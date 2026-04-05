---
name: beast-forge
description: "Ironclad planning + independent verification. Turns any input into a bulletproof plan, executes with TDD, verifies with independent agents. Use for 3+ files or unclear scope."
---

# Beast Forge — Plan Iron, Verify Real

Two machines: **Plan Forge** (refine until bulletproof) + **Verification Chain** (prove it's actually done).

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

---

## Machine 1: Plan Forge

Refinement loop. Cycles until all gates pass. Max 5 iterations.

### PRECEDENT — search institutional knowledge first

Before touching code, search what the project already knows:

1. **Grep project's CLAUDE.md** for gotchas mentioning touched files/systems. Surface them explicitly.
2. **Grep `.omc/plans/`** (if exists) for past plans touching same systems.
3. **Read `docs/architecture/{system}.md`** (if exists) to understand current design.
4. **Read CLAUDE.md `## Common Failures`** section (if exists) for known failure patterns.
5. **Run `discover-skills.sh`** to find relevant skills for this task's domain.

If a project hasn't run `/beast setup`, PRECEDENT still works — it just greps whatever CLAUDE.md and docs exist.

### RESEARCH — verify everything, assume nothing

- Read EVERY file being touched. Grep ALL usages: calls, type refs, imports, re-exports, barrel files, mocks, string references.
- **`scc --by-file <dirs>`** (if installed) — flag high-complexity files for careful reading.
- External API/lib → fetch docs via context7 or WebSearch. Don't assume — verify.
- **Spike anything testable in <5 minutes.** One assumption per spike. Disposable.
  - Record: `✅ confirmed: [assumption]` or `❌ refuted — actual: [reality]`
  - Refuted spike = immediate adjustment. Never carry known-false assumptions.
- Spikes happen in ANY phase. If testable in <5 min → test it NOW.

### CHALLENGE — get a real second opinion

Self-challenge first: What am I assuming? Simplest approach? What breaks?

Then get an independent opinion (one of):
- `codex challenge` (if codex CLI available) — adversarial review by different AI model
- Fallback: `Agent(model="opus", prompt="You are a senior engineer who has NEVER seen this codebase. Review this plan. Find every way it fails. Be ruthless.")`

Second opinion is PLANNING-ONLY. Not repeated at verification.

### CLARIFY — ask user only for genuine design decisions

- Classify unknowns: **self-decidable** vs **needs user input**.
- Self-decide where possible. Document decision + rationale in plan.
- Ask user ONLY for genuine design choices.
- Format: structured questions with 2-3 options + recommendation + reasoning.

### PLAN — concrete enough to execute without thinking

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

### REVIEW — 2 binary gates

| Gate | Agent | Pass | Fail → |
|------|-------|------|--------|
| **Skeptic** | `agents/skeptic.md` (opus) | 0 mirages | → back to RESEARCH |
| **Integration** | Fresh sonnet agent | All cross-system contracts verified | → back to RESEARCH |

Both must pass. Max 5 iterations. After 5 → present best plan + unresolved concerns to user.

### Output

FINAL-PLAN saved to `.omc/plans/FINAL-PLAN-{slug}.md` (or `.beast-plan/` if .omc doesn't exist). Present approval summary. User reviews → "ok" or corrects → proceed to EXECUTE.

---

## Execute

1. Load FINAL-PLAN. Parse steps into tasks.
2. Per step: **RED** (write failing test) → **GREEN** (minimal code to pass) → **REFACTOR**.
3. Parallel where independent. Serial where dependent.
4. **Checkpoint steps** (`checkpoint: true`): run acceptance criteria before proceeding.
5. Static analysis on every change (whatever project has: tsc, lsp, semgrep, eslint...).
6. After all steps → VERIFICATION CHAIN.

---

## Machine 2: Verification Chain

### Layer 0: Static (instant, whatever project has)

Run the project's static analysis tools. Common examples:
```
tsc --noEmit                    # TypeScript
lsp_diagnostics <files>         # IDE diagnostics  
semgrep scan --config=.semgrep/ # Custom gotcha rules
eslint <files>                  # If configured
```

### Layer 1: Unit Tests

Run project's test command on changed modules. If no tests exist for changed code → flag as GAP.

### Layer 2: E2E System Checks

Where the plan has e2e acceptance criteria, run them. ACTIVELY trigger — never wait for cron or scheduled runs. Use whatever mechanism the project has: curl API, CLI commands, DB queries.

### Layer 3: Independent Agents

**Evidence Collector** (fresh agent, `agents/evidence-collector.md`):
- Input: FINAL-PLAN.md ONLY. No executor output.
- Runs every acceptance criterion independently.
- Records: {criterion, command, output, verdict: PASS|FAIL|NOT_FOUND}
- Checks criteria sufficiency: "proves feature WORKS, not just code WRITTEN?"

**Auditor** (fresh agent, `agents/auditor.md`):
- Input: Evidence Report + FINAL-PLAN.md. NOT executor output.
- Spot-checks 30-50% (weighted toward integration/runtime).
- Coverage check: every criterion → evidence entry.
- E2E: runs the plan's full E2E scenario.
- Clean state check: git status clean?
- Verdict: VERIFIED | GAPS [list]

### Gap Handling

```
GAPS FOUND →
  1. Check project's CLAUDE.md "Common Failures" — new pattern? Add it.
  2. Back to EXECUTE with specific gaps list.
  
VERIFIED →
  Doc sweep: update affected docs/, CLAUDE.md if needed.
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
/beast-forge --full "task"     — extended RESEARCH + mandatory spike
/beast-forge --discuss "task"  — extended CLARIFY for vague input
/beast-forge --plan-only       — stop after FINAL-PLAN
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
