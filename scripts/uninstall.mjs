#!/usr/bin/env node
/**
 * Forge plugin uninstaller.
 *
 * Reverses what install.mjs does:
 *   1. Remove forge hook entries from hooks/hooks.json
 *   2. Remove our symlinks from ~/.claude/commands/ (only those pointing to plugin/)
 *   3. Remove our symlinks from ~/.claude/skills/   (only those pointing to plugin/)
 *   4. Remove forge hook entries from ~/.claude/settings.json
 *
 * Does NOT touch .omc/forge.db or ~/.forge/global.db — your data stays put.
 * Safe and idempotent. Never touches files/dirs the installer didn't create.
 *
 * Flags:
 *   --dry-run   show what would change, write nothing
 *   --verbose   extra diagnostics
 *   --help      this help
 */

import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, lstatSync, readlinkSync, unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");
const PLUGIN_COMMANDS_DIR = join(PLUGIN_ROOT, "commands");
const PLUGIN_SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const FORGE_HOOKS_ABS = join(PLUGIN_ROOT, "hooks", "forge-hooks.mjs");

const CLAUDE_COMMANDS_DIR = join(homedir(), ".claude", "commands");
const CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const VERBOSE = args.has("--verbose");

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: bun run scripts/uninstall.mjs [--dry-run] [--verbose]

