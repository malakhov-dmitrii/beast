#!/usr/bin/env node
/**
 * Forge plugin installer.
 *
 * Idempotent setup for beast-forge:
 *   1. Register SessionStart + SessionEnd + PreCompact hooks in hooks/hooks.json
 *   2. Initialize global ~/.forge/global.db (via forge-global.mjs, needs bun)
 *
 * Project-scoped .omc/forge.db is NOT created here — it's lazy per project,
 * materialized on first /forge run. Hooks skip silently when it's absent.
 *
 * Safe to re-run — merges hook registrations, skips up-to-date DB.
 *
 * Runs under node or bun. Spawns `bun` for the global DB because
 * forge-global.mjs uses bun:sqlite.
 *
 * Flags:
 *   --dry-run   show planned actions, change nothing
 *   --verbose   print extra diagnostics
 *   --no-db     skip DB init (hooks.json only)
 *   --help      this help
 *
 * Exit 0 on success (including "already set up"), non-zero on real failure.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");
const FORGE_HOOKS_MJS = join(PLUGIN_ROOT, "hooks", "forge-hooks.mjs");
const FORGE_GLOBAL_MJS = join(PLUGIN_ROOT, "hooks", "forge-global.mjs");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const VERBOSE = args.has("--verbose");
const SKIP_DB = args.has("--no-db");

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: bun run scripts/install.mjs [--dry-run] [--verbose] [--no-db]

Installs beast-forge plugin into its own hooks.json and (optionally) initializes
forge.db / global.db. Idempotent.

  --dry-run   Report planned changes, write nothing.
  --verbose   Extra diagnostics.
  --no-db     Skip DB initialization (hook wiring only).
`);
  process.exit(0);
}

const log = (...m) => console.log(...m);
const vlog = (...m) => { if (VERBOSE) console.error("[verbose]", ...m); };

let failures = 0;
const changes = [];
const skipped = [];

// ── 1. hooks/hooks.json ────────────────────────────────────

const HOOK_COMMAND_PREFIX = "bun ${CLAUDE_PLUGIN_ROOT}/hooks/forge-hooks.mjs";

const DESIRED_HOOKS = {
  SessionStart: { matcher: "", cmd: `${HOOK_COMMAND_PREFIX} sessionstart` },
  SessionEnd:   { matcher: "", cmd: `${HOOK_COMMAND_PREFIX} sessionend` },
  PreCompact:   { matcher: "", cmd: `${HOOK_COMMAND_PREFIX} precompact` },
};

function loadHooksJson() {
  if (!existsSync(HOOKS_JSON)) {
    return { description: "Beast-forge plugin hooks.", hooks: {} };
  }
  try {
    const raw = readFileSync(HOOKS_JSON, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.hooks || typeof parsed.hooks !== "object") parsed.hooks = {};
    return parsed;
  } catch (e) {
    throw new Error(`Cannot parse ${HOOKS_JSON}: ${e.message}`);
  }
}

function hasRegistration(eventEntries, cmd) {
  if (!Array.isArray(eventEntries)) return false;
  for (const entry of eventEntries) {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    for (const h of inner) {
      if (h && h.type === "command" && h.command === cmd) return true;
    }
  }
  return false;
}

function ensureHook(cfg, event, { matcher, cmd }) {
  if (!Array.isArray(cfg.hooks[event])) cfg.hooks[event] = [];
  if (hasRegistration(cfg.hooks[event], cmd)) {
    skipped.push(`hook ${event} already registered`);
    return false;
  }
  cfg.hooks[event].push({
    matcher,
    hooks: [{ type: "command", command: cmd }],
  });
  changes.push(`hook ${event} → forge-hooks.mjs`);
  return true;
}

function writeHooks() {
  if (!existsSync(FORGE_HOOKS_MJS)) {
    failures++;
    console.error(`ERROR: ${FORGE_HOOKS_MJS} missing — plugin checkout incomplete`);
    return;
  }

  const cfg = loadHooksJson();
  let mutated = false;
  for (const [event, spec] of Object.entries(DESIRED_HOOKS)) {
    if (ensureHook(cfg, event, spec)) mutated = true;
  }

  if (!mutated) {
    vlog("hooks.json already has all registrations");
    return;
  }

  const serialized = JSON.stringify(cfg, null, 2) + "\n";
  if (DRY_RUN) {
    vlog("dry-run — skipping write to hooks.json");
    vlog(serialized);
    return;
  }
  writeFileSync(HOOKS_JSON, serialized);
  vlog(`wrote ${HOOKS_JSON}`);
}

// ── 2. DB init via bun ─────────────────────────────────────

function hasBun() {
  const r = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function initGlobalDb() {
  if (!existsSync(FORGE_GLOBAL_MJS)) {
    skipped.push("global.db (forge-global.mjs absent)");
    return;
  }
  const dbPath = join(homedir(), ".forge", "global.db");
  const existedBefore = existsSync(dbPath);

  const script = `
    import { openGlobalDb } from "${FORGE_GLOBAL_MJS.replace(/"/g, '\\"')}";
    const db = openGlobalDb();
    const v = db.query("PRAGMA user_version").get().user_version;
    db.close();
    console.log(JSON.stringify({ version: v }));
  `.trim();

  if (DRY_RUN) {
    changes.push(existedBefore
      ? "db: global.db (verify — dry-run)"
      : "db: global.db (create — dry-run)");
    return;
  }
  const r = spawnSync("bun", ["-e", script], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    failures++;
    console.error(`ERROR: global.db init failed (bun exit ${r.status})`);
    if (r.stderr) console.error(r.stderr.trim());
    return;
  }
  if (VERBOSE && r.stdout) process.stderr.write(`[verbose] global.db: ${r.stdout}`);
  if (existedBefore) {
    skipped.push("global.db (already present, migrations verified)");
  } else {
    changes.push("db: global.db (created)");
  }
}

function ensureGlobalDir() {
  const d = join(homedir(), ".forge");
  if (existsSync(d)) return;
  if (DRY_RUN) { changes.push(`mkdir ${d}`); return; }
  mkdirSync(d, { recursive: true });
  changes.push(`mkdir ${d}`);
}

// ── main ───────────────────────────────────────────────────

log(`Forge installer ${DRY_RUN ? "(dry-run)" : ""}`);
log(`Plugin root: ${PLUGIN_ROOT}`);

writeHooks();

if (SKIP_DB) {
  skipped.push("DB init (--no-db)");
} else if (!hasBun()) {
  failures++;
  console.error("ERROR: `bun` not found on PATH. Install bun.sh or re-run with --no-db.");
} else {
  ensureGlobalDir();
  initGlobalDb();
}

log("");
if (changes.length) {
  log("Changes:");
  for (const c of changes) log(`  + ${c}`);
} else {
  log("No changes (already installed).");
}
if (skipped.length && VERBOSE) {
  log("Skipped:");
  for (const s of skipped) log(`  - ${s}`);
}

if (failures) {
  log("");
  log(`FAILED with ${failures} error(s).`);
  process.exit(1);
}

log("");
log("Done. Next steps:");
log("  • Restart Claude Code or start a new session to activate hooks");
log("  • Run `/forge \"your task\"` to start the pipeline");
log("  • Re-run this installer any time — it is idempotent");
