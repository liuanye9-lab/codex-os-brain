'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { resolveV9Paths } = require('./paths');

const SCHEMA_VERSION = 2;

function openMemoryDatabase({ paths = resolveV9Paths(), dbPath = paths.memoryDbPath, readonly = false, ignoreRestoreLock = false } = {}) {
  if (!ignoreRestoreLock && fs.existsSync(paths.memoryRestoreLockPath)) {
    throw new Error('memory_restore_in_progress_run_brain_memory_recover');
  }
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
  let current = Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
  if (current < 1) {
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
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
      db.exec('COMMIT');
      current = 1;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original transaction error */ }
      throw error;
    }
  }
  if (current < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const sourceColumns = new Set(db.prepare('PRAGMA table_info(source_documents)').all().map(row => row.name));
      if (!sourceColumns.has('capture_mode')) db.exec("ALTER TABLE source_documents ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'import'");
      if (!sourceColumns.has('trust_status')) db.exec("ALTER TABLE source_documents ADD COLUMN trust_status TEXT NOT NULL DEFAULT 'quarantined' CHECK(trust_status IN ('trusted','untrusted','quarantined','revoked'))");
      if (!sourceColumns.has('privacy_level')) db.exec("ALTER TABLE source_documents ADD COLUMN privacy_level TEXT NOT NULL DEFAULT 'private' CHECK(privacy_level IN ('local_only','private','restricted','public'))");
      if (!sourceColumns.has('subjects_json')) db.exec("ALTER TABLE source_documents ADD COLUMN subjects_json TEXT NOT NULL DEFAULT '[]'");
      if (!sourceColumns.has('allowed_uses_json')) db.exec("ALTER TABLE source_documents ADD COLUMN allowed_uses_json TEXT NOT NULL DEFAULT '[]'");
      if (!sourceColumns.has('retention_policy_json')) db.exec("ALTER TABLE source_documents ADD COLUMN retention_policy_json TEXT NOT NULL DEFAULT '{}'");
      if (!sourceColumns.has('valid_from')) db.exec('ALTER TABLE source_documents ADD COLUMN valid_from TEXT');
      if (!sourceColumns.has('valid_to')) db.exec('ALTER TABLE source_documents ADD COLUMN valid_to TEXT');
      if (!sourceColumns.has('version')) db.exec('ALTER TABLE source_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
      db.exec(`
        CREATE INDEX IF NOT EXISTS source_documents_trust_time
          ON source_documents(trust_status,privacy_level,updated_at DESC);

        CREATE TABLE cognitive_evidence_assertions(
          evidence_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          source_version TEXT NOT NULL,
          epistemic_type TEXT NOT NULL CHECK(epistemic_type IN ('source_fact','speaker_claim','user_experience','synthesis_inference','project_application')),
          anchor_ref_json TEXT NOT NULL,
          anchor_status TEXT NOT NULL DEFAULT 'unverified' CHECK(anchor_status IN ('unverified','verified','failed')),
          attribution_status TEXT NOT NULL DEFAULT 'unverified' CHECK(attribution_status IN ('not_applicable','unverified','verified','failed')),
          entailment_status TEXT NOT NULL DEFAULT 'unverified' CHECK(entailment_status IN ('unverified','verified','failed')),
          external_fact_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(external_fact_status IN ('not_applicable','unverified','verified','failed')),
          uncertainty REAL NOT NULL DEFAULT 1 CHECK(uncertainty>=0 AND uncertainty<=1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(document_id) REFERENCES source_documents(document_id) ON DELETE RESTRICT
        );
        CREATE INDEX cognitive_evidence_document ON cognitive_evidence_assertions(document_id,entailment_status);

        CREATE TABLE cognition_units(
          unit_id TEXT PRIMARY KEY,
          claim TEXT NOT NULL CHECK(length(trim(claim))>0),
          cognition_type TEXT NOT NULL,
          context_json TEXT NOT NULL DEFAULT '{}',
          mechanism_json TEXT NOT NULL DEFAULT '{}',
          boundary TEXT NOT NULL DEFAULT '',
          falsifier TEXT NOT NULL DEFAULT '',
          counterexample TEXT NOT NULL DEFAULT '',
          transfer_scope_json TEXT NOT NULL DEFAULT '{}',
          evidence_dependencies_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed','rejected','retired','stale_blocked')),
          privacy_level TEXT NOT NULL DEFAULT 'local_only' CHECK(privacy_level IN ('local_only','private','restricted','public')),
          sensitive_inference INTEGER NOT NULL DEFAULT 0 CHECK(sensitive_inference IN (0,1)),
          version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX cognition_units_status_type ON cognition_units(status,cognition_type,updated_at DESC);

        CREATE TABLE cognitive_playbooks(
          playbook_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          target_problem TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          evidence_dependencies_json TEXT NOT NULL DEFAULT '[]',
          dependency_digest TEXT NOT NULL,
          semantic_maturity TEXT NOT NULL DEFAULT 'method_candidate' CHECK(semantic_maturity IN ('method_candidate','runnable_playbook','verified_capability')),
          deployment_state TEXT NOT NULL DEFAULT 'candidate' CHECK(deployment_state IN ('candidate','shadow','replay','canary','promoted','revoked')),
          validation_status TEXT NOT NULL DEFAULT 'current' CHECK(validation_status IN ('current','stale_blocked','revoked')),
          privacy_level TEXT NOT NULL DEFAULT 'local_only' CHECK(privacy_level IN ('local_only','private','restricted','public')),
          version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX cognitive_playbooks_state ON cognitive_playbooks(validation_status,semantic_maturity,deployment_state);

        CREATE TABLE cognitive_reuse_receipts(
          receipt_id TEXT PRIMARY KEY,
          playbook_id TEXT NOT NULL,
          playbook_version INTEGER NOT NULL,
          context_hash TEXT NOT NULL,
          semantic_case_hash TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','not_applicable','infrastructure_failure')),
          case_kind TEXT NOT NULL DEFAULT 'ordinary' CHECK(case_kind IN ('ordinary','boundary','adversarial')),
          verifier_identity TEXT NOT NULL,
          executor_identity TEXT NOT NULL,
          critical_safety_failure INTEGER NOT NULL DEFAULT 0 CHECK(critical_safety_failure IN (0,1)),
          production_path INTEGER NOT NULL DEFAULT 0 CHECK(production_path IN (0,1)),
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(playbook_id) REFERENCES cognitive_playbooks(playbook_id) ON DELETE RESTRICT
        );
        CREATE INDEX cognitive_reuse_playbook ON cognitive_reuse_receipts(playbook_id,playbook_version,created_at DESC);

        CREATE TABLE cognitive_projection_grants(
          grant_id TEXT PRIMARY KEY,
          recipient_agent TEXT NOT NULL,
          purpose TEXT NOT NULL,
          scope_json TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          content_version TEXT NOT NULL,
          policy_digest TEXT NOT NULL,
          no_onward_sharing INTEGER NOT NULL DEFAULT 1 CHECK(no_onward_sharing IN (0,1)),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX cognitive_projection_grants_lookup ON cognitive_projection_grants(recipient_agent,status,expires_at);

        CREATE TABLE cognitive_projection_items(
          grant_id TEXT NOT NULL,
          asset_type TEXT NOT NULL CHECK(asset_type IN ('cognition','playbook')),
          asset_id TEXT NOT NULL,
          asset_version INTEGER NOT NULL,
          PRIMARY KEY(grant_id,asset_type,asset_id),
          FOREIGN KEY(grant_id) REFERENCES cognitive_projection_grants(grant_id) ON DELETE CASCADE
        );

        CREATE TABLE cognitive_approval_receipts(
          receipt_id TEXT PRIMARY KEY,
          authority_mode TEXT NOT NULL CHECK(authority_mode IN ('protected','operator_guardrail_only')),
          object_id TEXT NOT NULL,
          object_version INTEGER NOT NULL,
          action TEXT NOT NULL,
          scope_hash TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        );

        CREATE TABLE cognitive_withdrawal_receipts(
          receipt_id TEXT PRIMARY KEY,
          asset_type TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          cascaded_json TEXT NOT NULL,
          residues_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE cognitive_asset_versions(
          asset_type TEXT NOT NULL CHECK(asset_type IN ('cognition','playbook')),
          asset_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version>0),
          snapshot_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(asset_type,asset_id,version)
        );

        CREATE TABLE cognitive_asset_events(
          event_id TEXT PRIMARY KEY,
          asset_type TEXT NOT NULL CHECK(asset_type IN ('cognition','playbook')),
          asset_id TEXT NOT NULL,
          asset_version INTEGER NOT NULL,
          action TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX cognitive_asset_events_asset ON cognitive_asset_events(asset_type,asset_id,created_at);

        CREATE TABLE cognitive_dependency_registry(
          dependency_type TEXT NOT NULL CHECK(dependency_type IN ('policy','tool_contract','asset_contract')),
          dependency_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version>0),
          digest TEXT NOT NULL CHECK(length(digest)=64),
          status TEXT NOT NULL DEFAULT 'current' CHECK(status IN ('current','revoked')),
          updated_at TEXT NOT NULL,
          PRIMARY KEY(dependency_type,dependency_id)
        );

        CREATE TABLE cognitive_playbook_dependencies(
          playbook_id TEXT NOT NULL,
          dependency_type TEXT NOT NULL CHECK(dependency_type IN ('policy','tool_contract','asset_contract')),
          dependency_id TEXT NOT NULL,
          dependency_version INTEGER NOT NULL CHECK(dependency_version>0),
          dependency_digest TEXT NOT NULL CHECK(length(dependency_digest)=64),
          PRIMARY KEY(playbook_id,dependency_type,dependency_id),
          FOREIGN KEY(playbook_id) REFERENCES cognitive_playbooks(playbook_id) ON DELETE CASCADE
        );
      `);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
      db.exec('COMMIT');
      current = 2;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original transaction error */ }
      throw error;
    }
  }
  return current;
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original transaction error */ }
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
