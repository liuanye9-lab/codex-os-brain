'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openMemoryDatabase, integrity } = require('./memory-db');
const { resolveV9Paths } = require('./paths');

const REQUIRED = [
  'scripts/v9/memory-db.js', 'scripts/v9/memory-service.js', 'scripts/v9/memory-harness.js', 'scripts/v9/memory-encrypted-backup.js', 'scripts/v9/memory-recovery.js',
  'scripts/brain-lite-routing-receipt.js',
  'tests/brain-v9-memory-db.test.js', 'tests/brain-v9-memory-service.test.js', 'tests/brain-v9-memory-harness.test.js', 'tests/brain-v9-memory-encrypted-backup.test.js', 'tests/brain-v9-memory-recovery.test.js',
  'tests/brain-lite-routing-receipt.test.js',
];

function verifyCapabilities({ root = path.resolve(__dirname, '..', '..'), paths = resolveV9Paths() } = {}) {
  const files = REQUIRED.map(relative => ({ relative, present: fs.existsSync(path.join(root, relative)) }));
  let database = { passed: false, error: null };
  try {
    const db = openMemoryDatabase({ paths });
    database = { ...integrity(db), fts5: Boolean(db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get().enabled) };
    db.close();
  } catch (error) { database.error = error.code || error.message; }
  const capabilities = {
    transactionalStore: database.passed,
    crud: files.find(item => item.relative.endsWith('memory-service.js'))?.present === true,
    fullTextBm25: database.fts5 === true,
    exactVectorRetrieval: files.find(item => item.relative.endsWith('memory-service.js'))?.present === true,
    graphTraversal: files.find(item => item.relative.endsWith('memory-service.js'))?.present === true,
    agentStateBlocks: files.find(item => item.relative.endsWith('memory-service.js'))?.present === true,
    candidateOnlyEvolution: files.find(item => item.relative.endsWith('memory-harness.js'))?.present === true,
    encryptedBackup: files.find(item => item.relative.endsWith('memory-encrypted-backup.js'))?.present === true,
    offlineKeyRecovery: files.find(item => item.relative.endsWith('memory-recovery.js'))?.present === true,
    automaticRestore: files.find(item => item.relative.endsWith('memory-recovery.test.js'))?.present === true,
    verifierBackedRouting: files.find(item => item.relative.endsWith('brain-lite-routing-receipt.test.js'))?.present === true,
  };
  return { passed: files.every(item => item.present) && database.passed && Object.values(capabilities).every(Boolean), files, database, capabilities };
}

if (require.main === module) {
  const report = verifyCapabilities();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

module.exports = { REQUIRED, verifyCapabilities };
