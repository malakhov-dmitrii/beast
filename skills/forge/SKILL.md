---
name: forge
description: "Ore in, steel out. Planning pipeline with independent verification, persistent memory, and compounding knowledge. Use for 3+ files or unclear scope."
---

# Forge — Ore In, Steel Out

Two machines: **Plan Forge** (refine until bulletproof) + **Verification Chain** (prove it's actually done). Ralph provides persistence.

## When to Use
- Task touches 3+ files or has unclear scope
- Architecture decisions needed
- User says "forge", "forge plan", or task needs verified planning
- Previous attempt failed — need to reassess

## Scaling
```
Quick fix (<3 files, clear)    → skip forge, direct executor + MICRO-VERIFY
Standard (3-10 files)          → PLAN FORGE → EXECUTE → VERIFICATION CHAIN
Complex (10+, architectural)   → PLAN FORGE --full → EXECUTE with checkpoints → CHAIN
Vague input                    → PLAN FORGE --discuss → rest as standard
```

## State
Use `mode: "ralph"` with session_id. Phase prefix `bf-` distinguishes from plain ralph.
```json
{"mode":"ralph","session_id":"<session>","current_phase":"bf-forge|bf-execute|bf-verify",
 "state":{"planning_mode":"forge","forge_iteration":1,
  "gates":{"skeptic":null,"integration":null,"second_opinion":null},
  "verify":{"evidence":null,"auditor":null},
  "completed_steps":[],"slug":"task-name"}}
```

## HUD Integration

Forge writes status to **two channels** on every phase transition:

### 1. Statusline (via `state_write`)

Shows `ralph:N/M` in the terminal statusbar. N = current forge iteration, M = max (default 5).

Call `state_write` at each phase transition:
```
state_write(
  mode: "ralph",
  active: true,
  iteration: <forge_iteration>,
  max_iterations: <total_phases>,
  current_phase: "bf-<phase>",
  task_description: "<slug>",
  session_id: <session_id>,
  state: {
    planning_mode: "forge",
    gates: { skeptic: "PASS"|"FAIL"|null, integration: ..., second_opinion: ... },
    steps_done: N,
    steps_total: M
  }
)
```

### 2. Rich status (via `notepad_write_priority`)

Shows detailed progress in notepad (visible via `notepad_read`). Update at each transition:

```
notepad_write_priority(
  content: "[FORGE] <PHASE> v<iter> | <gate_summary> | <steps_done>/<steps_total> steps"
)
```

**Examples at each stage:**
```
[FORGE] PRECEDENT          | — | 0/8 stages
[FORGE] RESEARCH           | — | 1/8 stages
[FORGE] CHALLENGE          | — | 2/8 stages
[FORGE] PLAN v1            | — | 3/8 stages
[FORGE] REVIEW v1          | Skeptic:PASS Integration:— 2nd:— | 3/8 stages
[FORGE] REVIEW v1          | Skeptic:PASS Integration:PASS 2nd:FAIL | 3/8 stages
[FORGE] PLAN v2            | ↑ revising: 2nd opinion found P1 issue | 3/8 stages
[FORGE] REVIEW v2          | Skeptic:PASS Integration:PASS 2nd:PASS | 3/8 stages
[FORGE] EXECUTE            | ALL GATES PASSED | 5/7 steps done | 5/8 stages
[FORGE] VERIFY             | Evidence:— Auditor:— | 6/8 stages
[FORGE] VERIFY             | Evidence:PASS Auditor:PASS | 7/8 stages
[FORGE] DOCS-REFRESH       | VERIFIED | 8/8 stages
```

### Phase map (for progress tracking)

| # | Phase | Description |
|---|-------|-------------|
| 1 | PRECEDENT | Search institutional knowledge |
| 2 | RESEARCH | Read files, spike assumptions (top-3 mandatory) |
| 3 | CHALLENGE | Independent review of approach |
| 4 | CLARIFY | User questions + visionary mode selection |
| 5 | PLAN-DRAFT | Write plan with typed claims |
| 6 | VISIONARY | N parallel passes (optional) |
| 7 | COMPARATOR | 3-tier classify + reality-check (if visionary ran) |
| 8 | USER-DECIDE | Pick standard / visionary / merge |
| 9 | PLAN-FINAL | Rewrite plan per decision |
| 10 | REVIEW | Sealed blind parallel + stacked meta |
| 11 | EXECUTE | Cascade gemini->opus, TDD |
| 12 | VERIFY | Evidence + Auditor |
| 13 | DOCS-REFRESH | Docs + DB sweep |

For the statusline `max_iterations`: use forge iteration cap (default 5) during PLAN/REVIEW loop. Switch to `13` (total stages) during EXECUTE onward.

### On completion/failure

```
state_write(mode: "ralph", active: false, completed_at: <ISO>)
notepad_write_priority(content: "[FORGE] DONE ✓ | <slug> | <total_time>")
mempalace_diary_write(
  agent_name: "claude-code",
  topic: "forge-<slug>",
  entry: "FORGE:<slug>|iters:N|gates:PASS|spikes:M|drawers:K|lesson:<AAAK summary>"
)
```

On failure:
```
notepad_write_priority(content: "[FORGE] BLOCKED | <slug> | <reason>")
```

**Non-blocking diary guarantee (D):** `mempalace_diary_write` failure (timeout, MCP error, palace unavailable) MUST NOT block forge completion. Per the A runtime degradation contract: catch the failure, log `[palace-degraded] diary_write failed: <reason>` to notepad, mark forge completed in `forge.db` regardless. Forge completion is the source of truth; the diary entry is a secondary write.

---

## Machine 1: Plan Forge

Refinement loop. Two phases: draft the plan, then gate it. Cycles until all 3 gates pass.

```
PRECEDENT → RESEARCH (+top-3 mandatory spikes) → CHALLENGE → CLARIFY (+visionary?) →
  PLAN-DRAFT (typed claims) → [VISIONARY STREAM] → [COMPARATOR] → USER DECISION →
  PLAN-FINAL → REVIEW (blind parallel + stacked meta) →
  EXECUTE (cascade: gemini→opus) → VERIFY → DOCS-REFRESH (+DB sweep)
```

### PRECEDENT — search institutional knowledge first

Before touching code, search what the project already knows:
1. **Grep CLAUDE.md** for gotchas mentioning touched files/systems. Surface them explicitly.
2. **Grep `.omc/plans/`** (if exists) for past plans touching same systems. Note approach + outcome.
3. **Read `docs/architecture/{system}.md`** (if exists) to understand current design.
4. **Read CLAUDE.md `## Common Failures`** section (if exists) for known failure patterns.
5. **Query `.omc/forge.db`** (if exists) — past forge runs, risk scores, cached spikes:
   ```sql
   -- Past runs on these systems
   SELECT slug, status, iteration, json_extract(context, '$.lesson') as lesson
   FROM forges WHERE systems LIKE '%<system>%' AND status IN ('completed','abandoned')
   ORDER BY completed_at DESC LIMIT 5;

   -- Risk scores
   SELECT system, fail_rate, avg_iterations FROM system_risk
   WHERE system IN ('<system1>', '<system2>');

   -- Cached spikes (don't re-test confirmed assumptions)
   SELECT assumption, result, actual FROM spikes
   WHERE permanent = 1 OR tested_at > datetime('now', '-30 days');

   -- Co-failure warnings
   SELECT system_a, system_b, gate,
     ROUND(1.0 * fail_count / total_count, 2) as fail_rate
   FROM co_failures
   WHERE (system_a IN ('<systems>') OR system_b IN ('<systems>'))
     AND CAST(fail_count AS REAL) / total_count > 0.3;
   ```
   Surface: "reply-worker + engage-scheduler fail Integration 60% — include both in scope?"
6. For large codebase scans, prefer `ctx_batch_execute` to keep research results in sandbox.
7. **MemPalace palace + KG recall** (A). In the same message, spawn a parallel fan-out:
   - `mempalace_search(query="<touched-systems keywords>", wing="<project slug>", limit=5)` — semantic recall across code + docs + convos
   - `mempalace_kg_query(entity="<system>")` — one call per touched system for typed facts (deps, status, models, incidents)
   - `mempalace_diary_read(agent_name="claude-code", last_n=3)` — recent agent diary entries for cross-session context
   Summarize results into a `## Prior institutional context` section that is prepended to PLAN-DRAFT. **Runtime degradation contract:** each palace call has a 10s soft timeout. On timeout, error, or MCP-unavailable, log one line via `notepad_write_priority` prefixed `[palace-degraded] <call> failed: <reason>`, skip the failing call, and continue PRECEDENT with file-based sources only. NEVER block or retry-loop on a palace call — forge must remain forward-progressable when MCP is flaky. The same contract applies to every palace call mentioned elsewhere in this skill (Skeptic kg_query, draft commits, completion diary_write, spike mirror). If the `--no-mempalace` flag is set, skip steps 7 entirely.

### RESEARCH — verify everything, assume nothing

- Read EVERY file being touched. Grep ALL usages: calls, type refs, imports, re-exports, barrel files, mocks, string references.
- `scc --by-file <dirs>` (if installed) — flag high-complexity files for careful reading.
- External API/lib → fetch docs via context7 or WebSearch. Don't assume — verify.
- **Spike anything testable in <5 minutes.** One assumption per spike. Disposable.
  - Record: `✅ confirmed: [assumption]` or `❌ refuted — actual: [reality]`
  - Refuted spike = immediate adjustment. Never carry known-false assumptions.
- Spikes happen in ANY phase. If testable in <5 min → test it NOW.

### CHALLENGE — challenge the approach BEFORE writing the plan

Self-challenge first: What am I assuming? What's the simplest approach? What breaks?

Then get an independent challenge on the APPROACH (not the plan yet — that comes at REVIEW):
- Check if codex is available: `which codex`
- If available: write approach summary to /tmp, run `codex exec "Review this approach. What are the 3 most likely failure modes?" -C <repo> -s read-only -c 'model_reasoning_effort="high"'`
- If unavailable: `Agent(model="opus", prompt="You are a senior engineer who has NEVER seen this codebase. Here is the proposed approach: [approach]. Find the 3 most likely failure modes.")`

If challenge reveals a fundamental flaw → revise approach before writing the plan.

### CLARIFY — ask user only for genuine design decisions

- Classify unknowns: **self-decidable** vs **needs user input**.
- Self-decide where possible. Document decision + rationale in plan.
- Ask user ONLY for genuine design choices.
- Format: structured questions with 2-3 options + recommendation + reasoning.

#### Visionary stream question (ask at end of CLARIFY)

Adaptive default based on scope:
```
Visionary stream — search for a "significantly better" approach?
  a) skip        ← default if <3 files
  b) 1 pass      ← default if 3-10 files
  c) 3 passes    ← default if 10+ files
  d) N passes    (any number, no token limit)
```

Save choice to `forges.context` as `visionary_mode`. If `--no-visionary` flag, auto-select `a`.

### Planner agent selection (v3 is default)
Before invoking the planner agent, select it inline from the forge's flag.
v3 is now the default — only explicit `pipelineV3 === false` opts back to v2:
```js
  const ctx = getForgeContext(cwd, forgeId);
  Agent(subagent_type=(ctx?.pipelineV3 === false ? 'planner' : 'planner-v3'), ...)
```

planner-v3 emits DAG JSON + parallel claim fan-out per ADR §3.
planner is the explicit opt-out path (`setForgeContext(forgeId, 'pipelineV3', false)`).

### PLAN — write the plan draft with typed claims

Each step MUST contain a `Claims:` block classifying every assertion:

**fact:** — verifiable codebase statement
  Required: `file:line` OR `doc#section` OR `spike:id` citation.
  Skeptic verifies citation exists AND contains the claimed thing.

**design_bet:** — reasoned guess about behavior
  Required: `assumption:` + `validation_plan:` + `blast_radius:`

**strategic:** — direction-level choice
  Required: `rationale:` + `alternatives_considered:`

**kg_fact:** — assertion about project-level truth stored in the MemPalace knowledge graph
  Required: `kg_citation: <triple_id>` discovered via `mempalace_kg_query`.
  Use `kg_fact:` (not `fact:`) when the assertion is about project-level infrastructure/config/client status/architectural invariants that live outside the code — models a service uses, who owns a project, current tenant status, browser stack, patterns like "reply_queue uses SKIP_LOCKED". Use `fact:` for code-level claims with `file:line` citations. See `agents/planner-v3.md` "### kg_fact claims" for the full decision rule and examples.

NO global "% hard evidence" gate. Skeptic checks PER CLAIM:
- fact: missing citation → mirage
- fact: citation broken (file/line absent) → mirage
- design_bet: missing validation_plan → mirage
- strategic: missing alternatives_considered → mirage
- kg_fact: triple_id not in KG, or triple `current=false` → mirage (see skeptic.md pattern 11)
Plan with ANY mirage → FAIL Skeptic gate.

**Refuted kg_fact feedback loop:** when Skeptic verdicts a `kg_fact:` claim as MIRAGE, the orchestrator enqueues a `palace_drafts` row with `draft_type='kg_invalidate', payload:{triple_id}` so the stale KG fact can be cleaned up in Machine 3. Subject to the A runtime degradation contract (skip enqueue if MCP flaky).

Each step also gets `complexity: simple|complex`:
- Author sets initial value
- Auto-override to `complex` if step has `strategic:` claims OR touches 3+ files

Step format:
```
### Step N: [Title]
Do: [specific action]
Files: [exact paths]
Complexity: simple|complex
Claims:
  - fact: [claim] — file:line
  - design_bet: [claim]
    assumption: ...
    validation_plan: ...
    blast_radius: ...
Acceptance criteria:
  - static: [type check, lsp, semgrep]
  - unit: [test command + expected]
  - e2e: [command proving feature works] (where applicable)
Failure mode: [what goes wrong]
Fallback: [what to do]
Checkpoint: true/false
Depends on: [step numbers]
```

Plan MUST include:
- Execution order (parallel-safe vs serial steps)
- Rollback strategy
- E2E verification scenario: the ONE flow proving everything works together
- Blast radius estimate

Read the project's CLAUDE.md for test/build/deploy commands. Don't invent — use what the project already has.
E2E criteria use REAL commands the project actually uses (curl APIs, DB queries, CLI tools). NEVER wait for cron.

### VISIONARY STREAM (optional, after PLAN-DRAFT, before REVIEW)

If user chose visionary mode in CLARIFY (b, c, or d), run N parallel passes:

| Pass | Angle | Agent | Reads | Question |
|------|-------|-------|-------|----------|
| 1 | simpler | opus or codex | PLAN-DRAFT only | "Is there a simpler approach?" |
| 2 | better | codex preferred, opus fallback | PLAN-DRAFT only | "Could this be 10x better?" |
| 3 | blind_spots | opus | **ORIGINAL USER REQUEST only** | "What is the user really trying to achieve?" |

Agent prompt files at `~/.claude/plugins/forge/agents/visionary-simpler.md`, `visionary-better.md`, `visionary-blind-spots.md`.

Each pass:
1. Spawn fresh Agent() with prompt from agent file
2. Pass only the specified input (plan OR original request — NEVER both for blind_spots)
3. Record result: `recordVisionaryPass(cwd, forgeId, iteration, { passNumber, angle, agent, content })`

Passes run in parallel when possible (spawn multiple Agent() calls in one message).

### COMPARATOR (mandatory if visionary ran — Iron Rule #6)

Fresh opus agent reads: PLAN-DRAFT + all visionary passes + original user request.
Agent prompt at `~/.claude/plugins/forge/agents/comparator.md`.

**3-tier claim classification:**
- `codebase-verifiable` → grep/read codebase → `verified` | `rejected`
- `externally-verifiable` → WebSearch/context7 if available, else `needs-external-check`
- `strategic` → present to user with tradeoffs, no verdict

**Output to user (before REVIEW):**
```
TL;DR:
  Standard:  [1-line]
  Visionary: [1-line]
  Main diff: [1-line]

DIFF ITEMS:
  - [item]: gain=[...], cost=[...], tier=[...], check=[✓/✗/unknown]

REALITY CHECK:
  Confirmed: [...]  Rejected: [...]  Unknown: [...]

RECOMMENDATION: standard | visionary | merge
```

User picks: standard | visionary | merge | edit manually.
Record: `recordComparatorReport(cwd, forgeId, iteration, { tldr, diffItems, realityCheck, recommendation })`
After user decides: `updateComparatorDecision(cwd, forgeId, iteration, decision)`

PLAN-FINAL is written (or rewritten) based on user's choice, then proceeds to REVIEW.

### REVIEW — sealed parallel-blind gates with stacked synthesis

#### Sealed Input Bundle Protocol

Gates do NOT read `.omc/forge.db`. They do NOT look for other gate findings. Isolation is enforced by:
1. Orchestrator prepares: plan path + original user request as text
2. Skeptic Agent(model=opus) + Integration Agent(model=sonnet) spawned **in parallel, same message**
3. Prompt explicitly states: "DO NOT read .omc/forge.db. You see ONLY the plan and the codebase."
4. Both return findings as text in their Agent response
5. Orchestrator writes BOTH to `gates` table (with `blind=1`) via `INSERT OR REPLACE` **after both return**
6. Only THEN: spawn 2nd Opinion with [plan + skeptic findings + integration findings]
7. 2nd Opinion writes to `gates` with `blind=0`, `meta_findings` populated

#### Gate definitions

**Skeptic** (blind, opus, fresh):
- Verify every `fact:` claim citation (file exists, line contains claimed thing)
- Verify every `design_bet:` has assumption + validation_plan + blast_radius
- Verify every `strategic:` has rationale + alternatives_considered
- Verify every `kg_fact:` against the `### KG Snapshot` section included in the sealed input bundle (orchestrator pre-fetches `mempalace_kg_query(entity=<subject>)` for each plan subject BEFORE spawning Skeptic, then includes the JSON snapshot in Skeptic's prompt). Skeptic matches `kg_citation` by `(predicate, object, current=true)` against the snapshot. MCP tools are NOT reachable from subagent frontmatter — inline-snapshot is the only reliable path. (Pattern 11 in agents/skeptic.md)
- Hunt for mirages (phantom files, APIs, functions, stale triples)
- PASS = zero mirages, all claims structurally valid

**Integration** (blind, sonnet, fresh):
- Cross-system contracts: types, imports, schemas align
- Sequencing: step dependencies make sense
- Scope: steps cover what plan promises
- PASS = all contracts verified, no missing coverage

**Second Opinion** (stacked, codex preferred / opus fallback):
- Reads [plan + original request + skeptic findings + integration findings]
- META-question: "What did these two miss?"
- Focus: wrong frame, production scenarios, missing rollback, concurrency
- Forbidden: re-checking what Skeptic or Integration already covered
- PASS = no P1 meta-findings

Record each gate: `recordGate(cwd, forgeId, iteration, gate, result, findings, { blind, inputsSeen, metaFindings })`

ANY gate FAIL → revise plan, re-run failed gate(s) only, bump iteration.

For typed claims, also record: `recordClaim(cwd, forgeId, iteration, stepNumber, { claimType, claimText, citation })` for each claim in the plan, then `validateClaim(cwd, claimId, { result, notes })` as Skeptic validates them.

### Output

FINAL-PLAN saved to `.omc/plans/FINAL-PLAN-{slug}.md` (or project root if .omc doesn't exist). Present approval summary including all gate results. User reviews → "ok" or corrects → proceed to EXECUTE.

---

## Execute (cascade, ralph persistence, TDD)

### Stream Cascade (v3 is default)
v3 is the default execute path. Only explicit `pipelineV3 === false` opts back to the v2 linear cascade:
```js
  const ctx = getForgeContext(cwd, forgeId);
  if (ctx?.pipelineV3 === false) {
    // v2 linear cascade (legacy opt-out path)
  } else {
    await fanOutStreams(cwd, forgeId, /* task spawner */);
  }
```

### Cascade Execute (gemini → opus)

Per step in PLAN-FINAL:
```
IF step.complexity == 'simple' AND `which gemini` available:
  1. gemini exec (model: gemini-2.5-flash-preview, timeout: 90s)
  2. Static analysis (tsc/lsp/semgrep)
     FAIL → git checkout changed files, opus rewrites
  3. Step acceptance criteria (unit tests)
     FAIL → git checkout changed files, opus rewrites
  4. opus REVIEW pass (read git diff only):
     APPROVE → next step
     REJECT → git checkout changed files, opus rewrites
ELSE:
  opus executes directly (standard path)
```

Token savings: ~70% per simple step (gemini ~5k + opus review ~3k vs opus-only ~25k).

### TDD per step (unchanged)
Per step: **RED** (write failing test from acceptance criteria) → **GREEN** (minimal code to pass) → **REFACTOR**.
Parallel where steps are independent. Serial where dependent.
**Checkpoint steps** (`checkpoint: true`): run acceptance criteria before proceeding.
Static analysis on every change.
After all steps → VERIFICATION CHAIN.

---

## Machine 2: Verification Chain

### Layer 0: Static (instant, whatever project has)
Run the project's static analysis tools. Common:
```
tsc --noEmit                    # TypeScript
lsp_diagnostics <files>         # IDE diagnostics
semgrep scan --config=.semgrep/ # Custom gotcha rules (if .semgrep/ exists)
```

### Layer 1: Unit Tests
Run project's test command on changed modules. If no tests exist for changed code → flag as GAP.

### Layer 2: E2E System Checks
Where the plan has e2e acceptance criteria, run them. ACTIVELY trigger — never wait for cron or scheduled runs. Use whatever mechanism the project has.

### Layer 3: Independent Agents

**Evidence Collector** (fresh sonnet agent, `agents/evidence-collector.md`):
- Input: FINAL-PLAN.md ONLY. No executor output. No contamination.
- Runs every acceptance criterion independently.
- Records: {criterion, command, output, verdict: PASS|FAIL|NOT_FOUND}
- Checks criteria sufficiency: "proves feature WORKS, not just code WRITTEN?"

**Auditor** (fresh opus agent, `agents/auditor.md`):
- Input: Evidence Report + FINAL-PLAN.md. NOT executor output.
- Spot-checks 30-50% (weighted toward integration/runtime).
- Coverage check: every criterion → evidence entry.
- E2E: runs the plan's full E2E scenario.
- Clean state check: git status clean?
- Verdict: VERIFIED | GAPS [list]

### Gap Handling
```
GAPS FOUND →
  1. Check CLAUDE.md "Common Failures" — new pattern? Add it.
  2. Back to EXECUTE with specific gaps list.
  3. Ralph iteration++.

VERIFIED →
  E8: Docs Refresh (final stage — see below).
  Done.
```

---

## Machine 3: Docs Refresh (final stage)

After verification passes, run a scoped documentation hygiene pass. This is the `/docs-refresh` skill integrated as Forge's closing stage.

### What to check (scoped to touched systems)

1. **CLAUDE.md gotchas** — did this work fix a gotcha? Remove it. Did it introduce a new danger? Add it. Still under 40-line target?
2. **Memory files** — do any `arch-*` or `lesson-*` files reference systems that changed? Update or flag.
3. **MEMORY.md index** — still under 180 lines? Any new entries needed? Any entries now stale?
4. **docs/ vault** — do architecture docs, specs, or runbooks need updating for what changed?
5. **Common Failures** — new pattern discovered during execution? Add it.
6. **Knowledge Sweep (forge.db + global.db)**

   **Auto-action (safe):**
   - Orphaned `current_state` pointers (forge abandoned/completed) → DELETE
   - `forges.plan_path` where file doesn't exist → SET NULL + flag
   - Contradicting spikes (refuted then confirmed same assumption) → keep latest, mark old superseded

   **Warn-only (user decides):**
   - Parked forges >30 days → "consider /forge --abandon"
   - `~/.forge/global.db` spikes >90 days without verification → "re-verify?"
   - Stale global_patterns (>60 days unused) → "flag stale?"

### Scaling

```
Quick fix (<3 files)    → CLAUDE.md gotcha check only (30 seconds)
Standard (3-10 files)   → CLAUDE.md + touched memory files + docs/ for affected systems
Complex (10+)           → full /docs-refresh --scan-only, present triage to user
```

### Auto-create (forge-driven documentation)

Machine 3 doesn't just audit — it GENERATES docs from forge results:

1. **Permanent refuted spike → lesson file.** If a spike with `permanent=1` has no corresponding `lesson-*.md`, auto-create one in memory with the assumption, actual result, and "How to apply" section.
2. **Gate finding repeated 3+ times → CLAUDE.md gotcha.** Query forge.db: `SELECT findings FROM gates WHERE result='FAIL' GROUP BY findings HAVING COUNT(*) >= 3`. If a finding repeats across forges, add it to CLAUDE.md gotchas section.
3. **Architecture changed → update/create docs.** If the forge modified architecture files (new tables, new services, new data flow), update `docs/architecture/{system}.md` or create if missing.
4. **Forge lesson → memory file.** On `--complete`, if a lesson was recorded, check if it's already in memory. If not, auto-create `lesson-{slug}.md`.
5. **Palace drafts — MemPalace write-through (C).** All palace writes accumulated during the forge run (lessons as drawers, permanent spikes as `kg_add`, architecture changes as drawers, refuted kg_fact as `kg_invalidate`) live in the `palace_drafts` table via `addPalaceDraft`. At this stage, call `listPalaceDrafts(cwd, forgeId, 'pending')` and present a single **batch triage** to the user: group by `draft_type`, show count + preview of each payload, ask `approve all | reject all | edit`. On approve, iterate drafts: call the matching MCP tool (`mempalace_kg_add` / `mempalace_add_drawer` / `mempalace_kg_invalidate`) per payload; on success call `markPalaceDraftCommitted(cwd, draftId)`. On reject, call `discardPalaceDraft(cwd, draftId)` for each. Partial MCP failure leaves remaining rows `pending` — user can re-run Machine 3 to retry. All MCP calls subject to the A runtime degradation contract.

**Resume-surface contract:** `/forge --resume <slug>` MUST run `listPalaceDrafts(cwd, forgeId, 'pending')` and surface the count to the user BEFORE continuing work on the resumed forge. If count > 0, prompt: "N pending palace drafts from last run — triage now? (y/N)". On `y` → run the batch-triage flow above; on `N` → note `[palace-drafts-deferred] N rows` to notepad and continue resume. Without this, drafts accumulate silently across park/resume cycles.

### Rules

- NEVER skip this stage. Even a 30-second gotcha check catches stale docs early.
- For complex work, run `/docs-refresh --scan-only` and include the triage in the completion report.
- New gotcha? Add to CLAUDE.md. Fixed gotcha? Remove from CLAUDE.md.
- Memory approaching 180 lines? Flag to user, suggest `/docs-refresh` standalone run.
- Auto-created docs are DRAFTS — present to user before committing. Exception: CLAUDE.md gotchas from 3+ repeated findings can be auto-added.

---

## Micro-Verify (for quick fixes)

After ANY direct executor completes (non-forge work):
```
- Static analysis on changed files (whatever project has)
- Reference check on changed exports (callers updated?)
- Run tests on changed modules (if fast, <30s)
Verdict: CLEAN | SUSPECT [list]
```

---

## Iron Rules (IMMUTABLE — meta-learning CANNOT override)

These rules prevent the self-optimizing system from removing its own safety checks.

1. **2+ independent review gates on every plan.** No exceptions.
   Meta-learning may reorder, add, specialize — NEVER reduce below 2.
2. **Gates = separate agents.** Planner ≠ reviewer. No shared context between planner and gate agent.
3. **Pipeline adaptation is project-scoped.** Gate ordering, risk thresholds — NEVER auto-propagate between projects.
4. **Additive = auto. Subtractive = human.** Adding a checkpoint: auto. Removing a gate: requires explicit human approval.
5. **Skeptic AND Integration MUST both be blind to each other on every plan.**
   No rotation. No exceptions. Meta-learning may not change this.
6. **Comparator CANNOT be skipped if visionary stream produced output.**
   No visionary output may bypass classification.
7. **Claim type cannot be downgraded to escape requirements.**
   `fact:` → `strategic:` to dodge citation = mirage. Skeptic catches by checking claim shape.
8. **Opus review pass on gemini-executed steps is MANDATORY.**
   Gemini NEVER self-approves. Token savings do not override safety.

**Note on MemPalace integration (2026-04-14):** All palace recall, `kg_fact:` validation, `palace_drafts` write-through, completion diary, and spike mirror are fully additive. Rule #7 is preserved because `kg_fact:` has structural parity with `fact:` — `kg_citation: <triple_id>` is a required citation just like `file:line`, and Skeptic validates triple existence + `current=true` via `mempalace_kg_query`. Rule #5 is preserved because Skeptic reads KG as an additional data source, not as another gate's findings. All palace interactions honor the runtime degradation contract (A) and are disabled wholesale by `--no-mempalace`.

---

## Forge Commands

Forge manages persistent work units ("forges") that survive across sessions.

```
/forge "task"              — create new forge, start pipeline
/forge --park [reason]     — park current forge, save context to forge.db
/forge --resume [slug]     — resume parked forge, restore context
/forge --spawn "sub-task"  — create child forge (optionally --blocks-parent)
/forge --switch [slug]     — park current + resume another (atomic)
/forge --list              — show all forges with status
/forge --status            — deep status of current forge + dependency tree
/forge --complete          — mark done, record lesson, unblock dependents
/forge --abandon [reason]  — mark abandoned, preserve context
/forge --full "task"       — extended RESEARCH + mandatory spike
/forge --discuss "task"    — extended CLARIFY for vague input
/forge --plan-only         — stop after FINAL-PLAN
/forge --execute           — load existing FINAL-PLAN, skip forge
/forge --no-docs           — skip docs-refresh final stage
/forge --no-visionary "task"  — skip visionary stream (equivalent to 'skip' in CLARIFY)
/forge --no-mempalace      — skip all MemPalace integration (palace recall in PRECEDENT, kg_fact validation, palace_drafts write-through, completion diary, spike mirror). Use when palace MCP is unavailable or for hermetic runs.
```

### Forge persistence

All forge state lives in `.omc/forge.db` (SQLite). This is the sole source of truth.
`ralph-state.json` is a HUD display cache only — OMC may delete it on SessionEnd.

On every phase transition:
1. Update forge.db (via SQL or forge-crud.mjs functions)
2. Update ralph-state.json (via state_write MCP tool) for HUD display
3. forge.db `current_state` table tracks the active forge for compaction recovery

### Compaction recovery

If `/compact` happens mid-forge, the PreCompact hook saves state to forge.db and injects a recovery prompt. After compaction, read forge.db `current_state` and resume:
```sql
SELECT value FROM current_state WHERE key = 'active_forge';
```

### Recording gate results and spikes

After each gate completes, record to forge.db:
```sql
INSERT INTO gates (forge_id, iteration, gate, result, findings)
VALUES (<id>, <iter>, 'skeptic', 'PASS', '["no mirages found"]');
```

After each spike:
```sql
INSERT INTO spikes (forge_id, assumption, result, actual, permanent)
VALUES (<id>, 'Dolphin supports concurrent tabs', 'refuted', '1 tab per profile', 1);
```

**Spike mirror to palace (E).** After recording a spike with `permanent=1`, mirror it into `palace_drafts` so Machine 3 can surface it for approval alongside other palace writes:
- `result='confirmed'` → `addPalaceDraft(cwd, forgeId, { draftType: 'kg_add', payload: { subject, predicate, object: actual }, sourceSpikeId: <spike.id> })`
- `result='refuted'` → `addPalaceDraft(cwd, forgeId, { draftType: 'add_drawer', payload: { wing: '<project>', room: 'documentation', content: 'Refuted: <assumption>. Actual: <actual>.' }, sourceSpikeId: <spike.id> })`
Drafts are reviewed and committed in Machine 3 (item 5 in Auto-create). Subject to the A runtime degradation contract (skip enqueue if palace_drafts write fails — spike still recorded in forge.db).

### Spawn workflow

During RESEARCH or EXECUTE, if a sub-task is discovered:
```
/forge --spawn "fix batch recovery" --blocks-parent
```
- Creates child forge with parent_id = current forge
- If `--blocks-parent`: current forge → status 'blocked', blocked_by = child
- When child completes → SQL trigger auto-unblocks parent
- Child's findings available to parent's PRECEDENT via forge.db queries

---

## Project Setup

Run `/forge-setup` once per project to get the most from Forge:
- Creates docs/ vault structure with INDEX.md navigation
- Creates .semgrep/ with starter rules (if semgrep installed)
- Adds Common Failures + Project Docs sections to CLAUDE.md
- Checks for optional tools (semgrep, scc, codex)

Forge works WITHOUT setup — it just greps whatever exists. Setup makes it better.

---

## Integration Re-plan Hook (pipeline-v3)

After all streams complete, the orchestrator evaluates integration contracts. Two outcomes:

### Pass path — `dispatchIntegrationResult(cwd, forgeId, { allPass: true, lesson })`
All contracts have status='pass'. Calls `completeForge(cwd, forgeId, lesson)`. Re-plan is NOT triggered.

### Fail path — `dispatchIntegrationResult(cwd, forgeId, { allPass: false })`
One or more contracts have status='fail'. Calls `reEnterPlanning(cwd, forgeId)`.

`reEnterPlanning` does the following:
1. Reads `integration_contracts WHERE status='fail' AND forge_id=?`
2. Appends `{ iteration, contracts: [...], timestamp }` to `forges.context.integration_failure_history`
3. Increments `forges.iteration` and sets `phase='bf-plan-draft'`
4. Streams rows are **preserved** (not deleted) — they remain for reference during re-planning
5. **Cap**: at `iteration >= 5`, calls `blockForge(cwd, forgeId, 'integration-replan cap (5) exceeded')` instead of incrementing

### integration_disabled short-circuit
If `configJson.integration_disabled` is set (or the forge context has `integrationDisabled: true`), skip the integration gate entirely — neither `completeForge` nor `reEnterPlanning` is invoked via this path. The forge proceeds directly to VERIFY.

### API surface (hooks/forge-crud.mjs)
```js
reEnterPlanning(cwd, forgeId)
dispatchIntegrationResult(cwd, forgeId, { allPass: boolean, lesson?: string })
```
