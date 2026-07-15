'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'bin', 'brain.js');

function run(args, brainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-'))) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CODEX_BRAIN_HOME: brainHome } });
}

test('status emits stable JSON', () => {
  const result = run(['status', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), ['enabled', 'runtimeRoot', 'version']);
});

test('migration apply is impossible without confirmation', () => {
  const result = run(['migrate', 'apply', '--json']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /confirm-migration/);
});

test('task create, show, and verify share persisted core state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-task-'));
  const created = run(['task', 'create', '--task-id', 'task_cli', '--objective', 'verify cli', '--criterion', 'tests', '--json'], home);
  assert.equal(created.status, 0, created.stderr);
  const shown = run(['task', 'show', '--json'], home);
  assert.equal(JSON.parse(shown.stdout).taskId, 'task_cli');
  // Without harness re-run, required criteria remain partial (claims alone never complete).
  const verified = run(['verify', '--status-only', '--json'], home);
  assert.equal(JSON.parse(verified.stdout).status, 'partial');
});

test('embedding configure is confirmation-gated and visible through status', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-embed-'));
  const blocked = run(['embeddings', 'configure', '--model', 'qwen3-embedding:0.6b', '--json'], home);
  assert.equal(blocked.status, 3);
  assert.match(blocked.stderr, /confirm/);
  const configured = run(['embeddings', 'configure', '--model', 'qwen3-embedding:0.6b', '--confirm', '--json'], home);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).requiresReindex, true);
  const status = run(['embeddings', 'status', '--json'], home);
  assert.equal(JSON.parse(status.stdout).model, 'qwen3-embedding:0.6b');
});
