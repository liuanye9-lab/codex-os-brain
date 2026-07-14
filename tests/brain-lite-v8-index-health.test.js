'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectIndexHealth } = require('../scripts/brain-lite-index-health');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-index-health-'));
  const sources = path.join(root, 'sources');
  const indexPath = path.join(root, 'index.json');
  fs.mkdirSync(sources);
  const indexed = path.join(sources, 'indexed.md');
  fs.writeFileSync(indexed, '# indexed\n');
  return { root, sources, indexPath, indexed };
}

function writeIndex(target, overrides = {}) {
  fs.writeFileSync(target.indexPath, JSON.stringify({
    version: 1,
    builtAt: '2026-07-14T00:00:00.000Z',
    sourceFiles: [{ path: target.indexed, mtimeMs: fs.statSync(target.indexed).mtimeMs }],
    chunks: [{ source: target.indexed }],
    warnings: [],
    ...overrides,
  }, null, 2));
}

function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).sort().map((entry) => {
    const target = path.join(root, entry);
    return fs.statSync(target).isFile() ? [entry, fs.readFileSync(target, 'utf8')] : [entry, null];
  });
}

test('fresh complete index is healthy and inspection is read-only', () => {
  const target = fixture();
  writeIndex(target);
  const before = snapshot(target.root);
  const result = inspectIndexHealth({ indexPath: target.indexPath, sources: [target.sources], now: new Date('2026-07-14T12:00:00.000Z'), staleAfterHours: 48 });
  assert.equal(result.status, 'healthy');
  assert.equal(result.indexedSources, 1);
  assert.equal(result.discoveredSources, 1);
  assert.equal(result.unindexedSources, 0);
  assert.equal(result.fullPathsExposed, false);
  assert.deepEqual(snapshot(target.root), before);
});

test('stale warnings, unindexed sources, missing indexed sources, and temp debris degrade health', () => {
  const target = fixture();
  const missing = path.join(target.sources, 'missing.md');
  fs.writeFileSync(path.join(target.sources, 'new.md'), '# new\n');
  fs.writeFileSync(`${target.indexPath}.tmp.99`, 'partial');
  writeIndex(target, {
    builtAt: '2026-07-10T00:00:00.000Z',
    sourceFiles: [{ path: target.indexed, mtimeMs: fs.statSync(target.indexed).mtimeMs }, { path: missing, mtimeMs: 0 }],
    warnings: [{ source: missing, reason: 'dataless' }],
  });
  const result = inspectIndexHealth({ indexPath: target.indexPath, sources: [target.sources], now: new Date('2026-07-14T12:00:00.000Z'), staleAfterHours: 48 });
  assert.equal(result.status, 'degraded');
  assert.equal(result.stale, true);
  assert.equal(result.warningCounts.dataless, 1);
  assert.equal(result.unindexedSources, 1);
  assert.equal(result.missingIndexedSources, 1);
  assert.equal(result.temporaryFiles, 1);
  assert.ok(result.sourceRefs.every((value) => /^src_[a-f0-9]{12}$/.test(value)));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(target.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('missing or corrupt indexes are unhealthy without creating files', () => {
  const target = fixture();
  const missing = inspectIndexHealth({ indexPath: target.indexPath, sources: [target.sources] });
  assert.equal(missing.status, 'unhealthy');
  assert.equal(missing.reason, 'missing-index');
  assert.equal(fs.existsSync(target.indexPath), false);
  fs.writeFileSync(target.indexPath, '{not-json');
  const corrupt = inspectIndexHealth({ indexPath: target.indexPath, sources: [target.sources] });
  assert.equal(corrupt.status, 'unhealthy');
  assert.equal(corrupt.reason, 'corrupt-index');
  assert.equal(fs.readFileSync(target.indexPath, 'utf8'), '{not-json');
});

test('the same source warning from the saved index and current scan is counted once', () => {
  const target = fixture();
  const missing = path.join(target.root, 'missing.md');
  writeIndex(target, { warnings: [{ source: missing, reason: 'missing' }] });
  const result = inspectIndexHealth({ indexPath: target.indexPath, sources: [target.sources, missing], now: new Date('2026-07-14T12:00:00.000Z') });
  assert.equal(result.warningCounts.missing, 1);
  assert.equal(result.sourceRefs.length, 1);
});
