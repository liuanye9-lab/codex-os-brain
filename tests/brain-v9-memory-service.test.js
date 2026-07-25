'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryService } = require('../scripts/v9/memory-service');
const { resolveV9Paths } = require('../scripts/v9/paths');

function service() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-memory-service-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  return createMemoryService({ paths });
}

test('memory CRUD is candidate-first, versioned, and approval gated', () => {
  const memory = service();
  const created = memory.createMemory({ memoryId: 'mem_1', kind: 'preference', content: '默认使用本地检索' });
  assert.equal(created.status, 'candidate');
  assert.equal(memory.search({ query: '本地检索' }).count, 0);
  assert.throws(() => memory.updateMemory('mem_1', { expectedVersion: 9, content: 'x' }), /version_conflict/);
  const confirmed = memory.transitionMemory('mem_1', 'confirmed', { expectedVersion: 1, approvedBy: 'operator', reason: 'test approval' });
  assert.equal(confirmed.version, 2);
  assert.equal(memory.search({ query: '本地检索' }).results[0].ownerId, 'mem_1');
  assert.throws(() => memory.updateMemory('mem_1', { expectedVersion: 2, content: 'remote' }), /approval_required/);
  assert.equal(memory.updateMemory('mem_1', { expectedVersion: 2, content: '坚持本地检索', approvedBy: 'operator' }).version, 3);
  const repeated = memory.updateMemory('mem_1', { expectedVersion: 3, content: '幂等更新', approvedBy: 'operator', idempotencyKey: 'update-1' });
  assert.equal(memory.updateMemory('mem_1', { expectedVersion: 4, content: '不应二次更新', approvedBy: 'operator', idempotencyKey: 'update-1' }).version, repeated.version);
  assert.equal(memory.getMemory('mem_1').content, '幂等更新');
  const deleted = memory.deleteMemory('mem_1', { expectedVersion: 4, approvedBy: 'operator', reason: 'test delete', idempotencyKey: 'delete-1' });
  assert.equal(deleted.status, 'retired');
  assert.equal(memory.search({ query: '幂等更新', includeCandidates: true }).count, 0);
});

test('idempotency keys cannot cross memory objects or actions', () => {
  const memory = service();
  const a = memory.createMemory({ memoryId: 'idem_a', content: 'A' });
  const b = memory.createMemory({ memoryId: 'idem_b', content: 'B' });
  memory.updateMemory(a.memory_id, { expectedVersion: 1, content: 'A2', idempotencyKey: 'shared-key' });
  assert.throws(() => memory.updateMemory(b.memory_id, { expectedVersion: 1, content: 'B2', idempotencyKey: 'shared-key' }), /idempotency_key_conflict/);
  assert.throws(() => memory.deleteMemory(a.memory_id, { expectedVersion: 2, approvedBy: 'operator', idempotencyKey: 'shared-key' }), /idempotency_key_conflict/);
  assert.equal(memory.getMemory(b.memory_id).content, 'B');
});

test('source documents are searchable evidence and exact vectors join hybrid ranking', () => {
  const memory = service();
  const a = memory.importDocument({ documentId: 'doc_a', sourceUri: 'source:a', title: '事务', content: '事务保证跨记录一致性', embedding: [1, 0], model: 'test', fingerprint: 'fp' });
  memory.importDocument({ documentId: 'doc_b', sourceUri: 'source:b', title: '图', content: '图遍历处理实体关系', embedding: [0, 1], model: 'test', fingerprint: 'fp' });
  memory.importDocument({ documentId: 'doc_c', sourceUri: 'source:c', title: '部分相关', content: '事务记录但不讨论一致性' });
  assert.equal(a.imported, true);
  assert.equal(memory.importDocument({ sourceUri: 'source:a2', content: '事务保证跨记录一致性' }).imported, false);
  const lexical = memory.search({ query: '事务跨记录一致性' });
  assert.equal(lexical.results[0].ownerId, 'doc_a');
  assert.match(lexical.results[0].sourceRef, /^(?:local|source):/);
  assert.equal('source_uri' in lexical.results[0], false);
  assert.equal(memory.search({ query: '图' }).results[0].ownerId, 'doc_b');
  const hybrid = memory.search({ query: '不存在的词', queryVector: [0, 1] });
  assert.equal(hybrid.mode, 'hybrid-exact');
  assert.equal(hybrid.results[0].ownerId, 'doc_b');
});

