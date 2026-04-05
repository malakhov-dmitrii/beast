---
name: beast-forge
description: "Plan iron, verify real. Full pipeline: plan → execute → verify. Use: /beast-forge 'task', /beast-forge --full, --discuss, --plan-only, --execute"
---

Route to the `beast-forge` skill with the user's arguments.

If no arguments provided and a FINAL-PLAN exists in `.omc/plans/` or `.beast-plan/`, ask: plan new task or execute existing plan?

Flags:
- `--full` — extended RESEARCH + mandatory spike on riskiest assumption
- `--discuss` — extended CLARIFY phase for vague input
- `--plan-only` — stop after FINAL-PLAN, don't execute
- `--execute` — load existing FINAL-PLAN, skip Plan Forge
