'use strict';
// Coverage for scope attribution and reclamation.
//
// Project state lives under a SHA-256 of the project path, which is one-way: measured on
// this machine, 27 folders had accumulated in a day with no way to tell which project any
// of them came from, and no way to reclaim them. These tests pin the two properties that
// make reclaiming safe: a scope can name itself, and nothing ambiguous is ever deleted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectProjectScopes, readOriginMarker, scanProjectScopes, writeOriginMarker } = require('../scripts/v9/scope-gc');

function tempRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brain-gc-'));
}

function makeScope(runtimeRoot, projectId, { projectRoot = null, bytes = 0 } = {}) {
  const scopeRoot = path.join(runtimeRoot, 'projects', projectId);
  fs.mkdirSync(path.join(scopeRoot, 'control'), { recursive: true });
  if (bytes > 0) fs.writeFileSync(path.join(scopeRoot, 'control', 'blob.bin'), Buffer.alloc(bytes));
  if (projectRoot) writeOriginMarker({ runtimeRoot: scopeRoot, projectRoot, projectId });
  return scopeRoot;
}

test('a scope can name the project it belongs to', () => {
  const runtimeRoot = tempRuntime();
  const projectRoot = path.join(runtimeRoot, 'some-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  try {
    const scopeRoot = makeScope(runtimeRoot, 'aaa', { projectRoot });
    assert.equal(readOriginMarker(scopeRoot).projectRoot, projectRoot);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('rewriting the marker preserves when the scope was first seen', () => {
  const runtimeRoot = tempRuntime();
  const projectRoot = path.join(runtimeRoot, 'p');
  fs.mkdirSync(projectRoot, { recursive: true });
  try {
    const scopeRoot = makeScope(runtimeRoot, 'bbb', { projectRoot });
    const first = readOriginMarker(scopeRoot).firstSeenAt;
    writeOriginMarker({ runtimeRoot: scopeRoot, projectRoot, projectId: 'bbb' });
    assert.equal(readOriginMarker(scopeRoot).firstSeenAt, first);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('scopes are classified as live, dead, or unknown', () => {
  const runtimeRoot = tempRuntime();
  const alive = path.join(runtimeRoot, 'alive');
  fs.mkdirSync(alive, { recursive: true });
  try {
    makeScope(runtimeRoot, 'live1', { projectRoot: alive });
    makeScope(runtimeRoot, 'dead1', { projectRoot: path.join(runtimeRoot, 'deleted-project') });
    makeScope(runtimeRoot, 'legacy1'); // predates the marker
    const report = scanProjectScopes({ runtimeRoot });
    assert.equal(report.live, 1);
    assert.equal(report.dead, 1);
    assert.equal(report.unknown, 1);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('planning is the default and removes nothing', () => {
  const runtimeRoot = tempRuntime();
  try {
    makeScope(runtimeRoot, 'dead1', { projectRoot: path.join(runtimeRoot, 'gone'), bytes: 64 });
    const report = collectProjectScopes({ runtimeRoot });
    assert.equal(report.mode, 'plan');
    assert.equal(report.reclaimable.length, 1);
    assert.deepEqual(report.removed, []);
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'projects', 'dead1')), 'plan must not delete');
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('confirming reclaims dead scopes and leaves live ones alone', () => {
  const runtimeRoot = tempRuntime();
  const alive = path.join(runtimeRoot, 'alive');
  fs.mkdirSync(alive, { recursive: true });
  try {
    makeScope(runtimeRoot, 'live1', { projectRoot: alive, bytes: 32 });
    makeScope(runtimeRoot, 'dead1', { projectRoot: path.join(runtimeRoot, 'gone'), bytes: 64 });
    const report = collectProjectScopes({ runtimeRoot, confirm: true });
    assert.equal(report.removed.length, 1);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'projects', 'dead1')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'projects', 'live1')), true);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('an unmarked scope is never reclaimed, even with --confirm', () => {
  // The property that matters most. Deleting an unattributable folder could destroy the
  // contract currently guarding a live directory, which is far worse than leaking bytes.
  const runtimeRoot = tempRuntime();
  try {
    makeScope(runtimeRoot, 'legacy1', { bytes: 128 });
    const report = collectProjectScopes({ runtimeRoot, confirm: true });
    assert.deepEqual(report.removed, []);
    assert.equal(report.unknown, 1);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'projects', 'legacy1')), true);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('a corrupt marker is treated as unknown rather than dead', () => {
  const runtimeRoot = tempRuntime();
  try {
    const scopeRoot = makeScope(runtimeRoot, 'corrupt1', { bytes: 16 });
    fs.writeFileSync(path.join(scopeRoot, 'origin.json'), '{not json');
    const report = collectProjectScopes({ runtimeRoot, confirm: true });
    assert.deepEqual(report.removed, []);
    assert.equal(report.unknown, 1);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('a missing projects root reports nothing instead of throwing', () => {
  const runtimeRoot = tempRuntime();
  try {
    const report = collectProjectScopes({ runtimeRoot });
    assert.deepEqual(report.scopes, []);
    assert.equal(report.reclaimableBytes, 0);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
