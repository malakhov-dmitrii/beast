#!/usr/bin/env bun
/**
 * e2e-v3-fake.mjs — Task 3.5 E2E scenario script (pipeline-v3)
 *
 * Exercises fanOutStreams + runIntegration + dispatchIntegrationResult against a
 * fresh SQLite DB at /tmp/fake-forge.db (via a scratch cwd /tmp/fake-forge-root/).
 *
 * Modes:
 *   bun run scripts/e2e-v3-fake.mjs                    # happy path
 *   bun run scripts/e2e-v3-fake.mjs --fail-integration  # integration failure → re-plan
 *   bun run scripts/e2e-v3-fake.mjs --simulate-r4-rollback  # both kill-switches set
 */

import { rmSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

// ── Resolve script flags ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE_FAIL_INTEGRATION   = args.includes("--fail-integration");
const MODE_R4_ROLLBACK        = args.includes("--simulate-r4-rollback");

// ── Scratch cwd: /tmp/fake-forge-root (non-git dir → resolveOmcRoot falls back) ──
const SCRATCH_CWD = "/tmp/fake-forge-root";
const DB_PATH     = join(SCRATCH_CWD, ".omc", "forge.db");
const EXPORT_PATH = "/tmp/fake-forge.db";

// ── Import forge modules ────────────────────────────────────────────────────
import { openForgeDb } from "../hooks/forge-schema.mjs";
import {
  createStream,
  createIntegrationContract,
  setForgeContext,
  listStreams,
  dispatchIntegrationResult,
} from "../hooks/forge-crud.mjs";
import { fanOutStreams }    from "../hooks/stream-planner.mjs";
import { runIntegration }  from "../hooks/integration-runner.mjs";

// ── Setup: wipe and recreate scratch dir ───────────────────────────────────
function setup() {
  if (existsSync(SCRATCH_CWD)) {
    rmSync(SCRATCH_CWD, { recursive: true, force: true });
  }
  mkdirSync(join(SCRATCH_CWD, ".omc"), { recursive: true });

  // Trigger schema migration by opening the DB
  const db = openForgeDb(SCRATCH_CWD);
  db.close();
}

// ── Insert fake forge directly via SQL ────────────────────────────────────
function insertForge(slug) {
  const db = openForgeDb(SCRATCH_CWD);
  try {
    const result = db.run(
      `INSERT INTO forges (slug, systems, status, phase, iteration)
       VALUES (?, ?, 'active', 'bf-execute', 1)`,
      [slug, JSON.stringify([])]
    );
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

// ── Mock taskFn ────────────────────────────────────────────────────────────
// Returns tdd_evidence-compatible shape. Sleeps 200-500ms to simulate work.
async function mockTaskFn(streamRow) {
  const delay = 200 + Math.floor(Math.random() * 300);
  await new Promise(r => setTimeout(r, delay));
  return {
    green_tests: [`${streamRow.stream_id}-test-1`, `${streamRow.stream_id}-test-2`],
    refactor_notes: "",
  };
}

// ── Publish DB to /tmp/fake-forge.db ──────────────────────────────────────
function publishDb() {
  copyFileSync(DB_PATH, EXPORT_PATH);
}

// ── Assertion helper ───────────────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HAPPY PATH
// ═══════════════════════════════════════════════════════════════════════════
async function runHappyPath() {
  console.log("[e2e] MODE: happy path");

  setup();
  const forgeId = insertForge("fake-v3");

  // 3 streams: a, b independent; c depends on a
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "a", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "b", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "c", verifierCmd: "true", touchesFiles: [], dependsOn: ["a"],
  });

  // 1 integration contract: exit 0
  createIntegrationContract(SCRATCH_CWD, forgeId, {
    contractName: "smoke", testCmd: "exit 0",
  });

  // Enable pipelineV3
  setForgeContext(SCRATCH_CWD, forgeId, "pipelineV3", true);

  // Run streams
  const fanResult = await fanOutStreams(SCRATCH_CWD, forgeId, mockTaskFn);
  assert(fanResult?.mode !== "v2-fallback", "fanOutStreams should NOT fall back to v2");

  // Verify all streams green
  const streams = listStreams(SCRATCH_CWD, forgeId);
  for (const s of streams) {
    assert(s.status === "green", `stream ${s.stream_id} should be green, got ${s.status}`);
  }

  // Run integration
  const intResult = await runIntegration(SCRATCH_CWD, forgeId);
  assert(intResult.allPass === true, `integration allPass should be true, got ${intResult.allPass}`);

  // Dispatch
  dispatchIntegrationResult(SCRATCH_CWD, forgeId, { allPass: true });

  publishDb();

  console.log("[e2e] HAPPY PATH: PASS");
  console.log("  streams: a=green, b=green, c=green");
  console.log("  integration: allPass=true");
  console.log("  forge: completed");
}

// ═══════════════════════════════════════════════════════════════════════════
// FAIL-INTEGRATION PATH
// ═══════════════════════════════════════════════════════════════════════════
async function runFailIntegration() {
  console.log("[e2e] MODE: --fail-integration");

  setup();
  const forgeId = insertForge("fake-v3");

  createStream(SCRATCH_CWD, forgeId, {
    streamId: "a", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "b", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "c", verifierCmd: "true", touchesFiles: [], dependsOn: ["a"],
  });

  // Integration contract: exit 1 (failure)
  createIntegrationContract(SCRATCH_CWD, forgeId, {
    contractName: "fail-smoke", testCmd: "exit 1",
  });

  setForgeContext(SCRATCH_CWD, forgeId, "pipelineV3", true);

  // Run streams
  await fanOutStreams(SCRATCH_CWD, forgeId, mockTaskFn);

  // Run integration — expect failure
  const intResult = await runIntegration(SCRATCH_CWD, forgeId);
  assert(intResult.allPass === false, `integration allPass should be false, got ${intResult.allPass}`);

  // Dispatch — triggers reEnterPlanning
  dispatchIntegrationResult(SCRATCH_CWD, forgeId, { allPass: false });

  // Verify final DB state
  const db = openForgeDb(SCRATCH_CWD);
  try {
    const forge = db.query("SELECT iteration, phase, context FROM forges WHERE slug='fake-v3'").get();
    assert(forge !== null, "forge fake-v3 must exist");
    assert(forge.iteration === 2, `iteration should be 2, got ${forge.iteration}`);
    assert(forge.phase === "bf-plan-draft", `phase should be bf-plan-draft, got ${forge.phase}`);
    const ctx = JSON.parse(forge.context || "{}");
    assert(
      Array.isArray(ctx.integration_failure_history) && ctx.integration_failure_history.length === 1,
      `integration_failure_history.length should be 1, got ${ctx.integration_failure_history?.length}`
    );
  } finally {
    db.close();
  }

  publishDb();

  console.log("[e2e] FAIL-INTEGRATION PATH: PASS");
  console.log("  forge: iteration=2, phase=bf-plan-draft, history.length=1");
}

// ═══════════════════════════════════════════════════════════════════════════
// R4 ROLLBACK SIMULATION
// ═══════════════════════════════════════════════════════════════════════════
async function runR4Rollback() {
  console.log("[e2e] MODE: --simulate-r4-rollback");

  setup();
  const forgeId = insertForge("fake-v3");

  createStream(SCRATCH_CWD, forgeId, {
    streamId: "a", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "b", verifierCmd: "true", touchesFiles: [], dependsOn: [],
  });
  createStream(SCRATCH_CWD, forgeId, {
    streamId: "c", verifierCmd: "true", touchesFiles: [], dependsOn: ["a"],
  });

  createIntegrationContract(SCRATCH_CWD, forgeId, {
    contractName: "smoke", testCmd: "exit 0",
  });

  setForgeContext(SCRATCH_CWD, forgeId, "pipelineV3", true);

  // R4: set BOTH kill-switches atomically via single BEGIN IMMEDIATE transaction
  {
    const db = openForgeDb(SCRATCH_CWD);
    try {
      db.run("BEGIN IMMEDIATE");
      db.run(
        `UPDATE forges
         SET context = json_set(
           json_set(COALESCE(context, '{}'), '$.integration_disabled', json('true')),
           '$.tdd_required_disabled', json('true')
         ),
         updated_at = datetime('now')
         WHERE id = ?`,
        [forgeId]
      );
      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    } finally {
      db.close();
    }
  }

  // Run streams — tdd_required_disabled short-circuit: evidence={skipped:true}
  await fanOutStreams(SCRATCH_CWD, forgeId, mockTaskFn);

  // All streams should be green with skipped evidence
  const streams = listStreams(SCRATCH_CWD, forgeId);
  for (const s of streams) {
    assert(s.status === "green", `stream ${s.stream_id} should be green, got ${s.status}`);
    const ev = JSON.parse(s.tdd_evidence || "{}");
    assert(ev.skipped === true, `stream ${s.stream_id} tdd_evidence.skipped should be true`);
  }

  // runIntegration should short-circuit: integration_disabled=true
  const intResult = await runIntegration(SCRATCH_CWD, forgeId);
  assert(intResult.allPass === true,       `allPass should be true (short-circuit), got ${intResult.allPass}`);
  assert(intResult.shortCircuited === true, `shortCircuited should be true, got ${intResult.shortCircuited}`);
  assert(intResult.contracts.length === 0,  `contracts should be [], length ${intResult.contracts.length}`);

  // Verify no contracts in 'fail' status
  const db = openForgeDb(SCRATCH_CWD);
  try {
    const failCount = db.query(
      `SELECT COUNT(*) as n FROM integration_contracts WHERE forge_id = ? AND status = 'fail'`
    ).get(forgeId);
    assert(failCount.n === 0, `fail contract count should be 0, got ${failCount.n}`);
  } finally {
    db.close();
  }

  publishDb();

  console.log("[e2e] R4 ROLLBACK PATH: PASS");
  console.log("  all streams: green, tdd_evidence.skipped=true");
  console.log("  integration: shortCircuited=true, 0 contracts executed");
  console.log("  fail contracts in DB: 0");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
try {
  if (MODE_R4_ROLLBACK) {
    await runR4Rollback();
  } else if (MODE_FAIL_INTEGRATION) {
    await runFailIntegration();
  } else {
    await runHappyPath();
  }
  process.exit(0);
} catch (err) {
  console.error("[e2e] FATAL:", err);
  process.exit(1);
}
