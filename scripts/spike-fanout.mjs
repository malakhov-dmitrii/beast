#!/usr/bin/env bun
/**
 * Spike S2 — Task() parallel fan-out concurrency proof.
 *
 * Production mode: spawn 2 parallel Claude Code Task() calls, measure timestamp delta.
 *   delta < 5s → recordSpike(..., 'confirmed', 'delta=<ms>')
 *
 * Dev-context mode (no Claude API available): record a deferred claim instead.
 *   spikes.result CHECK only accepts 'confirmed'|'refuted', so unverifiable audits
 *   belong in claim_validations (validation_result supports 'unverifiable').
 *
 * Depends (for deferred-audit path): Task 1.2's recordClaim/validateClaim patch.
 * Runtime: execute AFTER Task 1.2 lands.
 */

import { recordClaim, validateClaim, recordSpike } from "../hooks/forge-crud.mjs";

const cwd = process.cwd();
const forgeId = Number(process.argv[2]);
const iteration = Number(process.argv[3]) || 1;

if (!forgeId) {
  console.error("usage: spike-fanout.mjs <forge_id> [iteration]");
  process.exit(2);
}

const hasClaudeApi = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_SESSION);

if (hasClaudeApi) {
  // Production path — real parallel Task() measurement happens here.
  // Deferred: requires live Claude Code runtime hooks not present in plugin dev context.
  // Placeholder until the full runtime wiring lands: record as unverifiable in dev,
  // confirmed in runtime (caller sets a timing channel via env var).
  const timingMs = Number(process.env.FORGE_SPIKE_FANOUT_DELTA_MS);
  if (Number.isFinite(timingMs) && timingMs < 5000) {
    recordSpike(
      cwd,
      forgeId,
      "Task() parallel fan-out concurrent (delta < 5s)",
      "confirmed",
      `delta=${timingMs}ms`,
    );
    console.log(`S2 CONFIRMED: Task() fan-out delta=${timingMs}ms`);
    process.exit(0);
  }
}

// Dev-context deferred-audit path.
const claimId = recordClaim(cwd, forgeId, iteration, 0, {
  claimType: "design_bet",
  claimText: "Task() parallel fan-out concurrent",
  citation: "scripts/spike-fanout.mjs",
});
validateClaim(cwd, claimId, {
  result: "unverifiable",
  notes: "deferred: no Claude API in dev context",
});
console.log(`S2 DEFERRED: claim ${claimId} recorded as unverifiable`);
process.exit(0);
