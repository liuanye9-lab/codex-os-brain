'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');
const { atomicWriteJson, readJsonSafe } = require('./store');
const { backupMemoryDatabase, integrity } = require('./memory-db');
const { resolveV9Paths } = require('./paths');

const MAGIC = Buffer.from('CBMEM001');
const HEADER_LIMIT = 64 * 1024;
const KEYCHAIN_SERVICE = 'com.codex-brain.memory-backup';
const KEYCHAIN_ACCOUNT = 'v9-aes-256-gcm';

function coded(code) { const error = new Error(code); error.code = code; return error; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function randomId(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function safeMkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); }

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function keyFingerprint(key) { return `key_${sha256(key).slice(0, 24)}`; }

function authenticatedHeader(header) {
  return {
    schemaVersion: header.schemaVersion,
    packageType: header.packageType,
    databaseId: header.databaseId,
    backupId: header.backupId,
    parentBackupId: header.parentBackupId,
    generation: header.generation,
    deviceId: header.deviceId,
    createdAt: header.createdAt,
    sqliteSchemaVersion: header.sqliteSchemaVersion,
    keyFingerprint: header.keyFingerprint,
    lineage: header.lineage,
    encryption: { algorithm: header.encryption.algorithm, iv: header.encryption.iv },
    plaintextSha256: header.plaintextSha256,
    plaintextBytes: header.plaintextBytes,
  };
}

function createMacKeychainStore({ service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT } = {}) {
  function run(args) {
    const result = spawnSync('/usr/bin/security', args, { encoding: 'utf8', timeout: 10_000 });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  }
  return {
    get() {
      if (process.platform !== 'darwin') throw coded('keychain_unavailable');
      const result = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (result.status !== 0) throw coded('backup_key_not_initialized');
      const key = Buffer.from(result.stdout.trim(), 'base64');
      if (key.length !== 32) throw coded('backup_key_invalid');
      return key;
    },
    init({ confirm = false } = {}) {
      if (!confirm) throw coded('confirmation_required');
      if (process.platform !== 'darwin') throw coded('keychain_unavailable');
      try { return { created: false, fingerprint: keyFingerprint(this.get()), service, account }; }
      catch (error) { if (error.code !== 'backup_key_not_initialized') throw error; }
      const key = crypto.randomBytes(32);
      const encoded = key.toString('base64');
      const result = run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', encoded]);
      if (result.status !== 0) throw coded('backup_key_store_failed');
      return { created: true, fingerprint: keyFingerprint(key), service, account };
    },
    set(key, { confirm = false, replace = false } = {}) {
      if (!confirm) throw coded('confirmation_required');
      if (process.platform !== 'darwin') throw coded('keychain_unavailable');
      if (!Buffer.isBuffer(key) || key.length !== 32) throw coded('backup_key_invalid');
      try { if (!replace) { this.get(); throw coded('backup_key_exists'); } } catch (error) {
        if (!['backup_key_not_initialized','backup_key_exists'].includes(error.code)) throw error;
        if (error.code === 'backup_key_exists') throw error;
      }
      const result = run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', key.toString('base64')]);
      if (result.status !== 0) throw coded('backup_key_store_failed');
      return { stored: true, fingerprint: keyFingerprint(key), service, account };
    },
  };
}

