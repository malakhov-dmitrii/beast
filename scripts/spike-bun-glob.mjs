#!/usr/bin/env bun
/**
 * Spike S4 — Bun.Glob API shape confirmation.
 * Plan citation: Task 2.2 depends on Bun.Glob.match(path) existing since Bun ≥1.1.
 * This script is a disposable proof. Exit 0 on success = CONFIRMED.
 */

const g = new Bun.Glob("src/**/*.ts");

const match1 = g.match("src/foo.ts");
const match2 = g.match("other/foo.ts");

if (match1 !== true) {
  console.error(`FAIL: expected 'src/foo.ts' to match 'src/**/*.ts', got ${match1}`);
  process.exit(1);
}
if (match2 !== false) {
  console.error(`FAIL: expected 'other/foo.ts' to NOT match 'src/**/*.ts', got ${match2}`);
  process.exit(1);
}

console.log("S4 CONFIRMED: Bun.Glob(...).match(path) returns boolean; glob semantics match expectation.");
process.exit(0);
