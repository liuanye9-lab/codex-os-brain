'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('active V8 is native-first and previous V8 runtime is absent', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'brain-lite-v8.json'), 'utf8'));
  assert.equal(config.version, 8); assert.equal(config.hooks.enabled, false);
  assert.ok(config.persistentInstructionBudget <= 800); assert.ok(config.contextEconomy.tokenBudget <= 900);
  assert.equal(fs.existsSync(path.join(root, 'v8', 'scripts', 'semantic-bridge.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'v8', 'scripts', 'daily-diary-sidecar.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'v8', 'DESIGN.md')), true);
});
test('all V8 modules expose a disabled-safe path through configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'brain-lite-v8.json'), 'utf8'));
  for (const name of ['taskContract','contextEconomy','trace','harnessTax','policyLab','skillLifecycle']) assert.equal(typeof config[name].enabled, 'boolean');
});
