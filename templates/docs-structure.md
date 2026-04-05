# docs/ Vault Structure

`/beast setup` creates this structure in your project root. These are living documents — update them as the project evolves.

---

## docs/INDEX.md

Root navigation file. Lists all docs with one-line descriptions and links. Organized by section. Includes a **Related Code** column pointing to the source files each doc describes.

Example format:
```
| Doc | Description | Related Code |
|-----|-------------|--------------|
| architecture/agent-loop.md | How the agent orchestrator works | lib/stagehand/agent-loop.ts |
| decisions/001-browser-provider.md | Why Dolphin Anty over Playwright | lib/stagehand/ |
```

Agents read this before planning. Keep it current.

---

## docs/architecture/

How systems work — the "why the code is shaped this way" layer.

One file per major subsystem. Each file covers:
- What the system does
- Key design decisions and constraints
- Data flow / sequence
- Known failure modes and mitigations
- Related Code pointers

These are NOT tutorials. They exist so a fresh agent (or engineer) can understand a system in 5 minutes without reading 500 lines of code.

---

## docs/decisions/

Lightweight ADRs (Architecture Decision Records).

Format: `NNN-short-title.md`

Each file contains:
- **Status**: Accepted / Superseded / Deprecated
- **Context**: What forced this decision
- **Decision**: What was chosen
- **Consequences**: What this makes easier or harder
- **Superseded by** (if applicable): link to newer ADR

Keep them short. The value is in the *why*, not the what.

---

## docs/specs/

Feature specs — written before implementation, updated after.

One file per feature or significant change. Covers:
- Goal and success criteria
- User-facing behavior
- Technical approach (brief)
- Open questions / assumptions
- Out of scope

Specs are input to `/beast-forge`. Link the spec in your task description.

---

## docs/retros/

Post-project retrospectives. One file per sprint/project/incident.

Format: `YYYY-MM-DD-topic.md`

Standard sections:
- What went well
- What went wrong
- Root causes (not symptoms)
- Action items with owners

Retros feed back into architecture docs and CLAUDE.md gotchas.

---

## docs/runbooks/

Operational procedures for recurring tasks or incident response.

One file per procedure. Covers:
- When to use this runbook
- Prerequisites
- Step-by-step commands
- Expected output / verification
- Rollback steps

Examples: deploy procedure, database migration, re-login flow, zombie session cleanup.
