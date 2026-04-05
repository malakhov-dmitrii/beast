# beast-forge — Plan Iron, Verify Real

**Plan Forge** turns vague tasks into bulletproof plans via a Planner → Skeptic → Critic consensus loop. **Verification Chain** ensures execution actually worked — not just that tests passed.

## Install

```bash
claude plugin install https://github.com/malakhov-dmitrii/beast.git
```

## Setup (one-time per project)

```bash
/beast setup
```

Creates `docs/` vault structure, copies semgrep rules, adds CLAUDE.md sections.

## Usage

| Command | What it does |
|---------|--------------|
| `/beast-forge "task"` | Plan + execute + verify |
| `/beast-forge --full "task"` | Extended research + spike before planning |
| `/beast-forge --discuss "task"` | Extended clarification for vague input |
| `/beast-forge --plan-only` | Plan only, stop at approval gate |
| `/beast-forge --execute` | Execute an existing approved plan |
| `/beast setup` | One-time project setup |

## How It Works

**Plan Forge loop**: Explorer maps the codebase → Researcher investigates → Planner drafts a wave-ordered plan → Skeptic hunts mirages (phantom APIs, wrong assumptions, schema drift) → Critic scores /25. Loop repeats until score ≥ 20.

**Verification Chain**: After execution, each claim is verified against reality — browser, API, DB — not just unit tests. Micro-verify runs after each file edit.

## Requirements

- Claude Code CLI

Optional (unlocks additional checks):
- `semgrep` — static analysis rules
- `scc` — code complexity metrics
- `codex` CLI — parallel execution tasks

## Author

Dmitrii Malakhov
