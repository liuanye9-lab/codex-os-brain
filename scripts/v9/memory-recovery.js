'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { atomicWriteJson, readJsonSafe } = require('./store');
const { SCHEMA_VERSION, backupMemoryDatabase, integrity } = require('./memory-db');
const {
  adoptBackupState,
  compareLineage,
  createEncryptedMemoryBackup,
  createMacKeychainStore,
  decryptPackage,
  keyFingerprint,
  loadBackupState,
  saveBackupState,
  verifyEncryptedMemoryBackup,
} = require('./memory-encrypted-backup');
const { resolveV9Paths } = require('./paths');

const SHARE_TYPE = 'codex-brain-recovery-share';
const KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1, keyLength: 32 });

function coded(code) { const error = new Error(code); error.code = code; return error; }
function safeMkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); }
function within(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); }
function xor(a, b) { if (a.length !== b.length) throw coded('share_length_mismatch'); const out = Buffer.alloc(a.length); for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i]; return out; }
function fsyncFile(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function fsyncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

function readPassphrase(file) {
  const resolved = path.resolve(file || '');
  const linkStat = fs.lstatSync(resolved);
  if (linkStat.isSymbolicLink()) throw coded('passphrase_file_symlink_rejected');
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw coded('passphrase_file_must_be_0600');
  const passphrase = fs.readFileSync(resolved, 'utf8').replace(/[\r\n]+$/u, '');
  if (Buffer.byteLength(passphrase) < 20) throw coded('passphrase_too_short');
  return passphrase;
}

function shareAad(envelope) {
  return Buffer.from(JSON.stringify({ schemaVersion: envelope.schemaVersion, packageType: envelope.packageType, ceremonyId: envelope.ceremonyId, shareIndex: envelope.shareIndex, shareTotal: envelope.shareTotal, keyFingerprint: envelope.keyFingerprint, createdAt: envelope.createdAt, kdf: envelope.kdf, encryption: { algorithm: envelope.encryption.algorithm, iv: envelope.encryption.iv } }), 'utf8');
}

function encryptShare({ share, passphrase, ceremonyId, shareIndex, fingerprint, createdAt }) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const kdf = { ...KDF, salt: salt.toString('base64') };
  const key = crypto.scryptSync(passphrase, salt, KDF.keyLength, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 });
  const base = { schemaVersion: 1, packageType: SHARE_TYPE, ceremonyId, shareIndex, shareTotal: 2, keyFingerprint: fingerprint, createdAt, kdf, encryption: { algorithm: 'aes-256-gcm', iv: iv.toString('base64') } };
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(shareAad(base));
  const ciphertext = Buffer.concat([cipher.update(share), cipher.final()]);
  return { ...base, encryption: { ...base.encryption, tag: cipher.getAuthTag().toString('base64') }, ciphertext: ciphertext.toString('base64') };
}

function decryptShare(file, passphrase) {
  const resolved = path.resolve(file); if (fs.lstatSync(resolved).isSymbolicLink()) throw coded('recovery_share_symlink_rejected');
  const envelope = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (envelope.packageType !== SHARE_TYPE || envelope.shareTotal !== 2) throw coded('recovery_share_invalid');
  if (envelope.kdf.name !== KDF.name || envelope.kdf.N !== KDF.N || envelope.kdf.r !== KDF.r || envelope.kdf.p !== KDF.p || envelope.kdf.keyLength !== KDF.keyLength) throw coded('recovery_share_kdf_invalid');
  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const key = crypto.scryptSync(passphrase, salt, envelope.kdf.keyLength, { N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p, maxmem: 256 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.encryption.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.encryption.tag, 'base64')); decipher.setAAD(shareAad(envelope));
  return { envelope, share: Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]) };
}

