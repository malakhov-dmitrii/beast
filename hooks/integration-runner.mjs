/**
 * integration-runner.mjs — Task 3.2
 *
 * runIntegration(cwd, forgeId) — executes all integration contracts for a forge.
 *
 * Spawn note: uses Bun.spawnSync with stdout:"pipe", stderr:"pipe" for output capture.
 * This is safe because integration contracts are expected to produce <64KB output.
 * The 64KB deadlock gotcha (CLAUDE.md) applies only to long-lived processes with "pipe".
 * Short-lived contract scripts are bounded by design.
 */

import {
  getForgeContext,
  listIntegrationContracts,
  updateContractStatus,
} from "./forge-crud.mjs";

/**
 * Run all integration contracts for the given forge.
 *
 * @param {string} cwd   - forge working directory (used for DB path)
 * @param {number} forgeId
 * @returns {Promise<{ allPass: boolean, contracts: Array, shortCircuited?: boolean }>}
 */
export async function runIntegration(cwd, forgeId) {
  // iter-7 Phase-2/Phase-3 kill-switch: skip all execution when disabled
  const ctx = getForgeContext(cwd, forgeId);
  if (ctx?.integration_disabled === true) {
    return { allPass: true, contracts: [], shortCircuited: true };
  }

  const rows = listIntegrationContracts(cwd, forgeId);

  if (rows.length === 0) {
    return { allPass: true, contracts: [] };
  }

  let allPass = true;
  const contracts = [];

  for (const row of rows) {
    const proc = Bun.spawnSync(["sh", "-c", row.test_cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = proc.exitCode;
    const result = exitCode === 0 ? "pass" : "fail";

    let failureOutput = null;
    if (result === "fail") {
      const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
      const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
      failureOutput = (stdout + stderr).trim() || null;
      allPass = false;
    }

    updateContractStatus(cwd, row.id, result, failureOutput);

    contracts.push({
      id: row.id,
      contractName: row.contract_name,
      result,
      failureOutput,
    });
  }

  return { allPass, contracts };
}
