---
name: code-hygiene
description: "Codebase health analysis: dead code, test quality, duplicates, complexity, security, architecture mapping. Tool-first, structured storage, forge integration."
---

# Code Hygiene — Scan, Report, Integrate

Persistent codebase health analysis. Runs static tools, interprets output, stores structured findings, suggests forge tasks for cleanup.

## When to Use
- After shipping a feature (catch accumulated tech debt)
- Periodic hygiene (every 1-2 sprints)
- Before major refactoring (map current state first)
- Onboarding to unfamiliar codebase (architecture overview)
- User says "code hygiene", "tech debt", "почисти код", "найди мертвый код", "проверь тесты"

## Pipeline: SCAN → REPORT → INTEGRATE → SAVE

---

### Phase 1: SCAN

#### 1a. Project Detection
- `package.json` → TypeScript/JavaScript (primary, full tool support)
- `pyproject.toml`/`setup.py` → Python (semgrep + scc only)
- `go.mod` → Go (semgrep + scc only)
- `Cargo.toml` → Rust (semgrep + scc only)
- Report honestly: "Full analysis available for TS/JS. Limited to semgrep+scc for [language]."

#### 1b. Tool Detection
Check availability, report what's missing:
```
Global:   which tsc semgrep scc jq
Local:    grep devDependencies package.json for knip, jscpd, dependency-cruiser, stryker
Missing:  suggest `npm i -D knip jscpd dependency-cruiser` for full coverage
```

#### 1c. Tool Execution
Run available tools. ALL output goes to files first — NEVER read raw output into context.

**3-step pattern for every tool:**
1. **Redirect:** `<cmd> > .omc/hygiene/raw-<name>.json 2>&1`
2. **Summarize:** `jq '<path>[:50]' raw-<name>.json > <name>.json`
   - If jq unavailable: `Read raw-<name>.json` with `limit: 200`
   - tsc is plain text: `head -100 raw-types.txt > types.txt`
3. **Read:** Read `<name>.json` — NEVER read `raw-*` files into context

**Tools (run in parallel via background Bash):**

| Tool | Command | Output file | Summary jq path |
|------|---------|-------------|-----------------|
| tsc | `tsc --noEmit 2>&1 > raw-types.txt` | types.txt | `head -100` (plain text) |
| scc | `scc --by-file --format json src/ > raw-complexity.json` | complexity.json | `sort_by(.Complexity) \| reverse \| .[:50]` |
| semgrep | `semgrep scan --config auto --json . > raw-security.json` | security.json | `.results[:50]` |
| knip | `npx knip --reporter json > raw-dead-code.json` | dead-code.json | `.files[:50] + .exports[:50]` (if in devDeps) |
| jscpd | `npx jscpd src/ --reporters json -o /tmp/jscpd > raw-duplicates.json` | duplicates.json | `.duplicates[:50]` (if installed) |
| dep-cruiser | `npx dependency-cruiser src --include-only "^src" --output-type json > raw-dependencies.json` | dependencies.json | `.summary.violations[:50]` (if installed) |
| stryker | `npx stryker run --reporters json > raw-mutations.json` | mutations.json | `.files \| to_entries[:20]` (only with `--deep`) |

#### 1d. Adaptive Mode Decision
After SCAN completes, count source files analyzed:
```
source_files < 50   → INLINE mode (Claude interprets all tool outputs directly)
source_files >= 50  → AGENT mode (spawn focused agents per concern area)
```
User can override: `--inline` forces inline, `--agents` forces agents.

#### 1e. Incremental Mode
- If `.omc/hygiene/snapshot.json` exists → diff file hashes against current
- Coarse skip: if no `.ts/.js` files changed since last run → skip tsc
- knip, jscpd, dependency-cruiser ALWAYS run full project (need full graph context)
- No snapshot → full scan, save snapshot in SAVE phase

---

### Phase 2: REPORT

**INLINE mode** — Claude does all analysis directly:

#### 2a. Dead Code Analysis
- Read `dead-code.json` (knip output). If knip unavailable: grep for exports, cross-reference imports.
- Verify top-10 findings: Read the actual source file, grep for usages across codebase.
- Filter false positives: framework entrypoints, dynamic imports, barrel re-exports, test utilities.
- Each verified finding: cite file:line, explain why dead, estimate removal blast radius.

