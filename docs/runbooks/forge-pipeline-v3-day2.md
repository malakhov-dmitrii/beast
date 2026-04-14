# Forge pipeline-v3 — Day-2 Operator Runbook

This is the operational contract for day-2 of forge pipeline-v3 (parallel streams + TDD + integration gate).
Once a forge has `pipelineV3=true` and has begun creating `streams` / `integration_contracts` / `integration_failure_history`, partial v3 state can persist across crashes, parks, throttle events, and deployment aborts. Use the procedures below; do not improvise schema changes.

See also: `.omc/plans/FINAL-PLAN-pipeline-v3.md` (authoritative source; this file is a copy for the Phase 3 exit gate's file-existence check).

## Invariant

Every v3 stream row is in one of five states: `pending | running | green | failed | blocked`.
The forge as a whole is `active | parked | blocked | completed | abandoned`.
The pair `(forge_status, set-of-stream-statuses)` determines the recovery action. No other state exists.

## R1 — Resume after park with half-green streams

Trigger: forge was parked mid-execute; some streams `green`, some `pending`, possibly one `running` (the park was mid-execute).

1. On `/forge --resume <slug>`, before spawning any fan-out:
   `UPDATE streams SET status='pending' WHERE forge_id=? AND status='running'`
   (the `running` row's subagent no longer exists; reset and let fan-out re-pick it up).
2. For every `green` stream whose `touches_files` list contains any file modified on disk since `completed_at`:
   `UPDATE streams SET status='pending', tdd_evidence='{}', retries=0`.
   Staleness check: `stat -f %m <file>` (macOS) / `stat -c %Y <file>` (Linux) vs. stream's `completed_at`, OR `git log --since='<completed_at>' --name-only -- <touches_files>`.
3. `green` streams whose files are unchanged: trusted, not re-run. `tdd_evidence` is the receipt.
4. Fan-out resumes from the remaining `pending` set.

## R2 — Discard and restart a forge cleanly

Trigger: operator wants to wipe v3 state and start over for this forge (e.g., after chasing an integration failure deep into re-plan cycles that produced nonsense).

Helper: `discardStreamState(cwd, forgeId)` in `hooks/forge-crud.mjs`.
Preserves: `forges` row, `gates`, `claim_validations` (full postmortem audit).
Wipes: `streams`, `integration_contracts`, `forges.context.integration_failure_history`. Resets iteration=1, phase='bf-plan-draft', status='active', clears blocking_reason.

## R3 — SQLITE_BUSY / Task() throttle recovery during fan-out

- `openForgeDb` sets `journal_mode=WAL` and `busy_timeout=5000` at every open (enforced by Task 1.1 test). Writer contention is retried transparently.
- Task() throttle: `fanOutStreams` catches throttle errors per-stream, marks stream `status='pending'` (NOT `failed`), waits 30s, resumes. `retries` counter is NOT incremented for throttle — only for `verifier_cmd` non-zero exit counts toward the retry cap (ADR §4).
- If throttle persists >5 min across 3 retry windows: forge → `blocked` with reason "infrastructure throttle — operator intervention"; Day-2 action = wait + `/forge --resume <slug>` (R1).

## R4 — Roll back from "Phase 3 live" to "Phase 2 only" without cleaning v3 tables

Trigger: Phase 3's TDD enforcement, integration runner, or re-plan logic is producing incident-worthy behavior; operator wants Phase-2 parallel-executor semantics (per ADR §8 Phase-2: header "parallel executor" + body "prove concurrent execution without TDD enforcement noise") without discarding streams/contracts rows.

Phase-2 semantics require BOTH kill-switches set, because Phase 3 adds two enforcement layers:
- TDD enforcement (Task 3.1 verifier_cmd gate)
- Integration + re-plan (Task 3.2 + Task 3.3)

Procedure:

1. For every active forge with `pipelineV3=true`, flip both flags in a single transaction:
   ```sql
   BEGIN IMMEDIATE;
   UPDATE forges
     SET context = json_set(
       json_set(COALESCE(context,'{}'), '$.integration_disabled', json('true')),
       '$.tdd_required_disabled', json('true')
     ),
     updated_at = datetime('now')
     WHERE id = ?;
   COMMIT;
   ```
2. `UPDATE streams SET status='pending', tdd_evidence='{}', retries=0 WHERE forge_id=? AND status IN ('failed','blocked')` — reset Phase-3-caused failures/blocks so fan-out re-picks them up.
3. Forges continue under Phase-2 semantics: parallel fan-out only; Task 3.1 skips verifier_cmd and marks streams `green` on Task() completion with `tdd_evidence={skipped:true, reason:'tdd_required_disabled'}`; Task 3.2 short-circuits `{allPass:true, shortCircuited:true}`; Task 3.3 re-plan never fires. Schema v3+ rows remain.
4. Forward path back to Phase 3 = `json_remove` both keys (or set both to false) after the incident root-cause is closed.

## R5 — Roll back from any v3 state to "pure v2"

Trigger: operator wants v3 off entirely for a specific forge.

```js
setForgeContext(cwd, forgeId, 'pipelineV3', false);
// Optional: preserve audit. If cleanup desired: discardStreamState(cwd, forgeId) from R2.
```

Schema v3+ remains in the DB (idempotent; v2 code never reads `streams` or `integration_contracts`). A forge reverted this way re-enters the v2 cascade on next phase transition.
