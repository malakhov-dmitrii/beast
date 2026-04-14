/**
 * Tests for detectImportDeps — Task 2.3
 * Verifies JS/TS import graph parsing without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectImportDeps } from "../stream-planner.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-imports-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write a file inside tmpDir and return its absolute path.
 */
function writeFile(rel, content) {
  const abs = join(tmpDir, rel);
  const dir = abs.split("/").slice(0, -1).join("/");
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe("detectImportDeps", () => {
  it("1. finds static import x from 'path' and returns resolved path", () => {
    const dep = writeFile("utils.ts", "export const x = 1;");
    const main = writeFile("main.ts", `import x from "./utils";`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(dep);
  });

  it("2. detects dynamic import('path')", () => {
    const dep = writeFile("lazy.ts", "export default {}");
    const main = writeFile("loader.ts", `const m = await import("./lazy");`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(dep);
  });

  it("3. detects require('path') CommonJS", () => {
    const dep = writeFile("lib.js", "module.exports = {};");
    const main = writeFile("consumer.js", `const lib = require("./lib");`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(dep);
  });

  it("4. detects export * from 'path' re-export", () => {
    const dep = writeFile("models.ts", "export const M = 1;");
    const main = writeFile("index.ts", `export * from "./models";`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(dep);
  });

  it("5. detects export { x } from 'path' named re-export", () => {
    const dep = writeFile("helpers.ts", "export const h = () => {};");
    const main = writeFile("barrel.ts", `export { h } from "./helpers";`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(dep);
  });

  it("6. barrel file: importing from lib/ resolves to lib/index.ts if it exists", () => {
    // Create lib/index.ts (barrel)
    writeFile("lib/index.ts", `export * from "./core";`);
    writeFile("lib/core.ts", "export const c = 1;");
    const main = writeFile("app.ts", `import { c } from "./lib";`);
    const barrelPath = join(tmpDir, "lib/index.ts");

    const result = detectImportDeps([main], tmpDir);
    expect(result).toContain(barrelPath);
  });

  it("7. returns empty array when no imports found", () => {
    const main = writeFile("pure.ts", `const x = 1; export { x };`);

    const result = detectImportDeps([main], tmpDir);
    expect(result).toEqual([]);
  });
});
