/**
 * Task 1.2 — CRUD helpers (pipeline-v3)
 * 15 tests covering new exports + recordClaim patch + discardStreamState
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openForgeDb } from "../forge-schema.mjs";
import {
  createForge,
  recordClaim,
  validateClaim,
  recordGate,
  // new exports under test:
  createStream,
  updateStreamStatus,
  setTddEvidence,
  listStreams,
  searchStreams,
  createIntegrationContract,
  updateContractStatus,
  listIntegrationContracts,
  blockForge,
  setForgeContext,
  getForgeContext,
  discardStreamState,
} from "../forge-crud.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-crud-v3-"));
  forgeId = createForge(cwd, { slug: `test-forge-${Date.now()}`, systems: ["a", "b"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Test 1: createStream round-trip ─────────────────────

test("createStream round-trip", () => {
  const id = createStream(cwd, forgeId, {
    streamId: "s1",
    verifierCmd: "bun test",
    touchesFiles: ["src/foo.ts"],
    acceptanceCriteria: ["foo works"],
    dependsOn: [],
  });
  expect(typeof id).toBe("number");
  expect(id).toBeGreaterThan(0);

  const rows = listStreams(cwd, forgeId);
  expect(rows.length).toBe(1);
  expect(rows[0].stream_id).toBe("s1");
  expect(rows[0].status).toBe("pending");
  expect(rows[0].verifier_cmd).toBe("bun test");
});

// ── Test 2: createStream serializes arrays as JSON ──────

test("createStream serializes touches_files + acceptance_criteria + depends_on as JSON", () => {
  createStream(cwd, forgeId, {
    streamId: "s2",
    verifierCmd: "bun test",
    touchesFiles: ["a.ts", "b.ts"],
    acceptanceCriteria: ["criterion 1", "criterion 2"],
    dependsOn: ["s1"],
  });

  const db = openForgeDb(cwd);
  try {
    const row = db.query("SELECT touches_files, acceptance_criteria, depends_on FROM streams WHERE stream_id = 's2'").get();
    expect(() => JSON.parse(row.touches_files)).not.toThrow();
    expect(() => JSON.parse(row.acceptance_criteria)).not.toThrow();
    expect(() => JSON.parse(row.depends_on)).not.toThrow();
    expect(JSON.parse(row.touches_files)).toEqual(["a.ts", "b.ts"]);
    expect(JSON.parse(row.acceptance_criteria)).toEqual(["criterion 1", "criterion 2"]);
    expect(JSON.parse(row.depends_on)).toEqual(["s1"]);
  } finally {
    db.close();
  }
});

// ── Test 3: updateStreamStatus transitions ───────────────

test("updateStreamStatus transitions pending → running → green", () => {
  const streamRowId = createStream(cwd, forgeId, {
    streamId: "s3",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  updateStreamStatus(cwd, streamRowId, "running");
  let rows = listStreams(cwd, forgeId);
  expect(rows[0].status).toBe("running");

  updateStreamStatus(cwd, streamRowId, "green");
  rows = listStreams(cwd, forgeId);
  expect(rows[0].status).toBe("green");
});

// ── Test 4: updateStreamStatus rejects invalid value ────

test("updateStreamStatus to invalid value raises CHECK error", () => {
  const streamRowId = createStream(cwd, forgeId, {
    streamId: "s4",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  expect(() => updateStreamStatus(cwd, streamRowId, "invalid-status")).toThrow();
});

// ── Test 5: setTddEvidence writes both columns ───────────

test("setTddEvidence writes both tdd_evidence JSON AND refactor_notes column", () => {
  const streamRowId = createStream(cwd, forgeId, {
    streamId: "s5",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: ["works"],
    dependsOn: [],
  });

  setTddEvidence(cwd, streamRowId, {
    red_tests: ["test A fails"],
    green_tests: ["test A passes"],
    refactor_notes: "extracted helper",
  });

  const db = openForgeDb(cwd);
  try {
    const row = db.query("SELECT tdd_evidence, refactor_notes FROM streams WHERE id = ?").get(streamRowId);
    const evidence = JSON.parse(row.tdd_evidence);
    expect(evidence.red_tests).toEqual(["test A fails"]);
    expect(evidence.green_tests).toEqual(["test A passes"]);
    expect(row.refactor_notes).toBe("extracted helper");
  } finally {
    db.close();
  }
});

// ── Test 6: setTddEvidence with no refactor_notes key ───

test("setTddEvidence with no refactor_notes key → refactor_notes='' written, searchStreams finds updated row (not stale)", () => {
  const streamRowId = createStream(cwd, forgeId, {
    streamId: "s6",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: ["specificcriterionxyz"],
    dependsOn: [],
  });

  // No refactor_notes key in evidence
  setTddEvidence(cwd, streamRowId, {
    red_tests: ["test B fails"],
    green_tests: ["test B passes"],
  });

  const db = openForgeDb(cwd);
  try {
    const row = db.query("SELECT refactor_notes FROM streams WHERE id = ?").get(streamRowId);
    expect(row.refactor_notes).toBe("");
  } finally {
    db.close();
  }

  // FTS search should find row (not stale) by acceptance_criteria
  // Use a single unique token (no hyphens — FTS5 splits on hyphens)
  const results = searchStreams(cwd, "specificcriterionxyz");
  expect(results.length).toBeGreaterThan(0);
  expect(results.some(r => r.stream_id === "s6")).toBe(true);
});

// ── Test 7: searchStreams by acceptance_criteria FTS ─────

test("searchStreams by FTS match on acceptance_criteria", () => {
  createStream(cwd, forgeId, {
    streamId: "s7",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: ["uniqueacceptancetokenabc"],
    dependsOn: [],
  });
  createStream(cwd, forgeId, {
    streamId: "s7b",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: ["something else entirely"],
    dependsOn: [],
  });

  const results = searchStreams(cwd, "uniqueacceptancetokenabc");
  expect(results.length).toBe(1);
  expect(results[0].stream_id).toBe("s7");
});

// ── Test 8: searchStreams by refactor_notes FTS ──────────

test("searchStreams by FTS match on refactor_notes (after setTddEvidence)", () => {
  const streamRowId = createStream(cwd, forgeId, {
    streamId: "s8",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: ["generic criterion"],
    dependsOn: [],
  });

  setTddEvidence(cwd, streamRowId, {
    red_tests: [],
    green_tests: [],
    refactor_notes: "extracteduniquehelperqwerty",
  });

  const results = searchStreams(cwd, "extracteduniquehelperqwerty");
  expect(results.length).toBeGreaterThan(0);
  expect(results.some(r => r.stream_id === "s8")).toBe(true);
});

// ── Test 9: createIntegrationContract + updateContractStatus ──

test("createIntegrationContract + updateContractStatus round-trip", () => {
  const contractId = createIntegrationContract(cwd, forgeId, {
    contractName: "api-contract",
    testCmd: "bun test integration",
  });

  expect(typeof contractId).toBe("number");
  expect(contractId).toBeGreaterThan(0);

  let contracts = listIntegrationContracts(cwd, forgeId);
  expect(contracts.length).toBe(1);
  expect(contracts[0].status).toBe("pending");
  expect(contracts[0].contract_name).toBe("api-contract");

  updateContractStatus(cwd, contractId, "pass");
  contracts = listIntegrationContracts(cwd, forgeId);
  expect(contracts[0].status).toBe("pass");
});

// ── Test 10: listIntegrationContracts filtered by status ─

test("listIntegrationContracts filtered by status='fail'", () => {
  const c1 = createIntegrationContract(cwd, forgeId, { contractName: "c1", testCmd: "cmd1" });
  const c2 = createIntegrationContract(cwd, forgeId, { contractName: "c2", testCmd: "cmd2" });

  updateContractStatus(cwd, c1, "fail", "output: assertion failed");
  updateContractStatus(cwd, c2, "pass");

  const failing = listIntegrationContracts(cwd, forgeId, "fail");
  expect(failing.length).toBe(1);
  expect(failing[0].contract_name).toBe("c1");
  expect(failing[0].failure_output).toBe("output: assertion failed");
});

// ── Test 11: blockForge ──────────────────────────────────

test("blockForge sets status='blocked' with reason", () => {
  blockForge(cwd, forgeId, "stream s1 failed 3 total attempts");

  const db = openForgeDb(cwd);
  try {
    const forge = db.query("SELECT status, blocking_reason FROM forges WHERE id = ?").get(forgeId);
    expect(forge.status).toBe("blocked");
    expect(forge.blocking_reason).toBe("stream s1 failed 3 total attempts");
  } finally {
    db.close();
  }
});

// ── Test 12: setForgeContext merges without erasing ──────

test("setForgeContext merges pipelineV3 flag without erasing other keys", () => {
  setForgeContext(cwd, forgeId, "existingKey", "existingValue");
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  const ctx = getForgeContext(cwd, forgeId);
  expect(ctx.existingKey).toBe("existingValue");
  expect(ctx.pipelineV3).toBe(true);
});

// ── Test 13: strict-equality boolean readback ────────────

test("getForgeContext(cwd, fid).pipelineV3 === true after setForgeContext(..., true) — STRICT EQUALITY readback guards against SQLite boolean→integer coercion", () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  const ctx = getForgeContext(cwd, forgeId);
  // Must be strict boolean true, not integer 1
  expect(ctx.pipelineV3 === true).toBe(true);
  expect(ctx.pipelineV3).not.toBe(1);
});

// ── Test 14: recordClaim returns id; validateClaim uses it ─

test("recordClaim returns the inserted row id; validateClaim(cwd, id, ...) with that id updates that exact row", () => {
  const claimId = recordClaim(cwd, forgeId, 1, 0, {
    claimType: "fact",
    claimText: "test claim for iter-6 C1 fix",
    citation: "forge-crud.mjs:220",
  });

  expect(typeof claimId).toBe("number");
  expect(claimId).toBeGreaterThan(0);

  validateClaim(cwd, claimId, { result: "verified", notes: "confirmed in test" });

  const db = openForgeDb(cwd);
  try {
    const row = db.query("SELECT validation_result, validation_notes FROM claim_validations WHERE id = ?").get(claimId);
    expect(row).not.toBeNull();
    expect(row.validation_result).toBe("verified");
    expect(row.validation_notes).toBe("confirmed in test");
  } finally {
    db.close();
  }
});

// ── Test 15: discardStreamState preservation invariant ───

test("discardStreamState(cwd, forgeId) deletes streams + integration_contracts + integration_failure_history for that forge but preserves forges row, gates, and claim_validations", () => {
  // Create streams
  createStream(cwd, forgeId, {
    streamId: "discard-s1",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  createStream(cwd, forgeId, {
    streamId: "discard-s2",
    verifierCmd: "bun test",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  // Create integration contract
  createIntegrationContract(cwd, forgeId, { contractName: "ic1", testCmd: "cmd" });

  // Create a gate record
  recordGate(cwd, forgeId, 1, "skeptic", "PASS", ["finding 1"]);

  // Create a claim
  const claimId = recordClaim(cwd, forgeId, 1, 0, {
    claimType: "fact",
    claimText: "preserved claim",
    citation: null,
  });

  // Set integration_failure_history in context
  setForgeContext(cwd, forgeId, "integration_failure_history", JSON.stringify([{ iteration: 1, reason: "x" }]));

  // Discard
  discardStreamState(cwd, forgeId);

  const db = openForgeDb(cwd);
  try {
    // Streams deleted
    const streamCount = db.query("SELECT COUNT(*) as c FROM streams WHERE forge_id = ?").get(forgeId);
    expect(streamCount.c).toBe(0);

    // Integration contracts deleted
    const contractCount = db.query("SELECT COUNT(*) as c FROM integration_contracts WHERE forge_id = ?").get(forgeId);
    expect(contractCount.c).toBe(0);

    // Forges row preserved
    const forge = db.query("SELECT * FROM forges WHERE id = ?").get(forgeId);
    expect(forge).not.toBeNull();
    expect(forge.iteration).toBe(1);
    expect(forge.phase).toBe("bf-plan-draft");
    expect(forge.status).toBe("active");

    // integration_failure_history removed from context
    const ctx = forge.context ? JSON.parse(forge.context) : {};
    expect(ctx.integration_failure_history).toBeUndefined();

    // Gates preserved
    const gateCount = db.query("SELECT COUNT(*) as c FROM gates WHERE forge_id = ?").get(forgeId);
    expect(gateCount.c).toBe(1);

    // Claim validations preserved
    const claimRow = db.query("SELECT id FROM claim_validations WHERE id = ?").get(claimId);
    expect(claimRow).not.toBeNull();
  } finally {
    db.close();
  }
});
