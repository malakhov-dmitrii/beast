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
const SCHEMA_VERSION = 5;

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

  if (currentVersion < 2) {
    migrateV1toV2(db);
  }

  if (currentVersion < 3) {
    migrateV2toV3(db);
  }

  if (currentVersion < 4) {
    migrateV3toV4(db);
  }

  if (currentVersion < 5) {
    migrateV4toV5(db);
  }

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

function migrateV2toV3(db) {
  db.run("BEGIN IMMEDIATE");

  try {
    // streams table (ADR §6)
    db.run(`CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY,
      forge_id INTEGER NOT NULL REFERENCES forges(id),
      stream_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','green','failed','blocked')),
      depends_on TEXT NOT NULL DEFAULT '[]',
      touches_files TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      verifier_cmd TEXT NOT NULL,
      tdd_required INTEGER DEFAULT 1,
      tdd_evidence TEXT DEFAULT '{}',
      retries INTEGER DEFAULT 0,
      refactor_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      UNIQUE(forge_id, stream_id)
    )`);

    db.run("CREATE INDEX IF NOT EXISTS idx_streams_forge_status ON streams(forge_id, status)");

    // integration_contracts table
    db.run(`CREATE TABLE IF NOT EXISTS integration_contracts (
      id INTEGER PRIMARY KEY,
      forge_id INTEGER NOT NULL REFERENCES forges(id),
      contract_name TEXT NOT NULL,
      test_cmd TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','pass','fail')) DEFAULT 'pending',
      failure_output TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(forge_id, contract_name)
    )`);

    // FTS5 virtual table indexing acceptance_criteria + refactor_notes
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS streams_fts USING fts5(
      acceptance_criteria, refactor_notes, content=streams, content_rowid=id
    )`);

    // AFTER INSERT trigger — direct column reads, no json_extract
    db.run(`CREATE TRIGGER IF NOT EXISTS streams_ai AFTER INSERT ON streams BEGIN
      INSERT INTO streams_fts(rowid, acceptance_criteria, refactor_notes)
        VALUES (new.id, new.acceptance_criteria, new.refactor_notes);
    END`);

    // AFTER UPDATE trigger — contentless FTS5 delete+re-insert pattern
    db.run(`CREATE TRIGGER IF NOT EXISTS streams_au
      AFTER UPDATE OF acceptance_criteria, refactor_notes ON streams
    BEGIN
      INSERT INTO streams_fts(streams_fts, rowid, acceptance_criteria, refactor_notes)
        VALUES ('delete', old.id, old.acceptance_criteria, old.refactor_notes);
      INSERT INTO streams_fts(rowid, acceptance_criteria, refactor_notes)
        VALUES (new.id, new.acceptance_criteria, new.refactor_notes);
    END`);

  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }

  db.run("COMMIT");
}

function migrateV3toV4(db) {
  // Add red_tests column to streams for verifier superset enforcement (Task 3.1)
  try { db.run("ALTER TABLE streams ADD COLUMN red_tests TEXT DEFAULT '[]'"); } catch {}
}

function migrateV4toV5(db) {
  // V4→V5: extend claim_validations CHECK to include 'kg_fact', add palace_drafts table.
  // SQLite has no ALTER CHECK — must recreate the table. Explicit column list prevents
  // silent drops if schemas diverge.
  db.run("BEGIN IMMEDIATE");
  try {
    const preCount = db.query("SELECT COUNT(*) as c FROM claim_validations").get().c;

    db.run(`CREATE TABLE claim_validations_new (
      id INTEGER PRIMARY KEY,
      forge_id INTEGER NOT NULL REFERENCES forges(id),
      iteration INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      claim_type TEXT NOT NULL CHECK(claim_type IN ('fact','design_bet','strategic','kg_fact')),
      claim_text TEXT NOT NULL,
      citation TEXT,
      validation_result TEXT CHECK(validation_result IN ('verified','mirage','unverifiable','pending')),
      validation_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    db.run(`INSERT INTO claim_validations_new
      (id, forge_id, iteration, step_number, claim_type, claim_text, citation, validation_result, validation_notes, created_at)
      SELECT id, forge_id, iteration, step_number, claim_type, claim_text, citation, validation_result, validation_notes, created_at
      FROM claim_validations`);

    const postCount = db.query("SELECT COUNT(*) as c FROM claim_validations_new").get().c;
    if (postCount !== preCount) {
      throw new Error(`V4→V5 migration row count mismatch: pre=${preCount} post=${postCount}`);
    }

    db.run("DROP TABLE claim_validations");
    db.run("ALTER TABLE claim_validations_new RENAME TO claim_validations");
    db.run("CREATE INDEX IF NOT EXISTS idx_claims_forge_iter ON claim_validations(forge_id, iteration)");

    db.run(`CREATE TABLE IF NOT EXISTS palace_drafts (
      id INTEGER PRIMARY KEY,
      forge_id INTEGER NOT NULL REFERENCES forges(id),
      draft_type TEXT NOT NULL CHECK(draft_type IN ('kg_add','add_drawer','kg_invalidate')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','committed','discarded')) DEFAULT 'pending',
      source_spike_id INTEGER REFERENCES spikes(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    )`);
    db.run("CREATE INDEX IF NOT EXISTS idx_palace_drafts_forge_status ON palace_drafts(forge_id, status)");

    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

function migrateV1toV2(db) {
  db.run("BEGIN IMMEDIATE");

  // ALTER existing gates table — each wrapped in try/catch for idempotency
  try { db.run("ALTER TABLE gates ADD COLUMN blind INTEGER DEFAULT 1"); } catch {}
  try { db.run("ALTER TABLE gates ADD COLUMN inputs_seen TEXT DEFAULT '[]'"); } catch {}
  try { db.run("ALTER TABLE gates ADD COLUMN meta_findings TEXT DEFAULT '[]'"); } catch {}

  // Unique index on gates for INSERT OR REPLACE support
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_gates_forge_iter_gate ON gates(forge_id, iteration, gate)");

  // Visionary passes table
  db.run(`CREATE TABLE IF NOT EXISTS visionary_passes (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER NOT NULL REFERENCES forges(id),
    iteration INTEGER NOT NULL,
    pass_number INTEGER NOT NULL,
    angle TEXT NOT NULL CHECK(angle IN ('simpler','better','blind_spots','custom')),
    agent TEXT NOT NULL CHECK(agent IN ('codex','opus','gemini')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(forge_id, iteration, pass_number, angle)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_visionary_forge_iter ON visionary_passes(forge_id, iteration)");

  // Comparator reports table
  db.run(`CREATE TABLE IF NOT EXISTS comparator_reports (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER NOT NULL REFERENCES forges(id),
    iteration INTEGER NOT NULL,
    tldr TEXT NOT NULL,
    diff_items TEXT NOT NULL DEFAULT '[]',
    reality_check TEXT NOT NULL DEFAULT '{}',
    recommendation TEXT NOT NULL CHECK(recommendation IN ('standard','visionary','merge')),
    user_decision TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(forge_id, iteration)
  )`);

  // Claim validations table
  db.run(`CREATE TABLE IF NOT EXISTS claim_validations (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER NOT NULL REFERENCES forges(id),
    iteration INTEGER NOT NULL,
    step_number INTEGER NOT NULL,
    claim_type TEXT NOT NULL CHECK(claim_type IN ('fact','design_bet','strategic')),
    claim_text TEXT NOT NULL,
    citation TEXT,
    validation_result TEXT CHECK(validation_result IN ('verified','mirage','unverifiable','pending')),
    validation_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_claims_forge_iter ON claim_validations(forge_id, iteration)");

  db.run("COMMIT");
}
