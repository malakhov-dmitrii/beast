/**
 * Forge Intelligence — CRUD Operations
 *
 * Create/park/resume/complete/abandon forges.
 * Record gates, spikes. Aggregate risk. Update co-failures.
 */

import { openForgeDb } from "./forge-schema.mjs";

// ── Forge CRUD ──────────────────────────────────────────

export function createForge(cwd, { slug, systems = [], parentId = null, priority = "medium" }) {
  const db = openForgeDb(cwd);
  try {
    const result = db.run(
      `INSERT INTO forges (slug, parent_id, systems, priority, status, phase)
       VALUES (?, ?, ?, ?, 'active', 'bf-precedent')`,
      [slug, parentId, JSON.stringify(systems), priority]
    );
    saveCurrentState(db, { forgeId: result.lastInsertRowid, slug, phase: "bf-precedent", iteration: 1 });
    return result.lastInsertRowid;
  } finally { db.close(); }
}

export function parkForge(cwd, forgeId, reason = null) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `UPDATE forges SET status = 'parked', parked_at = datetime('now'),
       updated_at = datetime('now'), blocking_reason = ?
       WHERE id = ? AND status = 'active'`,
      [reason, forgeId]
    );
    clearCurrentState(db);
  } finally { db.close(); }
}

export function resumeForge(cwd, slugOrId) {
  const db = openForgeDb(cwd);
  try {
    const forge = typeof slugOrId === "number"
      ? db.query("SELECT * FROM forges WHERE id = ?").get(slugOrId)
      : db.query("SELECT * FROM forges WHERE slug = ?").get(slugOrId);
    if (!forge) throw new Error(`Forge not found: ${slugOrId}`);
    if (forge.status !== "parked") throw new Error(`Forge "${forge.slug}" is ${forge.status}, not parked`);

    db.run(
      `UPDATE forges SET status = 'active', parked_at = NULL, updated_at = datetime('now')
       WHERE id = ?`, [forge.id]
    );
    saveCurrentState(db, {
      forgeId: forge.id, slug: forge.slug, phase: forge.phase,
      iteration: forge.iteration, context: forge.context
    });
    return forge;
  } finally { db.close(); }
}

export function completeForge(cwd, forgeId, lesson = null) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `UPDATE forges SET status = 'completed', completed_at = datetime('now'),
       updated_at = datetime('now'), context = json_set(COALESCE(context, '{}'), '$.lesson', ?)
       WHERE id = ?`,
      [lesson, forgeId]
    );
    updateCoFailures(db, forgeId);
    clearCurrentState(db);
  } finally { db.close(); }
}

export function abandonForge(cwd, forgeId, reason = null) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `UPDATE forges SET status = 'abandoned', completed_at = datetime('now'),
       updated_at = datetime('now'), blocking_reason = ?
       WHERE id = ?`,
      [reason, forgeId]
    );
    clearCurrentState(db);
  } finally { db.close(); }
}

export function updateForgePhase(cwd, forgeId, phase, iteration = null) {
  const db = openForgeDb(cwd);
  try {
    if (iteration !== null) {
      db.run(
        `UPDATE forges SET phase = ?, iteration = ?, updated_at = datetime('now') WHERE id = ?`,
        [phase, iteration, forgeId]
      );
    } else {
      db.run(
        `UPDATE forges SET phase = ?, updated_at = datetime('now') WHERE id = ?`,
        [phase, forgeId]
      );
    }
    const forge = db.query("SELECT slug, iteration FROM forges WHERE id = ?").get(forgeId);
    saveCurrentState(db, { forgeId, slug: forge?.slug, phase, iteration: iteration ?? forge?.iteration });
  } finally { db.close(); }
}

export function spawnForge(cwd, { slug, systems, parentId, blocksParent = false, priority = "medium" }) {
  const db = openForgeDb(cwd);
  try {
    const result = db.run(
      `INSERT INTO forges (slug, parent_id, systems, priority, status, phase)
       VALUES (?, ?, ?, ?, 'active', 'bf-precedent')`,
      [slug, parentId, JSON.stringify(systems), priority]
    );
    if (blocksParent) {
      db.run(
        `UPDATE forges SET status = 'blocked', blocked_by = ?, blocking_reason = 'waiting for: ' || ?
         WHERE id = ?`,
        [result.lastInsertRowid, slug, parentId]
      );
    }
    return result.lastInsertRowid;
  } finally { db.close(); }
}

// ── Gates ───────────────────────────────────────────────

export function recordGate(cwd, forgeId, iteration, gate, result, findings = []) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `INSERT INTO gates (forge_id, iteration, gate, result, findings) VALUES (?, ?, ?, ?, ?)`,
      [forgeId, iteration, gate, result, JSON.stringify(findings)]
    );
  } finally { db.close(); }
}

// ── Spikes ──────────────────────────────────────────────

export function recordSpike(cwd, forgeId, assumption, result, actual = null) {
  const db = openForgeDb(cwd);
  try {
    const permanent = result === "refuted" ? 1 : 0;
    db.run(
      `INSERT INTO spikes (forge_id, assumption, result, actual, permanent) VALUES (?, ?, ?, ?, ?)`,
      [forgeId, assumption, result, actual, permanent]
    );
  } finally { db.close(); }
}

