'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SCHEMA_VERSION, backupMemoryDatabase, integrity, openMemoryDatabase, transaction } = require('../scripts/v9/memory-db');
const { resolveV9Paths } = require('../scripts/v9/paths');

function tempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-memory-db-'));
  return resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
}

test('memory database creates ACID schema with WAL, FTS5, and private permissions', () => {
  const paths = tempPaths();
  const db = openMemoryDatabase({ paths });
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get().enabled, 1);
  assert.equal(integrity(db).passed, true);
  db.close();
  if (process.platform !== 'win32') assert.equal(fs.statSync(paths.memoryDbPath).mode & 0o777, 0o600);
});

test('transaction rolls back all writes on failure', () => {
  const db = openMemoryDatabase({ paths: tempPaths() });
  assert.throws(() => transaction(db, () => {
    db.prepare("INSERT INTO memory_items(memory_id,kind,content,status,confidence,privacy,metadata_json,created_at,updated_at) VALUES('m1','fact','x','candidate',0.5,'private','{}','x','x')").run();
    throw new Error('stop');
  }), /stop/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get().count, 0);
  db.close();
});

test('schema v3 upgrades to v4 without losing existing memory data', () => {
  const paths = tempPaths();
  const legacy = openMemoryDatabase({ paths });
  legacy.prepare("INSERT INTO memory_items(memory_id,kind,content,status,confidence,privacy,metadata_json,created_at,updated_at) VALUES('legacy','fact','preserved','confirmed',1,'private','{}','x','x')").run();
  legacy.exec(`
    DROP TABLE cognitive_product_versions;
    DROP TABLE cognitive_agent_profiles;
    DROP TABLE cognitive_knowledge_bases;
    DELETE FROM schema_migrations WHERE version=4;
  `);
  legacy.close();

  const upgraded = openMemoryDatabase({ paths });
  assert.equal(upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, SCHEMA_VERSION);
  assert.equal(upgraded.prepare("SELECT content FROM memory_items WHERE memory_id='legacy'").get().content, 'preserved');
  for (const table of ['cognitive_knowledge_bases', 'cognitive_agent_profiles', 'cognitive_product_versions']) {
    assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(table).count, 1);
  }
  assert.equal(integrity(upgraded).passed, true);
  upgraded.close();
});

test('backup API checkpoints and verifies a recoverable private snapshot', async () => {
  const paths = tempPaths();
  const db = openMemoryDatabase({ paths });
  db.prepare("INSERT INTO source_documents(document_id,source_uri,content,content_hash,metadata_json,created_at,updated_at) VALUES('d','s','content','h','{}','x','x')").run();
  db.close();
  const report = await backupMemoryDatabase({ paths });
  assert.equal(report.integrity.passed, true);
  assert.equal(fs.existsSync(report.target), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(report.target).mode & 0o777, 0o600);
});
