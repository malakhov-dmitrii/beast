---
description: Start automated iterative planning with 5-actor verification pipeline (Researcher → Planner → Skeptic → TDD Reviewer → Critic)
---

> **Note:** This is the original planning-only command. For the full plan+execute pipeline, use `/beast plan` and `/beast execute`.

Before starting, check for existing active sessions:

1. **Scan for sessions:**
   - Pending: `.beast-plan/pending-*/state.json`
   - Active: `.beast-plan/sessions/*/state.json`
   - Legacy: `.beast-plan/state.json`

2. **If existing sessions found:**
   - Count active sessions
   - Show: "Existing beast-plan sessions detected: {count} active"
   - List them briefly: "{session-id}: {phase} ({iteration}/{max})"
   - Note: "Starting new session..."

3. **Invoke the skill:**
   ```
   Invoke the `beast:beast-plan` skill and follow it exactly.

   Target task: $ARGUMENTS
   ```

The skill will create a new pending session that coexists with any existing sessions.
