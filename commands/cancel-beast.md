---
description: "Cancel active beast session(s)"
---

Cancel beast session(s).

1. **Find sessions** — check these locations:
   - `.beast-plan/sessions/*/state.json` (active sessions)
   - `.beast-plan/pending-*/state.json` (unclaimed sessions)
   - `.beast-plan/state.json` (legacy flat structure)

2. **List active sessions** — show session ID, phase, command, task description

3. **Let user select** which to cancel (or cancel all)

4. **Cancel:** Update state.json — set `active: false`, `phase: "cancelled"`

5. **Offer cleanup:** Ask if user wants to delete session directories

6. **Signal hook:** Emit `<bp-complete>` to allow the stop hook to release the session.
