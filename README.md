# beast-forge

**Plan iron, verify real.**

Claude Code plugin that turns any task description — even vague ones — into an ironclad plan, executes it with TDD, and independently verifies the result with agents that have never seen the executor's work.

```
"fix the auth bug" → Plan Forge refines it → Execute with TDD → Verification Chain proves it's done
```

## Why

Claude Code is great at writing code. It's not great at:

- **Knowing when it's actually done.** It says "complete" — two days later you find half the work is missing.
- **Checking its own work.** The same agent that wrote the code reviews the code. Confirmation bias is built in.
- **Learning from mistakes.** The 7th task makes the same class of errors as the 1st.
- **Surfacing what it doesn't know.** It assumes instead of verifying, carries phantom APIs through an entire plan.

Beast-forge fixes this with two machines:

**Plan Forge** — a refinement loop that greps your project's CLAUDE.md for gotchas, searches past plans for precedents, spikes risky assumptions, gets a second opinion from a different AI model, and cycles until two independent reviewers find zero issues.

**Verification Chain** — two agents who have *never seen the executor's output* independently verify every acceptance criterion by running the actual commands, then an auditor spot-checks 30-50% of the evidence to catch fakes and gaps.

## Install

```bash
claude plugin install https://github.com/malakhov-dmitrii/beast.git
```

Then, one-time per project:

```bash
/beast setup
```

This creates a `docs/` vault, starter semgrep rules, and adds failure tracking sections to your CLAUDE.md.

## Usage

```
/beast-forge "add rate limiting to the API"     # plan → execute → verify
/beast-forge --full "migrate to new auth system" # extended research + spike
/beast-forge --discuss "make engagement better"  # refines vague input first
/beast-forge --plan-only                         # plan without executing
/beast-forge --execute                           # execute an existing plan
```

## How It Works

### Plan Forge

A refinement loop — not linear phases. Cycles until all gates pass.

```
PRECEDENT ─── grep CLAUDE.md gotchas, past plans, docs/
     │
RESEARCH ──── read every touched file, grep all usages, spike <5 min
     │
CHALLENGE ─── second opinion (codex CLI or fresh opus agent)
     │
CLARIFY ───── self-decide what you can, ask user only for real design choices
     │
PLAN ──────── concrete steps, acceptance criteria (static + unit + e2e)
     │
REVIEW ────── 2 binary gates: Skeptic (0 mirages) + Integration (contracts safe)
     │
     └── fail? → loop back. Max 5 iterations.
```

**Spikes are not a phase — they're a principle.** Any time an assumption can be tested in under 5 minutes, test it. Don't carry it as an assumption.

**Second opinion** uses OpenAI's Codex CLI for a genuinely independent review. If codex isn't installed, a fresh Claude agent with an adversarial prompt provides the challenge.

### Verification Chain

After execution, three layers verify the work:

```
Layer 0: Static ──── tsc, lsp, semgrep, scc (instant, every time)
Layer 1: Unit ────── project test suite on changed modules
Layer 2: E2E ─────── trigger real flows, check DB state, verify data pipeline
Layer 3: Agents ──── Evidence Collector → Auditor (independent, no executor access)
```

**Evidence Collector** (sonnet) takes only the FINAL-PLAN as input. For each acceptance criterion: runs the command, records the output, flags weak criteria that prove code was *written* but not that it *works*.

**Auditor** (opus) takes the Evidence Report. Re-runs 30-50% of commands (weighted toward integration tests), catches fake proofs, finds missing criteria, runs the full E2E scenario, checks for uncommitted changes.

If gaps are found → back to execution with a specific list. The failure pattern is added to CLAUDE.md so the system learns.

### Micro-Verify

For quick fixes that don't need the full forge:

```
After any direct executor:
  lsp_diagnostics → semgrep → reference check → tests (<30s)
  Verdict: CLEAN | SUSPECT [list]
```

## Project Structure

```
agents/
  skeptic.md              # Mirage hunter — verifies plan claims against reality
  evidence-collector.md   # Independent verification — no executor access
  auditor.md              # Spot-checks evidence, catches fakes and gaps
  researcher.md           # Deep codebase + dependency investigation
  planner.md              # Writes concrete, testable plans
  explorer.md             # Maps project structure and patterns
  executor.md             # TDD implementation
  architect.md            # Post-execution architectural review
  simplifier.md           # Refactoring pass
  qa-fixer.md             # Auto-fix loop for failing tests

commands/
  beast-forge.md          # Main command — plan + execute + verify
  beast-setup.md          # One-time project setup

skills/
  beast-forge/SKILL.md    # Core skill specification

templates/
  semgrep-starter.yml     # Starter rules for project gotchas
  docs-structure.md       # Knowledge vault structure
  claude-md-additions.md  # CLAUDE.md sections to add
```

## What `/beast setup` Creates

```
your-project/
├── docs/                        # Knowledge vault (git-tracked)
│   ├── INDEX.md                 # Navigation
│   ├── architecture/INDEX.md    # How systems work
│   ├── decisions/INDEX.md       # Why you chose X over Y
│   ├── specs/INDEX.md           # What features do
│   ├── retros/INDEX.md          # What happened + lessons
│   └── runbooks/INDEX.md        # How to operate
├── .semgrep/rules.yml           # Project-specific gotcha rules
└── CLAUDE.md                    # + Common Failures section
                                 # + Project Docs reference
```

## Comparison

| | beast-forge | Beast v2 | beast-lite (gstack) | OMC ralplan |
|---|---|---|---|---|
| Planning depth | PRECEDENT + RESEARCH + CHALLENGE + CLARIFY + PLAN | P1-P8 with stop hook | Frame + Research + Plan | Planner → Architect → Critic |
| Verification | Evidence Collector + Auditor (independent) | Architect review | Skeptic + Critic | Critic only |
| Persistence | Ralph (OMC) | Stop hook state machine | None | None |
| Second opinion | Codex CLI / fresh opus | None | Spike | None |
| Learning loop | CLAUDE.md Common Failures | None | Lessons dir | None |
| Project setup | `/beast setup` (docs, semgrep, CLAUDE.md) | None | None | None |
| Gotcha surfacing | Auto-grep CLAUDE.md per touched file | None | None | None |
| Works without config | Yes | Yes | Yes | Yes |

## Requirements

- **Claude Code CLI** (required)
- **semgrep** (optional) — project-specific gotcha rules as static analysis
- **scc** (optional) — code complexity metrics for planning
- **codex CLI** (optional) — cross-model second opinion. Falls back to fresh Claude agent.

```bash
# optional tools
brew install semgrep scc
```

## Philosophy

1. **Garbage in, iron out.** The system's job is to refine, not to require perfect input.
2. **Verify independently.** The agent that wrote the code cannot verify the code. Separate agents, separate context.
3. **Spike, don't theorize.** If you can test an assumption in 5 minutes, test it. Don't debate it for 30.
4. **Learn from gaps.** Every verification failure is recorded. The same bug class should never happen twice.
5. **Active, not passive.** Trigger checks, poll results, query state. Never wait for schedules.

## License

MIT

## Author

[Dmitrii Malakhov](https://github.com/malakhov-dmitrii)
