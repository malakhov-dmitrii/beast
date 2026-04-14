/**
 * Task 3.1 — verifier_cmd gate + tdd_evidence capture
 * 8 tests. RED phase: all fail before the new branches are implemented.
 *
 * Tests new behaviors added on top of Task 2.5's executeStream:
 *   1. exit 0 + green_tests non-empty → status=green
 *   2. exit 1 → status=failed, retries increments
 *   3. exit 0 but green_tests empty → status=pending, alert logged
 *   4. green_tests not superset of red_tests → status=pending, alert logged
 *   5. 2nd failure (retries 1→2) → status=failed, blockForge NOT called
 *   6. 3rd failure (retries 2→3) → status=failed, blockForge called with reason containing '3 total attempts'
 *   7. Task() throttle error → status=pending (reset), retries NOT incremented
 *   8. tdd_required_disabled=true → skip verifier, status=green, tdd_evidence={skipped:true,reason:'tdd_required_disabled'}
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createForge,
  createStream,
  setForgeContext,
  listStreams,
} from "../forge-crud.mjs";
import { openForgeDb } from "../forge-schema.mjs";
import { executeStream } from "../stream-planner.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-vgate-"));
  forgeId = createForge(cwd, { slug: `vgate-test-${Date.now()}`, systems: ["test"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// Helper: set stream retries directly in DB (simulates prior failure history)
function setRetries(cwd, rowId, count) {
  const db = openForgeDb(cwd);
  try {
    db.run(`UPDATE streams SET retries = ? WHERE id = ?`, [count, rowId]);
  } finally {
    db.close();
  }
}

// Helper: get forge row
function getForge(cwd, forgeId) {
  const db = openForgeDb(cwd);
  try {
    return db.query(`SELECT * FROM forges WHERE id = ?`).get(forgeId);
  } finally {
    db.close();
  }
}

// ── Test 1: exit 0 + non-empty green_tests → status=green ─────────────────

test("verifier exit 0 + non-empty green_tests → status=green, tdd_evidence persisted", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t1",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const streamRow = listStreams(cwd, forgeId)[0];

  await executeStream(cwd, forgeId, streamRow, async () => ({
    green_tests: ["test A passes", "test B passes"],
  }));

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("green");
  const evidence = JSON.parse(updated.tdd_evidence);
  expect(evidence.green_tests).toEqual(["test A passes", "test B passes"]);
});

// ── Test 2: verifier exit 1 → status=failed, retries increments ───────────

test("verifier exit 1 → status=failed, retries increments from 0 to 1", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t2",
    verifierCmd: "false", // always exits 1
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const streamRow = listStreams(cwd, forgeId)[0];

  await executeStream(cwd, forgeId, streamRow, async () => ({
    green_tests: ["test X passes"],
  }));

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("failed");
  expect(updated.retries).toBe(1);
});

// ── Test 3: exit 0 but green_tests empty → status=pending, alert ──────────

test("verifier exit 0 but empty green_tests → status=pending (not green), alert fired", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t3",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const streamRow = listStreams(cwd, forgeId)[0];

  const alerts = [];
  const origWarn = console.warn;
  console.warn = (...args) => alerts.push(args.join(" "));

  try {
    await executeStream(cwd, forgeId, streamRow, async () => ({
      green_tests: [], // deliberately empty
    }));
  } finally {
    console.warn = origWarn;
  }

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("pending");
  expect(alerts.some(a => /green_tests.*empty|no.*green_tests/i.test(a))).toBe(true);
});

// ── Test 4: green_tests not superset of red_tests → status=pending, alert ─

test("green_tests names not superset of red_tests → status=pending, alert fired", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t4",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
    // red_tests stored in the stream row — set via DB directly after creation
  });
  // Set red_tests on the stream row
  const rowId = listStreams(cwd, forgeId)[0].id;
  const db = openForgeDb(cwd);
  try {
    db.run(`UPDATE streams SET red_tests = ? WHERE id = ?`, [
      JSON.stringify(["test alpha", "test beta"]),
      rowId,
    ]);
  } finally {
    db.close();
  }

  const streamRow = listStreams(cwd, forgeId)[0];

  const alerts = [];
  const origWarn = console.warn;
  console.warn = (...args) => alerts.push(args.join(" "));

  try {
    await executeStream(cwd, forgeId, streamRow, async () => ({
      // green_tests covers alpha but NOT beta
      green_tests: ["test alpha"],
    }));
  } finally {
    console.warn = origWarn;
  }

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("pending");
  expect(alerts.some(a => /superset|red_tests|missing/i.test(a))).toBe(true);
});

// ── Test 5: 2nd failure (retries 1→2) → status=failed, blockForge NOT called

test("2nd verifier failure (retries 1→2) → status=failed, blockForge NOT called", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t5",
    verifierCmd: "false",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const rowId = listStreams(cwd, forgeId)[0].id;
  // Simulate 1 prior failure
  setRetries(cwd, rowId, 1);

  const streamRow = listStreams(cwd, forgeId)[0];

  await executeStream(cwd, forgeId, streamRow, async () => ({
    green_tests: ["some test"],
  }));

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("failed");
  expect(updated.retries).toBe(2);

  // Forge must NOT be blocked after only 2 total attempts
  const forge = getForge(cwd, forgeId);
  expect(forge.status).not.toBe("blocked");
});

// ── Test 6: 3rd failure (retries 2→3) → status=failed, blockForge fires ──

test("3rd verifier failure (retries 2→3) → status=failed, blockForge called with '3 total attempts'", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t6",
    verifierCmd: "false",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const rowId = listStreams(cwd, forgeId)[0].id;
  // Simulate 2 prior failures
  setRetries(cwd, rowId, 2);

  const streamRow = listStreams(cwd, forgeId)[0];

  await executeStream(cwd, forgeId, streamRow, async () => ({
    green_tests: ["some test"],
  }));

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("failed");
  expect(updated.retries).toBe(3);

  // Forge MUST be blocked after 3 total attempts
  const forge = getForge(cwd, forgeId);
  expect(forge.status).toBe("blocked");
  expect(forge.blocking_reason).toMatch(/3 total attempts/);
});

// ── Test 7: Task() throttle error → status=pending, retries NOT incremented

test("Task() throttle error → stream status=pending (reset), retries NOT incremented", async () => {
  createStream(cwd, forgeId, {
    streamId: "vg-t7",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const rowId = listStreams(cwd, forgeId)[0].id;
  // Stream is currently 'pending' (default). retries starts at 0.
  const streamRow = listStreams(cwd, forgeId)[0];

  // Simulate a throttle error from the Task() infra layer
  const throttleError = new Error("TRIGGER_THROTTLED: too many concurrent tasks");
  throttleError.code = "TRIGGER_THROTTLED";

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));

  try {
    await executeStream(cwd, forgeId, streamRow, async () => {
      throw throttleError;
    });
  } finally {
    console.log = origLog;
  }

  const updated = listStreams(cwd, forgeId)[0];
  // Must be reset to pending, NOT failed
  expect(updated.status).toBe("pending");
  // Retries must NOT increment — infra failure, not code failure
  expect(updated.retries).toBe(0);
  // Must log the throttle event
  expect(logs.some(l => /throttle|infra/i.test(l))).toBe(true);
});

// ── Test 8: tdd_required_disabled=true → skip verifier entirely ───────────

test("tdd_required_disabled=true → skip verifier_cmd, status=green on Task() completion, tdd_evidence={skipped:true}", async () => {
  // Set the kill-switch flag
  setForgeContext(cwd, forgeId, "tdd_required_disabled", true);

  createStream(cwd, forgeId, {
    streamId: "vg-t8",
    verifierCmd: "false", // would fail if executed — proves it's skipped
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  const streamRow = listStreams(cwd, forgeId)[0];

  let taskFnCalled = false;
  await executeStream(cwd, forgeId, streamRow, async () => {
    taskFnCalled = true;
    return { green_tests: [] }; // empty is fine when tdd_required_disabled
  });

  expect(taskFnCalled).toBe(true);

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("green");

  const evidence = JSON.parse(updated.tdd_evidence);
  expect(evidence.skipped).toBe(true);
  expect(evidence.reason).toBe("tdd_required_disabled");
});
