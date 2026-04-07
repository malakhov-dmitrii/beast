# Forge

**Ore in, steel out.**

A blacksmith doesn't blame the ore. It smelts, shapes, tempers, and quenches — until what comes out holds an edge. Forge does the same with code: takes any task, however raw, and pushes it through planning gates, independent review, and verified execution until the result is proven to work.

Claude Code plugin. Two skills: planning pipeline and docs hygiene. Persistent memory that learns from every run.

```
"fix the auth bug" → research → plan → 2 independent reviews → TDD execute → independent verify → done
```

## Install

```bash
git clone https://github.com/malakhov-dmitrii/forge.git ~/.claude/plugins/forge
bun run ~/.claude/plugins/forge/scripts/install.mjs
```

The installer symlinks skills, registers hooks in `settings.json`, and initializes the knowledge database.

## Skills

### `/forge` — planning + execution + verification

The main pipeline. Takes a task from idea to verified implementation.

```
/forge "add rate limiting to the API"      — plan → execute → verify
/forge --full "migrate to new auth system"  — deeper research + spike
/forge --discuss "improve engagement"       — clarify vague input first
/forge --plan-only                          — stop after final plan
```

Two machines work in sequence:

**Plan Forge** — refinement loop. Searches your project's gotchas, past plans, and architecture docs. Spikes risky assumptions. Gets a second opinion from a different AI model. Cycles until two independent reviewers find zero issues. Max 5 iterations.

**Verification Chain** — two agents who have *never seen the executor's output* independently verify every acceptance criterion. An auditor spot-checks 30-50% of the evidence. Gaps get fed back to execution.

**Iron rules** (hardcoded, system can't override):
- Minimum 2 independent review gates on every plan
- Planner ≠ reviewer. No shared context.
- Pipeline config is project-scoped. Never auto-propagates between projects.

### `/docs-refresh` — documentation hygiene

Audits all project docs for freshness. Deletes what's dead, updates what drifted, compresses what's bloated. Also runs as Forge's final stage.

```
/docs-refresh                — full audit: memory, CLAUDE.md, lessons, references
/docs-refresh --scan-only    — report only, no changes
/docs-refresh --memory-only  — scope to memory files
```

## Forge Intelligence

Every forge run writes to a SQLite database (`.omc/forge.db`). The system learns from its own history.

**What it tracks:**
- Gate results per iteration (which reviews failed, what they found)
- Spike cache (confirmed/refuted assumptions with TTL)
- Risk scores per system (auto-aggregated from past failures)
- Co-failure patterns (which pairs of systems tend to break together)

**What it enables:**
- `--park` / `--resume` — save work, come back in a new session
- `--spawn "sub-task"` — create child forges with dependency tracking
- Compaction survival — state preserved when context window resets
- PRECEDENT phase queries past runs before planning ("last time this system needed 3 iterations")

**Cross-project knowledge** lives in `~/.forge/global.db` — verified facts about tools and libraries that apply everywhere. Spikes about external tools get promoted automatically.

Schema is versioned (`PRAGMA user_version`) — future updates migrate automatically.

## How It Works

### Plan Forge

```
PRECEDENT ── gotchas, past plans, forge.db risk scores, cached spikes
    │
RESEARCH ─── read every file, grep all usages, spike anything testable in <5 min
    │
CHALLENGE ── second opinion on approach (codex CLI or fresh opus agent)
    │
PLAN ─────── concrete steps with acceptance criteria (static + unit + e2e)
    │
REVIEW ───── 2+ binary gates: Skeptic (mirages) + Second Opinion (production failures)
    │
    └── fail? → fix specific issue → re-run failed gate only → max 5 iterations
```

### Verification Chain

```
Layer 0: Static ── tsc, semgrep, lsp diagnostics
Layer 1: Unit ──── test suite on changed modules
Layer 2: E2E ───── trigger real flows, verify actual behavior
Layer 3: Agents ── Evidence Collector (sonnet) → Auditor (opus), no executor access
```

### Docs Refresh (final stage)

After verification: check if this work created new gotchas, obsoleted old docs, or discovered patterns worth recording. Auto-creates lesson files from permanent spikes, adds CLAUDE.md gotchas from repeated gate findings.

## Forge Commands

```
/forge "task"              — new forge, start pipeline
/forge --park [reason]     — save state to forge.db
/forge --resume [slug]     — continue from where you left off
/forge --spawn "sub-task"  — child forge, optionally blocks parent
/forge --switch [slug]     — park current + resume another
/forge --list              — all forges with status
/forge --complete          — mark done, record lesson, unblock dependents
/forge --abandon [reason]  — mark abandoned, preserve context
```

## Project Structure

```
skills/
  forge/SKILL.md                 # Planning pipeline specification
  docs-refresh/SKILL.md          # Documentation hygiene

hooks/
  forge-schema.mjs               # SQLite schema, migrations, triggers
  forge-crud.mjs                 # CRUD operations, risk aggregation
  forge-hooks.mjs                # SessionStart/End/PreCompact handlers
  forge-global.mjs               # Cross-project knowledge DB

agents/
  skeptic.md                     # Mirage hunter — verifies claims against reality
  evidence-collector.md          # Independent verification, no executor access
  auditor.md                     # Spot-checks evidence, catches gaps
  researcher.md                  # Deep codebase investigation
  planner.md                     # Concrete, testable plans
  ...                            # 13 agents total

commands/
  forge.md                       # Main command
  forge-setup.md                 # One-time project setup

templates/
  semgrep-starter.yml            # Starter gotcha rules
  docs-structure.md              # Knowledge vault template

scripts/
  install.mjs                    # Symlinks, hook registration, DB init
```

## HUD Integration

When a forge is active, the terminal statusline shows progress:

```
forge:REV·2 S✓I✓2✗ +1parked     — Review iter 2, Skeptic pass, Integration pass, 2nd fail, 1 parked
forge:EXE 4/6                    — Execute phase, 4 of 6 steps done
forge:VER                        — Verification chain running
```

## Philosophy

1. **Ore in, steel out.** The system refines, not rejects. Vague input gets clarified. Bad assumptions get spiked. Weak plans get tempered.
2. **Verify independently.** The agent that shaped the metal cannot test the blade. Separate agents, no shared context.
3. **Spike, don't theorize.** Five minutes of testing beats thirty minutes of debate.
4. **The forge remembers.** Every run teaches the next one. Risk scores, cached spikes, co-failure patterns — knowledge compounds.
5. **Iron rules hold.** Two independent reviews on every plan. The system can optimize within bounds, but cannot remove its own safety checks.

## Requirements

- [Bun](https://bun.sh) — runtime (for bun:sqlite in hooks)
- [Claude Code](https://claude.ai/code) — AI coding assistant

Optional:
```bash
brew install semgrep scc    # static analysis + complexity metrics
```

[Codex CLI](https://github.com/openai/codex) recommended for cross-model second opinion.

## License

MIT — [Dmitrii Malakhov](https://github.com/malakhov-dmitrii)
