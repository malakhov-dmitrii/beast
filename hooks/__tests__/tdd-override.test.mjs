/**
 * ADR §9 Q3 — Operator override audit trail.
 *
 * Setting tdd_required_disabled is not a silent flag flip. It requires a
 * reason and records a strategic claim in claim_validations for audit.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  disableTdd,
  enableTdd,
  getForgeContext,
  createForge,
  listClaims,
} from "../forge-crud.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-tdd-override-"));
  forgeId = createForge(cwd, {
    slug: `tdd-override-test-${Date.now()}`,
    systems: ["test"],
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

test("disableTdd throws when reason missing", () => {
  expect(() => disableTdd(cwd, forgeId)).toThrow(/requires a reason/);
  expect(() => disableTdd(cwd, forgeId, "")).toThrow(/requires a reason/);
  expect(() => disableTdd(cwd, forgeId, "  ")).toThrow(/requires a reason/);
  expect(() => disableTdd(cwd, forgeId, "ab")).toThrow(/requires a reason/);
});

test("disableTdd throws when forge not found", () => {
  expect(() => disableTdd(cwd, 99999, "valid reason")).toThrow(/not found/);
});

test("disableTdd sets tdd_required_disabled === true on readback (strict equality)", () => {
  disableTdd(cwd, forgeId, "spike for throwaway reproduction");
  const ctx = getForgeContext(cwd, forgeId);
  expect(ctx?.tdd_required_disabled).toBe(true);
});

test("disableTdd records a strategic claim in claim_validations with the reason", () => {
  disableTdd(cwd, forgeId, "spike for throwaway reproduction");
  const claims = listClaims(cwd, forgeId, 1);
  const strategicClaims = claims.filter((c) => c.claim_type === "strategic");
  expect(strategicClaims.length).toBe(1);
  expect(strategicClaims[0].claim_text).toContain("TDD enforcement disabled");
  expect(strategicClaims[0].claim_text).toContain("spike for throwaway reproduction");
  expect(strategicClaims[0].citation).toBe("operator-override");
  expect(strategicClaims[0].validation_result).toBe("verified");
  expect(strategicClaims[0].validation_notes).toBe("spike for throwaway reproduction");
});

test("enableTdd removes the flag; re-reading ctx.tdd_required_disabled is undefined", () => {
  disableTdd(cwd, forgeId, "temporary");
  enableTdd(cwd, forgeId);
  const ctx = getForgeContext(cwd, forgeId);
  expect(ctx?.tdd_required_disabled).toBeUndefined();
});

test("enableTdd does NOT delete the audit trail — prior claim remains", () => {
  disableTdd(cwd, forgeId, "temp spike");
  enableTdd(cwd, forgeId);
  const claims = listClaims(cwd, forgeId, 1);
  const strategicClaims = claims.filter((c) => c.claim_type === "strategic");
  expect(strategicClaims.length).toBe(1);
  expect(strategicClaims[0].claim_text).toContain("TDD enforcement disabled");
});
