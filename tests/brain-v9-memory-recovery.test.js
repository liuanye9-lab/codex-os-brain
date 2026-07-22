'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createEncryptedMemoryBackup, keyFingerprint, loadBackupState, saveBackupState } = require('../scripts/v9/memory-encrypted-backup');
const { openMemoryDatabase } = require('../scripts/v9/memory-db');
const { decryptShare, drillRecoveryKey, exportRecoveryKey, importRecoveryKey, recoverIncompleteRestore, recoverStaleRestoreLock, restoreEncryptedMemoryBackup, rotateRecoveryKey } = require('../scripts/v9/memory-recovery');
const { resolveV9Paths } = require('../scripts/v9/paths');

function setup(label = 'recovery') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `brain-v9-${label}-`));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  const offlineA = path.join(root, 'offline-a'); const offlineB = path.join(root, 'offline-b'); fs.mkdirSync(offlineA); fs.mkdirSync(offlineB);
  const passA = path.join(root, 'pass-a'); const passB = path.join(root, 'pass-b');
  fs.writeFileSync(passA, 'test-only-passphrase-alpha-0123456789\n', { mode: 0o600 });
  fs.writeFileSync(passB, 'test-only-passphrase-beta-9876543210\n', { mode: 0o600 });
  return { root, paths, offlineA, offlineB, passA, passB };
}

function fakeStore(initial) {
  let key = Buffer.from(initial);
  return { get: () => Buffer.from(key), set(next, options = {}) { if (!options.confirm) throw new Error('confirmation_required'); key = Buffer.from(next); return { stored: true, fingerprint: keyFingerprint(key) }; } };
}

function insertDocument(paths, id, content) {
  const db = openMemoryDatabase({ paths });
  try { db.prepare('INSERT INTO source_documents(document_id,source_uri,content,content_hash,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, `source:${id}`, content, `hash-${id}`, '{}', 'x', 'x'); }
  finally { db.close(); }
}

function documentCount(paths) { const db = new DatabaseSync(paths.memoryDbPath, { readOnly: true }); try { return Number(db.prepare('SELECT COUNT(*) AS count FROM source_documents').get().count); } finally { db.close(); } }

async function backupPair() {
  const origin = setup('origin'); const key = crypto.randomBytes(32); const keyStore = fakeStore(key);
  insertDocument(origin.paths, 'd1', 'first');
  const first = await createEncryptedMemoryBackup({ paths: origin.paths, keyStore });
  insertDocument(origin.paths, 'd2', 'second');
  const second = await createEncryptedMemoryBackup({ paths: origin.paths, keyStore });
  return { origin, key, keyStore, first, second };
}

test('2-of-2 recovery shares drill and import without exposing or installing during drill', async () => {
  const fixture = setup(); const key = crypto.randomBytes(32); const keyStore = fakeStore(key);
  insertDocument(fixture.paths, 'd1', 'recovery evidence');
  const backup = await createEncryptedMemoryBackup({ paths: fixture.paths, keyStore });
  const shareA = path.join(fixture.offlineA, 'share-a.cbkey'); const shareB = path.join(fixture.offlineB, 'share-b.cbkey');
  const exported = exportRecoveryKey({ paths: fixture.paths, keyStore, outputA: shareA, outputB: shareB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, allowSameDevice: true, confirm: true });
  assert.equal(exported.keyFingerprint, keyFingerprint(key));
  assert.equal(fs.statSync(shareA).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(shareA).includes(key), false);
  const drill = await drillRecoveryKey({ paths: fixture.paths, shareA, shareB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, input: backup.target });
  assert.equal(drill.passed, true); assert.equal(drill.keyInstalled, false); assert.equal(drill.backup.passed, true);
  const destination = fakeStore(crypto.randomBytes(32));
  const imported = importRecoveryKey({ keyStore: destination, shareA, shareB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, replace: true, confirm: true });
  assert.equal(imported.keyFingerprint, keyFingerprint(key)); assert.equal(keyFingerprint(destination.get()), keyFingerprint(key));
});

test('recovery export rejects same-device custody unless explicitly enabled for tests', () => {
  const fixture = setup();
  assert.throws(() => exportRecoveryKey({ paths: fixture.paths, keyStore: fakeStore(crypto.randomBytes(32)), outputA: path.join(fixture.offlineA, 'a.cbkey'), outputB: path.join(fixture.offlineB, 'b.cbkey'), passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, confirm: true }), /recovery_shares_require_distinct_devices/);
});

test('recovery shares reject tampered KDF work factors before derivation', () => {
  const fixture = setup(); const shareA = path.join(fixture.offlineA, 'a.cbkey'); const shareB = path.join(fixture.offlineB, 'b.cbkey');
  exportRecoveryKey({ paths: fixture.paths, keyStore: fakeStore(crypto.randomBytes(32)), outputA: shareA, outputB: shareB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, allowSameDevice: true, confirm: true });
  const envelope = JSON.parse(fs.readFileSync(shareA, 'utf8')); envelope.kdf.N *= 2; fs.writeFileSync(shareA, JSON.stringify(envelope), { mode: 0o600 });
  assert.throws(() => decryptShare(shareA, 'test-only-passphrase-alpha-0123456789'), /recovery_share_kdf_invalid/);
});

test('automatic restore adopts uninitialized backup then fast-forwards and no-ops same head', async () => {
  const { key, first, second } = await backupPair(); const target = setup('target'); const keyStore = fakeStore(key);
  const adopted = await restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: first.target, confirm: true, allowUninitialized: true, processInspector: () => [] });
  assert.equal(adopted.status, 'uninitialized'); assert.equal(documentCount(target.paths), 1);
  const advanced = await restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: second.target, confirm: true, processInspector: () => [] });
  assert.equal(advanced.status, 'fast_forward'); assert.equal(documentCount(target.paths), 2); assert.ok(advanced.rollbackSnapshot);
  const same = await restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: second.target, confirm: true, processInspector: () => [] });
  assert.deepEqual({ restored: same.restored, status: same.status }, { restored: false, status: 'same' });
});

