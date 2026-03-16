---
description: "Beast: plan-to-code pipeline. Use '/beast plan' to create a verified plan, '/beast execute' to implement it with TDD. Run '/beast' alone for help."
---

Beast is a two-command pipeline with an approval gate:

1. `/beast plan "task"` — explore, discuss, research, plan, review until consensus
2. `/beast execute` — load approved plan, implement with TDD, verify

## Routing

Parse the first argument after `/beast`:

- **`plan`** (or "plan this", "plan and build"): Invoke `beast:beast` skill with `plan` command. Pass remaining arguments as the task description.
- **`execute`** (or "execute plan", "implement plan", "build it"): Invoke `beast:beast` skill with `execute` command.
- **`status`**: Show session status (same as `/beast-status`).
- **No argument + no FINAL-PLAN.md**: Run `plan`.
- **No argument + FINAL-PLAN.md exists**: Ask user — plan new or execute existing?

```
Invoke the `beast:beast` skill.
Command: <plan|execute>
Target task: $ARGUMENTS
```
