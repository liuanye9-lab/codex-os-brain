'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;
const SQLITE_RETRY_WAIT = new Int32Array(new SharedArrayBuffer(4));

function sessionScopeId(value) {
  return crypto.createHash('sha256').update(String(value || 'default')).digest('hex').slice(0, 24);
}

function retrySqliteBusy(fn, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      const busy = error?.errcode === 5 || /database is (?:locked|busy)/i.test(String(error?.message || ''));
      if (!busy || attempt === attempts - 1) throw error;
      Atomics.wait(SQLITE_RETRY_WAIT, 0, 0, 20);
    }
  }
  throw new Error('sqlite_busy_retry_exhausted');
}

function openControlDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA busy_timeout=5000');
  retrySqliteBusy(() => db.exec('PRAGMA journal_mode=WAL'));
  db.exec('PRAGMA synchronous=FULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_schema (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS control_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_sessions (
      session_id TEXT PRIMARY KEY,
      active_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_id TEXT,
      kind TEXT NOT NULL,
      status TEXT,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failure_circuits (
      session_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, operation)
    );
    CREATE TABLE IF NOT EXISTS task_contracts (
      task_id TEXT PRIMARY KEY,
      bound_session_id TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      contract_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      spec_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(bound_session_id) REFERENCES harness_sessions(session_id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS harness_events_session_time ON harness_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS harness_events_task_time ON harness_events(task_id, created_at);
  `);
  const taskColumns = db.prepare("SELECT name FROM pragma_table_info('task_contracts')").all().map(row => row.name);
  if (taskColumns.length > 0 && (!taskColumns.includes('bound_session_id') || !taskColumns.includes('active'))) {
    transaction(db, () => {
      db.exec('DROP INDEX IF EXISTS task_contracts_active_session');
      db.exec('ALTER TABLE task_contracts RENAME TO task_contracts_v1');
      db.exec(`
        CREATE TABLE task_contracts (
          task_id TEXT PRIMARY KEY,
          bound_session_id TEXT,
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
          contract_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          spec_hash TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(bound_session_id) REFERENCES harness_sessions(session_id) ON DELETE SET NULL
        );
        INSERT INTO task_contracts(task_id, bound_session_id, active, contract_json, revision, spec_hash, created_at, updated_at)
        SELECT task_id, session_id, 1, contract_json, revision, NULL, updated_at, updated_at FROM task_contracts_v1;
        DROP TABLE task_contracts_v1;
      `);
    });
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS task_contracts_active_session
      ON task_contracts(bound_session_id) WHERE bound_session_id IS NOT NULL AND active=1;
    CREATE INDEX IF NOT EXISTS task_contracts_active_updated ON task_contracts(active, updated_at);
    CREATE TABLE IF NOT EXISTS worktree_leases (
      worktree_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      acquired_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES task_contracts(task_id) ON DELETE CASCADE
    );
  `);
  db.prepare('INSERT OR IGNORE INTO control_schema(version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
  try { fs.chmodSync(dbPath, 0o600); } catch {}
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function parseContract(row) {
  if (!row) return null;
  try { return JSON.parse(row.contract_json); }
  catch { throw new Error('task_contract_corrupt'); }
}

function contractWorktreeId(contract) {
  for (const criterion of contract?.criteria || []) {
    const worktreeId = criterion?.verifierSpec?.baseline?.worktreeId;
    if (worktreeId) return String(worktreeId);
  }
  return null;
}

function insertEvent(db, event, scopedSessionId) {
  const encoded = JSON.stringify(event);
  const existing = db.prepare('SELECT event_json FROM harness_events WHERE event_id=?').get(event.eventId);
  if (existing) {
    if (existing.event_json !== encoded) throw new Error('event_id_conflict');
    return false;
  }
  db.prepare(`
    INSERT INTO harness_events(event_id, session_id, task_id, kind, status, event_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.eventId,
    scopedSessionId,
    event.taskId || null,
    event.kind,
    event.status || null,
    encoded,
    event.createdAt,
  );
  return true;
}

function createControlStore({ dbPath, sessionId = 'default', taskId } = {}) {
  if (!dbPath) throw new Error('control_db_path_required');
  const rawSessionId = String(sessionId || 'default');
  const scopedSessionId = sessionScopeId(rawSessionId);
  const unboundSession = rawSessionId === 'default';
  const selectedTaskId = taskId ? String(taskId) : null;

  function withDb(fn) {
    const db = openControlDatabase(dbPath);
    try { return fn(db); }
    finally { db.close(); }
  }

  function ensureSession(db, now = new Date().toISOString()) {
    db.prepare(`
      INSERT OR IGNORE INTO harness_sessions(session_id, active_task_id, created_at, updated_at)
      VALUES (?, NULL, ?, ?)
    `).run(scopedSessionId, now, now);
  }

  function stateFromRow(row) {
    if (!row) return { expected: false, contract: null, missing: false, corrupt: false };
    try {
      return { expected: true, contract: parseContract(row), missing: false, corrupt: false };
    } catch {
      return { expected: true, contract: null, missing: false, corrupt: true };
    }
  }

  return {
    dbPath,
    sessionId: scopedSessionId,
    isDefaultSession: unboundSession,
    createTask(contract) {
      return withDb(db => transaction(db, () => {
        const now = new Date().toISOString();
        if (db.prepare('SELECT 1 FROM task_contracts WHERE task_id=?').get(contract.taskId)) {
          throw new Error('task_id_exists');
        }
        let binding = null;
        if (unboundSession) {
          const pending = Number(db.prepare('SELECT COUNT(*) AS count FROM task_contracts WHERE active=1 AND bound_session_id IS NULL').get().count);
          if (pending > 0) throw new Error('unbound_task_exists_use_session');
        } else {
          ensureSession(db, now);
          const session = db.prepare('SELECT active_task_id FROM harness_sessions WHERE session_id=?').get(scopedSessionId);
          if (session?.active_task_id) throw new Error('session_already_has_active_task');
          binding = scopedSessionId;
        }
        db.prepare(`
          INSERT INTO task_contracts(task_id, bound_session_id, active, contract_json, revision, spec_hash, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `).run(
          contract.taskId,
          binding,
          JSON.stringify(contract),
          Number(contract.revision || 1),
          contract.trust?.specHash || null,
          now,
          now,
        );
        if (binding) {
          db.prepare('UPDATE harness_sessions SET active_task_id=?, updated_at=? WHERE session_id=?')
            .run(contract.taskId, now, binding);
        }
        const worktreeId = contract.executionMode === 'read_only' ? null : contractWorktreeId(contract);
        if (worktreeId) {
          try {
            db.prepare('INSERT INTO worktree_leases(worktree_id, task_id, acquired_at) VALUES (?, ?, ?)')
              .run(worktreeId, contract.taskId, now);
          } catch (error) {
            if (String(error.message).includes('UNIQUE')) throw new Error('worktree_write_lease_conflict');
            throw error;
          }
        }
        insertEvent(db, {
          schemaVersion: 9,
          eventId: `evt_${crypto.randomBytes(12).toString('hex')}`,
          taskId: contract.taskId,
          kind: 'checkpoint',
          status: 'observed',
          reasonCode: 'task_created',
          createdAt: now,
        }, scopedSessionId);
        return contract;
      }));
    },
    saveTask(contract, { expectedRevision = Number(contract.revision || 1) - 1 } = {}) {
      return withDb(db => transaction(db, () => {
        const current = db.prepare('SELECT revision, bound_session_id, active FROM task_contracts WHERE task_id=?').get(contract.taskId);
        if (!current) throw new Error('task_not_found');
        if (Number(current.revision) !== Number(expectedRevision)) throw new Error('task_revision_conflict');
        const active = contract.lifecycle === 'complete' ? 0 : 1;
        const now = new Date().toISOString();
        const result = db.prepare(`
          UPDATE task_contracts
          SET active=?, contract_json=?, revision=?, spec_hash=?, updated_at=?
          WHERE task_id=? AND revision=?
        `).run(
          active,
          JSON.stringify(contract),
          Number(contract.revision || 1),
          contract.trust?.specHash || null,
          now,
          contract.taskId,
          Number(expectedRevision),
        );
        if (Number(result.changes) !== 1) throw new Error('task_revision_conflict');
        if (!active && current.bound_session_id) {
          db.prepare('UPDATE harness_sessions SET active_task_id=NULL, updated_at=? WHERE session_id=? AND active_task_id=?')
            .run(now, current.bound_session_id, contract.taskId);
        }
        if (!active) db.prepare('DELETE FROM worktree_leases WHERE task_id=?').run(contract.taskId);
        return contract;
      }));
    },
    saveTaskAndEvent(contract, event, { expectedRevision = Number(contract.revision || 1) - 1 } = {}) {
      return withDb(db => transaction(db, () => {
        const current = db.prepare('SELECT revision, bound_session_id FROM task_contracts WHERE task_id=?').get(contract.taskId);
        if (!current) throw new Error('task_not_found');
        if (Number(current.revision) !== Number(expectedRevision)) throw new Error('task_revision_conflict');
        const active = contract.lifecycle === 'complete' ? 0 : 1;
        const now = new Date().toISOString();
        const updated = db.prepare(`
          UPDATE task_contracts
          SET active=?, contract_json=?, revision=?, spec_hash=?, updated_at=?
          WHERE task_id=? AND revision=?
        `).run(active, JSON.stringify(contract), Number(contract.revision || 1), contract.trust?.specHash || null,
          now, contract.taskId, Number(expectedRevision));
        if (Number(updated.changes) !== 1) throw new Error('task_revision_conflict');
        insertEvent(db, event, scopedSessionId);
        if (!active && current.bound_session_id) {
          db.prepare('UPDATE harness_sessions SET active_task_id=NULL, updated_at=? WHERE session_id=? AND active_task_id=?')
            .run(now, current.bound_session_id, contract.taskId);
        }
        if (!active) db.prepare('DELETE FROM worktree_leases WHERE task_id=?').run(contract.taskId);
        return contract;
      }));
    },
    getTask(requestedTaskId) {
      if (!requestedTaskId) return null;
      return withDb(db => stateFromRow(
        db.prepare('SELECT contract_json FROM task_contracts WHERE task_id=?').get(String(requestedTaskId)),
      ).contract);
    },
    rollbackCreate(requestedTaskId, expectedSpecHash) {
      if (!requestedTaskId) return false;
      return withDb(db => transaction(db, () => {
        const row = db.prepare('SELECT spec_hash FROM task_contracts WHERE task_id=?').get(String(requestedTaskId));
        if (!row || row.spec_hash !== expectedSpecHash) return false;
        db.prepare('DELETE FROM task_contracts WHERE task_id=?').run(String(requestedTaskId));
        db.prepare('UPDATE harness_sessions SET active_task_id=NULL, updated_at=? WHERE active_task_id=?')
          .run(new Date().toISOString(), String(requestedTaskId));
        return true;
      }));
    },
    activeState() {
      return withDb(db => transaction(db, () => {
        if (selectedTaskId) {
          const row = db.prepare('SELECT contract_json FROM task_contracts WHERE task_id=? AND active=1').get(selectedTaskId);
          return row
            ? stateFromRow(row)
            : { expected: true, contract: null, missing: true, corrupt: false, selectedTaskId };
        }
        if (!unboundSession) {
          const session = db.prepare('SELECT active_task_id FROM harness_sessions WHERE session_id=?').get(scopedSessionId);
          if (session?.active_task_id) {
            const row = db.prepare('SELECT contract_json FROM task_contracts WHERE task_id=? AND active=1').get(session.active_task_id);
            return row ? stateFromRow(row) : { expected: true, contract: null, missing: true, corrupt: false };
          }
          const pending = db.prepare('SELECT task_id, contract_json FROM task_contracts WHERE active=1 AND bound_session_id IS NULL ORDER BY created_at').all();
          if (pending.length > 1) return { expected: true, contract: null, missing: true, corrupt: false, ambiguous: true };
          if (pending.length === 0) return { expected: false, contract: null, missing: false, corrupt: false };
          const now = new Date().toISOString();
          ensureSession(db, now);
          db.prepare('UPDATE task_contracts SET bound_session_id=?, updated_at=? WHERE task_id=? AND bound_session_id IS NULL AND active=1')
            .run(scopedSessionId, now, pending[0].task_id);
          db.prepare('UPDATE harness_sessions SET active_task_id=?, updated_at=? WHERE session_id=?')
            .run(pending[0].task_id, now, scopedSessionId);
          return stateFromRow(pending[0]);
        }
        const active = db.prepare('SELECT task_id, contract_json FROM task_contracts WHERE active=1 ORDER BY created_at').all();
        if (active.length > 1) return { expected: true, contract: null, missing: true, corrupt: false, ambiguous: true };
        return active.length === 1 ? stateFromRow(active[0]) : { expected: false, contract: null, missing: false, corrupt: false };
      }));
    },
    activeTask() {
      return this.activeState().contract;
    },
    appendEvent(event) {
      return withDb(db => transaction(db, () => {
        insertEvent(db, event, scopedSessionId);
        return event;
      }));
    },
    listEvents({ limit = 100, requestedTaskId } = {}) {
      return withDb(db => {
        const bounded = Math.max(1, Math.min(1000, Number(limit || 100)));
        const eventTaskId = requestedTaskId || selectedTaskId;
        const rows = eventTaskId
          ? db.prepare('SELECT event_json FROM harness_events WHERE task_id=? ORDER BY created_at DESC LIMIT ?')
            .all(eventTaskId, bounded)
          : db.prepare('SELECT event_json FROM harness_events WHERE session_id=? ORDER BY created_at DESC LIMIT ?')
            .all(scopedSessionId, bounded);
        return rows.reverse().flatMap(row => {
          try { return [JSON.parse(row.event_json)]; } catch { return []; }
        });
      });
    },
    updateCircuit(operation, updater) {
      const key = String(operation || 'unknown');
      return withDb(db => transaction(db, () => {
        const row = db.prepare('SELECT state_json FROM failure_circuits WHERE session_id=? AND operation=?')
          .get(scopedSessionId, key);
        let current = { signature: null, operation: key, consecutive: 0, status: 'closed' };
        if (row) {
          try { current = JSON.parse(row.state_json); } catch { throw new Error('failure_circuit_corrupt'); }
        }
        const next = updater(current);
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO failure_circuits(session_id, operation, state_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id, operation) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at
        `).run(scopedSessionId, key, JSON.stringify(next), now);
        return next;
      }));
    },
    circuitStatus(operation) {
      return withDb(db => {
        if (operation) {
          const row = db.prepare('SELECT state_json FROM failure_circuits WHERE session_id=? AND operation=?')
            .get(scopedSessionId, String(operation));
          return row ? JSON.parse(row.state_json) : { signature: null, operation: String(operation), consecutive: 0, status: 'closed' };
        }
        return db.prepare('SELECT state_json FROM failure_circuits WHERE session_id=? ORDER BY operation').all(scopedSessionId)
          .map(row => JSON.parse(row.state_json));
      });
    },
    // Circuits are per-session because breaking a retry loop is a within-session concern.
    // Recall is the opposite: its whole value is telling a *new* session what an earlier
    // one already learned, so it reads the project instead. Rows are collapsed per
    // operation, keeping the worst streak, so one operation cannot flood the replay.
    projectCircuits({ minConsecutive = 2, limit = 10 } = {}) {
      return withDb(db => {
        const rows = db.prepare('SELECT operation, state_json, updated_at FROM failure_circuits ORDER BY updated_at DESC').all();
        const worst = new Map();
        for (const row of rows) {
          let state;
          try { state = JSON.parse(row.state_json); } catch { continue; }
          if (!state || Number(state.consecutive) < minConsecutive) continue;
          if (state.status === 'closed') continue;
          const key = String(state.operation || row.operation || 'unknown');
          const previous = worst.get(key);
          if (!previous || Number(state.consecutive) > Number(previous.consecutive)) {
            worst.set(key, { ...state, operation: key, updatedAt: row.updated_at });
          }
        }
        return [...worst.values()]
          .sort((a, b) => Number(b.consecutive) - Number(a.consecutive))
          .slice(0, limit);
      });
    },
    importLegacy({ contract, guardExpected = false, events = [] } = {}) {
      return withDb(db => transaction(db, () => {
        const existing = db.prepare('SELECT value_json FROM control_meta WHERE key=?').get('legacy-import-v1');
        if (existing) return JSON.parse(existing.value_json);
        const now = new Date().toISOString();
        let taskImported = false;
        if (contract?.taskId && !db.prepare('SELECT 1 FROM task_contracts WHERE task_id=?').get(contract.taskId)) {
          db.prepare(`
            INSERT INTO task_contracts(task_id, bound_session_id, active, contract_json, revision, spec_hash, created_at, updated_at)
            VALUES (?, NULL, 1, ?, ?, ?, ?, ?)
          `).run(contract.taskId, JSON.stringify(contract), Number(contract.revision || 1), contract.trust?.specHash || null, now, now);
          taskImported = true;
        }
        let eventsImported = 0;
        for (const event of events) {
          if (!event?.eventId || !event?.kind || !event?.createdAt) continue;
          const result = db.prepare(`
            INSERT OR IGNORE INTO harness_events(event_id, session_id, task_id, kind, status, event_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(event.eventId, sessionScopeId('legacy'), event.taskId || null, event.kind, event.status || null, JSON.stringify(event), event.createdAt);
          eventsImported += Number(result.changes);
        }
        const receipt = { version: 1, taskImported, eventsImported, guardExpected, importedAt: now };
        db.prepare('INSERT INTO control_meta(key, value_json, updated_at) VALUES (?, ?, ?)')
          .run('legacy-import-v1', JSON.stringify(receipt), now);
        return receipt;
      }));
    },
    integrity() {
      return withDb(db => {
        const quick = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
        const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
        return {
          passed: quick.length === 1 && quick[0] === 'ok' && foreignKeys.length === 0,
          quickCheck: quick,
          foreignKeyErrors: foreignKeys.length,
        };
      });
    },
  };
}

module.exports = { SCHEMA_VERSION, createControlStore, openControlDatabase, sessionScopeId, transaction };
