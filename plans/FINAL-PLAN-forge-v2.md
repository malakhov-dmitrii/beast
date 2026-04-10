# FINAL-PLAN — Forge v2.2

**Slug:** `forge-v2`
**Scope:** Upgrade Forge planning, review, and execution. Visionary Stream, Comparator, Typed Claims, Parallel-Blind gates, Cascade Execute (gemini), Docs DB Sweep, **MemPalace L1+L2** (knowledge plane).
**Revision:** v2.2 — incorporates all 5 P1 + 5 P2 from 3-gate review of v2.1 + MemPalace integration.

## P1/P2 Resolution Map

| Finding | Fix | Step |
|---|---|---|
| P1: Anchored Review Collapse | Skeptic+Integration parallel-blind. 2nd Opinion stacked. | 5 |
| P1: Blindness Not Enforced | Sealed input bundle — gates don't read forge.db. Orchestrator persists after both return. | 5 |
| P1: Dual-Write Split-Brain | **Eliminated.** ALTER existing `gates` table (spike confirmed). No new `gate_runs` table. | 1 |
| P1: Non-Idempotent State | UNIQUE constraints + INSERT OR REPLACE on all new tables + gates. | 1 |
| P1: Iron Rule Self-Undo | Rule #5 rewritten: no rotation, bilateral blindness immutable. | 5 |
| P1: Global Cutover | Staged canary: Steps 1-3 (non-behavior-changing) → canary → Step 5 (SKILL.md cutover). | 4 |
| P2: Migration Race | `BEGIN IMMEDIATE`/`COMMIT` wrapping. | 1 |
| P2: Citation Churn | Deferred to v2.3. file:line is fine for one-shot planning — re-run Skeptic is cheap. | — |
| P2: Default 3-Pass Tax | **Adaptive default** by scope: <3 files=skip, 3-10=1 pass, 10+=3 passes. | 5 |
| P2: Comparator Offline | Tier-2 marks `needs-external-check` if no network. | 3,5 |
| P2: Schema Hygiene | Indexes on `(forge_id, iteration)` for all tables. CHECK constraints tightened. | 1 |
| **NEW: Cascade Execute** | Gemini first → static → acceptance → opus review → fallback opus rewrite. | 5 |
| **NEW: Docs DB Sweep** | `/docs-refresh` sweeps forge.db + global.db + MemPalace (auto-action + warn). | 5 |
| **DEFERRED: MemPalace L1** | pip install + init + mcp add. Standalone, not wired into pipeline. | — |
| **DEFERRED: MemPalace L2** | PRECEDENT queries + dual-write + hook chaining. Blocked by: hall param, soft failures, env mismatch. | — |

## Spike Log

| Assumption | Result | Evidence |
|---|---|---|
| bun:sqlite ALTER TABLE ADD COLUMN works | **confirmed** | In-memory test: 3 ALTERs on `gates`, existing rows get defaults, UNIQUE INDEX works, INSERT OR REPLACE works. Recorded in forge.db. |

---

## Step 0: MemPalace setup (L1 — parallel with all other steps)

**Do:** Install MemPalace, initialize palace for thewhychain, register MCP server, mine existing project knowledge into the palace.

**Files:** none in Forge plugin (MemPalace is external)

**Procedure:**

```bash
# 1. Install
pip install mempalace

# 2. Initialize palace for thewhychain
mempalace init ~/code/thewhychain

# 3. Configure wings
#    - wing_thewhychain (project): keywords from system dirs
#    - wing_forge_global (cross-project): spikes, patterns, process learnings
#    Wing config at ~/.mempalace/wing_config.json

# 4. Register MCP server
claude mcp add mempalace -- python -m mempalace.mcp_server

# 5. Mine existing knowledge into palace
mempalace mine ~/code/thewhychain/docs/          --wing thewhychain    # architecture docs, specs
mempalace mine ~/code/thewhychain/.omc/plans/    --wing thewhychain    # past forge plans
mempalace mine ~/.claude/projects/-Users-malakhov-code-thewhychain/memory/ --mode convos --wing thewhychain  # memory files

# 6. Seed KG with key architectural facts
# (done via MCP tools in first session after setup)
```

**Palace structure:**

