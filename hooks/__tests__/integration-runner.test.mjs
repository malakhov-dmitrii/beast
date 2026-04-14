/**
 * Task 3.2 — runIntegration integration contract-test runner
 * 6 tests. RED phase: all fail before implementation.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createForge,
  createIntegrationContract,
  listIntegrationContracts,
  setForgeContext,
} from "../forge-crud.mjs";
import { runIntegration } from "../integration-runner.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-integ-runner-"));
  forgeId = createForge(cwd, { slug: `integ-test-${Date.now()}`, systems: ["test"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Test 1: loops all contracts from listIntegrationContracts ────────────────

test("runIntegration loops all contracts and returns results for each", async () => {
  createIntegrationContract(cwd, forgeId, { contractName: "c1", testCmd: "exit 0" });
  createIntegrationContract(cwd, forgeId, { contractName: "c2", testCmd: "exit 0" });

  const result = await runIntegration(cwd, forgeId);

  expect(result.contracts.length).toBe(2);
  expect(result.contracts[0].contractName).toBe("c1");
  expect(result.contracts[1].contractName).toBe("c2");
});

// ── Test 2: marks pass/fail per contract based on exit code ─────────────────

test("runIntegration marks pass on exit 0 and fail on non-zero exit", async () => {
  createIntegrationContract(cwd, forgeId, { contractName: "passing", testCmd: "exit 0" });
  createIntegrationContract(cwd, forgeId, { contractName: "failing", testCmd: "exit 1" });

  const result = await runIntegration(cwd, forgeId);

  const passing = result.contracts.find(c => c.contractName === "passing");
  const failing = result.contracts.find(c => c.contractName === "failing");
  expect(passing.result).toBe("pass");
  expect(failing.result).toBe("fail");
});

// ── Test 3: stores failure_output for failures ───────────────────────────────

test("runIntegration stores failure_output (stdout+stderr combined) for failing contracts", async () => {
  createIntegrationContract(cwd, forgeId, {
    contractName: "noisy-fail",
    testCmd: "echo 'something went wrong'; exit 1",
  });

  const result = await runIntegration(cwd, forgeId);

  const contract = result.contracts[0];
  expect(contract.result).toBe("fail");
  expect(contract.failureOutput).toContain("something went wrong");

  // Verify it was also persisted to DB
  const dbContracts = listIntegrationContracts(cwd, forgeId);
  expect(dbContracts[0].failure_output).toContain("something went wrong");
});

// ── Test 4: returns allPass:false if ANY contract fails ──────────────────────

test("runIntegration returns allPass:false if any contract fails", async () => {
  createIntegrationContract(cwd, forgeId, { contractName: "ok", testCmd: "exit 0" });
  createIntegrationContract(cwd, forgeId, { contractName: "broken", testCmd: "exit 1" });

  const result = await runIntegration(cwd, forgeId);

  expect(result.allPass).toBe(false);
});

// ── Test 5: empty contract list → allPass:true, no execution ────────────────

test("runIntegration returns allPass:true immediately when no contracts exist", async () => {
  const result = await runIntegration(cwd, forgeId);

  expect(result.allPass).toBe(true);
  expect(result.contracts).toEqual([]);
});

// ── Test 6: short-circuit when integration_disabled === true (iter-7 kill-switch) ──

test("runIntegration short-circuits when forges.context.integration_disabled === true", async () => {
  // Add a contract that would fail if executed
  createIntegrationContract(cwd, forgeId, { contractName: "would-fail", testCmd: "exit 1" });

  setForgeContext(cwd, forgeId, "integration_disabled", true);

  const result = await runIntegration(cwd, forgeId);

  expect(result.allPass).toBe(true);
  expect(result.contracts).toEqual([]);
  expect(result.shortCircuited).toBe(true);

  // DB contract must remain untouched (status still 'pending')
  const dbContracts = listIntegrationContracts(cwd, forgeId);
  expect(dbContracts[0].status).toBe("pending");
});
