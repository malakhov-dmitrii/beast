---
name: code-hygiene
description: "Codebase health scan: dead code, test quality, duplicates, complexity, security, architecture. Use: /code-hygiene, --module, --deep"
---

Route to the `code-hygiene` skill with the user's arguments.

Flags:
- `--module <path>` — scope scan to a specific directory
- `--deep` — include mutation testing (slow)
- `--no-save` — run scans, do not persist results to `.omc/hygiene/`
- `--report-only` — re-emit latest saved report without rescanning
