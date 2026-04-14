/**
 * stream-planner.mjs — overlap detection + parallel stream execution for pipeline-v3.
 * ADR §7: planner-v3 rejects its own plan when two streams touch overlapping files.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import {
  getForgeContext,
  listStreams,
  updateStreamStatus,
  setTddEvidence,
  blockForge,
  setForgeContext,
} from "./forge-crud.mjs";

/**
 * Returns true if pathsA and pathsB share at least one overlapping path,
 * treating each entry as either a literal path or a Bun.Glob pattern.
 * Also populates `matched` with the paths that caused the overlap.
 *
 * @param {string[]} pathsA
 * @param {string[]} pathsB
 * @param {string[]} matched — output array, populated with overlapping paths
 * @returns {boolean}
 */
function patternsOverlap(pathsA, pathsB, matched) {
  for (const a of pathsA) {
    const globA = new Bun.Glob(a);
    for (const b of pathsB) {
      const globB = new Bun.Glob(b);
      // An overlap exists if:
      //   a (as glob) matches b (as literal path), OR
      //   b (as glob) matches a (as literal path)
      if (globA.match(b) || globB.match(a)) {
        matched.push(b);
      }
    }
  }
  return matched.length > 0;
}

/**
 * Compute file-overlap matrix for a list of streams.
 *
 * A pair (A, B) is flagged when:
 *   - their touches_files arrays intersect (via glob matching), AND
 *   - B does not depend_on A and A does not depend_on B
 *     (declared dependencies make overlap parallel-safe by construction).
 *
 * @param {Array<{ id: string, touches_files: string[], depends_on: string[] }>} streams
 * @returns {Array<{ a: string, b: string, files: string[] }>}
 */
