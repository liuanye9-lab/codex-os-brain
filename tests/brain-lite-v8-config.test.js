'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  readV8Config,
  resolveRuntimePaths,
} = require('../scripts/brain-lite-common');

const configPath = path.resolve(__dirname, '..', 'config', 'brain-lite-v8.json');

test('V8 config keeps native-first budgets and hooks disabled', () => {
  const config = readV8Config(configPath);
  assert.equal(config.version, 8);
  assert.equal(config.policyVersion, 'brain-lite-v8');
  assert.equal(config.hooks.enabled, false);
  assert.equal(config.contextEconomy.tokenBudget, 900);
  assert.equal(config.persistentInstructionBudget, 800);
  assert.equal(config.policyLab.minimumDistinctSamples, 3);
  assert.equal(config.policyLab.tokenBenefitThreshold, 0.15);
  assert.equal(config.harnessTax.disableWindow, 5);
  assert.equal(config.harnessTax.overheadThreshold, 0.10);
});

test('runtime paths resolve on macOS without committed user paths', () => {
  const paths = resolveRuntimePaths(
    { CODEX_HOME: '/opt/codex', CODEX_BRAIN_HOME: '/opt/brain' },
    { home: '/home/example', pathImpl: path.posix },
  );
  assert.equal(paths.codexHome, '/opt/codex');
  assert.equal(paths.brainHome, '/opt/brain');
  assert.equal(paths.v8ConfigPath, '/opt/brain/config/brain-lite-v8.json');
});

test('runtime paths resolve on Windows with win32 semantics', () => {
  const paths = resolveRuntimePaths(
    { CODEX_HOME: 'C:\\Codex', CODEX_BRAIN_HOME: 'D:\\Brain' },
    { home: 'C:\\Users\\Example', pathImpl: path.win32 },
  );
  assert.equal(paths.codexHome, 'C:\\Codex');
  assert.equal(paths.brainHome, 'D:\\Brain');
  assert.equal(paths.v8ConfigPath, 'D:\\Brain\\config\\brain-lite-v8.json');
});

test('V8 configuration contains only relative persisted paths', () => {
  const raw = fs.readFileSync(configPath, 'utf8');
  assert.doesNotMatch(raw, /\/Users\/|[A-Z]:\\\\Users\\\\/i);
  const config = JSON.parse(raw);
  for (const value of Object.values(config.paths)) assert.equal(path.isAbsolute(value), false);
});
