'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const api = require('../index');

const root = path.resolve(__dirname, '..');

test('exports stable public control-plane modules', () => {
  assert.equal(typeof api.taskContract.buildTaskContract, 'function');
  assert.equal(typeof api.policyLab.evaluateOrthogonality, 'function');
  assert.equal(typeof api.outcomeAttribution.attributeOutcomes, 'function');
  assert.equal(typeof api.indexHealth.inspectIndexHealth, 'function');
  assert.equal(typeof api.behavioralMemory.createCandidate, 'function');
});

test('self-check exposes safe defaults without starting a model or hook', () => {
  const result = spawnSync(process.execPath, ['bin/brain-lite.js', 'self-check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.name, 'brain-lite-agent-harness');
  assert.equal(output.hooksEnabled, false);
  assert.equal(output.behavioralMemoryEnabled, false);
  assert.equal(output.automaticLifecycleChanges, false);
});

test('contract CLI returns deterministic JSON from a file', () => {
  const result = spawnSync(process.execPath, [
    'bin/brain-lite.js',
    'contract',
    '--features',
    'examples/clarification-needed.json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).action, 'mother-clarify');
});

test('index-health CLI reports a missing example index without creating it', () => {
  const result = spawnSync(process.execPath, [
    'bin/brain-lite.js',
    'index-health',
    '--config',
    'config/brain-lite.json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'unhealthy');
  assert.equal(output.reason, 'missing-index');
  assert.equal(output.autoRepairApplied, false);
  assert.equal(output.fullPathsExposed, false);
});
