'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveV9Paths } = require('../scripts/v9/paths');
const { appendJsonl, atomicWriteJson, readJsonSafe, sha256File, withFileLock } = require('../scripts/v9/store');

test('V9 paths stay under CODEX_BRAIN_HOME', () => {
  const p = resolveV9Paths({ CODEX_BRAIN_HOME: '/tmp/example-brain' }, { home: '/tmp/home' });
  assert.equal(p.runtimeRoot, path.resolve('/tmp/example-brain/runtime/v9'));
  assert.equal(p.eventsRoot, path.resolve('/tmp/example-brain/runtime/v9/events'));
});

test('appendJsonl deduplicates eventId', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-store-'));
  const file = path.join(root, 'events.jsonl');
  appendJsonl(file, { eventId: 'evt_1', kind: 'test' });
  appendJsonl(file, { eventId: 'evt_1', kind: 'test' });
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
});

test('safe JSON preserves corrupt source and atomic writes are private', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-json-'));
  const file = path.join(root, 'value.json');
  fs.writeFileSync(file, '{broken', { mode: 0o600 });
  const result = readJsonSafe(file, { clean: true });
  assert.equal(result.corrupt, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  atomicWriteJson(file, { clean: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { clean: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(sha256File(file).length, 64);
});

test('file lock is exclusive and removed after work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-lock-'));
  const lock = path.join(root, 'active.lock');
  const value = withFileLock(lock, () => {
    assert.throws(() => withFileLock(lock, () => null), /lock_busy/);
    return 9;
  });
  assert.equal(value, 9);
  assert.equal(fs.existsSync(lock), false);
});