function validateShareTargets({ outputA, outputB, paths, allowSameDevice = false }) {
  const a = path.join(fs.realpathSync(path.dirname(path.resolve(outputA))), path.basename(outputA));
  const b = path.join(fs.realpathSync(path.dirname(path.resolve(outputB))), path.basename(outputB));
  if (a === b) throw coded('recovery_share_targets_must_differ');
  for (const target of [a, b]) {
    const dir = path.dirname(target); if (!fs.existsSync(dir)) throw coded('recovery_share_parent_missing');
    if (within(paths.brainHome, target) || within(paths.localStateRoot, target)) throw coded('recovery_share_target_not_offline');
    if (fs.existsSync(target)) throw coded('recovery_share_target_exists');
  }
  if (!allowSameDevice && fs.statSync(path.dirname(a)).dev === fs.statSync(path.dirname(b)).dev) throw coded('recovery_shares_require_distinct_devices');
  return { a, b };
}

function writeRecoveryShares({ key, outputA, outputB, passphraseAFile, passphraseBFile, paths = resolveV9Paths(), allowSameDevice = false, clock = () => new Date() }) {
  const targets = validateShareTargets({ outputA, outputB, paths, allowSameDevice });
  const passA = readPassphrase(passphraseAFile); const passB = readPassphrase(passphraseBFile);
  if (passA === passB) throw coded('recovery_passphrases_must_differ');
  const shareA = crypto.randomBytes(32); const shareB = xor(key, shareA);
  const ceremonyId = `cer_${crypto.randomBytes(12).toString('hex')}`; const createdAt = clock().toISOString(); const fingerprint = keyFingerprint(key);
  const envelopes = [encryptShare({ share: shareA, passphrase: passA, ceremonyId, shareIndex: 1, fingerprint, createdAt }), encryptShare({ share: shareB, passphrase: passB, ceremonyId, shareIndex: 2, fingerprint, createdAt })];
  fs.writeFileSync(targets.a, `${JSON.stringify(envelopes[0], null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  try { fs.writeFileSync(targets.b, `${JSON.stringify(envelopes[1], null, 2)}\n`, { mode: 0o600, flag: 'wx' }); } catch (error) { try { fs.unlinkSync(targets.a); } catch {} throw error; }
  fsyncFile(targets.a); fsyncFile(targets.b); fsyncDir(path.dirname(targets.a)); fsyncDir(path.dirname(targets.b));
  return { ceremonyId, keyFingerprint: fingerprint, shares: [{ index: 1, output: targets.a }, { index: 2, output: targets.b }], distinctDevices: fs.statSync(path.dirname(targets.a)).dev !== fs.statSync(path.dirname(targets.b)).dev };
}

function reconstructRecoveryKey({ shareA, shareB, passphraseAFile, passphraseBFile }) {
  const parts = [decryptShare(shareA, readPassphrase(passphraseAFile)), decryptShare(shareB, readPassphrase(passphraseBFile))].sort((a, b) => a.envelope.shareIndex - b.envelope.shareIndex);
  if (parts[0].envelope.shareIndex !== 1 || parts[1].envelope.shareIndex !== 2 || parts[0].envelope.ceremonyId !== parts[1].envelope.ceremonyId || parts[0].envelope.keyFingerprint !== parts[1].envelope.keyFingerprint) throw coded('recovery_share_pair_mismatch');
  const key = xor(parts[0].share, parts[1].share);
  if (keyFingerprint(key) !== parts[0].envelope.keyFingerprint) throw coded('recovery_key_fingerprint_mismatch');
  return { key, ceremonyId: parts[0].envelope.ceremonyId, keyFingerprint: keyFingerprint(key) };
}

function exportRecoveryKey(options = {}) {
  if (!options.confirm) throw coded('confirmation_required');
  const keyStore = options.keyStore || createMacKeychainStore();
  return writeRecoveryShares({ ...options, key: keyStore.get() });
}

async function drillRecoveryKey(options = {}) {
  const reconstructed = reconstructRecoveryKey(options);
  let backup = null;
  if (options.input) backup = await verifyEncryptedMemoryBackup({ input: options.input, paths: options.paths || resolveV9Paths(), keyStore: { get: () => reconstructed.key } });
  return { passed: true, ceremonyId: reconstructed.ceremonyId, keyFingerprint: reconstructed.keyFingerprint, backup: backup ? { passed: backup.passed, packageSha256: backup.packageSha256, backupId: backup.header.backupId } : null, keyInstalled: false };
}

function importRecoveryKey(options = {}) {
  if (!options.confirm) throw coded('confirmation_required');
  const reconstructed = reconstructRecoveryKey(options);
  const stored = (options.keyStore || createMacKeychainStore()).set(reconstructed.key, { confirm: true, replace: options.replace === true });
  return { imported: true, ceremonyId: reconstructed.ceremonyId, keyFingerprint: reconstructed.keyFingerprint, stored };
}

function defaultProcessInspector(dbPath) {
  if (process.platform !== 'darwin') throw coded('restore_process_inspector_unavailable');
  const result = spawnSync('/usr/sbin/lsof', ['-Fn', '--', dbPath, `${dbPath}-wal`, `${dbPath}-shm`], { encoding: 'utf8', timeout: 10_000 });
  if (![0, 1].includes(result.status)) throw coded('restore_process_inspector_failed');
  const pids = (result.stdout || '').split(/\r?\n/u).filter(line => /^p\d+$/u.test(line)).map(line => Number(line.slice(1))).filter(pid => pid !== process.pid);
  return [...new Set(pids)];
}

function recoverStaleRestoreLock(paths) {
  if (!fs.existsSync(paths.memoryRestoreLockPath)) return { recovered: false };
  const owner = readJsonSafe(path.join(paths.memoryRestoreLockPath, 'owner.json'), null).value;
  if (!owner?.pid) {
    const ageMs = Date.now() - fs.statSync(paths.memoryRestoreLockPath).mtimeMs;
    if (ageMs < 5 * 60 * 1000) throw coded('restore_lock_busy');
  } else {
    try { process.kill(Number(owner.pid), 0); throw coded('restore_lock_busy'); }
    catch (error) { if (error.code === 'restore_lock_busy' || error.code === 'EPERM') throw error; if (error.code !== 'ESRCH') throw error; }
  }
  fs.rmSync(paths.memoryRestoreLockPath, { recursive: true, force: true });
  return { recovered: true, restoreId: owner?.restoreId || null };
}

function databaseHasAuthoritativeState(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['memory_items','source_documents','entities','edges']) if (tables.has(table) && Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) > 0) return true;
    return false;
  } finally { db.close(); }
}

function recoverIncompleteRestore(paths) {
  if (!fs.existsSync(paths.memoryRestoreJournalPath)) return { recovered: false };
  const journal = readJsonSafe(paths.memoryRestoreJournalPath, null).value;
  if (!journal || !journal.previousDb) throw coded('restore_journal_corrupt');
  if (journal.phase === 'committed' && fs.existsSync(paths.memoryDbPath)) {
    const db = new DatabaseSync(paths.memoryDbPath, { readOnly: true });
    try { if (!integrity(db).passed) throw coded('restore_committed_database_invalid'); } finally { db.close(); }
    fs.unlinkSync(paths.memoryRestoreJournalPath);
    return { recovered: true, restoreId: journal.restoreId, action: 'finalized_committed_restore' };
  }
  if (fs.existsSync(journal.previousDb)) {
    if (fs.existsSync(paths.memoryDbPath)) fs.renameSync(paths.memoryDbPath, `${journal.previousDb}.failed-${Date.now()}`);
    fs.renameSync(journal.previousDb, paths.memoryDbPath);
  } else if (journal.hadPreviousDb === false) { try { fs.unlinkSync(paths.memoryDbPath); } catch {} }
  if (journal.previousState) saveBackupState(paths, journal.previousState);
  for (const file of [journal.stagedDb, `${paths.memoryDbPath}-wal`, `${paths.memoryDbPath}-shm`]) { try { fs.unlinkSync(file); } catch {} }
  fs.unlinkSync(paths.memoryRestoreJournalPath);
  return { recovered: true, restoreId: journal.restoreId, action: 'rolled_back_incomplete_restore' };
}

async function restoreEncryptedMemoryBackup(options = {}) {
  if (!options.confirm) throw coded('confirmation_required');
  const paths = options.paths || resolveV9Paths(); const keyStore = options.keyStore || createMacKeychainStore();
  safeMkdir(paths.memoryRoot); safeMkdir(paths.memoryRestoreRoot);
  recoverStaleRestoreLock(paths);
  recoverIncompleteRestore(paths);
  const verified = await verifyEncryptedMemoryBackup({ input: options.input, paths, keyStore });
  if (Number(verified.header.sqliteSchemaVersion) > SCHEMA_VERSION) throw coded('restore_schema_too_new');
  const comparison = compareLineage(loadBackupState(paths), verified.header);
  if (comparison.status === 'same') return { restored: false, status: 'same', action: 'noop', verified: true };
  if (!['fast_forward','uninitialized'].includes(comparison.status)) throw coded(`restore_blocked_${comparison.status}`);
  if (comparison.status === 'uninitialized' && options.allowUninitialized !== true) throw coded('restore_uninitialized_requires_explicit_allow');
  if (comparison.status === 'uninitialized' && databaseHasAuthoritativeState(paths.memoryDbPath)) throw coded('restore_uninitialized_local_data');
  try { fs.mkdirSync(paths.memoryRestoreLockPath, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw coded('restore_lock_busy'); throw error; }
  const restoreId = `rst_${crypto.randomBytes(12).toString('hex')}`; const restoreDir = fs.mkdtempSync(path.join(paths.memoryRestoreRoot, `${restoreId}-`)); fs.chmodSync(restoreDir, 0o700);
  const stagedDb = path.join(restoreDir, 'incoming.sqlite3'); const previousDb = path.join(restoreDir, 'previous.sqlite3'); const rollbackSnapshot = path.join(paths.memoryBackupRoot, `pre-restore-${restoreId}.sqlite3`);
  const inspector = options.processInspector || defaultProcessInspector;
  const previousState = loadBackupState(paths);
  const hadPreviousDb = fs.existsSync(paths.memoryDbPath);
  let swapped = false;
  try {
    atomicWriteJson(path.join(paths.memoryRestoreLockPath, 'owner.json'), { restoreId, pid: process.pid, startedAt: new Date().toISOString() });
    const busy = inspector(paths.memoryDbPath); if (busy.length) throw coded('restore_database_in_use');
    if (fs.existsSync(paths.memoryDbPath)) {
      const rollback = await backupMemoryDatabase({ paths, targetPath: rollbackSnapshot, ignoreRestoreLock: true });
      if (!rollback.integrity.passed) throw coded('restore_rollback_backup_failed');
    }
    await decryptPackage({ input: path.resolve(options.input), output: stagedDb, key: keyStore.get() });
    const staged = new DatabaseSync(stagedDb, { readOnly: true }); try { if (!integrity(staged).passed) throw coded('restore_staged_integrity_failed'); } finally { staged.close(); }
    if (inspector(paths.memoryDbPath).length) throw coded('restore_database_in_use');
    const journal = { schemaVersion: 1, restoreId, phase: 'prepared', input: path.resolve(options.input), stagedDb, previousDb, rollbackSnapshot, backupId: verified.header.backupId, previousState, hadPreviousDb, createdAt: new Date().toISOString() };
    atomicWriteJson(paths.memoryRestoreJournalPath, journal);
    for (const sidecar of [`${paths.memoryDbPath}-wal`, `${paths.memoryDbPath}-shm`]) { try { fs.unlinkSync(sidecar); } catch {} }
    if (fs.existsSync(paths.memoryDbPath)) fs.renameSync(paths.memoryDbPath, previousDb);
    if (options.faultAt === 'after_previous_move') throw coded('restore_injected_after_previous_move');
    fs.renameSync(stagedDb, paths.memoryDbPath); swapped = true; fs.chmodSync(paths.memoryDbPath, 0o600); fsyncFile(paths.memoryDbPath); fsyncDir(path.dirname(paths.memoryDbPath));
    atomicWriteJson(paths.memoryRestoreJournalPath, { ...journal, phase: 'swapped' });
    if (options.faultAt === 'after_swap') throw coded('restore_injected_after_swap');
    const restored = new DatabaseSync(paths.memoryDbPath, { readOnly: true }); try { if (!integrity(restored).passed) throw coded('restore_final_integrity_failed'); } finally { restored.close(); }
    const state = adoptBackupState(paths, verified.header);
    atomicWriteJson(paths.memoryRestoreJournalPath, { ...journal, phase: 'committed' });
    fs.unlinkSync(paths.memoryRestoreJournalPath);
    return { restored: true, restoreId, status: comparison.status, backupId: verified.header.backupId, rollbackSnapshot: fs.existsSync(rollbackSnapshot) ? rollbackSnapshot : null, previousDb: fs.existsSync(previousDb) ? previousDb : null, integrity: verified.integrity, state };
  } catch (error) {
    let rolledBack = !swapped;
    if (fs.existsSync(previousDb)) { try { if (fs.existsSync(paths.memoryDbPath)) fs.renameSync(paths.memoryDbPath, `${previousDb}.failed`); fs.renameSync(previousDb, paths.memoryDbPath); saveBackupState(paths, previousState); rolledBack = true; } catch {} }
    if (swapped && !hadPreviousDb) { try { fs.unlinkSync(paths.memoryDbPath); saveBackupState(paths, previousState); rolledBack = true; } catch {} }
    if (rolledBack) { try { fs.unlinkSync(paths.memoryRestoreJournalPath); } catch {} }
    throw error;
  } finally {
    try { if (fs.existsSync(stagedDb)) fs.unlinkSync(stagedDb); } catch {}
    try { fs.rmSync(paths.memoryRestoreLockPath, { recursive: true, force: true }); } catch {}
  }
}

async function rotateRecoveryKey(options = {}) {
  if (!options.confirm) throw coded('confirmation_required');
  const paths = options.paths || resolveV9Paths(); const keyStore = options.keyStore || createMacKeychainStore(); const current = keyStore.get();
  const proof = reconstructRecoveryKey(options.currentRecovery);
  if (!crypto.timingSafeEqual(current, proof.key)) throw coded('rotation_current_recovery_mismatch');
  const preRotationBackup = await createEncryptedMemoryBackup({ paths, keyStore });
  const next = crypto.randomBytes(32);
  const shares = writeRecoveryShares({ ...options.newRecovery, key: next, paths });
  try {
    keyStore.set(next, { confirm: true, replace: true });
    const backup = await createEncryptedMemoryBackup({ paths, keyStore });
    return { rotated: true, previousFingerprint: keyFingerprint(current), newFingerprint: keyFingerprint(next), shares, preRotationBackup: { target: preRotationBackup.target, backupId: preRotationBackup.header.backupId, packageSha256: preRotationBackup.packageSha256 }, backup: { target: backup.target, backupId: backup.header.backupId, packageSha256: backup.packageSha256 } };
  } catch (error) { try { keyStore.set(current, { confirm: true, replace: true }); } catch {} for (const share of shares.shares) { try { fs.unlinkSync(share.output); } catch {} } throw error; }
}

module.exports = { databaseHasAuthoritativeState, decryptShare, drillRecoveryKey, exportRecoveryKey, importRecoveryKey, readPassphrase, reconstructRecoveryKey, recoverIncompleteRestore, recoverStaleRestoreLock, restoreEncryptedMemoryBackup, rotateRecoveryKey, writeRecoveryShares };
