/**
 * Forge Intelligence — CRUD Operations
 *
 * Create/park/resume/complete/abandon forges.
 * Record gates, spikes. Aggregate risk. Update co-failures.
 */

import { openForgeDb } from "./forge-schema.mjs";

// ── DB helper ──────────────────────────────────────────
/** Open db, run fn(db), close unconditionally. Returns fn's result. */
function withDb(cwd, fn) {
  const db = openForgeDb(cwd);
  try { return fn(db); } finally { db.close(); }
}

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

export function recordGate(cwd, forgeId, iteration, gate, result, findings = [], { blind = 1, inputsSeen = [], metaFindings = [] } = {}) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `INSERT OR REPLACE INTO gates (forge_id, iteration, gate, result, findings, blind, inputs_seen, meta_findings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [forgeId, iteration, gate, result, JSON.stringify(findings), blind, JSON.stringify(inputsSeen), JSON.stringify(metaFindings)]
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

// ── Visionary ──────────────────────────────────────────

export function recordVisionaryPass(cwd, forgeId, iteration, { passNumber, angle, agent, content }) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `INSERT OR IGNORE INTO visionary_passes (forge_id, iteration, pass_number, angle, agent, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [forgeId, iteration, passNumber, angle, agent, content]
    );
  } finally { db.close(); }
}

export function listVisionaryPasses(cwd, forgeId, iteration) {
  const db = openForgeDb(cwd);
  try {
    return db.query(
      `SELECT * FROM visionary_passes WHERE forge_id = ? AND iteration = ? ORDER BY pass_number`
    ).all(forgeId, iteration);
  } finally { db.close(); }
}

// ── Comparator ─────────────────────────────────────────