function ensureDeviceId(paths) {
  safeMkdir(path.dirname(paths.memoryDeviceIdPath));
  if (!fs.existsSync(paths.memoryDeviceIdPath)) {
    fs.writeFileSync(paths.memoryDeviceIdPath, `${crypto.randomBytes(32).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  }
  const raw = fs.readFileSync(paths.memoryDeviceIdPath, 'utf8').trim();
  return `dev_${sha256(raw).slice(0, 20)}`;
}

function initialState() {
  return { schemaVersion: 1, databaseId: null, lastBackupId: null, generation: 0, knownBackups: [] };
}

function loadBackupState(paths) {
  const state = readJsonSafe(paths.memoryBackupStatePath, initialState()).value;
  return {
    schemaVersion: 1,
    databaseId: state.databaseId || null,
    lastBackupId: state.lastBackupId || null,
    generation: Number(state.generation || 0),
    knownBackups: Array.isArray(state.knownBackups) ? state.knownBackups.slice(-256) : [],
  };
}

function saveBackupState(paths, state) {
  safeMkdir(path.dirname(paths.memoryBackupStatePath));
  atomicWriteJson(paths.memoryBackupStatePath, { ...state, knownBackups: state.knownBackups.slice(-256) });
}

function adoptBackupState(paths, header) {
  const lineage = Array.isArray(header.lineage) ? header.lineage.slice(-256) : [];
  if (!lineage.some(item => item.backupId === header.backupId)) lineage.push({ backupId: header.backupId, parentBackupId: header.parentBackupId, generation: header.generation });
  const state = { schemaVersion: 1, databaseId: header.databaseId, lastBackupId: header.backupId, generation: Number(header.generation), knownBackups: lineage.slice(-256) };
  saveBackupState(paths, state);
  return state;
}

function compareLineage(state, incoming) {
  if (!state.databaseId) return { status: 'uninitialized', action: 'adopt_with_explicit_restore', safeToRestore: true };
  if (state.databaseId !== incoming.databaseId) return { status: 'foreign_database', action: 'block', safeToRestore: false };
  if (state.lastBackupId === incoming.backupId) return { status: 'same', action: 'noop', safeToRestore: true };
  const known = new Map(state.knownBackups.map(item => [item.backupId, item]));
  const incomingLineage = new Map((incoming.lineage || []).map(item => [item.backupId, item]));
  if (incoming.parentBackupId === state.lastBackupId || incomingLineage.has(state.lastBackupId)) {
    return { status: 'fast_forward', action: 'restore_allowed', safeToRestore: true };
  }
  if (known.has(incoming.backupId)) return { status: 'local_ahead', action: 'keep_local', safeToRestore: false };
  if (incoming.parentBackupId && known.has(incoming.parentBackupId)) return { status: 'diverged', action: 'block_and_review', safeToRestore: false };
  return { status: 'unknown_lineage', action: 'block_and_review', safeToRestore: false };
}

function readPackageHeader(file) {
  const fd = fs.openSync(path.resolve(file), 'r');
  try {
    const prefix = Buffer.alloc(12);
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length || !prefix.subarray(0, 8).equals(MAGIC)) throw coded('backup_format_invalid');
    const length = prefix.readUInt32BE(8);
    if (length < 2 || length > HEADER_LIMIT) throw coded('backup_header_invalid');
    const body = Buffer.alloc(length);
    if (fs.readSync(fd, body, 0, length, 12) !== length) throw coded('backup_header_truncated');
    const header = JSON.parse(body.toString('utf8'));
    const ciphertextOffset = 12 + length;
    if (fs.statSync(file).size !== ciphertextOffset + Number(header.ciphertextBytes)) throw coded('backup_size_mismatch');
    return { header, ciphertextOffset };
  } finally { fs.closeSync(fd); }
}

async function encryptSnapshot({ plaintext, target, key, headerBase }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const tempCiphertext = `${target}.cipher-${process.pid}`;
  const tempPackage = `${target}.tmp-${process.pid}`;
  try {
    const protectedHeader = authenticatedHeader({
      ...headerBase,
      encryption: { algorithm: 'aes-256-gcm', iv: iv.toString('base64') },
      plaintextSha256: await hashFile(plaintext),
      plaintextBytes: fs.statSync(plaintext).size,
    });
    const aad = Buffer.from(JSON.stringify(protectedHeader), 'utf8');
    cipher.setAAD(aad);
    await pipeline(fs.createReadStream(plaintext), cipher, fs.createWriteStream(tempCiphertext, { mode: 0o600, flags: 'wx' }));
    const tag = cipher.getAuthTag();
    const ciphertextBytes = fs.statSync(tempCiphertext).size;
    const header = {
      ...protectedHeader,
      encryption: { ...protectedHeader.encryption, tag: tag.toString('base64') },
      aadSha256: sha256(aad),
      ciphertextSha256: await hashFile(tempCiphertext),
      ciphertextBytes,
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.length > HEADER_LIMIT) throw coded('backup_header_too_large');
    const prefix = Buffer.alloc(12); MAGIC.copy(prefix, 0); prefix.writeUInt32BE(headerBytes.length, 8);
    fs.writeFileSync(tempPackage, Buffer.concat([prefix, headerBytes]), { mode: 0o600, flag: 'wx' });
    await pipeline(fs.createReadStream(tempCiphertext), fs.createWriteStream(tempPackage, { flags: 'a', mode: 0o600 }));
    fs.renameSync(tempPackage, target);
    fs.chmodSync(target, 0o600);
    return header;
  } finally {
    for (const file of [tempCiphertext, tempPackage]) { try { fs.unlinkSync(file); } catch {} }
  }
}

async function decryptPackage({ input, output, key }) {
  const { header, ciphertextOffset } = readPackageHeader(input);
  if (header.keyFingerprint !== keyFingerprint(key)) throw coded('backup_key_mismatch');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.encryption.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(header.encryption.tag, 'base64'));
  const aad = Buffer.from(JSON.stringify(authenticatedHeader(header)), 'utf8');
  if (sha256(aad) !== header.aadSha256) throw coded('backup_header_authentication_mismatch');
  decipher.setAAD(aad);
  await pipeline(fs.createReadStream(input, { start: ciphertextOffset }), decipher, fs.createWriteStream(output, { mode: 0o600, flags: 'wx' }));
  if (await hashFile(output) !== header.plaintextSha256) throw coded('backup_plaintext_hash_mismatch');
  return header;
}

async function createEncryptedMemoryBackup({ paths = resolveV9Paths(), keyStore = createMacKeychainStore(), clock = () => new Date() } = {}) {
  const key = keyStore.get();
  safeMkdir(paths.memoryEncryptedBackupRoot);
  safeMkdir(paths.memoryBackupRoot);
  const state = loadBackupState(paths);
  if (!state.databaseId) state.databaseId = randomId('db');
  const backupId = randomId('bkp');
  const generation = state.generation + 1;
  const createdAt = clock().toISOString();
  const workDir = fs.mkdtempSync(path.join(paths.memoryBackupRoot, '.encrypting-'));
  fs.chmodSync(workDir, 0o700);
  const plaintext = path.join(workDir, 'snapshot.sqlite3');
  const target = path.join(paths.memoryEncryptedBackupRoot, `memory-g${String(generation).padStart(6, '0')}-${backupId}.cbmem`);
  try {
    const snapshot = await backupMemoryDatabase({ paths, targetPath: plaintext });
    if (!snapshot.integrity.passed) throw coded('backup_integrity_failed');
    const lineage = [...state.knownBackups, { backupId, parentBackupId: state.lastBackupId, generation }].slice(-64);
    const header = await encryptSnapshot({
      plaintext, target, key,
      headerBase: {
        schemaVersion: 1,
        packageType: 'codex-brain-memory-backup',
        databaseId: state.databaseId,
        backupId,
        parentBackupId: state.lastBackupId,
        generation,
        deviceId: ensureDeviceId(paths),
        createdAt,
        sqliteSchemaVersion: 1,
        keyFingerprint: keyFingerprint(key),
        lineage,
      },
    });
    state.lastBackupId = backupId;
    state.generation = generation;
    state.knownBackups = lineage;
    saveBackupState(paths, state);
    return { created: true, target, header, packageSha256: await hashFile(target), integrity: snapshot.integrity };
  } finally {
    try { fs.unlinkSync(plaintext); } catch {}
    try { fs.rmdirSync(workDir); } catch {}
  }
}

async function verifyEncryptedMemoryBackup({ input, paths = resolveV9Paths(), keyStore = createMacKeychainStore() } = {}) {
  const key = keyStore.get();
  safeMkdir(paths.memoryBackupRoot);
  const workDir = fs.mkdtempSync(path.join(paths.memoryBackupRoot, '.verifying-'));
  fs.chmodSync(workDir, 0o700);
  const plaintext = path.join(workDir, 'verify.sqlite3');
  try {
    const header = await decryptPackage({ input: path.resolve(input), output: plaintext, key });
    const db = new DatabaseSync(plaintext, { readOnly: true });
    try {
      const report = integrity(db);
      if (!report.passed) throw coded('backup_integrity_failed');
      return { passed: true, input: path.resolve(input), header, packageSha256: await hashFile(input), integrity: report };
    } finally { db.close(); }
  } finally {
    try { fs.unlinkSync(plaintext); } catch {}
    try { fs.rmdirSync(workDir); } catch {}
  }
}

function inspectEncryptedMemoryBackup(input) {
  const { header } = readPackageHeader(input);
  return { input: path.resolve(input), header, encrypted: true };
}

async function compareEncryptedMemoryBackup({ input, paths = resolveV9Paths(), keyStore = createMacKeychainStore() } = {}) {
  const verified = await verifyEncryptedMemoryBackup({ input, paths, keyStore });
  const local = loadBackupState(paths);
  return { input: path.resolve(input), authenticated: true, local, incoming: verified.header, comparison: compareLineage(local, verified.header) };
}

module.exports = {
  MAGIC,
  compareEncryptedMemoryBackup,
  compareLineage,
  createEncryptedMemoryBackup,
  createMacKeychainStore,
  inspectEncryptedMemoryBackup,
  keyFingerprint,
  authenticatedHeader,
  adoptBackupState,
  decryptPackage,
  loadBackupState,
  readPackageHeader,
  verifyEncryptedMemoryBackup,
  saveBackupState,
};
