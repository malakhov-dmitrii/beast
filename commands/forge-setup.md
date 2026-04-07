---
name: beast-setup
description: "One-time project setup for forge: creates docs/ vault, .semgrep/ rules, CLAUDE.md sections"
---

# Beast Setup

One-time setup to get the most from forge. Run this once per project.

## Steps

### 1. Check tools
```
which semgrep → installed? If not: "Install with: brew install semgrep"
which scc → installed? If not: "Install with: brew install scc"  
which codex → installed? If not: "Optional. Fresh opus agent used as fallback for second opinion."
```

### 2. Create docs/ vault

If `docs/` doesn't exist, create it. If it exists, add subdirectories alongside existing content (DON'T overwrite).

Create:
- `docs/INDEX.md` — root navigation with "What Goes Where" table
- `docs/architecture/INDEX.md` — empty, with column headers (Doc | Summary | Updated | Related Code)
- `docs/decisions/INDEX.md` — empty, with column headers
- `docs/specs/INDEX.md` — empty
- `docs/retros/INDEX.md` — empty
- `docs/runbooks/INDEX.md` — empty

### 3. Create .semgrep/ (if semgrep installed)

Copy starter rules from `${CLAUDE_PLUGIN_ROOT}/templates/semgrep-starter.yml` to `.semgrep/rules.yml`.

Scan project to auto-detect relevant rulesets:
- TypeScript/JavaScript → uncomment relevant starter rules
- Python → add `p/python` note
- Go → add `p/golang` note

### 4. Update CLAUDE.md

If project has a CLAUDE.md, append (if not already present):

```markdown
## Common Failures (update every ~10 tasks)
- [Add patterns here as you discover them during verification]

## Project Docs
Architecture, ADRs, specs, runbooks → docs/INDEX.md. Read before planning.
```

If no CLAUDE.md exists, create a minimal one with project name + these sections.

### 5. Report

Show what was created and what's ready:
```
Beast Forge setup complete:
  ✓ docs/ vault (6 INDEX.md files)
  ✓ .semgrep/ rules (N starter rules)
  ✓ CLAUDE.md updated (Common Failures + Project Docs)
  ✓ semgrep: installed
  ✓ scc: installed
  ○ codex: not installed (optional, opus fallback active)

Run /forge "your task" to start.
```