test('restore blocks an in-use database and injected post-swap failure rolls back bytes and lineage', async () => {
  const { key, first, second } = await backupPair(); const target = setup('rollback'); const keyStore = fakeStore(key);
  await restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: first.target, confirm: true, allowUninitialized: true, processInspector: () => [] });
  await assert.rejects(() => restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: second.target, confirm: true, processInspector: () => [999] }), /restore_database_in_use/);
  assert.equal(documentCount(target.paths), 1);
  const before = loadBackupState(target.paths);
  await assert.rejects(() => restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: second.target, confirm: true, processInspector: () => [], faultAt: 'after_swap' }), /restore_injected_after_swap/);
  assert.equal(documentCount(target.paths), 1); assert.equal(loadBackupState(target.paths).lastBackupId, before.lastBackupId); assert.equal(fs.existsSync(target.paths.memoryRestoreLockPath), false);
  await assert.rejects(() => restoreEncryptedMemoryBackup({ paths: target.paths, keyStore, input: second.target, confirm: true, processInspector: () => [], faultAt: 'after_previous_move' }), /restore_injected_after_previous_move/);
  assert.equal(documentCount(target.paths), 1); assert.equal(loadBackupState(target.paths).lastBackupId, before.lastBackupId); assert.equal(fs.existsSync(target.paths.memoryRestoreJournalPath), false);
});

test('uninitialized restore refuses to overwrite authoritative local rows', async () => {
  const { key, first } = await backupPair(); const target = setup('untracked'); insertDocument(target.paths, 'local', 'authoritative local row');
  await assert.rejects(() => restoreEncryptedMemoryBackup({ paths: target.paths, keyStore: fakeStore(key), input: first.target, confirm: true, allowUninitialized: true, processInspector: () => [] }), /restore_uninitialized_local_data/);
  assert.equal(documentCount(target.paths), 1);
});