test('memory search enforces half-open temporal validity for lexical and vector recall', () => {
  const memory = service();
  const from = '2026-07-25T00:00:00Z';
  const to = '2026-07-26T00:00:00Z';
  memory.createMemory({
    memoryId: 'mem_temporal',
    kind: 'decision',
    content: 'temporal canary decision',
    status: 'confirmed',
    approvedBy: 'operator',
    validFrom: from,
    validTo: to,
  });
  memory.putEmbedding({ ownerType: 'memory', ownerId: 'mem_temporal', model: 'test', fingerprint: 'fp', vector: [1, 0] });

  assert.equal(memory.search({ query: 'temporal canary', at: '2026-07-24T23:59:59Z' }).count, 0);
  assert.equal(memory.search({ query: 'temporal canary', at: from }).results[0].ownerId, 'mem_temporal');
  assert.equal(memory.search({ query: 'missing', queryVector: [1, 0], at: '2026-07-25T12:00:00Z' }).results[0].ownerId, 'mem_temporal');
  assert.equal(memory.search({ query: 'temporal canary', at: to }).count, 0);
  assert.equal(memory.search({ query: 'missing', queryVector: [1, 0], at: '2026-07-26T00:00:01Z' }).count, 0);
  assert.throws(() => memory.search({ query: 'temporal', at: 'tomorrow' }), /invalid_at/);
  assert.throws(() => memory.createMemory({ content: 'bad interval', validFrom: to, validTo: from }), /invalid_validity_interval/);
});

test('graph traversal supports approved temporal edges', () => {
  const memory = service();
  const a = memory.upsertEntity({ entityId: 'a', entityType: 'project', name: 'Brain' });
  const b = memory.upsertEntity({ entityId: 'b', entityType: 'decision', name: 'SQLite' });
  const c = memory.upsertEntity({ entityId: 'c', entityType: 'task', name: 'Migration' });
  assert.equal(a.entity_id, 'a'); assert.equal(b.entity_id, 'b'); assert.equal(c.entity_id, 'c');
  assert.throws(() => memory.link({ fromEntityId: 'a', toEntityId: 'b', relation: 'adopts', status: 'active' }), /approval_required/);
  memory.link({ fromEntityId: 'a', toEntityId: 'b', relation: 'adopts', status: 'active', approvedBy: 'operator' });
  memory.link({ fromEntityId: 'b', toEntityId: 'c', relation: 'enables', status: 'active', approvedBy: 'operator' });
  const nodes = memory.traverse({ entityId: 'a', depth: 2 });
  assert.deepEqual(nodes.map(node => node.entity_id), ['a', 'b', 'c']);
});

test('agent state blocks separate working, core, project, archival and external state', () => {
  const memory = service();
  const block = memory.putStateBlock({ blockId: 'working-goal', agentId: 'agent-a', scope: 'working', content: 'ship memory kernel' });
  assert.equal(block.version, 1);
  assert.throws(() => memory.putStateBlock({ blockId: 'working-goal', agentId: 'agent-a', scope: 'working', content: 'stale', expectedVersion: 7 }), /version_conflict/);
  assert.equal(memory.putStateBlock({ blockId: 'working-goal', agentId: 'agent-a', scope: 'working', content: 'verify memory kernel', expectedVersion: 1 }).version, 2);
  assert.equal(memory.listStateBlocks('agent-a', 'working').length, 1);
});
