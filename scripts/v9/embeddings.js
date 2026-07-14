'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveV9Paths } = require('./paths');
const { atomicWriteJson, readJsonSafe } = require('./store');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/api/embed';
const DEFAULT_MODEL = 'qwen3-embedding:0.6b';

function coded(code) { const error = new Error(code); error.code = code; return error; }

function isLoopbackEndpoint(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/api/embed';
  } catch {
    return false;
  }
}

function validateModel(model) {
  const value = String(model || '').trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,127}$/.test(value)) throw coded('invalid_embedding_model');
  return value;
}

function normalizeDimensions(value) {
  if (value === undefined || value === null || value === '') return null;
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65536) throw coded('invalid_embedding_dimensions');
  return dimensions;
}

function embeddingFingerprint(input) {
  const identity = JSON.stringify({
    provider: input.provider || 'ollama',
    endpoint: input.endpoint,
    model: input.model,
    dimensions: input.dimensions ?? null,
  });
  return `emb_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function defaultStatus() {
  const base = {
    schemaVersion: 1,
    configured: false,
    enabled: true,
    provider: 'ollama',
    endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    dimensions: null,
    batchSize: 24,
    indexedFingerprint: null,
    requiresReindex: true,
  };
  return { ...base, fingerprint: embeddingFingerprint(base) };
}

function tagsEndpoint(embedEndpoint) {
  const url = new URL(embedEndpoint);
  url.pathname = '/api/tags';
  url.search = '';
  return url.toString();
}

function createEmbeddingService({
  paths = resolveV9Paths(),
  fetchImpl = globalThis.fetch,
  spawnSyncImpl = spawnSync,
  presetsPath = path.resolve(__dirname, '..', '..', 'config', 'embedding-model-presets.json'),
} = {}) {
  function status() {
    return readJsonSafe(paths.embeddingConfigPath, defaultStatus()).value;
  }

  function configure(input = {}) {
    if (!input.confirm) throw coded('confirmation_required');
    const current = status();
    const endpoint = String(input.endpoint || current.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
    if (!isLoopbackEndpoint(endpoint)) throw coded('local_endpoint_required');
    const model = validateModel(input.model || current.model || DEFAULT_MODEL);
    const dimensions = normalizeDimensions(input.dimensions !== undefined ? input.dimensions : current.dimensions);
    const batchSize = Number(input.batchSize || current.batchSize || 24);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw coded('invalid_embedding_batch_size');
    const base = { provider: 'ollama', endpoint, model, dimensions };
    const fingerprint = embeddingFingerprint(base);
    const next = {
      schemaVersion: 1,
      configured: true,
      enabled: input.enabled !== false,
      ...base,
      batchSize,
      fingerprint,
      indexedFingerprint: current.indexedFingerprint || null,
      requiresReindex: current.indexedFingerprint !== fingerprint,
      updatedAt: new Date().toISOString(),
    };
    return atomicWriteJson(paths.embeddingConfigPath, next);
  }

  function markIndexed(input = {}) {
    if (!input.confirm) throw coded('confirmation_required');
    const current = status();
    if (!input.manifestPath || !fs.existsSync(input.manifestPath)) throw coded('index_evidence_required');
    const evidence = readJsonSafe(input.manifestPath, null);
    if (evidence.corrupt || !evidence.value) throw coded('index_evidence_required');
    const manifest = evidence.value;
    const fingerprint = manifest.embeddingFingerprint || manifest.fingerprint;
    if (fingerprint !== current.fingerprint) throw coded('fingerprint_mismatch');
    const vectorCount = Number(manifest.vectorCount ?? (manifest.chunks || []).filter(item => Array.isArray(item.embedding) && item.embedding.length).length);
    const failedCount = Number(manifest.failedCount ?? (manifest.chunks || []).filter(item => !Array.isArray(item.embedding) || !item.embedding.length).length);
    const sourceWarningCount = Number(manifest.sourceWarningCount ?? (manifest.warnings || []).length);
    if (!Number.isInteger(vectorCount) || vectorCount < 1 || failedCount !== 0) throw coded('index_evidence_invalid');
    return atomicWriteJson(paths.embeddingConfigPath, {
      ...current,
      indexedFingerprint: current.fingerprint,
      requiresReindex: false,
      indexEvidence: { manifestPath: path.resolve(input.manifestPath), vectorCount, sourceWarningCount },
      indexedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function recommend(profile = 'zh-light') {
    const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    const selected = presets.profiles?.[profile];
    if (!selected) throw coded('unknown_embedding_profile');
    return { profile, provider: presets.provider, endpoint: presets.endpoint, ...selected };
  }

  async function doctor() {
    const current = status();
    const binary = spawnSyncImpl('ollama', ['--version'], { encoding: 'utf8', timeout: 5000 });
    const report = {
      provider: 'ollama',
      localOnly: isLoopbackEndpoint(current.endpoint),
      ollamaInstalled: binary.status === 0,
      apiReachable: false,
      modelInstalled: false,
      model: current.model,
      fingerprint: current.fingerprint,
      requiresReindex: current.requiresReindex,
      sourceWarningCount: Number(current.indexEvidence?.sourceWarningCount || 0),
      degradedSources: Number(current.indexEvidence?.sourceWarningCount || 0) > 0,
      ready: false,
    };
    if (!report.ollamaInstalled || !report.localOnly || typeof fetchImpl !== 'function') return report;
    try {
      const response = await fetchImpl(tagsEndpoint(current.endpoint), { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return report;
      const payload = await response.json();
      report.apiReachable = true;
      report.modelInstalled = (payload.models || []).some(item => item.name === current.model || item.model === current.model);
      report.ready = report.modelInstalled && !current.requiresReindex;
      return report;
    } catch {
      return report;
    }
  }

  async function probe({ text = 'local embedding probe' } = {}) {
    const current = status();
    if (!isLoopbackEndpoint(current.endpoint)) throw coded('local_endpoint_required');
    if (typeof fetchImpl !== 'function') throw coded('fetch_unavailable');
    const body = { model: current.model, input: [String(text)], truncate: true };
    if (current.dimensions) body.dimensions = current.dimensions;
    const response = await fetchImpl(current.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw coded(`embedding_probe_http_${response.status}`);
    const payload = await response.json();
    const vector = payload.embeddings?.[0];
    if (!Array.isArray(vector) || !vector.length) throw coded('invalid_embedding_response');
    return {
      ready: true,
      model: current.model,
      dimensions: vector.length,
      promptEvalCount: payload.prompt_eval_count ?? null,
      fingerprint: current.fingerprint,
    };
  }

  function pull({ model, confirm = false } = {}) {
    if (!confirm) throw coded('download_confirmation_required');
    const selected = validateModel(model || status().model);
    const result = spawnSyncImpl('ollama', ['pull', selected], { encoding: 'utf8', timeout: 30 * 60 * 1000 });
    if (result.status !== 0) throw coded('ollama_pull_failed');
    return { pulled: true, model: selected };
  }

  function adaptationPrompt() {
    const current = status();
    return [
      '请为当前项目重新适配 Ollama 本地嵌入后端，并把它视为可撤销的离线召回组件，而不是事实来源或 hook 判定器。',
      `当前候选：${current.model}；端点：${current.endpoint}；配置指纹：${current.fingerprint}。`,
      '1. 先检查操作系统、可用内存/显存、磁盘、Ollama 版本、localhost API 与模型许可；下载前必须获得明确确认。',
      '2. 用项目真实的中文、英文与代码查询建立固定召回 canary，比较召回质量、延迟、内存与索引成本，不因参数量更大就默认升级。',
      '3. 索引与查询使用同一模型、端点和 dimensions；记录配置指纹。',
      '4. 模型、端点或 dimensions 改变后完整重建索引，验证成功后再用当前 fingerprint 标记 indexed。',
      '5. 保留词法检索回退；Ollama 不可用、超时或索引过期时降级，不阻断普通 Agent 工作。',
      '6. 只把检索到的内容当作待核验证据，限制注入条数与 token，不把原始私有记忆发送到远程端点。',
    ].join('\n');
  }

  return { adaptationPrompt, configure, doctor, markIndexed, probe, pull, recommend, status };
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  createEmbeddingService,
  embeddingFingerprint,
  isLoopbackEndpoint,
};
