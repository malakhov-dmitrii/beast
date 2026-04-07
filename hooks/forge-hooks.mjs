#!/usr/bin/env bun
/**
 * Forge Intelligence — Hook Handlers
 *
 * Dispatched by CLI arg: sessionstart | sessionend | precompact
 * Registered in ~/.claude/settings.json (user-level, not plugin).
 *
 * SessionStart: health check (stale, zombies, orphans, phantom blocks)
 * SessionEnd:   aggregate risk, reconcile with git, complete current_state bookkeeping
 * PreCompact:   save forge state, return recovery prompt as systemMessage
 */

import { openForgeDb, resolveOmcRoot } from "./forge-schema.mjs";
import { getCurrentState } from "./forge-crud.mjs";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.env.PWD || process.cwd();
const command = process.argv[2];

// Read stdin (Claude Code passes JSON context)
let stdin = {};
try {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  if (chunks.length > 0) {
    const text = Buffer.concat(chunks).toString();
    if (text.trim()) stdin = JSON.parse(text);
  }
} catch { /* no stdin or invalid JSON — fine */ }

// Resolve cwd from stdin or env
const projectCwd = stdin.cwd || cwd;

// Check if forge.db exists — skip silently if no forge activity in this project
const omcRoot = resolveOmcRoot(projectCwd);
const forgeDbPath = join(omcRoot, "forge.db");
const forgeDbExists = existsSync(forgeDbPath);

try {
  switch (command) {
    case "sessionstart":
      await handleSessionStart();
      break;
    case "sessionend":
      await handleSessionEnd();
      break;
    case "precompact":
      await handlePreCompact();
      break;
    default:
      break;
  }
} catch (err) {
  console.error(`[forge-hooks] ${command} error:`, err.message);
}

// ── SessionStart: Health Check ──────────────────────────

async function handleSessionStart() {
  if (!forgeDbExists) return;

  const db = openForgeDb(projectCwd);
  try {
    const issues = [];

    // 1. Auto-park zombie forges (active but not updated in >2 hours)
    const zombies = db.query(`
      SELECT id, slug, phase, updated_at FROM forges
      WHERE status = 'active' AND updated_at < datetime('now', '-2 hours')
    `).all();

    for (const z of zombies) {
      db.run(`UPDATE forges SET status = 'parked', parked_at = updated_at,
        blocking_reason = 'auto-parked: zombie (last active ' || updated_at || ')',
        updated_at = datetime('now') WHERE id = ?`, [z.id]);
      issues.push(`auto-parked zombie "${z.slug}" (${z.phase}, last active ${z.updated_at})`);
    }

    // 2. Phantom blocks (blocked by completed/abandoned forge)
    const phantoms = db.query(`
      SELECT f.id, f.slug, b.slug as blocker_slug, b.status as blocker_status
      FROM forges f JOIN forges b ON f.blocked_by = b.id
      WHERE f.status = 'blocked' AND b.status IN ('completed', 'abandoned')
    `).all();

    for (const p of phantoms) {
      db.run(`UPDATE forges SET status = 'parked', blocked_by = NULL,
        blocking_reason = 'auto-unblocked: blocker "' || ? || '" ' || ?,
        updated_at = datetime('now') WHERE id = ?`,
        [p.blocker_slug, p.blocker_status, p.id]);
      issues.push(`auto-unblocked "${p.slug}" (blocker "${p.blocker_slug}" ${p.blocker_status})`);
    }

    // 3. Stale parked forges
    const stale = db.query(`
      SELECT slug, phase,
        CAST(julianday('now') - julianday(COALESCE(parked_at, updated_at)) AS INTEGER) as days
      FROM forges WHERE status = 'parked'
      AND COALESCE(parked_at, updated_at) < datetime('now', '-7 days')
      ORDER BY days DESC
    `).all();

    for (const s of stale) {
      if (s.days > 30) {
        issues.push(`stale ${s.days}d "${s.slug}" at ${s.phase} — consider /forge --abandon`);
      } else {
        issues.push(`parked ${s.days}d "${s.slug}" at ${s.phase}`);
      }
    }

    // 4. Orphan children (parent done, children still open)
    const orphans = db.query(`
      SELECT c.slug, p.slug as parent_slug, p.status as parent_status
      FROM forges c JOIN forges p ON c.parent_id = p.id
      WHERE c.status IN ('parked', 'blocked')
      AND p.status IN ('completed', 'abandoned')
    `).all();

    for (const o of orphans) {
      issues.push(`orphan "${o.slug}" (parent "${o.parent_slug}" ${o.parent_status})`);
    }

    // 5. Summary counts
    const counts = db.query(`
      SELECT status, COUNT(*) as c FROM forges
      WHERE status IN ('active', 'parked', 'blocked')
      GROUP BY status
    `).all();

    if (issues.length > 0 || counts.length > 0) {
      const countStr = counts.map(c => `${c.c} ${c.status}`).join(", ");
      const header = countStr ? `FORGES: ${countStr}` : "FORGES: none active";
      const body = issues.length > 0
        ? issues.map(i => `  ${i}`).join("\n")
        : "";

      const message = body ? `${header}\n${body}` : header;
      console.log(JSON.stringify({ continue: true, systemMessage: message }));
    }
  } finally { db.close(); }
}

