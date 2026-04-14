#!/usr/bin/env bun
/**
 * Spike S3 — /tdd skill preload behavior.
 *
 * Documents the assumption: a subagent spawned with a /tdd skill directive responds
 * with RED-GREEN-REFACTOR discipline on the first attempt without operator re-prompting.
 * The actual proof is a Phase-2 rollout measurement (response transcripts) — not
 * reproducible in plugin dev context, so this spike logs as 'unverifiable'.
 *
 * Depends (for deferred-audit path): Task 1.2's recordClaim/validateClaim patch.
 * Runtime: execute AFTER Task 1.2 lands.
 */

import { recordClaim, validateClaim } from "../hooks/forge-crud.mjs";

const cwd = process.cwd();
const forgeId = Number(process.argv[2]);
const iteration = Number(process.argv[3]) || 1;

if (!forgeId) {
  console.error("usage: spike-tdd-preload.mjs <forge_id> [iteration]");
  process.exit(2);
}

console.log(`
# S3 — /tdd skill preload design_bet

assumption: subagent preloaded with /tdd directive emits RED before GREEN on first attempt.
validation_plan: Phase-2 rollout — collect 10 real sample transcripts, grep for "RED:"
                 preceding "GREEN:" in each. Threshold: ≥9/10.
blast_radius: if violated, Task 3.1's verifier_cmd gate still catches missing RED tests
              (green_tests-must-be-superset-of-red_tests check), so worst case is a
              retry cycle, not silent data loss.
`.trim());

const claimId = recordClaim(cwd, forgeId, iteration, 0, {
  claimType: "design_bet",
  claimText: "/tdd skill preload induces RED-first behavior in spawned subagents",
  citation: "scripts/spike-tdd-preload.mjs",
});
validateClaim(cwd, claimId, {
  result: "unverifiable",
  notes: "validate in Phase 2 rollout via transcript sampling",
});
console.log(`S3 DEFERRED: claim ${claimId} recorded as unverifiable`);
process.exit(0);
