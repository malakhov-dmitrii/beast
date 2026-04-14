import { test, expect } from "bun:test";
import { overlapMatrix } from "../stream-planner.mjs";

// Test 1: no overlap when touches_files are disjoint
test("overlapMatrix returns empty array when streams have disjoint files", () => {
  const streams = [
    { id: "A", touches_files: ["src/alpha.ts"], depends_on: [] },
    { id: "B", touches_files: ["src/beta.ts"], depends_on: [] },
  ];
  expect(overlapMatrix(streams)).toEqual([]);
});

// Test 2: detects overlap when two streams touch the exact same path
test("overlapMatrix detects overlap when two streams touch the same literal path", () => {
  const streams = [
    { id: "A", touches_files: ["src/shared.ts"], depends_on: [] },
    { id: "B", touches_files: ["src/shared.ts"], depends_on: [] },
  ];
  const result = overlapMatrix(streams);
  expect(result).toHaveLength(1);
  expect(result[0].a).toBe("A");
  expect(result[0].b).toBe("B");
  expect(result[0].files).toContain("src/shared.ts");
});

// Test 3: detects overlap when stream A uses a glob matching stream B's literal path
test("overlapMatrix detects overlap when a glob matches a literal path", () => {
  const streams = [
    { id: "A", touches_files: ["src/**/*.ts"], depends_on: [] },
    { id: "B", touches_files: ["src/foo/bar.ts"], depends_on: [] },
  ];
  const result = overlapMatrix(streams);
  expect(result).toHaveLength(1);
  expect(result[0].a).toBe("A");
  expect(result[0].b).toBe("B");
  expect(result[0].files.length).toBeGreaterThan(0);
});

// Test 4: detects overlap when both streams use overlapping globs
test("overlapMatrix detects overlap when overlapping globs share a common expansion", () => {
  const streams = [
    { id: "A", touches_files: ["src/**"], depends_on: [] },
    { id: "B", touches_files: ["src/foo/*"], depends_on: [] },
  ];
  const result = overlapMatrix(streams);
  // src/foo/* is a subset of src/**, so they overlap
  expect(result).toHaveLength(1);
  expect(result[0].a).toBe("A");
  expect(result[0].b).toBe("B");
});

// Test 5: dependency exemption — if B depends_on A, their overlap is NOT flagged
test("overlapMatrix ignores overlap when B depends_on A", () => {
  const streams = [
    { id: "A", touches_files: ["src/shared.ts"], depends_on: [] },
    { id: "B", touches_files: ["src/shared.ts"], depends_on: ["A"] },
  ];
  expect(overlapMatrix(streams)).toEqual([]);
});

// Test 6: empty touches_files means no overlap
test("overlapMatrix handles empty touches_files as no overlap", () => {
  const streams = [
    { id: "A", touches_files: [], depends_on: [] },
    { id: "B", touches_files: ["src/foo.ts"], depends_on: [] },
  ];
  expect(overlapMatrix(streams)).toEqual([]);
});

// Test 7: pair shape { a, b, files }
test("overlapMatrix returns pair shape { a: streamId, b: streamId, files: [matched paths] }", () => {
  const streams = [
    { id: "X", touches_files: ["lib/util.ts", "lib/helper.ts"], depends_on: [] },
    { id: "Y", touches_files: ["lib/util.ts"], depends_on: [] },
  ];
  const result = overlapMatrix(streams);
  expect(result).toHaveLength(1);
  const pair = result[0];
  expect(pair).toHaveProperty("a");
  expect(pair).toHaveProperty("b");
  expect(pair).toHaveProperty("files");
  expect(Array.isArray(pair.files)).toBe(true);
  expect(pair.files).toContain("lib/util.ts");
});