Removes everything install.mjs added:
  - forge hook entries in plugin's hooks/hooks.json
  - ~/.claude/commands/*.md  symlinks pointing to this plugin
  - ~/.claude/skills/<name>  symlinks pointing to this plugin
  - forge hook entries in ~/.claude/settings.json

Data (forge.db, global.db) is NOT deleted.
`);
  process.exit(0);
}

const log = (...m) => console.log(...m);
const vlog = (...m) => { if (VERBOSE) console.error("[verbose]", ...m); };

const removed = [];
let failures = 0;

// ── 1. Plugin-local hooks/hooks.json ──────────────────────

const FORGE_ACTIONS = ["sessionstart", "sessionend", "precompact"];
const LOCAL_HOOK_COMMANDS = new Set(
  FORGE_ACTIONS.map(action => `bun \${CLAUDE_PLUGIN_ROOT}/hooks/forge-hooks.mjs ${action}`)
);
const GLOBAL_HOOK_COMMANDS = new Set([
  ...FORGE_ACTIONS.map(action => `bun "${FORGE_HOOKS_ABS}" ${action}`),
  ...FORGE_ACTIONS.map(action => `bun ${FORGE_HOOKS_ABS} ${action}`),
]);

function isPluginOwnedHookCommand(cmd) {
  return LOCAL_HOOK_COMMANDS.has(cmd) || GLOBAL_HOOK_COMMANDS.has(cmd);
}

function isGlobalHookCommand(cmd) {
  return GLOBAL_HOOK_COMMANDS.has(cmd);
}

function resolveLinkTarget(parentDir, target) {
  if (typeof target !== "string" || target.length === 0) return null;
  return resolve(parentDir, target);
}

function isPathWithin(targetPath, baseDir) {
  const targetAbs = resolve(targetPath);
  const baseAbs = resolve(baseDir);
  const rel = relative(baseAbs, targetAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function cleanPluginHooksJson() {
  if (!existsSync(HOOKS_JSON)) {
    vlog("hooks/hooks.json does not exist — skipping");
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(readFileSync(HOOKS_JSON, "utf-8"));
  } catch (e) {
    failures++;
    console.error(`ERROR: cannot parse ${HOOKS_JSON}: ${e.message}`);
    return;
  }

  if (!cfg.hooks || typeof cfg.hooks !== "object") {
    vlog("hooks.json has no hooks block");
    return;
  }

  let mutated = false;

  for (const event of Object.keys(cfg.hooks)) {
    const entries = Array.isArray(cfg.hooks[event]) ? cfg.hooks[event] : [];
    const kept = [];

    for (const entry of entries) {
      const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
      const keptHooks = inner.filter(h => {
        const match = h && h.type === "command" && typeof h.command === "string"
          && isPluginOwnedHookCommand(h.command);
        if (match) {
          removed.push(`hooks.json ${event} → ${h.command}`);
          mutated = true;
        }
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

  if (!mutated) return;
  if (DRY_RUN) { vlog("dry-run — skipping write to hooks.json"); return; }
  writeFileSync(HOOKS_JSON, JSON.stringify(cfg, null, 2) + "\n");
  vlog(`wrote ${HOOKS_JSON}`);
}

// ── 2. Symlinks in ~/.claude/commands/ ────────────────────

function removeOurSymlinks(dir, pluginDir, label) {
  if (!existsSync(dir)) {
    vlog(`${dir} does not exist — nothing to remove`);
    return;
  }

  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    failures++;
    console.error(`ERROR: cannot read ${dir}: ${e.message}`);
    return;
  }

  for (const name of entries) {
    const path = join(dir, name);

    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (!stat.isSymbolicLink()) {
      vlog(`${label} ${name}: not a symlink, leaving alone`);
      continue;
    }

    let targetRaw;
    let targetAbs;
    try {
      targetRaw = readlinkSync(path);
      targetAbs = resolveLinkTarget(dir, targetRaw);
    } catch {
      continue;
    }

    // Only remove symlinks that point into this plugin's tree.
    if (!targetAbs || !isPathWithin(targetAbs, pluginDir)) {
      vlog(`${label} ${name} → ${targetRaw}: not ours, leaving alone`);
      continue;
    }

    if (DRY_RUN) {
      removed.push(`symlink ${path} → ${targetRaw} (dry-run)`);
      continue;
    }
    try {
      unlinkSync(path);
      removed.push(`symlink ${path} → ${targetRaw}`);
    } catch (e) {
      failures++;
      console.error(`ERROR: cannot remove ${path}: ${e.message}`);
    }
  }
}

function cleanCommandSymlinks() {
  removeOurSymlinks(CLAUDE_COMMANDS_DIR, PLUGIN_COMMANDS_DIR, "command");
}

function cleanSkillSymlinks() {
  removeOurSymlinks(CLAUDE_SKILLS_DIR, PLUGIN_SKILLS_DIR, "skill");
}

// ── 3. Forge hooks in ~/.claude/settings.json ─────────────

function cleanGlobalSettings() {
  if (!existsSync(CLAUDE_SETTINGS)) {
    vlog(`${CLAUDE_SETTINGS} does not exist — skipping`);
    return;
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8"));
  } catch (e) {
    failures++;
    console.error(`ERROR: cannot parse ${CLAUDE_SETTINGS}: ${e.message}`);
    return;
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    vlog("settings.json has no hooks block");
    return;
  }

  let mutated = false;

  for (const event of Object.keys(settings.hooks)) {
    const entries = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = [];

    for (const entry of entries) {
      const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
      const keptHooks = inner.filter(h => {
        const match = h && h.type === "command" && typeof h.command === "string"
          && isGlobalHookCommand(h.command);
        if (match) {
          removed.push(`settings.json ${event} → ${h.command}`);
          mutated = true;
        }
        return !match;
      });

      if (keptHooks.length === 0 && inner.length > 0) {
        // Entry had only forge hooks — drop the whole entry.
        continue;
      }
      kept.push({ ...entry, hooks: keptHooks });
    }

    if (kept.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = kept;
    }
  }

  if (!mutated) return;
  if (DRY_RUN) { vlog("dry-run — skipping write to settings.json"); return; }
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  vlog(`wrote ${CLAUDE_SETTINGS}`);
}

// ── main ──────────────────────────────────────────────────

log(`Forge uninstaller ${DRY_RUN ? "(dry-run)" : ""}`);
log(`Plugin root: ${PLUGIN_ROOT}`);

cleanPluginHooksJson();
cleanCommandSymlinks();
cleanSkillSymlinks();
cleanGlobalSettings();

log("");
if (removed.length === 0) {
  log("Nothing to remove — already clean.");
} else {
  log("Removed:");
  for (const r of removed) log(`  - ${r}`);
}

if (failures) {
  log("");
  log(`FAILED with ${failures} error(s).`);
  process.exit(1);
}

log("");
log("Done. Data preserved:");
log("  • .omc/forge.db  (per project — delete manually if unwanted)");
log("  • ~/.forge/global.db  (cross-project)");
