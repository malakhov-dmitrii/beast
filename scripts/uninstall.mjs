#!/usr/bin/env node
/**
 * Forge plugin uninstaller.
 *
 * Removes the hook registrations this installer added to hooks/hooks.json.
 * Does NOT touch .omc/forge.db or ~/.forge/global.db — your data stays put.
 * Safe and idempotent.
 *
 * Flags:
 *   --dry-run   show what would change, write nothing
 *   --verbose   extra diagnostics
 *   --help      this help
 */

import { readFileSync, writeFileSync, existsSync, lstatSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");

const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const COMMAND_FILES = ["forge.md", "forge-setup.md"];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const VERBOSE = args.has("--verbose");

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: bun run scripts/uninstall.mjs [--dry-run] [--verbose]

Removes beast-forge hook registrations from hooks/hooks.json.
Data (forge.db, global.db) is NOT deleted.
`);
  process.exit(0);
}

const log = (...m) => console.log(...m);

const HOOK_COMMAND_PATTERN = /forge-hooks\.mjs\s+(sessionstart|sessionend|precompact)\b/;

if (VERBOSE) console.error(`[verbose] reading ${HOOKS_JSON}`);

if (!existsSync(HOOKS_JSON)) {
  log("Nothing to do — hooks/hooks.json does not exist.");
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(readFileSync(HOOKS_JSON, "utf-8"));
} catch (e) {
  console.error(`ERROR: cannot parse ${HOOKS_JSON}: ${e.message}`);
  process.exit(1);
}

if (!cfg.hooks || typeof cfg.hooks !== "object") {
  log("Nothing to do — no hooks block.");
  process.exit(0);
}

const removed = [];

for (const event of Object.keys(cfg.hooks)) {
  const entries = Array.isArray(cfg.hooks[event]) ? cfg.hooks[event] : [];
  const kept = [];

  for (const entry of entries) {
    const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    const keptHooks = inner.filter(h => {
      const match = h && h.type === "command" && typeof h.command === "string"
        && HOOK_COMMAND_PATTERN.test(h.command);
      if (match) removed.push(`${event} → ${h.command}`);
      return !match;
    });

    if (keptHooks.length === 0 && inner.length > 0) {
      continue;
    }
    kept.push({ ...entry, hooks: keptHooks });
  }

  if (kept.length === 0) {
    delete cfg.hooks[event];
  } else {
    cfg.hooks[event] = kept;
  }
}

if (removed.length === 0) {
  log("No forge hook registrations found — nothing to remove.");
  process.exit(0);
}

if (DRY_RUN) {
  log("Would remove:");
  for (const r of removed) log(`  - ${r}`);
  log("(dry-run — hooks.json unchanged)");
  process.exit(0);
}

writeFileSync(HOOKS_JSON, JSON.stringify(cfg, null, 2) + "\n");

log("Removed:");
for (const r of removed) log(`  - ${r}`);

// Remove slash-command symlinks
for (const file of COMMAND_FILES) {
  const dst = join(COMMANDS_DIR, file);
  try {
    const stat = lstatSync(dst);
    if (stat.isSymbolicLink()) {
      if (!DRY_RUN) unlinkSync(dst);
      log(`  - symlink ${dst}${DRY_RUN ? " (dry-run)" : ""}`);
    }
  } catch { /* not present, skip */ }
}

log("");
log("Done. Data preserved:");
log("  • .omc/forge.db  (per project — delete manually if unwanted)");
log("  • ~/.forge/global.db  (cross-project)");