export function searchSpikes(cwd, query) {
  const db = openForgeDb(cwd);
  try {
    return db.query(
      `SELECT s.*, sf.rank FROM spikes_fts sf
       JOIN spikes s ON s.id = sf.rowid
       WHERE spikes_fts MATCH ?
       AND (s.permanent = 1 OR s.tested_at > datetime('now', '-30 days'))
       ORDER BY sf.rank LIMIT 10`
    ).all(query);
  } finally { db.close(); }
}

// ── Queries for PRECEDENT ───────────────────────────────

export function getRiskScores(cwd, systems) {
  const db = openForgeDb(cwd);
  try {
    const placeholders = systems.map(() => "?").join(",");
    return db.query(
      `SELECT * FROM system_risk WHERE system IN (${placeholders}) ORDER BY fail_rate DESC`
    ).all(...systems);
  } finally { db.close(); }
}

export function getPastRuns(cwd, systems, limit = 5) {
  const db = openForgeDb(cwd);
  try {
    const like = systems.map(s => `systems LIKE '%${s.replace(/'/g, "''")}%'`).join(" OR ");
    return db.query(
      `SELECT slug, status, iteration, phase, json_extract(context, '$.lesson') as lesson,
              completed_at, systems
       FROM forges WHERE (${like}) AND status IN ('completed','abandoned')
       ORDER BY completed_at DESC LIMIT ?`
    ).all(limit);
  } finally { db.close(); }
}

export function getCoFailures(cwd, systems, threshold = 0.3) {
  const db = openForgeDb(cwd);
  try {
    const placeholders = systems.map(() => "?").join(",");
    return db.query(
      `SELECT * FROM co_failures
       WHERE (system_a IN (${placeholders}) OR system_b IN (${placeholders}))
       AND CAST(fail_count AS REAL) / MAX(total_count, 1) > ?
       ORDER BY fail_count DESC`
    ).all(...systems, ...systems, threshold);
  } finally { db.close(); }
}

export function listForges(cwd, statuses = ["active", "parked", "blocked"]) {
  const db = openForgeDb(cwd);
  try {
    const placeholders = statuses.map(() => "?").join(",");
    return db.query(
      `SELECT id, slug, status, phase, iteration, priority, parent_id, blocked_by,
              blocking_reason, systems, created_at, updated_at, parked_at
       FROM forges WHERE status IN (${placeholders})
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'parked' THEN 2 END,
                updated_at DESC`
    ).all(...statuses);
  } finally { db.close(); }
}

export function getForgeCounts(cwd) {
  const db = openForgeDb(cwd);
  try {
    return db.query(
      `SELECT status, COUNT(*) as count FROM forges
       WHERE status IN ('active','parked','blocked')
       GROUP BY status`
    ).all();
  } finally { db.close(); }
}

// ── Current State (compaction recovery) ─────────────────

function saveCurrentState(db, state) {
  db.run(
    `INSERT OR REPLACE INTO current_state (key, value, updated_at)
     VALUES ('active_forge', ?, datetime('now'))`,
    [JSON.stringify(state)]
  );
}

function clearCurrentState(db) {
  db.run("DELETE FROM current_state WHERE key = 'active_forge'");
}

export function getCurrentState(cwd) {
  const db = openForgeDb(cwd);
  try {
    const row = db.query("SELECT value FROM current_state WHERE key = 'active_forge'").get();
    return row ? JSON.parse(row.value) : null;
  } finally { db.close(); }
}

// ── Co-failure aggregation ──────────────────────────────

function updateCoFailures(db, forgeId) {
  const forge = db.query("SELECT systems FROM forges WHERE id = ?").get(forgeId);
  if (!forge) return;

  const systems = JSON.parse(forge.systems || "[]");
  if (systems.length < 2) return;

  const failedGates = db.query(
    "SELECT DISTINCT gate FROM gates WHERE forge_id = ? AND result = 'FAIL'"
  ).all(forgeId);

  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      const [a, b] = [systems[i], systems[j]].sort();
      for (const { gate } of failedGates) {
        db.run(
          `INSERT INTO co_failures (system_a, system_b, gate, fail_count, total_count)
           VALUES (?, ?, ?, 1, 1)
           ON CONFLICT(system_a, system_b, gate) DO UPDATE SET
             fail_count = fail_count + 1, total_count = total_count + 1`,
          [a, b, gate]
        );
      }
      if (failedGates.length === 0) {
        const allGates = db.query(
          "SELECT DISTINCT gate FROM gates WHERE forge_id = ?"
        ).all(forgeId);
        for (const { gate } of allGates) {
          db.run(
            `INSERT INTO co_failures (system_a, system_b, gate, fail_count, total_count)
             VALUES (?, ?, ?, 0, 1)
             ON CONFLICT(system_a, system_b, gate) DO UPDATE SET total_count = total_count + 1`,
            [a, b, gate]
          );
        }
      }
    }
  }
}
