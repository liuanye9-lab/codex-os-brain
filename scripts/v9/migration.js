#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { atomicWriteJson, sha256File, withFileLock } = require('./store');

const EXCLUDED = new Set(['.git', 'node_modules', 'runtime', '.worktrees']);

function isDataless(filePath) {
  if (process.platform !== 'darwin') return false;
  const result = spawnSync('/bin/ls', ['-lO', filePath], { encoding: 'utf8', timeout: 1500 });
  return /\bdataless\b/.test(result.stdout || '');
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) result._.push(item);
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[item.slice(2)] = argv[++index];
    else result[item.slice(2)] = true;
  }
  return result;
}

function detectLegacyVersion(relativePath) {
  const match = relativePath.replaceAll('\\', '/').match(/(?:^|\/)v([1-8])(?:\/|$)/i);
  return match ? Number(match[1]) : 1;
}

function classifySensitivity(relativePath) {
  return /memory|identity|soul|state|session|transcript|credential|secret/i.test(relativePath) ? 'private' : 'internal';
}

function collectFiles(root) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  visit(root);
  return files;
}

function canonicalHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new Error('invalid_migration_relative_path');
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error('invalid_migration_relative_path');
  }
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('invalid_migration_relative_path');
  }
  return normalized;
}

function assertContained(root, target, code = 'migration_path_escape') {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === '.') return path.resolve(target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(code);
  return path.resolve(target);
}

function assertExistingParentContained(root, target) {
  const rootPath = path.resolve(root);
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('migration_path_escape');
    existing = parent;
  }
  return assertContained(fs.realpathSync(rootPath), fs.realpathSync(existing));
}

function resolveContained(root, relativePath, { mustExist = false } = {}) {
  const rootPath = path.resolve(root);
  const normalized = normalizeRelativePath(relativePath);
  const lexical = assertContained(rootPath, path.resolve(rootPath, ...normalized.split('/')));
  if (!mustExist) {
    if (fs.existsSync(rootPath)) assertExistingParentContained(rootPath, lexical);
    return lexical;
  }
  if (!fs.existsSync(lexical) || !fs.statSync(lexical).isFile()) throw new Error('migration_source_missing');
  const realRoot = fs.realpathSync(rootPath);
  const realTarget = fs.realpathSync(lexical);
  return assertContained(realRoot, realTarget);
}

function validateRecord(record) {
  if (!isPlainObject(record)) throw new Error('invalid_migration_record');
  const relativePath = normalizeRelativePath(record.relativePath);
  if (!Number.isInteger(record.detectedVersion) || record.detectedVersion < 1 || record.detectedVersion > 8) {
    throw new Error('invalid_migration_version');
  }
  if (!['migrate', 'unavailable_dataless'].includes(record.disposition)) throw new Error('invalid_migration_disposition');
  if (!['private', 'internal'].includes(record.sensitivity)) throw new Error('invalid_migration_sensitivity');
  if (record.disposition === 'migrate' && !/^[a-f0-9]{64}$/i.test(String(record.sourceHash || ''))) {
    throw new Error('invalid_migration_source_hash');
  }
  if (record.bytes !== undefined && (!Number.isSafeInteger(record.bytes) || record.bytes < 0)) throw new Error('invalid_migration_bytes');
  return { ...record, relativePath };
}

function validateManifest(manifest, trustedRoots = {}) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 9 || !Array.isArray(manifest.records)) {
    throw new Error('invalid_migration_manifest');
  }
  if (manifest.records.length > 100_000) throw new Error('migration_manifest_too_large');
  if (!path.isAbsolute(manifest.sourceRoot || '') || !path.isAbsolute(manifest.outputRoot || '')) {
    throw new Error('migration_roots_must_be_absolute');
  }
  const sourceRoot = path.resolve(manifest.sourceRoot);
  const outputRoot = path.resolve(manifest.outputRoot);
  if (trustedRoots.sourceRoot && sourceRoot !== path.resolve(trustedRoots.sourceRoot)) throw new Error('migration_source_root_mismatch');
  if (trustedRoots.outputRoot && outputRoot !== path.resolve(trustedRoots.outputRoot)) throw new Error('migration_output_root_mismatch');
  const records = manifest.records.map(validateRecord);
  const unique = new Set(records.map(record => record.relativePath));
  if (unique.size !== records.length) throw new Error('duplicate_migration_record');
  return { ...manifest, sourceRoot, outputRoot, records };
}

