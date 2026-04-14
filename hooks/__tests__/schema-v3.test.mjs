/**
 * Schema v3 tests — RED phase for Task 1.1
 *
 * All tests (1-8) must FAIL before GREEN implementation.
 * Test 9 (WAL pragma) may already pass.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openForgeDb, getSchemaVersion } from "../forge-schema.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-schema-v3-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: open a fresh v3 DB in tmpDir
function freshDb() {
  return openForgeDb(tmpDir);
}

// Helper: get column names for a table
function getColumns(db, table) {
  return db.query(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

// ─── Test 1: streams table has all required columns ───────────────────────────

test("v3 streams table has all required columns", () => {
  const db = freshDb();
  try {
    const cols = getColumns(db, "streams");
    const required = [
      "id",
      "forge_id",
      "stream_id",
      "status",
      "depends_on",
      "touches_files",
      "acceptance_criteria",
      "verifier_cmd",
      "tdd_required",
      "tdd_evidence",
      "retries",
      "refactor_notes",
      "created_at",
      "completed_at",
    ];
    for (const col of required) {
      expect(cols).toContain(col);
    }
  } finally {
    db.close();
  }
});

// ─── Test 2: integration_contracts table exists with CHECK(status) ────────────

test("v3 integration_contracts table exists with CHECK(status)", () => {
  const db = freshDb();
  try {
    // Table must exist
    const cols = getColumns(db, "integration_contracts");
    expect(cols).toContain("id");
    expect(cols).toContain("forge_id");
    expect(cols).toContain("contract_name");
    expect(cols).toContain("test_cmd");
    expect(cols).toContain("status");

    // Insert valid statuses
    db.run(`INSERT INTO forges (slug, status, phase) VALUES ('f1', 'active', 'plan')`);
    const forgeId = db.query("SELECT last_insert_rowid() as id").get().id;

    db.run(
      `INSERT INTO integration_contracts (forge_id, contract_name, test_cmd, status)
       VALUES (?, 'contract-a', 'bun test', 'pending')`,
      [forgeId]
    );
    db.run(
      `INSERT INTO integration_contracts (forge_id, contract_name, test_cmd, status)
       VALUES (?, 'contract-b', 'bun test', 'pass')`,
      [forgeId]
    );
    db.run(
      `INSERT INTO integration_contracts (forge_id, contract_name, test_cmd, status)
       VALUES (?, 'contract-c', 'bun test', 'fail')`,
      [forgeId]
    );

    // Invalid status must throw
    expect(() => {
      db.run(
        `INSERT INTO integration_contracts (forge_id, contract_name, test_cmd, status)
         VALUES (?, 'contract-bad', 'bun test', 'running')`,
        [forgeId]
      );
    }).toThrow();
  } finally {
    db.close();
  }
});

// ─── Test 3: streams_fts virtual table indexes acceptance_criteria + refactor_notes ──

test("v3 streams_fts virtual table indexes acceptance_criteria + refactor_notes", () => {
  const db = freshDb();
  try {
    // Insert a forge + stream so we can search FTS
    db.run(`INSERT INTO forges (slug, status) VALUES ('fts-forge', 'active')`);
    const forgeId = db.query("SELECT last_insert_rowid() as id").get().id;

    db.run(
      `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, acceptance_criteria, refactor_notes)
       VALUES (?, 'sx', 'pending', 'bun test', 'uniquecriterionabc', 'uniquerefactorxyz')`,
      [forgeId]
    );

    // FTS search on acceptance_criteria
    const r1 = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH 'uniquecriterionabc'`)
      .all();
    expect(r1.length).toBeGreaterThan(0);

    // FTS search on refactor_notes
    const r2 = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH 'uniquerefactorxyz'`)
      .all();
    expect(r2.length).toBeGreaterThan(0);
  } finally {
    db.close();
  }
});

// ─── Test 4: streams_ai trigger populates FTS on INSERT (no json_extract) ────

test("v3 streams_ai AFTER INSERT trigger populates FTS without json_extract", () => {
  const db = freshDb();
  try {
    db.run(`INSERT INTO forges (slug, status) VALUES ('ai-forge', 'active')`);
    const forgeId = db.query("SELECT last_insert_rowid() as id").get().id;

    const uniqueTerm = "triggerinsertsentinel" + Date.now();
    db.run(
      `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, acceptance_criteria, refactor_notes)
       VALUES (?, 's1', 'pending', 'bun test', ?, '')`,
      [forgeId, uniqueTerm]
    );

    const rows = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH ?`)
      .all(uniqueTerm);
    expect(rows.length).toBe(1);

    // Verify trigger definition does NOT use json_extract (denormalized column, not JSON)
    const triggerSql = db
      .query(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='streams_ai'`)
      .get();
    expect(triggerSql).not.toBeNull();
    expect(triggerSql.sql).not.toContain("json_extract");
  } finally {
    db.close();
  }
});

// ─── Test 5: streams_au UPDATE trigger fires on acceptance_criteria or refactor_notes change ──

test("v3 streams_au UPDATE trigger fires on acceptance_criteria or refactor_notes change", () => {
  const db = freshDb();
  try {
    db.run(`INSERT INTO forges (slug, status) VALUES ('au-forge', 'active')`);
    const forgeId = db.query("SELECT last_insert_rowid() as id").get().id;

    const initialCriteria = "initialcriterion" + Date.now();
    const updatedCriteria = "updatedcriterion" + Date.now();
    const updatedNotes = "updatednotes" + Date.now();

    db.run(
      `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, acceptance_criteria, refactor_notes)
       VALUES (?, 's1', 'pending', 'bun test', ?, '')`,
      [forgeId, initialCriteria]
    );

    // Update acceptance_criteria — old term must not be findable, new term must be
    db.run(
      `UPDATE streams SET acceptance_criteria=? WHERE forge_id=? AND stream_id='s1'`,
      [updatedCriteria, forgeId]
    );

    const oldRows = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH ?`)
      .all(initialCriteria);
    expect(oldRows.length).toBe(0);

    const newRows = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH ?`)
      .all(updatedCriteria);
    expect(newRows.length).toBe(1);

    // Update refactor_notes — new note must be findable
    db.run(
      `UPDATE streams SET refactor_notes=? WHERE forge_id=? AND stream_id='s1'`,
      [updatedNotes, forgeId]
    );

    const noteRows = db
      .query(`SELECT rowid FROM streams_fts WHERE streams_fts MATCH ?`)
      .all(updatedNotes);
    expect(noteRows.length).toBe(1);
  } finally {
    db.close();
  }
});

// ─── Test 6: getSchemaVersion returns 4 after migration ───────────────────────

test("getSchemaVersion returns 4 after migration", () => {
  const version = getSchemaVersion(tmpDir);
  expect(version).toBe(4);
});

// ─── Test 7: v2 DB survives v2→v3 migration ───────────────────────────────────

test("v2 DB seeded with forges + gates + spikes rows survives v2→v3 migration", async () => {
  // Build a v2 DB manually by opening, inserting data, then forcing version=2
  // so the next open triggers the v2→v3 migration path.
  const dbPath = join(tmpDir, ".omc", "forge.db");
  mkdirSync(join(tmpDir, ".omc"), { recursive: true });

  // Open without migration to seed v2 data
  const seedDb = new Database(dbPath);
  seedDb.run("PRAGMA journal_mode = WAL");
  seedDb.run("PRAGMA foreign_keys = ON");

  // Create v1 tables
  seedDb.run(`CREATE TABLE IF NOT EXISTS forges (
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
  seedDb.run(`CREATE TABLE IF NOT EXISTS gates (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER NOT NULL REFERENCES forges(id),
    iteration INTEGER NOT NULL,
    gate TEXT NOT NULL CHECK(gate IN ('skeptic','integration','second_opinion','static')),
    result TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
    findings TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    blind INTEGER DEFAULT 1,
    inputs_seen TEXT DEFAULT '[]',
    meta_findings TEXT DEFAULT '[]'
  )`);
  seedDb.run(`CREATE TABLE IF NOT EXISTS spikes (
    id INTEGER PRIMARY KEY,
    forge_id INTEGER REFERENCES forges(id),
    assumption TEXT NOT NULL,
    result TEXT CHECK(result IN ('confirmed','refuted')),
    actual TEXT,
    tested_at TEXT DEFAULT (datetime('now')),
    permanent INTEGER DEFAULT 0
  )`);

  // Seed rows
  seedDb.run(`INSERT INTO forges (slug, status) VALUES ('v2-forge', 'active')`);
  const forgeId = seedDb.query("SELECT last_insert_rowid() as id").get().id;
  seedDb.run(
    `INSERT INTO gates (forge_id, iteration, gate, result) VALUES (?, 1, 'skeptic', 'PASS')`,
    [forgeId]
  );
  seedDb.run(
    `INSERT INTO spikes (forge_id, assumption, result) VALUES (?, 'test assumption', 'confirmed')`,
    [forgeId]
  );

  // Set user_version = 2 to simulate v2 DB
  seedDb.run("PRAGMA user_version = 2");
  seedDb.close();

  // Now open via openForgeDb — should migrate v2→v3
  const db = openForgeDb(tmpDir);
  try {
    // Existing data must survive
    const forge = db.query("SELECT * FROM forges WHERE slug='v2-forge'").get();
    expect(forge).not.toBeNull();
    expect(forge.slug).toBe("v2-forge");

    const gate = db.query("SELECT * FROM gates WHERE forge_id=?").get(forgeId);
    expect(gate).not.toBeNull();

    const spike = db.query("SELECT * FROM spikes WHERE forge_id=?").get(forgeId);
    expect(spike).not.toBeNull();

    // v3 tables must now exist
    const streams = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='streams'").get();
    expect(streams).not.toBeNull();

    const contracts = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_contracts'")
      .get();
    expect(contracts).not.toBeNull();

    // Version must be 4 (current SCHEMA_VERSION)
    const ver = db.query("PRAGMA user_version").get().user_version;
    expect(ver).toBe(4);
  } finally {
    db.close();
  }
});

// ─── Test 8: unique index (forge_id, stream_id) rejects duplicates ────────────

test("unique index (forge_id, stream_id) rejects duplicates", () => {
  const db = freshDb();
  try {
    db.run(`INSERT INTO forges (slug, status) VALUES ('uniq-forge', 'active')`);
    const forgeId = db.query("SELECT last_insert_rowid() as id").get().id;

    db.run(
      `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, acceptance_criteria)
       VALUES (?, 's1', 'pending', 'bun test', '[]')`,
      [forgeId]
    );

    expect(() => {
      db.run(
        `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, acceptance_criteria)
         VALUES (?, 's1', 'pending', 'bun test', '[]')`,
        [forgeId]
      );
    }).toThrow();
  } finally {
    db.close();
  }
});

// ─── Test 9: openForgeDb sets journal_mode=WAL and busy_timeout=5000 ─────────

test("openForgeDb sets journal_mode=wal and busy_timeout=5000 on every open", () => {
  const db = freshDb();
  try {
    const journalMode = db.query("PRAGMA journal_mode").get().journal_mode;
    expect(journalMode).toBe("wal");

    const busyTimeout = db.query("PRAGMA busy_timeout").get().timeout;
    expect(busyTimeout).toBe(5000);
  } finally {
    db.close();
  }
});
