/**
 * Forge Intelligence — Global Knowledge DB
 *
 * ~/.forge/global.db — cross-project verified knowledge.
 * Spikes about tools/libraries, abstract patterns, process learnings.
 * Future: sync with Forge Knowledge Network (forge-beast.dev).
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GLOBAL_SCHEMA_VERSION = 1;

/** Open (or create) global forge DB */
export function openGlobalDb() {
  const forgeDir = join(homedir(), ".forge");
  if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });

  const dbPath = join(forgeDir, "global.db");
  const db = new Database(dbPath);

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");

  migrateGlobalIfNeeded(db);
  return db;
}

function migrateGlobalIfNeeded(db) {
  const currentVersion = db.query("PRAGMA user_version").get().user_version;
  if (currentVersion >= GLOBAL_SCHEMA_VERSION) return;

  if (currentVersion < 1) ensureGlobalSchemaV1(db);

  db.run(`PRAGMA user_version = ${GLOBAL_SCHEMA_VERSION}`);
}

function ensureGlobalSchemaV1(db) {
  db.run(`CREATE TABLE IF NOT EXISTS global_spikes (
    id INTEGER PRIMARY KEY,
    assumption TEXT NOT NULL,
    result TEXT CHECK(result IN ('confirmed','refuted')),
    actual TEXT,
    technology TEXT,
    tested_at TEXT DEFAULT (datetime('now')),
    source_project TEXT,
    permanent INTEGER DEFAULT 0,
    network_id TEXT,
    network_status TEXT DEFAULT 'local'
      CHECK(network_status IN ('local','pending','verified','rejected'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS global_patterns (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,
    category TEXT CHECK(category IN ('integration','architecture','process','tooling','security')),
    confidence REAL DEFAULT 0.5,
    evidence_count INTEGER DEFAULT 1,
    discovered_at TEXT DEFAULT (datetime('now')),
    last_confirmed TEXT,
    network_id TEXT,
    network_status TEXT DEFAULT 'local'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS process_learnings (
    id INTEGER PRIMARY KEY,
    learning TEXT NOT NULL,
    context TEXT,
    evidence_count INTEGER DEFAULT 1,
    discovered_at TEXT DEFAULT (datetime('now')),
    network_id TEXT,
    network_status TEXT DEFAULT 'local'
  )`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS global_spikes_fts USING fts5(
    assumption, actual, technology, content=global_spikes, content_rowid=id
  )`);

  db.run(`CREATE TRIGGER IF NOT EXISTS global_spikes_ai AFTER INSERT ON global_spikes BEGIN
    INSERT INTO global_spikes_fts(rowid, assumption, actual, technology)
    VALUES (new.id, new.assumption, new.actual, new.technology);
  END`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS global_patterns_fts USING fts5(
    pattern, category, content=global_patterns, content_rowid=id
  )`);

  db.run(`CREATE TRIGGER IF NOT EXISTS global_patterns_ai AFTER INSERT ON global_patterns BEGIN
    INSERT INTO global_patterns_fts(rowid, pattern, category)
    VALUES (new.id, new.pattern, new.category);
  END`);
}

// ── CRUD ────────────────────────────────────────────────

export function promoteSpike(spike, sourceProject = null) {
  const db = openGlobalDb();
  try {
    const existing = db.query(
      "SELECT id FROM global_spikes WHERE assumption = ? AND technology = ?"
    ).get(spike.assumption, spike.technology);

    if (existing) {
      db.run("UPDATE global_spikes SET tested_at = datetime('now') WHERE id = ?", [existing.id]);
      return existing.id;
    }

    const result = db.run(
      `INSERT INTO global_spikes (assumption, result, actual, technology, source_project, permanent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [spike.assumption, spike.result, spike.actual, spike.technology, sourceProject, spike.permanent ? 1 : 0]
    );
    return result.lastInsertRowid;
  } finally { db.close(); }
}

export function addPattern(pattern, category) {
  const db = openGlobalDb();
  try {
    const existing = db.query("SELECT id FROM global_patterns WHERE pattern = ?").get(pattern);

    if (existing) {
      db.run(
        `UPDATE global_patterns SET confidence = MIN(confidence + 0.1, 1.0),
         evidence_count = evidence_count + 1, last_confirmed = datetime('now')
         WHERE id = ?`, [existing.id]
      );
      return existing.id;
    }

    const result = db.run(
      "INSERT INTO global_patterns (pattern, category) VALUES (?, ?)", [pattern, category]
    );
    return result.lastInsertRowid;
  } finally { db.close(); }
}

export function addProcessLearning(learning, context = null) {
  const db = openGlobalDb();
  try {
    const existing = db.query("SELECT id FROM process_learnings WHERE learning = ?").get(learning);

    if (existing) {
      db.run("UPDATE process_learnings SET evidence_count = evidence_count + 1 WHERE id = ?", [existing.id]);
      return existing.id;
    }

    const result = db.run(
      "INSERT INTO process_learnings (learning, context) VALUES (?, ?)", [learning, context]
    );
    return result.lastInsertRowid;
  } finally { db.close(); }
}

export function searchGlobalSpikes(query, technology = null) {
  const db = openGlobalDb();
  try {
    if (technology) {
      return db.query(
        `SELECT * FROM global_spikes WHERE technology = ?
         AND (permanent = 1 OR tested_at > datetime('now', '-30 days'))
         ORDER BY tested_at DESC LIMIT 20`
      ).all(technology);
    }
    return db.query(
      `SELECT s.* FROM global_spikes_fts f
       JOIN global_spikes s ON s.id = f.rowid
       WHERE global_spikes_fts MATCH ?
       ORDER BY f.rank LIMIT 20`
    ).all(query);
  } finally { db.close(); }
}

export function searchGlobalPatterns(query) {
  const db = openGlobalDb();
  try {
    return db.query(
      `SELECT p.* FROM global_patterns_fts f
       JOIN global_patterns p ON p.id = f.rowid
       WHERE global_patterns_fts MATCH ?
       ORDER BY p.confidence DESC LIMIT 20`
    ).all(query);
  } finally { db.close(); }
}

export function getProcessLearnings(limit = 10) {
  const db = openGlobalDb();
  try {
    return db.query(
      "SELECT * FROM process_learnings ORDER BY evidence_count DESC LIMIT ?"
    ).all(limit);
  } finally { db.close(); }
}

export function getGlobalStats() {
  const db = openGlobalDb();
  try {
    return {
      spikes: db.query("SELECT COUNT(*) as c FROM global_spikes").get().c,
      patterns: db.query("SELECT COUNT(*) as c FROM global_patterns").get().c,
      learnings: db.query("SELECT COUNT(*) as c FROM process_learnings").get().c,
      version: db.query("PRAGMA user_version").get().user_version,
    };
  } finally { db.close(); }
}