function inventoryLegacy({ brainRoot, outputRoot }) {
  const sourceRoot = path.resolve(brainRoot);
  const destination = path.resolve(outputRoot);
  const records = collectFiles(sourceRoot)
    .filter(file => !path.resolve(file).startsWith(`${destination}${path.sep}`))
    .map(file => {
      const relativePath = path.relative(sourceRoot, file).replaceAll('\\', '/');
      if (isDataless(file)) return { relativePath, detectedVersion: detectLegacyVersion(relativePath), disposition: 'unavailable_dataless', sensitivity: classifySensitivity(relativePath) };
      return {
        relativePath,
        detectedVersion: detectLegacyVersion(relativePath),
        bytes: fs.statSync(file).size,
        sourceHash: sha256File(file),
        sensitivity: classifySensitivity(relativePath),
        disposition: 'migrate',
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { schemaVersion: 9, sourceRoot, outputRoot: destination, createdAt: new Date().toISOString(), records };
}

function planMigration(manifest, options = {}) {
  const validated = validateManifest(manifest, options);
  if (options.rebuild === true) {
    const rebuilt = inventoryLegacy({ brainRoot: validated.sourceRoot, outputRoot: validated.outputRoot });
    if (canonicalHash(rebuilt.records) !== canonicalHash(validated.records)) throw new Error('migration_manifest_stale');
  }
  const migratable = validated.records.filter(record => record.disposition === 'migrate');
  const manifestHash = canonicalHash({
    schemaVersion: 9,
    sourceRoot: validated.sourceRoot,
    outputRoot: validated.outputRoot,
    records: validated.records,
  });
  return {
    schemaVersion: 9,
    sourceRoot: validated.sourceRoot,
    outputRoot: validated.outputRoot,
    manifestHash,
    records: migratable,
    lockPath: path.join(validated.outputRoot, 'migration.lock'),
  };
}

function verifyBackup(plan, backupRoot) {
  if (typeof backupRoot !== 'string' || backupRoot.length === 0) throw new Error('verified_backup_required');
  const root = path.resolve(backupRoot);
  const file = path.join(root, 'backup-manifest.json');
  if (!fs.existsSync(file)) throw new Error('verified_backup_required');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('verified_backup_required'); }
  if (value.schemaVersion !== 9 || value.manifestHash !== plan.manifestHash || !Array.isArray(value.records)) throw new Error('verified_backup_required');
  const expected = new Map(plan.records.map(record => [record.relativePath, record.sourceHash]));
  if (expected.size !== value.records.length) throw new Error('verified_backup_required');
  const seen = new Set();
  for (const record of value.records) {
    if (!isPlainObject(record)) throw new Error('verified_backup_required');
    const relativePath = normalizeRelativePath(record.relativePath);
    if (seen.has(relativePath)) throw new Error('verified_backup_required');
    seen.add(relativePath);
    const expectedHash = expected.get(relativePath);
    if (!expectedHash || record.sourceHash !== expectedHash) throw new Error('verified_backup_required');
    const backupFile = resolveContained(path.join(root, 'files'), relativePath, { mustExist: true });
    if (sha256File(backupFile) !== expectedHash) throw new Error('verified_backup_required');
  }
  return { manifestPath: file, records: value.records.length };
}

function createMigrationBackup(plan, backupRoot, options = {}) {
  if (options.confirm !== true) throw new Error('explicit_confirmation_required');
  const root = path.resolve(backupRoot);
  const filesRoot = path.join(root, 'files');
  fs.mkdirSync(filesRoot, { recursive: true, mode: 0o700 });
  const records = [];
  for (const record of plan.records) {
    const source = resolveContained(plan.sourceRoot, record.relativePath, { mustExist: true });
    if (sha256File(source) !== record.sourceHash) throw new Error('legacy_source_changed');
    let target = resolveContained(filesRoot, record.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    target = resolveContained(filesRoot, record.relativePath);
    if (fs.existsSync(target) && sha256File(target) !== record.sourceHash) throw new Error('backup_target_conflict');
    if (!fs.existsSync(target)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
    records.push({ relativePath: record.relativePath, sourceHash: record.sourceHash });
  }
  atomicWriteJson(path.join(root, 'backup-manifest.json'), {
    schemaVersion: 9,
    manifestHash: plan.manifestHash,
    createdAt: new Date().toISOString(),
    records,
  });
  return { backupRoot: root, manifestHash: plan.manifestHash, records: records.length };
}

function destinationFor(plan, record) {
  return resolveContained(plan.outputRoot, path.posix.join('imported', `v${record.detectedVersion}`, record.relativePath));
}

function applyMigration(plan, options = {}) {
  if (options.confirm !== true) throw new Error('explicit_confirmation_required');
  verifyBackup(plan, options.backupRoot);
  fs.mkdirSync(plan.outputRoot, { recursive: true, mode: 0o700 });
  assertContained(plan.outputRoot, plan.lockPath);
  return withFileLock(plan.lockPath, () => {
    let created = 0;
    let unchanged = 0;
    const records = [];
    for (const record of plan.records) {
      const source = resolveContained(plan.sourceRoot, record.relativePath, { mustExist: true });
      if (sha256File(source) !== record.sourceHash) throw new Error('legacy_source_changed');
      let target = destinationFor(plan, record);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      target = destinationFor(plan, record);
      if (fs.existsSync(target)) {
        if (sha256File(target) !== record.sourceHash) throw new Error('migration_target_conflict');
        unchanged += 1;
      } else {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        created += 1;
      }
      records.push({ ...record, target: path.relative(plan.outputRoot, target).replaceAll('\\', '/'), adapterVersion: 'v9-copy-1' });
    }
    const result = { schemaVersion: 9, manifestHash: plan.manifestHash, total: records.length, created, unchanged, records };
    atomicWriteJson(path.join(plan.outputRoot, 'migration-result.json'), result);
    return result;
  });
}

function verifyMigration(manifest, result) {
  const expected = new Map(manifest.records.filter(record => record.disposition === 'migrate').map(record => [record.relativePath, record.sourceHash]));
  const mismatches = result.records.filter(record => expected.get(record.relativePath) !== record.sourceHash).map(record => record.relativePath);
  return { passed: mismatches.length === 0 && expected.size === result.records.length, expected: expected.size, actual: result.records.length, mismatches };
}

function writeRollbackMarker(runtimeRoot, targetVersion = 8) {
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > 8) throw new Error('invalid_rollback_version');
  const marker = { schemaVersion: 9, targetVersion, createdAt: new Date().toISOString() };
  atomicWriteJson(path.join(runtimeRoot, 'rollback.json'), marker);
  return marker;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] !== 'inventory' || !args['brain-root']) throw new Error('usage: migration.js inventory --brain-root PATH [--output-root PATH] --json');
  const outputRoot = args['output-root'] || path.join(process.cwd(), '.brain-v9-inventory');
  const manifest = inventoryLegacy({ brainRoot: args['brain-root'], outputRoot });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

module.exports = {
  applyMigration,
  createMigrationBackup,
  inventoryLegacy,
  planMigration,
  validateManifest,
  verifyBackup,
  verifyMigration,
  writeRollbackMarker,
};