export function recordComparatorReport(cwd, forgeId, iteration, { tldr, diffItems, realityCheck, recommendation }) {
  const db = openForgeDb(cwd);
  try {
    // camelCase → snake_case mapping: diffItems → diff_items, realityCheck → reality_check
    db.run(
      `INSERT OR REPLACE INTO comparator_reports (forge_id, iteration, tldr, diff_items, reality_check, recommendation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [forgeId, iteration, tldr, JSON.stringify(diffItems), JSON.stringify(realityCheck), recommendation]
    );
  } finally { db.close(); }
}

export function updateComparatorDecision(cwd, forgeId, iteration, decision) {
  const db = openForgeDb(cwd);
  try {
    db.run(
      `UPDATE comparator_reports SET user_decision = ? WHERE forge_id = ? AND iteration = ?`,
      [decision, forgeId, iteration]
    );
  } finally { db.close(); }
}

export function getComparatorReport(cwd, forgeId, iteration) {
  const db = openForgeDb(cwd);
  try {
    return db.query(
      `SELECT * FROM comparator_reports WHERE forge_id = ? AND iteration = ?`
    ).get(forgeId, iteration);
  } finally { db.close(); }
}

// ── Claims ─────────────────────────────────────────────

export function recordClaim(cwd, forgeId, iteration, stepNumber, { claimType, claimText, citation = null }) {
  const db = openForgeDb(cwd);
  try {
    // camelCase → snake_case: claimType → claim_type, claimText → claim_text
    const result = db.run(
      `INSERT INTO claim_validations (forge_id, iteration, step_number, claim_type, claim_text, citation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [forgeId, iteration, stepNumber, claimType, claimText, citation]
    );
    return Number(result.lastInsertRowid);  // iter-6 C1 fix: matches createForge/spawnForge pattern
  } finally { db.close(); }
}

export function validateClaim(cwd, claimId, { result, notes = null }) {
  const db = openForgeDb(cwd);
  try {
    // result → validation_result, notes → validation_notes
    db.run(
      `UPDATE claim_validations SET validation_result = ?, validation_notes = ? WHERE id = ?`,
      [result, notes, claimId]
    );
  } finally { db.close(); }
}

export function listClaims(cwd, forgeId, iteration) {
  const db = openForgeDb(cwd);
  try {
    return db.query(
      `SELECT * FROM claim_validations WHERE forge_id = ? AND iteration = ? ORDER BY step_number, id`
    ).all(forgeId, iteration);
  } finally { db.close(); }
}

export function getClaimSummary(cwd, forgeId, iteration) {
  const db = openForgeDb(cwd);
  try {
    const rows = db.query(
      `SELECT claim_type, validation_result, COUNT(*) as count
       FROM claim_validations WHERE forge_id = ? AND iteration = ?
       GROUP BY claim_type, validation_result`
    ).all(forgeId, iteration);

    const summary = { fact: {}, design_bet: {}, strategic: {} };
    for (const row of rows) {
      const type = row.claim_type;
      const result = row.validation_result || 'pending';
      if (summary[type]) summary[type][result] = row.count;
    }
    return summary;
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

// ── Streams (pipeline-v3) ───────────────────────────────

export function createStream(cwd, forgeId, { streamId, verifierCmd, touchesFiles = [], acceptanceCriteria = [], dependsOn = [] }) {
  return withDb(cwd, db => {
    const result = db.run(
      `INSERT INTO streams (forge_id, stream_id, status, verifier_cmd, touches_files, acceptance_criteria, depends_on)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      [forgeId, streamId, verifierCmd, JSON.stringify(touchesFiles), JSON.stringify(acceptanceCriteria), JSON.stringify(dependsOn)]
    );
    return Number(result.lastInsertRowid);
  });
}

export function updateStreamStatus(cwd, streamRowId, status, completedAt = null) {
  withDb(cwd, db => {
    if (completedAt) {
      db.run(`UPDATE streams SET status = ?, completed_at = ? WHERE id = ?`, [status, completedAt, streamRowId]);
    } else {
      db.run(`UPDATE streams SET status = ? WHERE id = ?`, [status, streamRowId]);
    }
  });
}

export function setTddEvidence(cwd, streamRowId, evidence) {
  // Always writes both columns atomically
  const refactorNotes = typeof evidence.refactor_notes === 'string' ? evidence.refactor_notes : '';
  withDb(cwd, db => {
    db.run(
      `UPDATE streams SET tdd_evidence = ?, refactor_notes = ? WHERE id = ?`,
      [JSON.stringify(evidence), refactorNotes, streamRowId]
    );
  });
}

export function listStreams(cwd, forgeId, statusFilter = null) {
  return withDb(cwd, db => {
    if (statusFilter) {
      return db.query(`SELECT * FROM streams WHERE forge_id = ? AND status = ? ORDER BY id`).all(forgeId, statusFilter);
    }
    return db.query(`SELECT * FROM streams WHERE forge_id = ? ORDER BY id`).all(forgeId);
  });
}

export function searchStreams(cwd, query) {
  return withDb(cwd, db =>
    db.query(
      `SELECT s.* FROM streams_fts sf
       JOIN streams s ON s.id = sf.rowid
       WHERE streams_fts MATCH ?
       ORDER BY sf.rank LIMIT 20`
    ).all(query)
  );
}

// ── Integration Contracts (pipeline-v3) ─────────────────

export function createIntegrationContract(cwd, forgeId, { contractName, testCmd }) {
  return withDb(cwd, db => {
    const result = db.run(
      `INSERT INTO integration_contracts (forge_id, contract_name, test_cmd) VALUES (?, ?, ?)`,
      [forgeId, contractName, testCmd]
    );
    return Number(result.lastInsertRowid);
  });
}

export function updateContractStatus(cwd, contractRowId, status, failureOutput = null) {
  withDb(cwd, db => {
    db.run(
      `UPDATE integration_contracts SET status = ?, failure_output = ? WHERE id = ?`,
      [status, failureOutput, contractRowId]
    );
  });
}

export function listIntegrationContracts(cwd, forgeId, statusFilter = null) {
  return withDb(cwd, db => {
    if (statusFilter) {
      return db.query(`SELECT * FROM integration_contracts WHERE forge_id = ? AND status = ? ORDER BY id`).all(forgeId, statusFilter);
    }
    return db.query(`SELECT * FROM integration_contracts WHERE forge_id = ? ORDER BY id`).all(forgeId);
  });
}

// ── Forge Context + Block (pipeline-v3) ──────────────────

export function blockForge(cwd, forgeId, reason) {
  withDb(cwd, db => {
    db.run(
      `UPDATE forges SET status = 'blocked', blocking_reason = ?, updated_at = datetime('now') WHERE id = ?`,
      [reason, forgeId]
    );
  });
}

/**
 * setForgeContext — scalar merge into forges.context JSON at $.key.
 * Value is stored VERBATIM (scalars: boolean, number, string). Arrays/objects
 * stored via this helper become JSON-encoded strings, NOT nested structures.
 * Booleans: bind as JSON literal via json(?) so readback + JSON.parse round-trips
 * to JS boolean, not SQLite-coerced integer 1/0.
 * iter-5 readback test (getForgeContext(...).pipelineV3 === true) guards this codepath.
 */
export function setForgeContext(cwd, forgeId, key, value) {
  withDb(cwd, db => {
    const isBool = typeof value === 'boolean';
    const sql = isBool
      ? `UPDATE forges SET context = json_set(COALESCE(context,'{}'), ?, json(?)), updated_at = datetime('now') WHERE id = ?`
      : `UPDATE forges SET context = json_set(COALESCE(context,'{}'), ?, ?), updated_at = datetime('now') WHERE id = ?`;
    const bind = isBool
      ? [('$.' + key), (value ? 'true' : 'false'), forgeId]
      : [('$.' + key), value, forgeId];
    db.run(sql, bind);
  });
}

export function getForgeContext(cwd, forgeId, key = null) {
  return withDb(cwd, db => {
    const forge = db.query("SELECT context FROM forges WHERE id = ?").get(forgeId);
    const ctx = forge && forge.context ? JSON.parse(forge.context) : {};
    if (key !== null) return ctx[key];
    return ctx;
  });
}

/**
 * discardStreamState — iter-7 Day-2 R2 discard-and-restart helper.
 * Preserves: forges row, gates, claim_validations.
 * Wipes: streams, integration_contracts, integration_failure_history from context.
 * Resets: iteration=1, phase='bf-plan-draft', status='active'.
 */
export function discardStreamState(cwd, forgeId) {
  withDb(cwd, db => {
    db.run('BEGIN IMMEDIATE');
    try {
      db.run(`DELETE FROM integration_contracts WHERE forge_id = ?`, [forgeId]);
      db.run(`DELETE FROM streams WHERE forge_id = ?`, [forgeId]);
      db.run(
        `UPDATE forges SET
           iteration = 1,
           phase = 'bf-plan-draft',
           context = json_remove(COALESCE(context, '{}'), '$.integration_failure_history'),
           blocking_reason = NULL,
           status = 'active',
           updated_at = datetime('now')
         WHERE id = ?`,
        [forgeId]
      );
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
  });
}

// ── Re-plan on integration failure (pipeline-v3 Task 3.3) ──────────────────

const REPLAN_CAP = 5;

/**
 * reEnterPlanning — called when integration gate has ≥1 failing contract.
 *
 * - At iteration < REPLAN_CAP: increments iteration, sets phase='bf-plan-draft',
 *   appends {iteration, contracts, timestamp} to context.integration_failure_history.
 *   Streams rows are NOT deleted (preserved for reference).
 * - At iteration === REPLAN_CAP: calls blockForge with cap-exceeded reason,
 *   does NOT increment further.
 */
export function reEnterPlanning(cwd, forgeId) {
  return withDb(cwd, db => {
    const forge = db.query("SELECT iteration, context FROM forges WHERE id = ?").get(forgeId);
    if (!forge) throw new Error(`Forge not found: ${forgeId}`);

    const iteration = forge.iteration;

    if (iteration >= REPLAN_CAP) {
      db.run(
        `UPDATE forges SET status = 'blocked', blocking_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        [`integration-replan cap (5) exceeded`, forgeId]
      );
      return;
    }

    // Collect failing contracts for history
    const failingContracts = db.query(
      `SELECT id, contract_name, test_cmd, failure_output FROM integration_contracts WHERE forge_id = ? AND status = 'fail'`
    ).all(forgeId);

    // Build updated integration_failure_history
    const ctx = forge.context ? JSON.parse(forge.context) : {};
    const history = Array.isArray(ctx.integration_failure_history) ? ctx.integration_failure_history : [];
    history.push({
      iteration,
      contracts: failingContracts.map(c => ({
        contract_name: c.contract_name,
        test_cmd: c.test_cmd,
        failure_output: c.failure_output,
      })),
      timestamp: new Date().toISOString(),
    });

    const newIteration = iteration + 1;

    db.run(
      `UPDATE forges SET
         iteration = ?,
         phase = 'bf-plan-draft',
         context = json_set(COALESCE(context, '{}'), '$.integration_failure_history', json(?)),
         updated_at = datetime('now')
       WHERE id = ?`,
      [newIteration, JSON.stringify(history), forgeId]
    );
  });
}

/**
 * dispatchIntegrationResult — branching helper testable by unit tests.
 *
 * allPass=true  → calls completeForge (integration succeeded)
 * allPass=false → calls reEnterPlanning (integration failed, re-plan)
 */
export function dispatchIntegrationResult(cwd, forgeId, { allPass, lesson = null }) {
  if (allPass) {
    completeForge(cwd, forgeId, lesson);
  } else {
    reEnterPlanning(cwd, forgeId);
  }
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

// ── Operator override audit (ADR §9 Q3, resolved 2026-04-14) ──────────────
// Setting tdd_required_disabled or pipelineV3=false is a deliberate override
// that bypasses the forge's safety discipline. Require a reason and record a
// strategic claim for audit so operators can't quietly erode enforcement.

export function disableTdd(cwd, forgeId, reason) {
  if (typeof reason !== "string" || reason.trim().length < 3) {
    throw new Error(
      "disableTdd requires a reason (≥3 chars) — this is an audited override. " +
      "Pass a sentence explaining why TDD enforcement is being skipped for this forge.",
    );
  }
  return withDb(cwd, (db) => {
    const row = db.query("SELECT iteration FROM forges WHERE id = ?").get(forgeId);
    if (!row) throw new Error(`disableTdd: forge ${forgeId} not found`);
    db.run(
      `UPDATE forges SET context = json_set(COALESCE(context,'{}'),
        '$.tdd_required_disabled', json('true')), updated_at = datetime('now') WHERE id = ?`,
      [forgeId],
    );
    const result = db.run(
      `INSERT INTO claim_validations (forge_id, iteration, step_number, claim_type, claim_text, citation, validation_result, validation_notes)
       VALUES (?, ?, 0, 'strategic', ?, 'operator-override', 'verified', ?)`,
      [forgeId, row.iteration, `TDD enforcement disabled: ${reason.trim()}`, reason.trim()],
    );
    return Number(result.lastInsertRowid);
  });
}

export function enableTdd(cwd, forgeId) {
  return withDb(cwd, (db) => {
    db.run(
      `UPDATE forges SET context = json_remove(COALESCE(context,'{}'),
        '$.tdd_required_disabled'), updated_at = datetime('now') WHERE id = ?`,
      [forgeId],
    );
  });
}

// ── Cross-forge stream sharing (ADR §9 Q2, detect-only 2026-04-14) ────────
// Detects streams across forges that are structurally identical — same sorted
// touches_files + same verifier_cmd — so an operator can spot duplicate work.
// Detection only; execution sharing is deferred (each forge still runs its
// own stream independently, preserving audit/isolation).

export function detectSharedStreams(cwd) {
  return withDb(cwd, (db) => {
    const rows = db.query(
      `SELECT id, forge_id, stream_id, touches_files, verifier_cmd FROM streams`,
    ).all();
    const buckets = new Map();
    for (const row of rows) {
      const files = JSON.parse(row.touches_files || "[]").slice().sort();
      if (files.length === 0) continue;
      const key = JSON.stringify([files, row.verifier_cmd]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({
        rowId: row.id,
        forgeId: row.forge_id,
        streamId: row.stream_id,
        touchesFiles: files,
        verifierCmd: row.verifier_cmd,
      });
    }
    const dupes = [];
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      const forgeIds = new Set(group.map((s) => s.forgeId));
      if (forgeIds.size < 2) continue; // same forge twice = intra-forge, not cross
      dupes.push({
        touchesFiles: group[0].touchesFiles,
        verifierCmd: group[0].verifierCmd,
        occurrences: group,
      });
    }
    return dupes;
  });
}
