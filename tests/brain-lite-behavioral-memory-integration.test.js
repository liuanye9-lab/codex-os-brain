'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('behavioral memory and host sensors remain disabled by default', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/brain-lite-v8.json'), 'utf8'));
  assert.equal(config.hooks.enabled, false);
  assert.equal(config.behavioralMemory.enabled, false);
  assert.equal(config.behavioralMemory.sensorOnly, true);
  assert.equal(config.behavioralMemory.storeRawCorrectionText, false);
  assert.equal(config.behavioralMemory.requireExplicitRule, true);
  assert.equal(config.behavioralMemory.contextTokenBudget, 300);
  assert.equal(config.behavioralMemory.maxContextItems, 2);
  assert.deepEqual(config.behavioralMemory.hostAdapters, { claudeCode: false, codex: false, zcode: false });
});

test('runtime paths include a dedicated candidate store and text-free exports', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/brain-lite-v8.json'), 'utf8'));
  assert.equal(config.paths.behavioralMemory, 'data/brain-lite/v8-behavioral-memory.json');
  assert.equal(config.paths.behavioralMemoryExports, 'reports/brain-lite-v8/behavioral-memory');
});

test('package exposes focused behavioral-memory verification commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:behavioral-memory'], /behavioral-memory/);
  assert.match(pkg.scripts.check, /brain-lite-behavioral/);
});
