---
description: "Check beast session status (shows all active, pending, and completed sessions)"
---

Display beast session status. This works identically to `/beast-plan-status` — check both `.beast-plan/sessions/*/state.json` and `.beast-plan/pending-*/state.json`.

Follow the exact same protocol as the beast-plan-status command:

1. Find all sessions (pending, active, legacy)
2. Extract session ID, status, phase, command (plan/execute), iteration, wave, task info
3. Format as aligned table
4. Show task descriptions for active sessions
5. Show warnings for stale sessions (updated_at > 48 hours ago)