export function overlapMatrix(streams) {
  const pairs = [];

  for (let i = 0; i < streams.length; i++) {
    for (let j = i + 1; j < streams.length; j++) {
      const sA = streams[i];
      const sB = streams[j];

      // Skip if either has no files — nothing to overlap
      if (!sA.touches_files.length || !sB.touches_files.length) continue;

      // Skip if dependency relationship exists (parallel-safe by construction)
      const bDependsOnA = (sB.depends_on ?? []).includes(sA.id);
      const aDependsOnB = (sA.depends_on ?? []).includes(sB.id);
      if (bDependsOnA || aDependsOnB) continue;

      const matched = [];
      if (patternsOverlap(sA.touches_files, sB.touches_files, matched)) {
        pairs.push({ a: sA.id, b: sB.id, files: matched });
      }
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Import graph dependency detection — Task 2.3
// ---------------------------------------------------------------------------

/**
 * Regex patterns capturing the specifier (group 1) for each import shape.
 * Using functions so lastIndex resets are safe across multiple calls.
 */
const IMPORT_PATTERN_SOURCES = [
  // static: import x from "path"  /  import "path"
  /\bimport\s+(?:[^"'(][^"'(]*\s+from\s+)?["']([^"']+)["']/g,
  // dynamic: import("path")
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  // CommonJS: require("path")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  // re-exports: export * from "path"  /  export { x } from "path"
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
];

const EXTENSIONS = [".ts", ".mjs", ".js"];
const BARREL_NAMES = ["index.ts", "index.js", "index.mjs"];

/**
 * Resolve a relative specifier from a given source file to an existing path on disk.
 * Returns null for node_modules (non-relative) specifiers or when nothing found.
 *
 * Resolution order:
 *   1. base path as-is (specifier already has extension and file exists)
 *   2. base + .ts / .mjs / .js
 *   3. base/index.ts / base/index.js / base/index.mjs  (barrel)
 *
 * @param {string} specifier
 * @param {string} fromFile — absolute path of the importing file
 * @returns {string|null}
 */
function resolveSpecifier(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;

  const base = resolve(dirname(fromFile), specifier);

  // 1. Exact path (has explicit extension and is a file)
  if (existsSync(base)) {
    try {
      if (!statSync(base).isDirectory()) return base;
    } catch {
      return null;
    }
  }

  // 2. Append known extensions
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  // 3. Barrel resolution
  for (const barrel of BARREL_NAMES) {
    const candidate = resolve(base, barrel);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Parse a list of source files for import/require/export-from statements and
 * return the deduplicated set of resolved dependency file paths.
 *
 * Only relative specifiers are resolved (node_modules are ignored).
 *
 * @param {string[]} touchesFiles — absolute paths to source files to scan
 * @param {string} _root — repo root (reserved for future traversal, unused now)
 * @returns {string[]} — deduplicated list of resolved absolute dependency paths
 */
export function detectImportDeps(touchesFiles, _root) {
  const deps = new Set();

  for (const file of touchesFiles) {
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const pattern of IMPORT_PATTERN_SOURCES) {
      // Clone so we reset lastIndex independently per file
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(src)) !== null) {
        const specifier = match[1];
        const resolved = resolveSpecifier(specifier, file);
        if (resolved) deps.add(resolved);
      }
    }
  }

  return [...deps];
}

// ---------------------------------------------------------------------------
// Topological layer helper — Task 2.5 REFACTOR target
// ---------------------------------------------------------------------------

/**
 * Group streams into ordered layers where each layer's streams may run in
 * parallel. Layer N+1 starts only after all streams in layer N are complete.
 *
 * @param {Array<{stream_id: string, depends_on: string}>} streams
 *   depends_on is a JSON-encoded string array from the DB row.
 * @returns {Array<Array<{stream_id: string, ...}>>} — ordered layers
 */
export function topologicalLayers(streams) {
  // Parse depends_on from DB JSON strings if needed
  const parsed = streams.map(s => ({
    ...s,
    _deps: typeof s.depends_on === "string" ? JSON.parse(s.depends_on) : (s.depends_on ?? []),
  }));

  const completed = new Set();
  const layers = [];
  let remaining = [...parsed];

  while (remaining.length > 0) {
    // A stream is ready if all its deps are in the completed set
    const ready = remaining.filter(s => s._deps.every(dep => completed.has(dep)));
    if (ready.length === 0) {
      // Cycle or missing dep — add all remaining in one layer to avoid infinite loop
      layers.push(remaining);
      break;
    }
    layers.push(ready);
    for (const s of ready) completed.add(s.stream_id);
    remaining = remaining.filter(s => !completed.has(s.stream_id));
  }

  return layers;
}

// ---------------------------------------------------------------------------
// executeStream — Task 2.5
// ---------------------------------------------------------------------------

/**
 * Execute a single stream via an injected taskFn, then run its verifier_cmd.
 * On verifier exit 0 + non-empty green_tests: persist tdd_evidence + set status=green.
 * On verifier exit non-0: increment retries, status=failed; at 3 retries block the forge.
 *
 * @param {string} cwd
 * @param {number} forgeId
 * @param {object} streamRow  — raw DB row (id, stream_id, verifier_cmd, retries, …)
 * @param {Function} taskFn   — async (row) => { green_tests, refactor_notes? }
 */
export async function executeStream(cwd, forgeId, streamRow, taskFn) {
  const rowId = streamRow.id;

  // ── Branch: tdd_required_disabled short-circuit (iter-8) ──────────────────
  // When the forge-level kill-switch is set, skip verifier_cmd entirely.
  // Mark the stream green immediately after Task() completes and record audit
  // evidence so reviewers know TDD was intentionally bypassed.
  const ctx = getForgeContext(cwd, forgeId);
  if (ctx?.tdd_required_disabled === true) {
    await taskFn(streamRow);
    setTddEvidence(cwd, rowId, { skipped: true, reason: "tdd_required_disabled" });
    updateStreamStatus(cwd, rowId, "green", new Date().toISOString());
    return;
  }

  // ── Invoke the task (implementation step) ─────────────────────────────────
  // Catch Task() throttle errors (infra failure) separately from verifier
  // failures (code failure) — throttle must NOT burn the retry budget.
  let result;
  try {
    result = await taskFn(streamRow);
  } catch (err) {
    const isThrottle =
      (err?.code === "TRIGGER_THROTTLED") ||
      /TRIGGER_THROTTLED|throttle/i.test(err?.message ?? "");

    if (isThrottle) {
      // Infra failure: reset stream to pending so the scheduler can re-pick it.
      // Do NOT increment retries.
      console.log(`[executeStream] infra-throttle on stream ${streamRow.stream_id} — resetting to pending (retries unchanged)`);
      updateStreamStatus(cwd, rowId, "pending");
      return;
    }
    // Non-throttle task error: re-throw so fanOutStreams can surface it.
    throw err;
  }

  // ── Run verifier command ───────────────────────────────────────────────────
  const verifierCmd = streamRow.verifier_cmd ?? "true";
  // Use shell so simple commands like "true" and "false" resolve correctly.
  const proc = Bun.spawn(["sh", "-c", verifierCmd], {
    stderr: "inherit", // project CLAUDE.md gotcha: never "pipe" — deadlocks at 64KB
    stdout: "inherit",
  });
  const exitCode = await proc.exited;

  const greenTests = result?.green_tests ?? [];

  if (exitCode === 0) {
    // ── Gate: green_tests must be non-empty ─────────────────────────────────
    if (greenTests.length === 0) {
      console.warn(`[executeStream] stream ${streamRow.stream_id}: verifier exit 0 but green_tests empty — resetting to pending`);
      updateStreamStatus(cwd, rowId, "pending");
      return;
    }

    // ── Gate: green_tests must be superset of red_tests ─────────────────────
    let redTests = [];
    try {
      redTests = JSON.parse(streamRow.red_tests ?? "[]");
    } catch {
      redTests = [];
    }
    if (redTests.length > 0) {
      const greenSet = new Set(greenTests);
      const missing = redTests.filter(t => !greenSet.has(t));
      if (missing.length > 0) {
        console.warn(
          `[executeStream] stream ${streamRow.stream_id}: green_tests not superset of red_tests — missing: ${missing.join(", ")} — resetting to pending`
        );
        updateStreamStatus(cwd, rowId, "pending");
        return;
      }
    }

    // All gates passed — persist evidence and mark green.
    setTddEvidence(cwd, rowId, {
      green_tests: greenTests,
      refactor_notes: result?.refactor_notes ?? "",
    });
    updateStreamStatus(cwd, rowId, "green", new Date().toISOString());
  } else {
    // ── Verifier non-zero exit: increment retries, status=failed ────────────
    // Read current retries from DB (streamRow may be stale).
    const rows = listStreams(cwd, forgeId);
    const current = rows.find(r => r.id === rowId);
    const newRetries = (current?.retries ?? 0) + 1;

    const { openForgeDb } = await import("./forge-schema.mjs");
    const db = openForgeDb(cwd);
    try {
      db.run(`UPDATE streams SET retries = ?, status = 'failed' WHERE id = ?`, [newRetries, rowId]);
    } finally {
      db.close();
    }

    // ADR §4: "up to 2 retries" = 3 total attempts before block.
    if (newRetries >= 3) {
      blockForge(cwd, forgeId, `stream ${streamRow.stream_id} failed ${newRetries} total attempts`);
    }
  }
}

// ---------------------------------------------------------------------------
// checkStarvation — Task 3.4
// ---------------------------------------------------------------------------

/**
 * ADR §7 starvation clause: if the slowest stream's wall-clock time > 3× median
 * AND median > 5 minutes, return a detection shape. Skip if <3 samples (unreliable).
 *
 * @param {Array<{ stream_id: string, wall_ms: number }>} wallClocks
 * @returns {{ slow_stream_id: string, median_ms: number, slow_ms: number, recommendation: string } | null}
 */
export function checkStarvation(wallClocks) {
  if (wallClocks.length < 3) return null;

  const sorted = [...wallClocks].sort((a, b) => a.wall_ms - b.wall_ms);
  const n = sorted.length;
  const median =
    n % 2 === 1
      ? sorted[Math.floor(n / 2)].wall_ms
      : (sorted[n / 2 - 1].wall_ms + sorted[n / 2].wall_ms) / 2;

  const FIVE_MIN_MS = 5 * 60 * 1000;
  if (median <= FIVE_MIN_MS) return null;

  const slowest = sorted[n - 1];
  if (slowest.wall_ms <= 3 * median) return null;

  return {
    slow_stream_id: slowest.stream_id,
    median_ms: median,
    slow_ms: slowest.wall_ms,
    recommendation: "skeptic-review-and-split",
  };
}

// ---------------------------------------------------------------------------
// fanOutStreams — Task 2.5
// ---------------------------------------------------------------------------

/**
 * Fan out all streams for a forge in topological order with a concurrency cap.
 *
 * Feature-flag gated: reads forges.context.pipelineV3. v3 is now the DEFAULT.
 *   - explicit false → returns { mode: "v2-fallback" } immediately (opt-out).
 *   - true / missing / undefined → runs parallel cascade, returns { mode: "v3-complete" }.
 *
 * @param {string} cwd
 * @param {number} forgeId
 * @param {Function} taskFn  — async (streamRow) => { green_tests, … }
 * @param {{ concurrencyCap?: number }} opts
 * @returns {Promise<{ mode: "v2-fallback" | "v3-complete" }>}
 */
export async function fanOutStreams(cwd, forgeId, taskFn, { concurrencyCap = 5 } = {}) {
  const ctx = getForgeContext(cwd, forgeId);
  if (ctx?.pipelineV3 === false) {
    return { mode: "v2-fallback" };
  }

  const streams = listStreams(cwd, forgeId);
  const layers = topologicalLayers(streams);

  // ADR §7: track wall-clock times across all layers for starvation detection
  const wallClocks = [];

  for (const layer of layers) {
    // Semaphore: at most concurrencyCap concurrent tasks per layer
    let active = 0;
    let idx = 0;
    const results = [];

    await new Promise((resolve, reject) => {
      function next() {
        while (active < concurrencyCap && idx < layer.length) {
          const row = layer[idx++];
          active++;
          const startMs = Date.now();
          // Wrap taskFn to capture wall-clock and synthetic override
          const timedTaskFn = async (r) => {
            const result = await taskFn(r);
            const elapsed = result?._synthetic_wall_ms ?? (Date.now() - startMs);
            wallClocks.push({ stream_id: r.stream_id, wall_ms: elapsed });

            // ADR §7: starvation check after each completion (min 3 samples)
            const alert = checkStarvation(wallClocks);
            if (alert) {
              console.warn(
                `[fanOutStreams] starvation detected: stream "${alert.slow_stream_id}" ` +
                `took ${alert.slow_ms}ms vs median ${alert.median_ms}ms — recommend split`
              );
              // setForgeContext only handles scalars; store object as JSON string via direct DB update
              const { openForgeDb } = await import("./forge-schema.mjs");
              const _db = openForgeDb(cwd);
              try {
                _db.run(
                  `UPDATE forges SET context = json_set(COALESCE(context,'{}'), '$.starvation_alert', json(?)), updated_at = datetime('now') WHERE id = ?`,
                  [JSON.stringify(alert), forgeId]
                );
              } finally {
                _db.close();
              }
            }

            return result;
          };
          executeStream(cwd, forgeId, row, timedTaskFn)
            .then(() => {
              active--;
              results.push(null);
              if (results.length === layer.length) {
                resolve();
              } else {
                next();
              }
            })
            .catch(err => {
              reject(err);
            });
        }
      }
      next();
    });
  }

  return { mode: "v3-complete" };
}
