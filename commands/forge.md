---
name: forge
description: "Ore in, steel out. Full pipeline: plan → execute → verify. Use: /forge 'task', /forge --full, --discuss, --plan-only, --execute, --park, --resume"
---

Route to the `forge` skill with the user's arguments.

If no arguments provided and a FINAL-PLAN exists in `.omc/plans/`, ask: plan new task or execute existing plan?
If forge.db has parked forges, mention them: "You have N parked forges. --list to see them, --resume <slug> to continue."

Flags:
- `--full` — extended RESEARCH + mandatory spike on riskiest assumption
- `--discuss` — extended CLARIFY phase for vague input
- `--plan-only` — stop after FINAL-PLAN, don't execute
- `--execute` — load existing FINAL-PLAN, skip Plan Forge
- `--park [reason]` — save state to forge.db
- `--resume [slug]` — continue a parked forge
- `--spawn "sub-task"` — create child forge
- `--switch [slug]` — park current + resume another
- `--list` — show all forges with status
- `--complete` — mark done, record lesson
- `--abandon [reason]` — mark abandoned
- `--no-docs` — skip docs-refresh final stage
