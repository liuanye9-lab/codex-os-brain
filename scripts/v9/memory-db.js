'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { resolveV9Paths } = require('./paths');

const SCHEMA_VERSION = 1;

function openMemoryDatabase({ paths = resolveV9Paths(), dbPath = paths.memoryDbPath, readonly = false, ignoreRestoreLock = false } = {}) {
  if (!ignoreRestoreLock && fs.existsSync(paths.memoryRestoreLockPath)) throw new Error('memory_restore_in_progress');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { readOnly: readonly, enableForeignKeyConstraints: true });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readonly) {
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');
    migrate(db);
    try { fs.chmodSync(dbPath, 0o600); } catch { /* best effort */ }
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const current = Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
  if (current >= SCHEMA_VERSION) return current;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE memory_items (
        memory_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL CHECK(length(trim(content)) > 0),
        status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed','rejected','retired')),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
        privacy TEXT NOT NULL DEFAULT 'private' CHECK(privacy IN ('private','restricted','public')),
        source_uri TEXT,
        valid_from TEXT,
        valid_to TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX memory_items_status_kind ON memory_items(status, kind);
      CREATE INDEX memory_items_validity ON memory_items(valid_from, valid_to);

      CREATE TABLE source_documents (
        document_id TEXT PRIMARY KEY,
        source_uri TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL CHECK(length(trim(content)) > 0),
        content_hash TEXT NOT NULL UNIQUE,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX source_documents_uri ON source_documents(source_uri);

      CREATE VIRTUAL TABLE search_index USING fts5(
        owner_type UNINDEXED,
        owner_id UNINDEXED,
        title,
        content,
        tokenize='trigram'
      );

      CREATE TABLE embeddings (
        owner_type TEXT NOT NULL CHECK(owner_type IN ('memory','document','entity')),
        owner_id TEXT NOT NULL,
        model TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK(dimensions > 0),
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(owner_type, owner_id, fingerprint)
      );
      CREATE INDEX embeddings_fingerprint ON embeddings(fingerprint, owner_type);

      CREATE TABLE memory_events (
        event_id TEXT PRIMARY KEY,
        memory_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        from_version INTEGER,
        to_version INTEGER,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memory_items(memory_id)
      );
      CREATE INDEX memory_events_memory_time ON memory_events(memory_id, created_at);

      CREATE TABLE entities (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(entity_type, name)
      );

      CREATE TABLE edges (
        edge_id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('candidate','active','retired','rejected')),
        weight REAL NOT NULL DEFAULT 1 CHECK(weight >= 0 AND weight <= 1),
        valid_from TEXT,
        valid_to TEXT,
        provenance_uri TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(from_entity_id) REFERENCES entities(entity_id),
        FOREIGN KEY(to_entity_id) REFERENCES entities(entity_id),
        UNIQUE(from_entity_id, to_entity_id, relation, valid_from),
        CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX edges_from_relation ON edges(from_entity_id, relation, status);
      CREATE INDEX edges_to_relation ON edges(to_entity_id, relation, status);

      CREATE TABLE agent_state_blocks (
        block_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('working','core','project','archival','external')),
        content TEXT NOT NULL,
        access_mode TEXT NOT NULL DEFAULT 'read_write' CHECK(access_mode IN ('read_write','read_only')),
        version INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_id, scope, block_id)
      );
      CREATE INDEX agent_state_agent_scope ON agent_state_blocks(agent_id, scope);

      CREATE TABLE retrieval_feedback (
        feedback_id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL,
        owner_type TEXT,
        owner_id TEXT,
        rank INTEGER,
        signal TEXT NOT NULL CHECK(signal IN ('useful','harmful','missed','stale','conflict')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX retrieval_feedback_signal_time ON retrieval_feedback(signal, created_at);

      CREATE TABLE retrieval_eval_cases (
        case_id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        expected_json TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE harness_runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('passed','degraded','failed')),
        metrics_json TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE TABLE evolution_candidates (
        candidate_id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        problem TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        baseline_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        rollback_json TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','reverted')),
        approved_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX evolution_candidates_status_family ON evolution_candidates(status, family);
    `);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return SCHEMA_VERSION;
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function integrity(db) {
  const quick = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  return { passed: quick.length === 1 && quick[0] === 'ok' && foreignKeys.length === 0, quickCheck: quick, foreignKeyErrors: foreignKeys.length };
}

async function backupMemoryDatabase({ paths = resolveV9Paths(), targetPath, ignoreRestoreLock = false } = {}) {
  fs.mkdirSync(paths.memoryBackupRoot, { recursive: true, mode: 0o700 });
  const target = path.resolve(targetPath || path.join(paths.memoryBackupRoot, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite3`));
  const allowedRoot = `${path.resolve(paths.memoryBackupRoot)}${path.sep}`;
  if (!target.startsWith(allowedRoot)) throw new Error('backup_target_outside_memory_backup_root');
  const db = openMemoryDatabase({ paths, ignoreRestoreLock });
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
    await backup(db, target);
  } finally { db.close(); }
  fs.chmodSync(target, 0o600);
  const verify = new DatabaseSync(target, { readOnly: true });
  try { return { created: true, target, bytes: fs.statSync(target).size, integrity: integrity(verify) }; }
  finally { verify.close(); }
}

module.exports = { SCHEMA_VERSION, backupMemoryDatabase, integrity, migrate, openMemoryDatabase, transaction };
