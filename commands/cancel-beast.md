---
description: "Cancel active beast session(s)"
---

Cancel beast session(s). This works identically to `/cancel-beast-plan` — operates on `.beast-plan/` directory.

Follow the exact same protocol as cancel-beast-plan: find sessions, let user select, update state.json to cancelled, offer cleanup.

Emit `<bp-complete>` to signal the stop hook to allow session exit.
