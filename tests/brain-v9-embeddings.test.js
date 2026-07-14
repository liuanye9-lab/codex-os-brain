'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveV9Paths } = require('../scripts/v9/paths');
const {
  createEmbeddingService,
  isLoopbackEndpoint,
} = require('../scripts/v9/embeddings');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-embeddings-'));
  return { paths: resolveV9Paths({ CODEX_BRAIN_HOME: home }) };
}

test('embedding configuration is local-only and requires explicit confirmation', () => {
  const service = createEmbeddingService(fixture());
  assert.equal(isLoopbackEndpoint('http://127.0.0.1:11434/api/embed'), true);
  assert.equal(isLoopbackEndpoint('http://localhost:11434/api/embed'), true);
  assert.equal(isLoopbackEndpoint('https://embedding.invalid/api/embed'), false);
  assert.throws(() => service.configure({ model: 'qwen3-embedding:0.6b' }), /confirmation_required/);
  assert.throws(() => service.configure({ model: 'qwen3-embedding:0.6b', endpoint: 'https://embedding.invalid/api/embed', confirm: true }), /local_endpoint_required/);
});

test('changing model identity marks the complete index for rebuild', () => {
  const { paths } = fixture();
  const service = createEmbeddingService({ paths });
  const first = service.configure({ model: 'qwen3-embedding:0.6b', confirm: true });
  assert.equal(first.requiresReindex, true);
  const unchanged = service.configure({ model: 'qwen3-embedding:0.6b', confirm: true });
  assert.equal(unchanged.requiresReindex, true);
  assert.equal(unchanged.fingerprint, first.fingerprint);
  const changed = service.configure({ model: 'qwen3-embedding:4b', confirm: true });
  assert.equal(changed.requiresReindex, true);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.equal(fs.statSync(paths.embeddingConfigPath).mode & 0o777, 0o600);
});

test('reindex state clears only for the configured fingerprint with confirmation', () => {
  const { paths } = fixture();
  const service = createEmbeddingService({ paths });
  const configured = service.configure({ model: 'qwen3-embedding:0.6b', confirm: true });
  const manifestPath = path.join(paths.embeddingsRoot, 'index-manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ embeddingFingerprint: configured.fingerprint, vectorCount: 12, failedCount: 0, warnings: [{ reason: 'dataless' }] }));
  assert.throws(() => service.markIndexed({ manifestPath }), /confirmation_required/);
  assert.throws(() => service.markIndexed({ manifestPath: path.join(paths.embeddingsRoot, 'missing.json'), confirm: true }), /index_evidence_required/);
  const indexed = service.markIndexed({ manifestPath, confirm: true });
  assert.equal(indexed.requiresReindex, false);
  assert.equal(indexed.indexedFingerprint, configured.fingerprint);
  assert.equal(indexed.indexEvidence.sourceWarningCount, 1);
  const changed = service.configure({ model: 'qwen3-embedding:4b', confirm: true });
  assert.equal(changed.requiresReindex, true);
});

test('index evidence must match the configured fingerprint and contain vectors', () => {
  const { paths } = fixture();
  const service = createEmbeddingService({ paths });
  service.configure({ model: 'qwen3-embedding:0.6b', confirm: true });
  const manifestPath = path.join(paths.embeddingsRoot, 'bad-index.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ embeddingFingerprint: 'stale', vectorCount: 0, failedCount: 2 }));
  assert.throws(() => service.markIndexed({ manifestPath, confirm: true }), /fingerprint_mismatch/);
});

test('probe returns dimensions without exposing the raw vector', async () => {
  const fetchImpl = async (_endpoint, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'qwen3-embedding:0.6b');
    assert.deepEqual(body.input, ['中文检索探针']);
    return { ok: true, json: async () => ({ embeddings: [[0.1, 0.2, 0.3]], prompt_eval_count: 4 }) };
  };
  const service = createEmbeddingService({ ...fixture(), fetchImpl });
  service.configure({ model: 'qwen3-embedding:0.6b', confirm: true });
  const report = await service.probe({ text: '中文检索探针' });
  assert.deepEqual(report, {
    ready: true,
    model: 'qwen3-embedding:0.6b',
    dimensions: 3,
    promptEvalCount: 4,
    fingerprint: service.status().fingerprint,
  });
  assert.equal(JSON.stringify(report).includes('0.1'), false);
});

test('adaptation prompt requires same-model querying, reindex, canary, and fallback', () => {
  const service = createEmbeddingService(fixture());
  const prompt = service.adaptationPrompt();
  for (const phrase of ['索引与查询使用同一模型', '完整重建索引', '固定召回 canary', '词法检索回退']) assert.match(prompt, new RegExp(phrase));
});