test('stale restore lock is removed only after its owner is confirmed dead', () => {
  const fixture = setup('stale-lock'); fs.mkdirSync(fixture.paths.memoryRestoreLockPath, { recursive: true });
  fs.writeFileSync(path.join(fixture.paths.memoryRestoreLockPath, 'owner.json'), JSON.stringify({ restoreId: 'dead', pid: 99999999 }));
  assert.equal(recoverStaleRestoreLock(fixture.paths).recovered, true); assert.equal(fs.existsSync(fixture.paths.memoryRestoreLockPath), false);
  fs.mkdirSync(fixture.paths.memoryRestoreLockPath); fs.writeFileSync(path.join(fixture.paths.memoryRestoreLockPath, 'owner.json'), JSON.stringify({ restoreId: 'live', pid: process.pid }));
  assert.throws(() => recoverStaleRestoreLock(fixture.paths), /restore_lock_busy/);
});

test('crash journal rolls a swapped database and lineage back before the next restore', () => {
  const fixture = setup('journal'); insertDocument(fixture.paths, 'old', 'old'); fs.mkdirSync(fixture.paths.memoryRestoreRoot, { recursive: true });
  const previousDb = path.join(fixture.paths.memoryRestoreRoot, 'previous.sqlite3'); fs.copyFileSync(fixture.paths.memoryDbPath, previousDb);
  const previousState = { schemaVersion: 1, databaseId: 'db_old', lastBackupId: 'bkp_old', generation: 1, knownBackups: [{ backupId: 'bkp_old', parentBackupId: null, generation: 1 }] }; saveBackupState(fixture.paths, previousState);
  insertDocument(fixture.paths, 'new', 'new'); saveBackupState(fixture.paths, { ...previousState, lastBackupId: 'bkp_new', generation: 2 });
  fs.writeFileSync(fixture.paths.memoryRestoreJournalPath, JSON.stringify({ schemaVersion: 1, restoreId: 'rst_crash', phase: 'swapped', stagedDb: path.join(fixture.paths.memoryRestoreRoot, 'missing.sqlite3'), previousDb, previousState, hadPreviousDb: true }));
  const recovered = recoverIncompleteRestore(fixture.paths);
  assert.equal(recovered.action, 'rolled_back_incomplete_restore'); assert.equal(documentCount(fixture.paths), 1); assert.equal(loadBackupState(fixture.paths).lastBackupId, 'bkp_old'); assert.equal(fs.existsSync(fixture.paths.memoryRestoreJournalPath), false);
});

test('rotation requires proof of the current recovery pair and emits a backup under the new key', async () => {
  const fixture = setup('rotate'); const current = crypto.randomBytes(32); const keyStore = fakeStore(current); insertDocument(fixture.paths, 'd1', 'rotation');
  const oldA = path.join(fixture.offlineA, 'old-a.cbkey'); const oldB = path.join(fixture.offlineB, 'old-b.cbkey');
  exportRecoveryKey({ paths: fixture.paths, keyStore, outputA: oldA, outputB: oldB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, allowSameDevice: true, confirm: true });
  const nextA = path.join(fixture.offlineA, 'next-a.cbkey'); const nextB = path.join(fixture.offlineB, 'next-b.cbkey');
  const rotated = await rotateRecoveryKey({ paths: fixture.paths, keyStore, confirm: true, currentRecovery: { shareA: oldA, shareB: oldB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB }, newRecovery: { outputA: nextA, outputB: nextB, passphraseAFile: fixture.passA, passphraseBFile: fixture.passB, allowSameDevice: true } });
  assert.equal(rotated.rotated, true); assert.notEqual(rotated.previousFingerprint, rotated.newFingerprint); assert.equal(rotated.newFingerprint, keyFingerprint(keyStore.get())); assert.ok(fs.existsSync(rotated.preRotationBackup.target)); assert.ok(fs.existsSync(rotated.backup.target));
});
