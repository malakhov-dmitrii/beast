/**
 * Task 2.5 — executeStream + fanOutStreams
 * 9 tests. RED phase: all fail before implementation.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createForge,
  createStream,
  setForgeContext,
  getForgeContext,
  listStreams,
} from "../forge-crud.mjs";
import { executeStream, fanOutStreams } from "../stream-planner.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-exec-stream-"));
  forgeId = createForge(cwd, { slug: `exec-test-${Date.now()}`, systems: ["test"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Test 1: executeStream invokes taskFn with stream row ──────────────────

test("executeStream calls taskFn with stream row and returns result", async () => {
  const rowId = createStream(cwd, forgeId, {
    streamId: "s1",
    verifierCmd: "true", // exits 0
    touchesFiles: [],
    acceptanceCriteria: ["criterion 1"],
    dependsOn: [],
  });

  const rows = listStreams(cwd, forgeId);
  const streamRow = rows[0];

  let capturedRow = null;
  const mockTaskFn = async (row) => {
    capturedRow = row;
    return { green_tests: ["test passes"] };
  };

  await executeStream(cwd, forgeId, streamRow, mockTaskFn);

  expect(capturedRow).not.toBeNull();
  expect(capturedRow.stream_id).toBe("s1");
});

// ── Test 2: executeStream blocks GREEN until verifier exits 0 ────────────

test("executeStream sets status=green only when verifier_cmd exits 0", async () => {
  const rowId = createStream(cwd, forgeId, {
    streamId: "s2",
    verifierCmd: "true", // always exits 0
    touchesFiles: [],
    acceptanceCriteria: ["all good"],
    dependsOn: [],
  });

  const streamRow = listStreams(cwd, forgeId)[0];

  const mockTaskFn = async () => ({ green_tests: ["test A passes"] });

  await executeStream(cwd, forgeId, streamRow, mockTaskFn);

  const updated = listStreams(cwd, forgeId)[0];
  expect(updated.status).toBe("green");
});

// ── Test 3: executeStream persists tdd_evidence on completion ────────────

test("executeStream persists tdd_evidence JSON when verifier exits 0", async () => {
  const rowId = createStream(cwd, forgeId, {
    streamId: "s3",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: ["works"],
    dependsOn: [],
  });

  const streamRow = listStreams(cwd, forgeId)[0];

  const mockTaskFn = async () => ({
    green_tests: ["test B passes", "test C passes"],
    refactor_notes: "extracted helper fn",
  });

  await executeStream(cwd, forgeId, streamRow, mockTaskFn);

  const updated = listStreams(cwd, forgeId)[0];
  const evidence = JSON.parse(updated.tdd_evidence);
  expect(evidence.green_tests).toEqual(["test B passes", "test C passes"]);
  expect(updated.refactor_notes).toBe("extracted helper fn");
});

// ── Test 4: fanOutStreams runs independent streams concurrently ───────────

test("fanOutStreams runs independent streams concurrently (all start within 100ms)", async () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  // Create 3 independent streams
  for (let i = 1; i <= 3; i++) {
    createStream(cwd, forgeId, {
      streamId: `concurrent-${i}`,
      verifierCmd: "true",
      touchesFiles: [],
      acceptanceCriteria: [],
      dependsOn: [],
    });
  }

  const startTimes = [];
  const mockTaskFn = async (row) => {
    startTimes.push(Date.now());
    // Small delay to allow timing measurement
    await new Promise(r => setTimeout(r, 20));
    return { green_tests: ["pass"] };
  };

  await fanOutStreams(cwd, forgeId, mockTaskFn);

  expect(startTimes.length).toBe(3);
  const spread = Math.max(...startTimes) - Math.min(...startTimes);
  // All 3 started within 100ms of each other (concurrent, not serial)
  expect(spread).toBeLessThan(100);
});

// ── Test 5: fanOutStreams respects concurrency cap 5 ─────────────────────

test("fanOutStreams never exceeds concurrency cap of 5", async () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  // Create 10 independent streams
  for (let i = 1; i <= 10; i++) {
    createStream(cwd, forgeId, {
      streamId: `cap-stream-${i}`,
      verifierCmd: "true",
      touchesFiles: [],
      acceptanceCriteria: [],
      dependsOn: [],
    });
  }

  let concurrentCount = 0;
  let maxConcurrent = 0;

  const mockTaskFn = async () => {
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
    await new Promise(r => setTimeout(r, 30));
    concurrentCount--;
    return { green_tests: ["pass"] };
  };

  await fanOutStreams(cwd, forgeId, mockTaskFn, { concurrencyCap: 5 });

  expect(maxConcurrent).toBeLessThanOrEqual(5);
  expect(maxConcurrent).toBeGreaterThan(1); // actually ran concurrently
});

// ── Test 6: fanOutStreams waits for dep before starting dependent ─────────

test("fanOutStreams waits for dependency to complete before starting dependent stream", async () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  createStream(cwd, forgeId, {
    streamId: "dep-a",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });
  createStream(cwd, forgeId, {
    streamId: "dep-b",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: ["dep-a"],
  });

  const completionOrder = [];
  const mockTaskFn = async (row) => {
    if (row.stream_id === "dep-a") {
      await new Promise(r => setTimeout(r, 40));
    }
    completionOrder.push(row.stream_id);
    return { green_tests: ["pass"] };
  };

  await fanOutStreams(cwd, forgeId, mockTaskFn);

  // dep-a must complete before dep-b starts (and thus completes)
  expect(completionOrder.indexOf("dep-a")).toBeLessThan(completionOrder.indexOf("dep-b"));
});

// ── Test 7: fanOutStreams explicit opt-out → v2-fallback ──────────────────

test("fanOutStreams returns {mode:'v2-fallback'} when pipelineV3 === false (explicit opt-out)", async () => {
  // v3 is now the default — only explicit `false` opts back to v2.
  setForgeContext(cwd, forgeId, "pipelineV3", false);

  createStream(cwd, forgeId, {
    streamId: "fallback-s1",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  const mockTaskFn = async () => ({ green_tests: ["pass"] });

  const result = await fanOutStreams(cwd, forgeId, mockTaskFn);

  expect(result).toEqual({ mode: "v2-fallback" });
});

// ── Test 7b: fanOutStreams default (no flag) → v3-complete ────────────────

test("fanOutStreams returns {mode:'v3-complete'} when pipelineV3 flag is not set (v3 is the default)", async () => {
  // Do NOT set pipelineV3 flag — forge context is empty by default
  // After the v3-default flip, an unset flag means v3.

  createStream(cwd, forgeId, {
    streamId: "default-s1",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  const mockTaskFn = async () => ({ green_tests: ["pass"] });

  const result = await fanOutStreams(cwd, forgeId, mockTaskFn);

  expect(result).toEqual({ mode: "v3-complete" });
});

// ── Test 8: fanOutStreams flag-on → parallel Task() path ─────────────────

test("fanOutStreams returns {mode:'v3-complete'} when forges.context.pipelineV3 === true", async () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  createStream(cwd, forgeId, {
    streamId: "v3-s1",
    verifierCmd: "true",
    touchesFiles: [],
    acceptanceCriteria: [],
    dependsOn: [],
  });

  const mockTaskFn = async () => ({ green_tests: ["pass"] });

  const result = await fanOutStreams(cwd, forgeId, mockTaskFn);

  expect(result).toEqual({ mode: "v3-complete" });
});

// ── Test 9: SKILL.md PLAN-DRAFT section contains planner agent flag-check ─

test("SKILL.md contains inline-ternary planner agent selection pattern in PLAN-DRAFT section", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  // Walk up from hooks/ to find skills/forge/SKILL.md
  const skillPath = resolve(
    import.meta.dir,
    "../../skills/forge/SKILL.md"
  );

  const content = readFileSync(skillPath, "utf8");

  // Must contain the inline ternary pattern (v3-default flip: explicit false opts to legacy planner)
  expect(content).toContain("ctx?.pipelineV3 === false ? 'planner' : 'planner-v3'");
  // Must also contain the stream cascade flag-check
  expect(content).toContain("fanOutStreams");
});
