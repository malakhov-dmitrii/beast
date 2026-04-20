---
name: docs-refresh
description: "Docs hygiene: audit freshness, delete stale, update drifted, compress bloated. Use: /docs-refresh, --scan-only, --memory-only"
---

Route to the `docs-refresh` skill with the user's arguments.

Flags:
- `--scan-only` — report only, no changes
- `--memory-only` — scope to memory files (skip CLAUDE.md, docs/, lessons)
- `--docs-only` — scope to `docs/` vault
- `--force` — bypass the "don't delete recent" safety rails
