/**
 * ADR §9 Q2 — Cross-forge stream sharing detection.
 *
 * detectSharedStreams(cwd) scans all streams and returns groups that are
 * structurally identical (same sorted touches_files + verifier_cmd) across
 * at least 2 distinct forges. Detection only — execution sharing deferred.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createForge,
  createStream,
  detectSharedStreams,
} from "../forge-crud.mjs";

let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "forge-shared-streams-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

test("returns empty list when nothing is shared", () => {
  const a = createForge(cwd, { slug: "a", systems: [] });
  const b = createForge(cwd, { slug: "b", systems: [] });
  createStream(cwd, a, {
    streamId: "s1", verifierCmd: "bun test", touchesFiles: ["a.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  createStream(cwd, b, {
    streamId: "s1", verifierCmd: "bun test", touchesFiles: ["b.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  expect(detectSharedStreams(cwd)).toEqual([]);
});

test("detects cross-forge streams that share the same files + verifier", () => {
  const a = createForge(cwd, { slug: "a", systems: [] });
  const b = createForge(cwd, { slug: "b", systems: [] });
  createStream(cwd, a, {
    streamId: "auth", verifierCmd: "bun test auth",
    touchesFiles: ["src/auth.ts", "src/auth.test.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  createStream(cwd, b, {
    streamId: "auth-rewrite", verifierCmd: "bun test auth",
    touchesFiles: ["src/auth.test.ts", "src/auth.ts"], // different order — must normalize
    acceptanceCriteria: [], dependsOn: [],
  });

  const dupes = detectSharedStreams(cwd);
  expect(dupes.length).toBe(1);
  expect(dupes[0].verifierCmd).toBe("bun test auth");
  expect(dupes[0].touchesFiles).toEqual(["src/auth.test.ts", "src/auth.ts"]); // sorted
  expect(dupes[0].occurrences.length).toBe(2);
  const forgeIds = dupes[0].occurrences.map((o) => o.forgeId).sort();
  expect(forgeIds).toEqual([a, b].map(Number).sort());
});

test("same-forge duplicates are NOT reported (intra-forge is not 'sharing')", () => {
  const a = createForge(cwd, { slug: "a", systems: [] });
  createStream(cwd, a, {
    streamId: "s1", verifierCmd: "bun test", touchesFiles: ["x.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  createStream(cwd, a, {
    streamId: "s2", verifierCmd: "bun test", touchesFiles: ["x.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  expect(detectSharedStreams(cwd)).toEqual([]);
});

test("streams with empty touches_files are excluded (no signal)", () => {
  const a = createForge(cwd, { slug: "a", systems: [] });
  const b = createForge(cwd, { slug: "b", systems: [] });
  createStream(cwd, a, {
    streamId: "s1", verifierCmd: "bun test", touchesFiles: [],
    acceptanceCriteria: [], dependsOn: [],
  });
  createStream(cwd, b, {
    streamId: "s1", verifierCmd: "bun test", touchesFiles: [],
    acceptanceCriteria: [], dependsOn: [],
  });
  expect(detectSharedStreams(cwd)).toEqual([]);
});

test("different verifier_cmd breaks the match even if files identical", () => {
  const a = createForge(cwd, { slug: "a", systems: [] });
  const b = createForge(cwd, { slug: "b", systems: [] });
  createStream(cwd, a, {
    streamId: "s1", verifierCmd: "bun test a", touchesFiles: ["x.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  createStream(cwd, b, {
    streamId: "s1", verifierCmd: "bun test b", touchesFiles: ["x.ts"],
    acceptanceCriteria: [], dependsOn: [],
  });
  expect(detectSharedStreams(cwd)).toEqual([]);
});