#### 2b. Test Quality Analysis
- Find test files: `Glob("**/*.test.{ts,tsx,js}", "**/*.spec.{ts,tsx,js}", "**/__tests__/**")`
- Read test files and classify each:
  - **Effective** — tests behavior, would catch regressions
  - **Weak** — happy path only, no edge cases
  - **Zombie** — no real assertions (`expect(true).toBe(true)`, empty test body)
  - **Broken** — `.skip`, `.todo`, or always-failing
  - **Coupled** — mocks everything, tests implementation details not behavior
- Cross-reference with `complexity.json`: high-complexity files with no tests = critical gap.
- Use `git blame` on `.skip` tests to find how long they've been disabled.

#### 2c. Architecture Overview
- From `dependencies.json`: extract module dependency graph, generate mermaid diagram.
- From `complexity.json`: identify hotspots (top-10 most complex files).
- From directory structure: identify module boundaries, entry points, shared utilities.
- Generate `architecture.md` with mermaid flowchart + complexity heatmap.

#### 2d. Drift Check
- Run `/docs-refresh --scan-only` — compose, don't duplicate.
- Fold drift findings into report as separate "Documentation Drift" section.

#### 2e. Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **P0** | Type errors (tsc), security critical (semgrep high), broken tests | Fix this sprint |
| **P1** | Dead code (high confidence), unused deps, circular deps, complexity >25 | Plan fix |
| **P2** | Suspected dead code, duplicates >30 lines, complexity 15-25, weak tests | Backlog |
| **P3** | Minor duplicates, style issues, low-priority items | Nice to have |

#### 2f. Health Score
Weighted 0-100: types (25%) + dead code (20%) + tests (20%) + security (15%) + complexity (10%) + deps (10%).
Per-category: 100 = zero findings, 0 = critical issues. Deduct per finding by severity.

**AGENT mode** — spawn 3 focused agents sequentially:

1. **dead-code-hunter** (`agents/dead-code-hunter.md`, model: sonnet)
   - Input: `.omc/hygiene/dead-code.json` + project root path
   - Does: verifies findings, filters false positives, cites file:line
   - Output: verified dead code list with confidence ratings

2. **test-analyst** (`agents/test-analyst.md`, model: sonnet)
   - Input: `.omc/hygiene/complexity.json` + test file glob results
   - Does: reads test files, classifies quality, finds critical gaps
   - Output: test quality report with per-file classifications

3. **hygiene-synthesizer** (`agents/hygiene-synthesizer.md`, model: opus)
   - Input: all `.omc/hygiene/*.json` + agent outputs (1,2) + optional docs-refresh output
   - Does: builds unified report, generates architecture.md, calculates health score
   - Output: `report.md` + `architecture.md` + severity-classified findings

---

### Phase 3: INTEGRATE
- Present `report.md` to user with health score and finding counts.
- For each P0/P1 finding: suggest `/forge --spawn "refactor: [finding description]"`
- User approves/rejects forge task creation. Can `--park` them for later.

### Phase 4: SAVE
- Write all `.omc/hygiene/` files (see Storage Schema below).
- Save `snapshot.json` with current source file SHA-256 hashes.
- Delete `raw-*` files (keep with `--keep-raw` for debugging).
- If previous findings exist: diff and report delta ("Since last run: +2 P1, -3 P2 resolved").

---

## Storage Schema

```
.omc/hygiene/
├── _meta.json           # run metadata, health score, tool list
├── dead-code.json       # knip findings (summarized)
├── duplicates.json      # jscpd clone pairs
├── dependencies.json    # dependency-cruiser violations + graph
├── complexity.json      # scc per-file scores (top-50)
├── tests.json           # test quality classifications
├── security.json        # semgrep findings
├── types.json           # tsc errors (plain text, head -100)
├── architecture.md      # mermaid diagrams, module map, data flow
├── report.md            # human-readable triage (the deliverable)
└── snapshot.json        # SHA-256 per source file for incremental
```

All JSON files carry `_meta: { updated_at, tool, version }` for staleness tracking.

---

## Flags

```
/code-hygiene                    — full pipeline (adaptive mode)
/code-hygiene --module <path>    — scope to specific directory
/code-hygiene --deep             — include mutation testing (stryker, slow)
/code-hygiene --inline           — force inline mode (no agents)
/code-hygiene --agents           — force agent mode
/code-hygiene --keep-raw         — keep raw-* tool output files
```

## Safety
- NEVER auto-fix code. Report only. Fixes go through `/forge --spawn`.
- NEVER delete `.omc/hygiene/` files without user approval.
- If a tool fails: log the error, skip that analysis, note in report as "unavailable".
- On first run: full scan always. Incremental only after snapshot exists.
