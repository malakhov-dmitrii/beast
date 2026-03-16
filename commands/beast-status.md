---
description: "Check beast session status (shows all active, pending, and completed sessions)"
---

Display beast session status.

1. **Find all sessions** — check these locations:
   - `.beast-plan/sessions/*/state.json` (active/completed)
   - `.beast-plan/pending-*/state.json` (unclaimed)
   - `.beast-plan/state.json` (legacy flat structure)

2. **For each session, extract:**
   - Session ID, status (active/completed/abandoned), phase
   - Command (plan/execute), iteration count, wave/task progress
   - Task description

3. **Format as aligned table:**
   ```
   SESSION ID   STATUS    COMMAND  PHASE      ITER  WAVE
   abc123      ✓ active   plan     pipeline   2/5   -
   def456      ✓ active   execute  running    -     3/5
   ghi789      ✗ done     plan     complete   3/5   -
   ```

4. **Show warnings** for stale sessions (updated_at > 48 hours ago)
5. **Show task descriptions** for active sessions
