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

function planMigration(manifest) {
  const migratable = manifest.records.filter(record => record.disposition === 'migrate');
  const manifestHash = canonicalHash(manifest.records);
  return {
    schemaVersion: 9,
    sourceRoot: manifest.sourceRoot,
    outputRoot: manifest.outputRoot,
    manifestHash,
    records: migratable,
    lockPath: path.join(manifest.outputRoot, 'migration.lock'),
  };
}

function verifyBackup(plan, backupRoot) {
  const file = path.join(path.resolve(backupRoot), 'backup-manifest.json');
  if (!fs.existsSync(file)) throw new Error('verified_backup_required');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.manifestHash !== plan.manifestHash) throw new Error('verified_backup_required');
}

function destinationFor(plan, record) {
  return path.join(plan.outputRoot, 'imported', `v${record.detectedVersion}`, record.relativePath);
}

function applyMigration(plan, options = {}) {
  if (options.confirm !== true) throw new Error('explicit_confirmation_required');
  verifyBackup(plan, options.backupRoot);
  return withFileLock(plan.lockPath, () => {
    let created = 0;
    let unchanged = 0;
    const records = [];
    for (const record of plan.records) {
      const source = path.join(plan.sourceRoot, record.relativePath);
      if (sha256File(source) !== record.sourceHash) throw new Error('legacy_source_changed');
      const target = destinationFor(plan, record);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
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

module.exports = { applyMigration, inventoryLegacy, planMigration, verifyMigration, writeRollbackMarker };