```
WING: thewhychain
  ROOMS (auto-detected from code): reply-worker, engage-scheduler,
    agent-orchestrator, dolphin-anty, reply-queue, growth-score, ...
  HALLS (fixed 5): hall_facts, hall_events, hall_discoveries,
    hall_preferences, hall_advice

WING: forge-global
  ROOMS: spikes, patterns, process-learnings, cross-project-gotchas
  HALLS: same 5
```

**Identity file** (`~/.mempalace/identity.txt`):
```
Forge Intelligence — planning + verification system for Claude Code.
Projects: thewhychain (Galevox SMM), budget-vision, winfinity.
Owner: Dmitrii Malakhov. Bun/TypeScript, PostgreSQL/Drizzle, Trigger.dev.
```

**Claims:**
- `fact:` MemPalace CLI installed at `/opt/homebrew/bin/mempalace` (TODO: verify after pip install — not yet installed).
- `fact:` `~/code/thewhychain/docs/` exists with architecture docs (referenced in CLAUDE.md "Project Docs" section).
- `fact:` `~/.claude/projects/-Users-malakhov-code-thewhychain/memory/` has 40+ memory files (MEMORY.md index).
- `design_bet:` Mining memory/*.md as convos mode will correctly parse markdown files.
  - `assumption:` MemPalace normalize.py handles markdown (not just chat exports).
  - `validation_plan:` Run `mempalace mine` on one memory file, verify drawer created. If fails, use `--mode projects` instead.
  - `blast_radius:` Mining is read-only — worst case: garbage drawers, easily deleted.
- `strategic:` Separate wing for forge-global (cross-project knowledge).
  - `rationale:` Matches `~/.forge/global.db` scope. Prevents cross-project tunnel noise.
  - `alternatives_considered:` Single wing per project only — rejected: global spikes/patterns need a home.

**Acceptance:**
- `mempalace status` returns palace overview with ≥2 wings
- `mempalace search "reply-worker"` returns results from thewhychain docs
- `claude mcp list` shows mempalace server
- `mempalace_list_wings` MCP tool returns wing list

**Checkpoint:** false (parallel, doesn't block other steps)
**Depends on:** none

---

## Step 1: Schema v2 migration (transactional)

**Do:** Bump `SCHEMA_VERSION` to 2. Add `migrateV1toV2()` that runs inside `BEGIN IMMEDIATE`/`COMMIT`. ALTER existing `gates` table (+3 columns). Create 3 new tables. Add UNIQUE constraints + indexes.

**Files:** `~/.claude/plugins/forge/hooks/forge-schema.mjs`

**Migration DDL (verbatim):**

```sql
BEGIN IMMEDIATE;

-- Extend gates (NOT a new table — resolves P1 dual-write)
ALTER TABLE gates ADD COLUMN blind INTEGER DEFAULT 1;
ALTER TABLE gates ADD COLUMN inputs_seen TEXT DEFAULT '[]';
ALTER TABLE gates ADD COLUMN meta_findings TEXT DEFAULT '[]';

-- Idempotent UNIQUE on gates (resolves P1 non-idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gates_unique
  ON gates(forge_id, iteration, gate);

-- Visionary passes
CREATE TABLE IF NOT EXISTS visionary_passes (
  id INTEGER PRIMARY KEY,
  forge_id INTEGER NOT NULL REFERENCES forges(id),
  iteration INTEGER NOT NULL,
  pass_number INTEGER NOT NULL,
  angle TEXT NOT NULL CHECK(angle IN ('simpler','better','blind_spots','custom')),
  agent TEXT NOT NULL CHECK(agent IN ('codex','opus','gemini')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(forge_id, iteration, pass_number, angle)
);
CREATE INDEX IF NOT EXISTS idx_visionary_forge ON visionary_passes(forge_id, iteration);

-- Comparator reports
CREATE TABLE IF NOT EXISTS comparator_reports (
  id INTEGER PRIMARY KEY,
  forge_id INTEGER NOT NULL REFERENCES forges(id),
  iteration INTEGER NOT NULL,
  tldr TEXT NOT NULL,
  diff_items TEXT NOT NULL DEFAULT '[]',
  reality_check TEXT NOT NULL DEFAULT '{}',
  recommendation TEXT NOT NULL CHECK(recommendation IN ('standard','visionary','merge')),
  user_decision TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(forge_id, iteration)
);

-- Claim validations
CREATE TABLE IF NOT EXISTS claim_validations (
  id INTEGER PRIMARY KEY,
  forge_id INTEGER NOT NULL REFERENCES forges(id),
  iteration INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  claim_type TEXT NOT NULL CHECK(claim_type IN ('fact','design_bet','strategic')),
  claim_text TEXT NOT NULL,
  citation TEXT,
  validation_result TEXT CHECK(validation_result IN ('verified','mirage','unverifiable','pending')),
  validation_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claims_forge ON claim_validations(forge_id, iteration);

COMMIT;
```

**Error handling:** If any ALTER fails (column already exists on re-run), catch and skip. bun:sqlite throws `SqliteError` — wrap each ALTER in try/catch. Tables use `IF NOT EXISTS`. Transaction ensures atomicity for fresh DBs.

**Claims:**
- `fact:` `SCHEMA_VERSION=1` at `forge-schema.mjs:19`. Migration scaffold at `:57-58`.
- `fact:` `migrateIfNeeded()` at `:48` with early-return at `:51` when version >= target.
- `fact:` spike confirmed ALTER TABLE works in bun:sqlite with existing rows preserving defaults. Recorded in forge.db.
- `design_bet:` ALTER on existing gates resolves all 3 runtime readers (handlePreCompact `:210-212`, updateCoFailures at `forge-crud.mjs:256-258`, system_risk view at `forge-schema.mjs:127-138`).
  - `assumption:` All readers query columns that existed pre-ALTER. New columns have defaults, invisible to old readers.
  - `validation_plan:` Canary (Step 4) runs handlePreCompact against migrated DB.
  - `blast_radius:` Per-project DB. Migration is additive. Rollback: DROP INDEX + DROP tables (ALTER columns remain but are harmless with defaults).

**Acceptance:**
- `bun forge-schema.mjs` parses
- Open `~/code/thewhychain/.omc/forge.db` (copy to /tmp first), verify version=2
- `PRAGMA table_info(gates)` returns 10 columns (was 7)
- `SELECT name FROM sqlite_master WHERE type='table'` includes all 3 new tables
- Existing `forges`/`gates`/`spikes` row counts unchanged
- Inserting duplicate `(forge_id, iteration, gate)` into gates → conflict error
- Inserting with `INSERT OR REPLACE` → old row replaced

**Checkpoint:** true
**Depends on:** none

---

## Step 2: CRUD additions

**Do:** Extend `forge-crud.mjs` with visionary, comparator, claims CRUD. Extend existing `recordGate` with optional `blind`/`inputs_seen`/`meta_findings` params (backward-compatible). Document camelCase→snake_case mapping explicitly.

**Files:** `~/.claude/plugins/forge/hooks/forge-crud.mjs`

**API (new exports):**
```js
// ── Visionary ──
recordVisionaryPass(cwd, forgeId, iteration, { passNumber, angle, agent, content })
  // INSERT OR IGNORE (same pass+angle = keep first)
listVisionaryPasses(cwd, forgeId, iteration)

// ── Comparator ──
recordComparatorReport(cwd, forgeId, iteration, { tldr, diffItems, realityCheck, recommendation })
  // INSERT OR REPLACE on UNIQUE(forge_id, iteration)
  // JS camelCase → SQL snake_case mapping:
  //   diffItems   → diff_items
  //   realityCheck → reality_check
updateComparatorDecision(cwd, forgeId, iteration, decision)
getComparatorReport(cwd, forgeId, iteration)

// ── Claims ──
recordClaim(cwd, forgeId, iteration, stepNumber, { claimType, claimText, citation })
  // claimType → claim_type, claimText → claim_text
validateClaim(cwd, claimId, { result, notes })
  // result → validation_result, notes → validation_notes
listClaims(cwd, forgeId, iteration)
getClaimSummary(cwd, forgeId, iteration)
  // Returns: { fact: { verified: N, mirage: M, pending: P }, design_bet: {...}, strategic: {...} }
```

**Extend existing `recordGate`** (at `forge-crud.mjs:126`):
```js
// Before: recordGate(cwd, forgeId, iteration, gate, result, findings = [])
// After:  recordGate(cwd, forgeId, iteration, gate, result, findings = [], { blind = 1, inputsSeen = [], metaFindings = [] } = {})
// Uses INSERT OR REPLACE on UNIQUE(forge_id, iteration, gate)
```

**Claims:**
- `fact:` Existing `recordGate` at `forge-crud.mjs:126-134` follows try/finally pattern. Extension is backward-compatible (optional last param with defaults).
- `fact:` `openForgeDb` import at `forge-crud.mjs:8`.
- `design_bet:` camelCase→snake_case documented per-function prevents Integration P1 (contract gap).
  - `validation_plan:` Runnable round-trip test (below) verifies exact column mapping.
  - `blast_radius:` Only new functions + backward-compatible extension. No existing callers break.

**Acceptance (runnable — resolves Integration "pseudocode" finding):**
```bash
/Users/malakhov/.bun/bin/bun -e "
import { createForge, recordGate, abandonForge } from '/Users/malakhov/.claude/plugins/forge/hooks/forge-crud.mjs';
import { recordVisionaryPass, listVisionaryPasses, recordComparatorReport, getComparatorReport, recordClaim, getClaimSummary } from '/Users/malakhov/.claude/plugins/forge/hooks/forge-crud.mjs';
import { openForgeDb } from '/Users/malakhov/.claude/plugins/forge/hooks/forge-schema.mjs';

const cwd = '/tmp';
const fid = createForge(cwd, { slug: 'test-v2-' + Date.now(), systems: ['test'] });

// Extended recordGate with blind + inputs_seen
recordGate(cwd, fid, 1, 'skeptic', 'PASS', ['ok'], { blind: 1, inputsSeen: ['plan'], metaFindings: [] });
const db = openForgeDb(cwd);
const gate = db.query('SELECT blind, inputs_seen, meta_findings FROM gates WHERE forge_id=? AND gate=\"skeptic\"').get(fid);
console.assert(gate.blind === 1, 'blind column');
console.assert(JSON.parse(gate.inputs_seen)[0] === 'plan', 'inputs_seen mapped');
db.close();

// Visionary round-trip
recordVisionaryPass(cwd, fid, 1, { passNumber: 1, angle: 'simpler', agent: 'opus', content: 'test content' });
const passes = listVisionaryPasses(cwd, fid, 1);
console.assert(passes.length === 1 && passes[0].angle === 'simpler', 'visionary');

// Comparator round-trip (camelCase→snake_case)
recordComparatorReport(cwd, fid, 1, { tldr: 'test', diffItems: [{x:1}], realityCheck: {confirmed:['a']}, recommendation: 'standard' });
const cr = getComparatorReport(cwd, fid, 1);
console.assert(cr.recommendation === 'standard', 'comparator');
console.assert(JSON.parse(cr.diff_items)[0].x === 1, 'diffItems mapped to diff_items');

// Claims round-trip
recordClaim(cwd, fid, 1, 1, { claimType: 'fact', claimText: 'test fact', citation: 'file:1' });
recordClaim(cwd, fid, 1, 1, { claimType: 'design_bet', claimText: 'test bet', citation: null });
const summary = getClaimSummary(cwd, fid, 1);
console.assert(summary.fact.pending === 1, 'claim summary');

abandonForge(cwd, fid, 'test cleanup');
console.log('ALL ROUND-TRIP TESTS PASSED');
"
```

**Checkpoint:** true
**Depends on:** Step 1

---

## Step 3: Agent prompt files

**Do:** Create 4 agent prompt files. Each has `# Role`, `# Input`, `# Output Format`, `# Forbidden` sections.

**Files (create):**
- `~/.claude/plugins/forge/agents/visionary-simpler.md`
- `~/.claude/plugins/forge/agents/visionary-better.md`
- `~/.claude/plugins/forge/agents/visionary-blind-spots.md`
- `~/.claude/plugins/forge/agents/comparator.md`

**Key behavioral contracts per agent:**

| Agent | Model | Reads | Question | Forbidden |
|---|---|---|---|---|
| visionary-simpler | opus/codex | PLAN-DRAFT only | "Is there a simpler approach for the same outcome?" | Adding scope, optimization |
| visionary-better | codex preferred | PLAN-DRAFT only | "Could this be 10x better with comparable effort?" | Rejecting what CLARIFY already considered |
| visionary-blind-spots | opus | **ORIGINAL USER REQUEST** (NOT plan) | "What is the user really trying to achieve?" | Reading plan draft |
| comparator | opus | PLAN-DRAFT + all visionary + original request | 3-tier classify + reality-check + TL;DR | Skipping reality-check |

**Comparator 3-tier classification:**
- `codebase-verifiable` → grep/read → ✓/✗
- `externally-verifiable` → WebSearch/context7 if network available, else mark `needs-external-check` (P2 offline fix)
- `strategic` → present to user with tradeoffs, no verdict

**Claims:**
- `fact:` Existing agents at `~/.claude/plugins/forge/agents/`: `evidence-collector.md`, `auditor.md` (referenced at `SKILL.md:297,303`). Same dir, same convention.
- `design_bet:` visionary-blind-spots reads ORIGINAL request prevents confirmation bias.
  - `validation_plan:` Behavioral grep in acceptance (below).
  - `blast_radius:` If agent reads plan instead → fails to catch reframing opportunities, but not destructive.

**Acceptance:**
- 4 files exist, each ≥30 lines
- `grep -l "ORIGINAL USER REQUEST" ~/.claude/plugins/forge/agents/visionary-blind-spots.md` → match
- `grep -l "DO NOT read.*plan" ~/.claude/plugins/forge/agents/visionary-blind-spots.md` → match
- `grep -l "3-tier" ~/.claude/plugins/forge/agents/comparator.md` → match
- `grep -l "needs-external-check" ~/.claude/plugins/forge/agents/comparator.md` → match (offline graceful)

**Checkpoint:** false
**Depends on:** none

---

## Step 4: Canary in thewhychain

**Do:** Validate Steps 1-3 end-to-end on the live `~/code/thewhychain/.omc/forge.db` WITHOUT touching SKILL.md (global cutover is Step 5, only after canary PASS).

**Files:** none modified (read-only validation)

**Procedure:**

1. **Backup:** `cp ~/code/thewhychain/.omc/forge.db ~/code/thewhychain/.omc/forge.db.v1-backup`
2. **Migration test:** open forge.db, verify version bumped to 2, existing data intact
3. **CRUD round-trip:** run Step 2 acceptance script against `/Users/malakhov/code/thewhychain`
4. **handlePreCompact test:** import `forge-hooks.mjs`, call handlePreCompact, verify it reads gates with new columns without error
5. **system_risk view test:** query `SELECT * FROM system_risk LIMIT 5` — must return results (proves ALTER didn't break view)
6. **Cleanup canary forge:** abandon test forge from step 3

**PASS criteria:** All 6 sub-checks pass. Existing forges queryable. handlePreCompact returns valid recovery prompt.

**FAIL action:** Restore backup. Fix. Re-run canary. Do NOT proceed to Step 5.

**Checkpoint:** true (GLOBAL CUTOVER GATE — nothing after this step can be reversed by rollback)
**Depends on:** Steps 1, 2, 3

---

## Step 5: SKILL.md rewrite (global cutover)

**Do:** Rewrite Plan Forge sections in SKILL.md. Add 5 new sections. Update Iron Rules. This is the atomic cutover — `/forge` changes behavior for ALL projects after this step.

**Files:** `~/.claude/plugins/forge/skills/forge/SKILL.md`

**Sections to add/rewrite:**

### 5-mempalace. MemPalace L2 integration (3 subsections woven into existing phases)

**5-mp-a. PRECEDENT — query MemPalace alongside forge.db**

Add to PRECEDENT phase (after forge.db queries):
```
6. mempalace_search("<system> decisions", wing=<project>) → past reasoning
7. mempalace_kg_query("<system>") → entity facts with temporal validity
8. mempalace_find_tunnels(wing_a, wing_b) → cross-project shared rooms
   Surface: "MemPalace: reply-worker was last discussed 2026-04-06, 
   decision: 'outer catch returns items to pending, not failed'"
```

**5-mp-b. Completion write-path — forge writes to MemPalace on completion + gate fail**

Add to forge completion flow:
```
On forge --complete:
  1. mempalace_add_drawer(wing=project, room=<primary_system>, hall=hall_events,
     content="Forge #{id} '{slug}': {summary}. Gates: {gate_results}. Lesson: {lesson}")
  2. For each gate with findings:
     mempalace_kg_add(<system>, "gate_result", <gate>:<result>, valid_from=<now>)
  3. For each confirmed spike:
     mempalace_kg_add(<subject>, <relationship>, <object>, valid_from=<now>)

On gate FAIL (even if forge continues):
  1. mempalace_add_drawer(wing=project, room=<system>, hall=hall_advice,
     content="Gate FAIL: {gate} on forge '{slug}' iter {N}. Findings: {findings}")
```

**5-mp-c. Hook chaining — MemPalace hooks alongside Forge hooks**

Add to `~/.claude/settings.json` (Step 0 registers MCP, but hooks need manual registration):
```json
"Stop": [
  { "hooks": [{ "type": "command", "command": "...existing OMC stop..." }] },
  { "hooks": [{ "type": "command", "command": "/path/to/mempalace/hooks/mempal_save_hook.sh", "timeout": 15 }] }
],
"PreCompact": [
  { "hooks": [{ "type": "command", "command": "...existing forge precompact..." }] },
  { "hooks": [{ "type": "command", "command": "/path/to/mempalace/hooks/mempal_precompact_hook.sh", "timeout": 15 }] }
]
```

SessionStart wake-up chain:
```
1. forge-hooks.mjs sessionstart → forge health (zombies, phantoms, stale)
2. mempalace wake-up (L0: identity + L1: critical facts → ~170 tokens)
3. Combined context injected
```

### 5a. Pipeline diagram (replace `SKILL.md:120-126`)

New 13-stage pipeline:
```
PRECEDENT → RESEARCH (+top-3 spikes) → CHALLENGE → CLARIFY (+visionary?) →
  PLAN-DRAFT (typed claims) → [VISIONARY] → [COMPARATOR] → USER DECISION →
  PLAN-FINAL → REVIEW (blind parallel + stacked meta) →
  EXECUTE (cascade: gemini→opus) → VERIFY → DOCS-REFRESH (+DB sweep)
```

### 5b. CLARIFY — visionary question (insert after `SKILL.md:186`)

Adaptive default:
```
Visionary stream — search for a "significantly better" approach?
  a) skip        ← default if <3 files
  b) 1 pass      ← default if 3-10 files
  c) 3 passes    ← default if 10+ files
  d) N passes
```

### 5c. PLAN — typed claim system (replace `SKILL.md:188-212`)

Step format gains `Claims:` block + `complexity: simple|complex` field.

Claim types: `fact:` (citation required, Skeptic verifies), `design_bet:` (assumption + validation_plan + blast_radius), `strategic:` (rationale + alternatives_considered).

No global % gate. Per-claim structural check. Any mirage → FAIL Skeptic.

Complexity auto-override: author marks `simple`, but system overrides to `complex` if step has `strategic:` claims OR touches 3+ files.

### 5d. VISIONARY section (new, between PLAN and REVIEW)

N parallel passes (user-chosen). Each writes to `visionary_passes` via `recordVisionaryPass()`. Agent files at `~/.claude/plugins/forge/agents/visionary-*.md`.

### 5e. COMPARATOR section (new, between VISIONARY and REVIEW)

Iron rule: cannot skip if visionary ran. 3-tier classification. Graceful offline for tier-2. Output: TL;DR + DIFF + reality-check + recommendation. User sees both variants and decides.

### 5f. REVIEW — sealed parallel-blind gates (replace `SKILL.md:214-260`)

**Sealed input bundle protocol:**
1. Orchestrator prepares: plan path + original user request text
2. Spawn Skeptic Agent(model=opus) + Integration Agent(model=sonnet) **in parallel, same message**
3. Prompt explicitly: "DO NOT read .omc/forge.db. DO NOT look for other gate findings. You see ONLY the plan and the codebase."
4. Both return findings as text in their Agent response
5. Orchestrator writes BOTH to `gates` table (with `blind=1`) via `INSERT OR REPLACE`
6. Only THEN: spawn 2nd Opinion (codex/opus) with [plan + skeptic findings + integration findings]
7. 2nd Opinion writes to `gates` with `blind=0`, `meta_findings` populated

### 5g. CASCADE EXECUTE (new section, replaces current Execute)

```
Per step in PLAN-FINAL:
  IF step.complexity == 'simple' AND `which gemini` available:
    1. gemini exec (model: gemini-2.5-flash-preview, timeout: 90s)
    2. Static analysis (tsc/lsp/semgrep)
       FAIL → rollback, opus rewrites
    3. Step acceptance criteria
       FAIL → rollback, opus rewrites
    4. opus REVIEW pass (read git diff only — cheap):
       APPROVE → next step
       REJECT → rollback, opus rewrites
  ELSE:
    opus executes directly (current behavior)
```

Token savings: ~70% per simple step (gemini 5k + opus review 3k vs opus-only 25k).

Iron Rule #8: opus review pass on gemini-executed steps is MANDATORY.

### 5h. DOCS REFRESH — DB Sweep (extend Machine 3)

Add "Knowledge Sweep" phase to existing /docs-refresh:

**Auto-action (safe):**
- Orphaned `current_state` pointers → DELETE
- `forges.plan_path` where file doesn't exist → SET NULL + flag
- Contradicting spikes (refuted then confirmed same assumption) → keep latest, mark old as superseded

**Warn-only (user decides):**
- Parked forges >30 days → "consider /forge --abandon"
- `~/.forge/global.db` spikes >90 days without verification → "re-verify?"
- Stale global_patterns (>60 days unused) → "flag stale?"

**MemPalace sweep (3rd backend):**

Auto-action:
- `mempalace_kg_invalidate` facts that contradict newer facts (same entity+relation)

Warn-only:
- `mempalace_kg_stats` → entities with no updates >60 days → "stale entity?"
- Rooms for systems deleted from code (grep codebase, compare to room list) → "dead room?"
- Cross-check: forge.db `co_failures` vs MemPalace KG triples — flag drift
- Wings with zero searches in >30 days → "unused wing?"

### 5i. Iron Rules update (extend `SKILL.md:376-385`)

New rules #5-#8:
```
5. Skeptic AND Integration MUST both be blind to each other on every plan.
   No rotation. No exceptions. Meta-learning may not change this.
6. Comparator CANNOT be skipped if visionary stream produced output.
7. Claim type cannot be downgraded to escape requirements.
   fact: → strategic: to dodge citation = mirage. Skeptic catches by checking claim shape.
8. Opus review pass on gemini-executed steps is MANDATORY.
   Gemini NEVER self-approves. Token savings do not override safety.
```

### 5j. Forge Commands update

Add: `/forge --no-visionary "task"` — skip visionary (equivalent to 'skip' in CLARIFY)

### 5k. Phase map update (replace `SKILL.md:89-98`)

13 phases, 3 optional (VISIONARY, COMPARATOR, USER-DECIDE shown when visionary active).

**Claims:**
- `fact:` Current REVIEW at `SKILL.md:214-260` already runs Skeptic+Integration parallel. v2.2 adds sealed bundle protocol on top.
- `fact:` Iron Rules at `SKILL.md:376-385`, 4 existing rules. Adding #5-#8 = 8 total.
- `fact:` `which gemini` confirmed available at `/opt/homebrew/bin/gemini` v0.34.0.
- `design_bet:` Sealed bundle prevents side-channel reads between blind gates.
  - `assumption:` Agent() subagents cannot see each other's outputs when spawned in same message.
  - `validation_plan:` Step 6 traces forge run — check that gate_runs for Skeptic and Integration have blind=1 and neither contains findings from the other.
  - `blast_radius:` If sealing fails, anchored review collapse (P1) returns. Caught by Step 6 trace.
- `strategic:` Gemini cascade is optional — falls back to opus-only when gemini unavailable.
  - `rationale:` Not all users have gemini CLI. Must work without.
  - `alternatives_considered:` Mandatory gemini — rejected (breaks on machines without it). Aider — rejected (not installed).

**Acceptance:**
- grep SKILL.md for each new section header: `VISIONARY`, `COMPARATOR`, `TYPED CLAIM`, `CASCADE EXECUTE`, `KNOWLEDGE SWEEP` — each appears once
- grep for `sealed input bundle` — appears in REVIEW section
- grep for `blind=1` — appears ≥3 times
- grep for `gemini` — appears in CASCADE EXECUTE section
- grep for `needs-external-check` — appears in COMPARATOR section
- grep for `--no-visionary` — appears in Forge Commands
- grep for Iron Rules #5, #6, #7, #8 — all present
- Agent file paths (`agents/visionary-simpler.md` etc.) explicitly referenced in VISIONARY section
- grep for `mempalace_search` — appears in PRECEDENT section
- grep for `mempalace_kg_add` — appears in completion write-path
- grep for `mempal_save_hook` — appears in hook chaining section
- grep for `Knowledge Sweep` — appears in Docs Refresh, covers 3 backends

**Checkpoint:** true
**Depends on:** Steps 1-4 (canary must PASS first)

---

## Step 6: Verification suite

**Do:** End-to-end validation of the complete v2.2 system.

**Files:** none (read-only)

**Sub-checks:**

1. **Schema:** open `~/code/thewhychain/.omc/forge.db`, verify version=2, all tables present, indexes present, existing data intact.

2. **CRUD round-trip:** run Step 2 acceptance script.

3. **Iron rules:** grep SKILL.md for all 8 numbered rules.

4. **Agent files:** ls `~/.claude/plugins/forge/agents/` — 16 files (12 existing + 4 new). Behavioral greps on new files pass.

5. **Pipeline coherence:** read SKILL.md, verify diagram references match section names.

6. **E2E scenario (exercises visionary + MemPalace):**
   - Invoke a tiny forge task choosing `b) 1 pass`
   - Verify CLARIFY asks visionary question
   - Verify visionary pass writes to `visionary_passes` table
   - Verify comparator writes to `comparator_reports` table
   - Verify Skeptic and Integration gates have `blind=1` in `gates` table
   - Verify 2nd Opinion gate has `blind=0` and `meta_findings` populated
   - Verify `claim_validations` populated for at least one `fact:` claim
   - Verify PRECEDENT phase called `mempalace_search` (check MCP tool usage)
   - On forge completion: verify MemPalace drawer created + KG triple added

7. **handlePreCompact compatibility:** manually trigger precompact hook, verify recovery prompt includes new column data.

**PASS = all 9 sub-checks green.**

**Checkpoint:** true (final)
**Depends on:** Step 5

---

## Execution Order

```
Step 0 (MemPalace setup) ─────────────────────────────────── parallel with everything
                                                              │
Step 1 (schema) ──→ Step 2 (CRUD) ──→ Step 4 (canary) ──→ Step 5 (SKILL.md + MemPalace L2) ──→ Step 6 (verify)
                                    ↗                        │
Step 3 (agents) ────────────────────               requires Step 0 done
```

Step 0 parallel with everything (pip install + mine). Steps 1→2 serial (CRUD needs tables). Step 3 parallel with 1-2. Step 4 serial after 1-3. Step 5 after canary PASS + Step 0 done (MemPalace available for PRECEDENT queries). Step 6 last.

---

## Summary

| Step | What | Files | CP |
|---|---|---|---|
| 0 | MemPalace: pip install + init + mcp add + mine docs/plans | (external) | — |
| 1 | Schema v2: ALTER gates + 3 tables + UNIQUE + indexes | forge-schema.mjs | ✓ |
| 2 | CRUD: visionary, comparator, claims, extended recordGate | forge-crud.mjs | ✓ |
| 3 | 4 agent prompt files | agents/*.md (new) | — |
| 4 | Canary: validate on thewhychain before cutover | (read-only) | ✓ |
| 5 | SKILL.md: pipeline + MemPalace L2 + cascade execute + DB sweep + iron rules | SKILL.md | ✓ |
| 6 | Verification: 9 sub-checks including visionary + MemPalace E2E | (read-only) | ✓ |

**7 steps (0-6), 4 checkpoints, 2 files modified, 4 new files, 0 deleted. MemPalace as external dependency.**

All 5 P1 from Second Opinion resolved. All actionable P2 resolved. Citation churn deferred to v2.3.

### Data topology (forge.db + MemPalace)

```
forge.db = CONTROL PLANE                MemPalace = KNOWLEDGE PLANE
├── forges (state machine)              ├── verbatim reasoning (drawers)
├── gates (PASS/FAIL + blind metadata)  ├── semantic search across sessions
├── spikes (confirmed/refuted)          ├── temporal KG (facts + validity)
├── claims (structured validation)      ├── agent diaries
├── visionary/comparator (metadata)     ├── cross-project tunnels
├── co_failures (analytics)             └── palace navigation
└── current_state (recovery)

forge.db: WHAT happened (structured)
MemPalace: WHY it happened (searchable)
```
