'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openMemoryDatabase, integrity } = require('./memory-db');
const { createMemoryService } = require('./memory-service');
const { createMemoryHarness } = require('./memory-harness');
const encryptedBackup = require('./memory-encrypted-backup');
const recovery = require('./memory-recovery');
const routingReceipt = require('../brain-lite-routing-receipt');
const { resolveV9Paths } = require('./paths');

const REQUIRED = [
  'scripts/v9/memory-db.js', 'scripts/v9/memory-service.js', 'scripts/v9/memory-harness.js', 'scripts/v9/memory-encrypted-backup.js', 'scripts/v9/memory-recovery.js',
  'scripts/brain-lite-routing-receipt.js',
  'tests/brain-v9-memory-db.test.js', 'tests/brain-v9-memory-service.test.js', 'tests/brain-v9-memory-harness.test.js', 'tests/brain-v9-memory-encrypted-backup.test.js', 'tests/brain-v9-memory-recovery.test.js',
  'tests/brain-lite-routing-receipt.test.js',
];

function verifyCapabilities({ root = path.resolve(__dirname, '..', '..'), paths = resolveV9Paths() } = {}) {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-brain-capability-'));
  const smokePaths = resolveV9Paths({
    CODEX_BRAIN_HOME: path.join(smokeRoot, 'brain'),
    CODEX_BRAIN_STATE_HOME: path.join(smokeRoot, 'state'),
  });
  const files = REQUIRED.map(relative => {
    const target = path.join(root, relative);
    return { relative, present: fs.existsSync(target), bytes: fs.existsSync(target) ? fs.statSync(target).size : 0 };
  });
  let database = { passed: false, error: null };
  try {
    const db = openMemoryDatabase({ paths: smokePaths });
    database = { ...integrity(db), fts5: Boolean(db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get().enabled) };
    db.close();
  } catch (error) { database.error = error.code || error.message; }
  const smoke = {
    crud: false,
    exactVectorRetrieval: false,
    graphTraversal: false,
    agentStateBlocks: false,
    candidateOnlyEvolution: false,
    verifierBackedRouting: false,
  };
  try {
    const memory = createMemoryService({ paths: smokePaths });
    const suffix = process.pid.toString(36);
    const created = memory.createMemory({ memoryId: `cap_mem_${suffix}`, content: 'capability smoke', kind: 'fact' });
    smoke.crud = created.status === 'candidate' && memory.getMemory(created.memory_id)?.memory_id === created.memory_id;
    memory.importDocument({ documentId: `cap_doc_${suffix}`, sourceUri: `capability:${suffix}`, content: 'vector smoke', embedding: [1, 0], model: 'smoke', fingerprint: 'smoke' });
    smoke.exactVectorRetrieval = memory.search({ query: 'not-present', queryVector: [1, 0] }).results[0]?.ownerId === `cap_doc_${suffix}`;
    memory.upsertEntity({ entityId: `cap_a_${suffix}`, entityType: 'project', name: `Capability A ${suffix}` });
    memory.upsertEntity({ entityId: `cap_b_${suffix}`, entityType: 'task', name: `Capability B ${suffix}` });
    memory.link({ fromEntityId: `cap_a_${suffix}`, toEntityId: `cap_b_${suffix}`, relation: 'smoke', status: 'active', approvedBy: 'capability-verifier' });
    smoke.graphTraversal = memory.traverse({ entityId: `cap_a_${suffix}`, depth: 1 }).length === 2;
    smoke.agentStateBlocks = memory.putStateBlock({ blockId: `cap_state_${suffix}`, agentId: 'capability-verifier', scope: 'working', content: 'smoke' }).version === 1;
    smoke.candidateOnlyEvolution = typeof createMemoryHarness({ paths: smokePaths }).cycle === 'function';
    smoke.verifierBackedRouting = routingReceipt.runVerifier({
      command: process.execPath,
      args: ['--check', path.join(root, 'scripts', 'brain-lite-routing-receipt.js')],
      expectedExitStatus: 0,
    }, { cwd: root }).passed === true;
  } catch (error) {
    smoke.error = error.code || error.message;
  }
  const capabilities = {
    transactionalStore: database.passed,
    crud: smoke.crud,
    fullTextBm25: database.fts5 === true,
    exactVectorRetrieval: smoke.exactVectorRetrieval,
    graphTraversal: smoke.graphTraversal,
    agentStateBlocks: smoke.agentStateBlocks,
    candidateOnlyEvolution: smoke.candidateOnlyEvolution,
    encryptedBackup: typeof encryptedBackup.createEncryptedMemoryBackup === 'function'
      && typeof encryptedBackup.verifyEncryptedMemoryBackup === 'function',
    offlineKeyRecovery: typeof recovery.exportRecoveryKey === 'function'
      && typeof recovery.reconstructRecoveryKey === 'function',
    automaticRestore: typeof recovery.restoreEncryptedMemoryBackup === 'function'
      && typeof recovery.recoverMemoryRuntime === 'function',
    verifierBackedRouting: smoke.verifierBackedRouting,
  };
  const report = {
    passed: files.every(item => item.present && item.bytes > 0) && database.passed && Object.values(capabilities).every(Boolean),
    files,
    database,
    smoke,
    capabilities,
  };
  fs.rmSync(smokeRoot, { recursive: true, force: true });
  return report;
}

if (require.main === module) {
  const report = verifyCapabilities();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

module.exports = { REQUIRED, verifyCapabilities };
