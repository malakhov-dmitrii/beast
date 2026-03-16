---
description: "Execute an approved beast plan with TDD implementation"
---

Execute the most recent approved FINAL-PLAN.md from a beast planning session.

1. **Find FINAL-PLAN.md** — check these locations (pick most recent by modification time):
   - `.beast-plan/sessions/*/FINAL-PLAN.md`
   - `.beast-plan/pending-*/FINAL-PLAN.md`
   - `.beast-plan/FINAL-PLAN.md` (legacy flat structure)
   - If not found: "No approved plan found. Run `/beast plan` first."

2. **Invoke the skill:**
   ```
   Invoke the `beast:beast` skill with `execute` command.
   Plan location: <path to FINAL-PLAN.md>
   ```