// ── SessionEnd: Reconcile + Aggregate ───────────────────

async function handleSessionEnd() {
  if (!forgeDbExists) return;

  const db = openForgeDb(projectCwd);
  try {
    let changedFiles = [];
    try {
      const porcelain = execSync("git status --porcelain", { cwd: projectCwd, encoding: "utf-8" });
      changedFiles = porcelain.split("\n")
        .filter(Boolean)
        .map(line => line.slice(3).trim());
    } catch { /* not a git repo or git error */ }

    if (changedFiles.length === 0) return;

    const openForges = db.query(`
      SELECT id, slug, systems, status FROM forges
      WHERE status IN ('parked', 'blocked')
    `).all();

    for (const forge of openForges) {
      const systems = JSON.parse(forge.systems || "[]");
      const touched = systems.some(sys =>
        changedFiles.some(f => f.toLowerCase().includes(sys.toLowerCase()))
      );

      if (touched) {
        const touchedSystems = systems.filter(sys =>
          changedFiles.some(f => f.toLowerCase().includes(sys.toLowerCase()))
        );
        db.run(`UPDATE forges SET
          updated_at = datetime('now'),
          blocking_reason = COALESCE(blocking_reason, '') ||
            ' [systems modified: ${touchedSystems.join(", ")}]'
          WHERE id = ?`, [forge.id]);

        const changeCount = changedFiles.filter(f =>
          systems.some(sys => f.toLowerCase().includes(sys.toLowerCase()))
        ).length;
        if (changeCount >= 3) {
          db.run(`UPDATE forges SET priority = 'high' WHERE id = ? AND priority != 'high'`,
            [forge.id]);
        }
      }
    }
  } finally { db.close(); }
}

// ── PreCompact: Save State + Recovery Prompt ────────────

async function handlePreCompact() {
  if (!forgeDbExists) return;

  const state = getCurrentState(projectCwd);
  if (!state) return;

  const db = openForgeDb(projectCwd);
  try {
    const forge = db.query("SELECT * FROM forges WHERE id = ?").get(state.forgeId);
    if (!forge) return;

    const gates = db.query(
      "SELECT gate, result FROM gates WHERE forge_id = ? AND iteration = ?"
    ).all(forge.id, forge.iteration);

    const gateStr = gates.length > 0
      ? gates.map(g => `${g.gate}: ${g.result}`).join(", ")
      : "none yet";

    const recovery = [
      `You were running Forge. Resume from where you left off.`,
      ``,
      `Forge: "${forge.slug}" (id: ${forge.id})`,
      `Phase: ${forge.phase}, iteration ${forge.iteration}`,
      `Gates this iteration: ${gateStr}`,
      forge.plan_path ? `Plan: ${forge.plan_path}` : null,
      `Systems: ${forge.systems}`,
      ``,
      `To resume: read the plan file and continue the pipeline from phase ${forge.phase}.`,
      `Run: /forge --resume ${forge.slug}`,
    ].filter(Boolean).join("\n");

    console.log(JSON.stringify({ continue: true, systemMessage: recovery }));
  } finally { db.close(); }
}
