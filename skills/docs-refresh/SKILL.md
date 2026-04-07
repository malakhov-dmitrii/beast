---
name: docs-refresh
description: "Full documentation hygiene pass: memory, CLAUDE.md, lessons, references, guides. Audit freshness, delete stale, update outdated, compress index."
---

# Docs Refresh — Sweep, Verify, Compress

Audit all project documentation for freshness. Delete what's dead, update what drifted, compress what's bloated.

## When to Use
- Periodic hygiene (every 1-2 weeks)
- Before major planning sessions (clean context = better plans)
- After big architectural changes (old docs become lies)
- User says "docs refresh", "обнови доки", "почисти память", "sweep docs"
- MEMORY.md approaching 200-line limit

## Scope

All doc layers, in order:

| Layer | Location | What to check |
|-------|----------|---------------|
| **Memory files** | `.claude/projects/.../memory/*.md` | Each file vs codebase reality |
| **Memory index** | `.claude/projects/.../memory/MEMORY.md` | Orphans, duplicates, line count |
| **CLAUDE.md (root)** | `CLAUDE.md` | Gotchas: still real? Commands: still work? |
| **CLAUDE.md (.claude)** | `.claude/CLAUDE.md` | OMC config: still accurate? |
| **Docs vault** | `docs/` (architecture, decisions, specs, runbooks, retros, articles) | Stale specs, outdated architecture |
| **Lessons index** | Lessons in memory + `docs/` | Lessons for deleted/rewritten systems |

---

## Pipeline

### 1. INVENTORY (automated scan)

Catalog everything with dates:

```
Memory files:    count, oldest, newest
MEMORY.md:       line count (warn if >170)
CLAUDE.md:       gotcha count, last modified
docs/:           file count per subdir, oldest files
```

Flag files older than 14 days for review. Flag any file referencing deleted code paths.

### 2. STALENESS SCAN (per file)

For each doc file, check against reality:

**Memory files** — classify each:
- `arch-*`: Does the system still exist? Has it changed significantly since the memory was written?
- `lesson-*`: Is the lesson about a system that was deleted/rewritten? Is the gotcha now guarded by semgrep/code?
- `feedback_*`: Is the preference still relevant? (some become obvious after being applied everywhere)
- `client-*`: Are facts current? (pricing, status, contacts)
- `project_*`: Is the project/initiative still active?
- `reference-*`: Does the external resource still exist? Is the info current?
- `content_*`, `lead-*`, `icp-*`: Is the strategy still the one we're executing?

**CLAUDE.md gotchas** — for each:
- `git log --oneline -5 -- <related-files>` — was the gotcha recently fixed?
- `grep -r "<gotcha-keyword>"` — is the guard/semgrep rule in place?
- If fixed AND guarded → candidate for removal

**docs/** — for each:
- Is this about a system that still exists?
- Does the spec match current implementation?
- Is the runbook still the way we deploy?

### 3. TRIAGE (present to user)

Output a structured report:

```markdown
## DELETE (stale, system removed, or fully guarded)
- [ ] memory: lesson-X — system deleted on 2026-04-03
- [ ] memory: arch-Y — replaced by arch-Z, duplicate info
- [ ] docs: spec-old.md — implemented and diverged, spec is now a lie

## UPDATE (partially stale, core still valid)
- [ ] memory: client-vladimir — pricing changed
- [ ] CLAUDE.md gotcha line 42 — partially fixed, needs narrowing

## COMPRESS (valid but verbose, can merge or shorten)
- [ ] memory: feedback_A + feedback_B — same theme, merge into one
- [ ] MEMORY.md — 3 entries pointing to same concept

## KEEP (verified fresh)
- (count): N files verified current
```

**User reviews the triage.** No deletions without approval.

### 4. EXECUTE

After user approves (or approves with edits):

1. **Delete** approved files. Remove their MEMORY.md entries.
2. **Update** flagged files with current info. Re-read source of truth before editing.
3. **Compress** merged entries. Update MEMORY.md index.
4. **CLAUDE.md**: remove fixed gotchas, update commands if changed, trim Common Failures.
5. **docs/**: archive or delete stale specs. Update architecture docs that drifted.

### 5. VERIFY

After execution:

- MEMORY.md line count (must be <180, target <150)
- No orphan memory files (file exists but no MEMORY.md entry)
- No dead links in MEMORY.md (entry exists but file deleted)
- CLAUDE.md gotcha count still under 40 lines
- `git diff --stat` — review what changed

---

## Staleness Heuristics

| Signal | Action |
|--------|--------|
| Memory references file/function that doesn't exist | DELETE or UPDATE |
| Lesson about system deleted >7 days ago | DELETE |
| Architecture doc contradicts current code | UPDATE |
| Feedback already baked into CLAUDE.md or code convention | DELETE (redundant) |
| Two memory files covering same topic | MERGE into one, delete other |
| MEMORY.md entry >150 chars | SHORTEN |
| Reference to external URL that 404s | DELETE or UPDATE |
| Project memory about completed initiative | ARCHIVE (move to "completed" or delete) |

## Memory Merge Rules

When merging:
- Keep the file with the richer content
- Update its frontmatter description
- Delete the other file
- Update MEMORY.md to point to survivor

## Safety

- NEVER delete without presenting triage first
- NEVER delete client data or incident records (archive instead)
- NEVER edit memory files based on assumptions — re-read source of truth
- Git commit after each phase (delete, update, compress) for easy rollback
- If unsure about a file → KEEP, don't delete

## Flags

```
/docs-refresh                — full pipeline: inventory → scan → triage → (approve) → execute → verify
/docs-refresh --scan-only    — inventory + scan + triage report, no changes
/docs-refresh --memory-only  — scope to memory files + MEMORY.md only
/docs-refresh --claude-only  — scope to CLAUDE.md files only
/docs-refresh --docs-only    — scope to docs/ vault only
/docs-refresh --auto         — auto-approve obvious deletions (deleted systems, duplicates), ask for ambiguous
```
