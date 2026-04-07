/**
 * Forge Intelligence — Schema & DB Init
 *
 * Creates and migrates forge.db (project-scoped).
 * Tables: forges, gates, spikes, co_failures, current_state
 * Views: system_risk
 * Triggers: cascade on status change
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Schema version. Bump this when adding tables/columns/triggers.
 * Migration functions handle upgrading from any previous version.
 */
const SCHEMA_VERSION = 1;

/** Resolve project .omc/ directory (git worktree aware) */
export function resolveOmcRoot(cwd) {
  try {
    const root = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
    return join(root, ".omc");
  } catch {
    return join(cwd, ".omc");
  }
}

/** Open (or create) forge.db with WAL mode and busy timeout */
export function openForgeDb(cwd) {
  const omcRoot = resolveOmcRoot(cwd);
  if (!existsSync(omcRoot)) mkdirSync(omcRoot, { recursive: true });

  const dbPath = join(omcRoot, "forge.db");
  const db = new Database(dbPath);

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  migrateIfNeeded(db);
  return db;
}

/** Check current version and run migrations */
function migrateIfNeeded(db) {
  const currentVersion = db.query("PRAGMA user_version").get().user_version;

  if (currentVersion >= SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    ensureSchemaV1(db);
  }

  // Future migrations go here:
  // if (currentVersion < 2) { migrateV1toV2(db); }

  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Get current schema version (useful for diagnostics) */
export function getSchemaVersion(cwd) {
  const db = openForgeDb(cwd);
  try {
    return db.query("PRAGMA user_version").get().user_version;
  } finally { db.close(); }
}

function ensureSchemaV1(db) {
  db.run(`CREATE TABLE IF NOT EXISTS forges (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    parent_id INTEGER REFERENCES forges(id),
    blocked_by INTEGER REFERENCES forges(id),
    status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active','parked','blocked','completed','abandoned')),
    phase TEXT,
    iteration INTEGER DEFAULT 1,
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
    systems TEXT DEFAULT '[]',
    plan_path TEXT,
    context TEXT DEFAULT '{}',
    blocking_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    parked_at TEXT,
    completed_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gates (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER NOT NULL REFERENCES forges(id),
    iteration INTEGER NOT NULL,
    gate TEXT NOT NULL CHECK(gate IN ('skeptic','integration','second_opinion','static')),
    result TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
    findings TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS spikes (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER REFERENCES forges(id),
    assumption TEXT NOT NULL,
    result TEXT CHECK(result IN ('confirmed','refuted')),
    actual TEXT,
    tested_at TEXT DEFAULT (datetime('now')),
    permanent INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS co_failures (
    system_a TEXT NOT NULL,
    system_b TEXT NOT NULL,
    gate TEXT NOT NULL,
    fail_count INTEGER DEFAULT 1,
    total_count INTEGER DEFAULT 1,
    PRIMARY KEY (system_a, system_b, gate)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS current_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE VIEW IF NOT EXISTS system_risk AS
    SELECT
      je.value AS system,
      ROUND(1.0 * SUM(CASE WHEN g.result = 'FAIL' THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 2) AS fail_rate,
      ROUND(AVG(f.iteration), 1) AS avg_iterations,
      MAX(f.updated_at) AS last_touched,
      COUNT(DISTINCT f.id) AS sample_count
    FROM forges f, json_each(f.systems) je
    LEFT JOIN gates g ON g.forge_id = f.id
    WHERE f.status IN ('completed', 'abandoned')
    GROUP BY je.value
  `);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS spikes_fts USING fts5(
    assumption, actual, content=spikes, content_rowid=id
  )`);

  db.run(`CREATE TRIGGER IF NOT EXISTS spikes_ai AFTER INSERT ON spikes BEGIN
    INSERT INTO spikes_fts(rowid, assumption, actual) VALUES (new.id, new.assumption, new.actual);
  END`);

  db.run(`CREATE TRIGGER IF NOT EXISTS cascade_on_complete
    AFTER UPDATE OF status ON forges
    WHEN NEW.status = 'completed'
  BEGIN
    UPDATE forges SET status = 'parked', blocked_by = NULL,
      blocking_reason = 'auto-unblocked: ' || NEW.slug || ' completed',
      updated_at = datetime('now')
    WHERE blocked_by = NEW.id AND status = 'blocked';
    UPDATE forges SET priority = 'high',
      blocking_reason = COALESCE(blocking_reason, '') || ' parent completed — still relevant?',
      updated_at = datetime('now')
    WHERE parent_id = NEW.id AND status IN ('parked', 'blocked');
  END`);

  db.run(`CREATE TRIGGER IF NOT EXISTS cascade_on_abandon
    AFTER UPDATE OF status ON forges
    WHEN NEW.status = 'abandoned'
  BEGIN
    UPDATE forges SET priority = 'high',
      blocking_reason = 'blocker abandoned — review scope',
      updated_at = datetime('now')
    WHERE blocked_by = NEW.id AND status = 'blocked';
  END`);

  db.run(`DELETE FROM gates WHERE forge_id IN (
    SELECT id FROM forges WHERE status IN ('completed','abandoned')
    AND completed_at < datetime('now', '-180 days')
  )`);
  db.run(`DELETE FROM forges WHERE status IN ('completed','abandoned')
    AND completed_at < datetime('now', '-180 days')`);
}
