/**
 * Task 3.3 — Re-plan on integration failure
 * 5 tests: reEnterPlanning + dispatchIntegrationResult
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openForgeDb } from "../forge-schema.mjs";
import {
  createForge,
  createStream,
  createIntegrationContract,
  updateContractStatus,
  getForgeContext,
  completeForge,
} from "../forge-crud.mjs";
import { reEnterPlanning } from "../forge-crud.mjs";
import { dispatchIntegrationResult } from "../forge-crud.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-replan-"));
  forgeId = createForge(cwd, { slug: `replan-test-${Date.now()}`, systems: ["a", "b"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Test 1: reEnterPlanning increments iteration and sets phase=bf-plan-draft ─

test("reEnterPlanning increments iteration and sets phase=bf-plan-draft", () => {
  const db = openForgeDb(cwd);
  const before = db.query("SELECT iteration, phase FROM forges WHERE id = ?").get(forgeId);
  db.close();

  const iterBefore = before.iteration;

  // Create a failing contract so there's something to process
  const cId = createIntegrationContract(cwd, forgeId, { contractName: "c1", testCmd: "bun test" });
  updateContractStatus(cwd, cId, "fail", "assertion error");

  reEnterPlanning(cwd, forgeId);

  const db2 = openForgeDb(cwd);
  const after = db2.query("SELECT iteration, phase FROM forges WHERE id = ?").get(forgeId);
  db2.close();

  expect(after.iteration).toBe(iterBefore + 1);
  expect(after.phase).toBe("bf-plan-draft");
});

// ── Test 2: reEnterPlanning preserves streams rows (not rolled back) ──────────

test("reEnterPlanning preserves streams rows (not rolled back)", () => {
  createStream(cwd, forgeId, {
    streamId: "s1",
    verifierCmd: "bun test",
    touchesFiles: ["src/foo.ts"],
    acceptanceCriteria: ["foo works"],
    dependsOn: [],
  });
  createStream(cwd, forgeId, {
    streamId: "s2",
    verifierCmd: "bun test",
    touchesFiles: ["src/bar.ts"],
    acceptanceCriteria: ["bar works"],
    dependsOn: [],
  });

  const cId = createIntegrationContract(cwd, forgeId, { contractName: "c-fail", testCmd: "bun test int" });
  updateContractStatus(cwd, cId, "fail", "type mismatch");

  reEnterPlanning(cwd, forgeId);

  const db = openForgeDb(cwd);
  const count = db.query("SELECT COUNT(*) as c FROM streams WHERE forge_id = ?").get(forgeId);
  db.close();

  expect(count.c).toBe(2);
});

// ── Test 3: reEnterPlanning appends contract failures to integration_failure_history ─

test("reEnterPlanning appends contract failures to integration_failure_history", () => {
  const c1 = createIntegrationContract(cwd, forgeId, { contractName: "api-contract", testCmd: "bun test api" });
  const c2 = createIntegrationContract(cwd, forgeId, { contractName: "schema-contract", testCmd: "bun test schema" });
  updateContractStatus(cwd, c1, "fail", "api mismatch");
  updateContractStatus(cwd, c2, "pass");

  reEnterPlanning(cwd, forgeId);

  const history = getForgeContext(cwd, forgeId, "integration_failure_history");
  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBe(1);

  const entry = history[0];
  expect(typeof entry.iteration).toBe("number");
  expect(Array.isArray(entry.contracts)).toBe(true);
  expect(entry.contracts.length).toBe(1);
  expect(entry.contracts[0].contract_name).toBe("api-contract");
  expect(typeof entry.timestamp).toBe("string");
});

// ── Test 4: reEnterPlanning at iteration 5 blocks forge with cap-exceeded reason ─

test("reEnterPlanning at iteration 5 blocks forge with cap-exceeded reason and does NOT increment", () => {
  // Advance forge to iteration 5
  const db = openForgeDb(cwd);
  db.run("UPDATE forges SET iteration = 5 WHERE id = ?", [forgeId]);
  db.close();

  const cId = createIntegrationContract(cwd, forgeId, { contractName: "cap-test", testCmd: "bun test" });
  updateContractStatus(cwd, cId, "fail", "still failing");

  reEnterPlanning(cwd, forgeId);

  const db2 = openForgeDb(cwd);
  const forge = db2.query("SELECT iteration, status, blocking_reason FROM forges WHERE id = ?").get(forgeId);
  db2.close();

  expect(forge.status).toBe("blocked");
  expect(forge.blocking_reason).toContain("integration-replan cap (5) exceeded");
  expect(forge.iteration).toBe(5); // NOT incremented
});

// ── Test 5: integration pass path calls completeForge, not reEnterPlanning ───

test("dispatchIntegrationResult calls completeForge (not reEnterPlanning) when allPass=true", () => {
  // Set up contracts that all pass
  const c1 = createIntegrationContract(cwd, forgeId, { contractName: "p1", testCmd: "bun test p1" });
  const c2 = createIntegrationContract(cwd, forgeId, { contractName: "p2", testCmd: "bun test p2" });
  updateContractStatus(cwd, c1, "pass");
  updateContractStatus(cwd, c2, "pass");

  dispatchIntegrationResult(cwd, forgeId, { allPass: true, lesson: "all contracts verified" });

  const db = openForgeDb(cwd);
  const forge = db.query("SELECT status, iteration FROM forges WHERE id = ?").get(forgeId);
  db.close();

  // completeForge sets status='completed', iteration stays the same
  expect(forge.status).toBe("completed");
  expect(forge.iteration).toBe(1); // not incremented — reEnterPlanning was NOT called
});
