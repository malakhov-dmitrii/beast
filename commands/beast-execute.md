---
description: "Execute an approved beast plan with TDD implementation"
---

Execute the most recent approved FINAL-PLAN.md from a beast planning session.

1. **Find FINAL-PLAN.md:**
   - Scan `.beast-plan/sessions/*/FINAL-PLAN.md` — pick most recent by file modification time
   - Also check `.beast-plan/pending-*/FINAL-PLAN.md`
   - If not found: "No approved plan found. Run `/beast plan` first."

2. **Invoke the skill:**
   ```
   Invoke the `beast:beast` skill with `execute` command.
   Plan location: <path to FINAL-PLAN.md>
   ```
