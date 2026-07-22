'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openMemoryDatabase } = require('../scripts/v9/memory-db');
const {
  compareEncryptedMemoryBackup,
  compareLineage,
  createEncryptedMemoryBackup,
  inspectEncryptedMemoryBackup,
  verifyEncryptedMemoryBackup,
} = require('../scripts/v9/memory-encrypted-backup');
const { resolveV9Paths } = require('../scripts/v9/paths');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-encrypted-backup-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  const key = crypto.randomBytes(32);
  const keyStore = { get: () => key };
  const db = openMemoryDatabase({ paths });
  db.prepare("INSERT INTO source_documents(document_id,source_uri,content,content_hash,metadata_json,created_at,updated_at) VALUES('d','private/source','encrypted content','h','{}','x','x')").run();
  db.close();
  return { paths, keyStore };
}

test('encrypted backup round-trips through AES-GCM without exposing plaintext', async () => {
  const { paths, keyStore } = fixture();
  const created = await createEncryptedMemoryBackup({ paths, keyStore, clock: () => new Date('2026-07-22T00:00:00Z') });
  assert.equal(created.integrity.passed, true);
  assert.equal(fs.readFileSync(created.target).includes(Buffer.from('encrypted content')), false);
  assert.equal(fs.statSync(created.target).mode & 0o777, 0o600);
  const inspected = inspectEncryptedMemoryBackup(created.target);
  assert.equal(inspected.header.packageType, 'codex-brain-memory-backup');
  assert.equal(inspected.header.generation, 1);
  assert.equal('hostname' in inspected.header, false);
  const verified = await verifyEncryptedMemoryBackup({ input: created.target, paths, keyStore });
  assert.equal(verified.passed, true);
  assert.equal(verified.integrity.passed, true);
  assert.equal((await compareEncryptedMemoryBackup({ input: created.target, paths, keyStore })).comparison.status, 'same');
});

test('tampering is rejected by authenticated encryption', async () => {
  const { paths, keyStore } = fixture();
  const created = await createEncryptedMemoryBackup({ paths, keyStore });
  const fd = fs.openSync(created.target, 'r+');
  try {
    const position = fs.statSync(created.target).size - 1;
    const byte = Buffer.alloc(1); fs.readSync(fd, byte, 0, 1, position); byte[0] ^= 0xff; fs.writeSync(fd, byte, 0, 1, position);
  } finally { fs.closeSync(fd); }
  await assert.rejects(() => verifyEncryptedMemoryBackup({ input: created.target, paths, keyStore }));
});

test('lineage header tampering is rejected before it can influence restore decisions', async () => {
  const { paths, keyStore } = fixture();
  const created = await createEncryptedMemoryBackup({ paths, keyStore });
  const data = fs.readFileSync(created.target);
  const headerLength = data.readUInt32BE(8);
  const header = JSON.parse(data.subarray(12, 12 + headerLength).toString('utf8'));
  header.deviceId = `${header.deviceId.slice(0, -1)}${header.deviceId.endsWith('0') ? '1' : '0'}`;
  const replacement = Buffer.from(JSON.stringify(header), 'utf8');
  assert.equal(replacement.length, headerLength);
  replacement.copy(data, 12);
  fs.writeFileSync(created.target, data);
  await assert.rejects(() => verifyEncryptedMemoryBackup({ input: created.target, paths, keyStore }), /backup_header_authentication_mismatch|Unsupported state/);
});

test('lineage allows fast-forward and blocks divergent or foreign databases', () => {
  const state = {
    databaseId: 'db1', lastBackupId: 'b2', generation: 2,
    knownBackups: [{ backupId: 'b1', parentBackupId: null, generation: 1 }, { backupId: 'b2', parentBackupId: 'b1', generation: 2 }],
  };
  assert.equal(compareLineage(state, { databaseId: 'db1', backupId: 'b3', parentBackupId: 'b2' }).status, 'fast_forward');
  assert.equal(compareLineage(state, {
    databaseId: 'db1', backupId: 'b4', parentBackupId: 'b3',
    lineage: [
      { backupId: 'b2', parentBackupId: 'b1', generation: 2 },
      { backupId: 'b3', parentBackupId: 'b2', generation: 3 },
      { backupId: 'b4', parentBackupId: 'b3', generation: 4 },
    ],
  }).status, 'fast_forward');
  assert.equal(compareLineage(state, { databaseId: 'db1', backupId: 'branch', parentBackupId: 'b1' }).status, 'diverged');
  assert.equal(compareLineage(state, { databaseId: 'db2', backupId: 'x', parentBackupId: null }).status, 'foreign_database');
});
