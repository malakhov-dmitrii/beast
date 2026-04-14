/**
 * Task 3.4 — Stream starvation cutoff
 * 4 tests. RED phase: all fail before implementation.
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
} from "../forge-crud.mjs";
import { checkStarvation, fanOutStreams } from "../stream-planner.mjs";

let cwd;
let forgeId;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-starvation-"));
  forgeId = createForge(cwd, { slug: `starvation-test-${Date.now()}`, systems: ["test"] });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Test 1: check skipped when fewer than 3 streams completed ────────────────

test("checkStarvation returns null when fewer than 3 wall-clock samples provided", () => {
  // Only 2 completed streams — sample too small to be reliable
  const wallClocks = [
    { stream_id: "s1", wall_ms: 400_000 }, // 6.6 min
    { stream_id: "s2", wall_ms: 100_000 }, // 1.6 min
  ];
  const result = checkStarvation(wallClocks);
  expect(result).toBeNull();
});

// ── Test 2: no starvation when all streams finish within 3× median ───────────

test("checkStarvation returns null when all streams complete within 3× median", () => {
  // median = 360_000, 3× = 1_080_000; max = 600_000 — no starvation
  const wallClocks = [
    { stream_id: "s1", wall_ms: 300_000 }, // 5 min
    { stream_id: "s2", wall_ms: 360_000 }, // 6 min
    { stream_id: "s3", wall_ms: 600_000 }, // 10 min  (< 3× median = 1080s)
  ];
  const result = checkStarvation(wallClocks);
  expect(result).toBeNull();
});

// ── Test 3: starvation flagged when slow > 3× median AND median > 5 min ──────

test("checkStarvation returns detection shape when one stream exceeds 3× median and median > 5 min", () => {
  // median of [360_000, 380_000, 400_000] = 380_000 (~6.3 min > 5 min)
  // slow stream: 1_200_000 (20 min) = 3.16× median — triggers starvation
  const wallClocks = [
    { stream_id: "s1", wall_ms: 360_000 },
    { stream_id: "s2", wall_ms: 380_000 },
    { stream_id: "s3", wall_ms: 400_000 },
    { stream_id: "slow", wall_ms: 1_200_000 },
  ];
  const result = checkStarvation(wallClocks);
  expect(result).not.toBeNull();
  expect(result.slow_stream_id).toBe("slow");
  expect(result.median_ms).toBe(390_000); // median of 4 values = (380+400)/2
  expect(result.slow_ms).toBe(1_200_000);
  expect(result.recommendation).toBe("skeptic-review-and-split");
});

// ── Test 4: starvation writes forges.context.starvation_alert during fanOutStreams ──

test("fanOutStreams writes context.starvation_alert when starvation detected", async () => {
  setForgeContext(cwd, forgeId, "pipelineV3", true);

  // Create 4 streams: 3 fast (each ~320s = 5.3 min median) + 1 slow (>3× median)
  const FIVE_MIN = 5 * 60 * 1000; // 300_000 ms — just over median threshold
  const streamIds = ["fast-1", "fast-2", "fast-3", "slow-stream"];
  for (const sid of streamIds) {
    createStream(cwd, forgeId, {
      streamId: sid,
      verifierCmd: "true",
      touchesFiles: [],
      acceptanceCriteria: [],
      dependsOn: [],
    });
  }

  // Mock taskFn: fast streams take 320s simulated, slow stream takes 1100s simulated.
  // We override Date.now progression by providing fake wall-clock via the
  // stream_id naming convention — the implementation reads actual elapsed time,
  // so we inject synthetic durations via the fakeClock option.
  const taskDurations = {
    "fast-1":    320_000,
    "fast-2":    340_000,
    "fast-3":    360_000,
    "slow-stream": 1_200_000,
  };

  const mockTaskFn = async (row) => {
    // Signal the synthetic wall-clock to fanOutStreams via a special return key
    return { green_tests: ["pass"], _synthetic_wall_ms: taskDurations[row.stream_id] };
  };

  await fanOutStreams(cwd, forgeId, mockTaskFn);

  const ctx = getForgeContext(cwd, forgeId);
  expect(ctx.starvation_alert).toBeDefined();
  expect(ctx.starvation_alert.slow_stream_id).toBe("slow-stream");
  expect(ctx.starvation_alert.recommendation).toBe("skeptic-review-and-split");
});
