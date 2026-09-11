'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BACKUP_FILE, REQUIRED_EVENTS, STATE_FILE, buildProjectHookConfig, doctorHooks, setProjectHooks } = require('../scripts/v9/hook-config');

const root = path.resolve(__dirname, '..');

test('hook manifest uses PLUGIN_ROOT and explicit short timeouts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.entries(manifest.hooks).flatMap(([event, groups]) =>
    groups.flatMap(group => group.hooks.map(hook => ({ ...hook, event }))));
  assert.ok(commands.every(hook => hook.command.includes('${PLUGIN_ROOT}')));
  assert.ok(commands.every(hook => hook.commandWindows.includes('%PLUGIN_ROOT%')));
  assert.ok(commands.filter(hook => hook.event !== 'Stop').every(hook => hook.timeout <= 5));
  assert.ok(commands.filter(hook => hook.event === 'Stop').every(hook => hook.timeout >= 120));
  assert.deepEqual(Object.keys(manifest.hooks), REQUIRED_EVENTS);
  // V11 contract: exactly three sensors, each with a distinct failure mode.
  assert.deepEqual(REQUIRED_EVENTS, ['SessionStart', 'PreToolUse', 'Stop']);
  assert.equal(commands.length, 3);
});

test('enable writes only project hooks after confirmation', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-project-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-home-'));
  assert.throws(() => setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: false }), /confirmation_required/);
  const report = setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  assert.equal(report.valid, true);
  assert.equal(fs.existsSync(path.join(projectRoot, '.codex', 'hooks.json')), true);
  assert.equal(fs.existsSync(path.join(fakeHome, '.codex', 'hooks.json')), false);
  assert.equal(doctorHooks({ projectRoot }).scope, 'host-user');
  assert.equal(doctorHooks({ projectRoot }).projectStateScope, 'project');
});

test('enable merges foreign hooks, creates a backup, and disable restores the original byte-for-byte', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-merge-'));
  const codex = path.join(projectRoot, '.codex');
  fs.mkdirSync(codex);
  const original = '{\n  "version": 1,\n  "integrationFixtureMarker": "must-survive",\n  "hooks": {\n    "PreToolUse": [{ "matcher": "Custom", "hooks": [{ "type": "command", "command": "node custom.js", "timeout": 5 }] }]\n  }\n}\n';
  fs.writeFileSync(path.join(codex, 'hooks.json'), original);

  const enabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  const merged = JSON.parse(fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8'));
  assert.equal(enabled.backupCreated, true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.eventsComplete, true);
  assert.equal(enabled.fingerprintMatch, true);
  assert.equal(enabled.packageVersionMatch, true);
  assert.equal(enabled.runtimeDigestMatch, true);
  assert.equal(enabled.foreignHookCount, 1);
  assert.equal(merged.integrationFixtureMarker, 'must-survive');
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].command, 'node custom.js');
  assert.equal(fs.readFileSync(path.join(codex, BACKUP_FILE), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(codex, STATE_FILE)), true);

  const disabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: false, confirm: true });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.restoration, 'original_restored');
  assert.equal(fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(codex, BACKUP_FILE)), false);
  assert.equal(fs.existsSync(path.join(codex, STATE_FILE)), false);
});

test('doctor rejects an installation state with a stale runtime fingerprint', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-runtime-drift-'));
  setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  const stateFile = path.join(projectRoot, '.codex', STATE_FILE);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.runtimeDigest = 'stale-runtime';
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const report = doctorHooks({ projectRoot, pluginRoot: root });
  assert.equal(report.runtimeDigestMatch, false);
  assert.equal(report.valid, false);
});

test('disable preserves foreign hooks added after installation instead of rolling them back', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-drift-'));
  setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  const file = path.join(projectRoot, '.codex', 'hooks.json');
  const changed = JSON.parse(fs.readFileSync(file, 'utf8'));
  changed.hooks.Stop.unshift({ matcher: 'AfterInstall', hooks: [{ type: 'command', command: 'node after.js', timeout: 9 }] });
  fs.writeFileSync(file, `${JSON.stringify(changed, null, 2)}\n`);

  const disabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: false, confirm: true });
  const remaining = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disabled.restoration, 'owned_hooks_removed');
  assert.equal(disabled.enabled, false);
  assert.equal(remaining.hooks.Stop.length, 1);
  assert.equal(remaining.hooks.Stop[0].hooks[0].command, 'node after.js');
});

test('doctor distinguishes foreign valid hooks from an owned complete installation and detects drift', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-doctor-'));
  const codex = path.join(projectRoot, '.codex');
  fs.mkdirSync(codex);
  fs.writeFileSync(path.join(codex, 'hooks.json'), JSON.stringify({
    version: 1,
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node foreign.js', timeout: 3 }] }] },
  }));
  const foreignOnly = doctorHooks({ projectRoot, pluginRoot: root });
  assert.equal(foreignOnly.enabled, false);
  assert.equal(foreignOnly.valid, true);
  assert.equal(foreignOnly.foreignHookCount, 1);

  setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  const file = path.join(codex, 'hooks.json');
  const drifted = JSON.parse(fs.readFileSync(file, 'utf8'));
  drifted.hooks.Stop[0].hooks[0].timeout = 1;
  fs.writeFileSync(file, JSON.stringify(drifted));
  const report = doctorHooks({ projectRoot, pluginRoot: root });
  assert.equal(report.enabled, true);
  assert.equal(report.valid, false);
  assert.equal(report.fingerprintMatch, false);
  assert.deepEqual(report.mismatchedEvents, ['Stop']);
});

test('adopts committed owned hooks without backing them up as the user original', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-adopt-'));
  const codex = path.join(projectRoot, '.codex');
  fs.mkdirSync(codex);
  fs.writeFileSync(path.join(codex, 'hooks.json'), `${JSON.stringify(buildProjectHookConfig(root), null, 2)}\n`);

  const enabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  assert.equal(enabled.enabled, true);
  const disabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: false, confirm: true });
  assert.equal(disabled.enabled, false);
  assert.equal(fs.existsSync(path.join(codex, 'hooks.json')), false);
  assert.equal(fs.existsSync(path.join(codex, STATE_FILE)), false);
  assert.equal(fs.existsSync(path.join(codex, BACKUP_FILE)), false);
});

test('foreign hooks may omit optional timeout and original mode and symlink survive round trip', { skip: process.platform === 'win32' }, () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-symlink-'));
  const codex = path.join(projectRoot, '.codex');
  fs.mkdirSync(codex);
  const target = path.join(projectRoot, 'shared-hooks.json');
  const original = '{"version":1,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node foreign.js"}]}]}}\n';
  fs.writeFileSync(target, original, { mode: 0o644 });
  fs.symlinkSync(path.relative(codex, target), path.join(codex, 'hooks.json'));

  const enabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  assert.equal(enabled.valid, true);
  assert.equal(fs.lstatSync(path.join(codex, 'hooks.json')).isSymbolicLink(), true);
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  const disabled = setProjectHooks({ projectRoot, pluginRoot: root, enabled: false, confirm: true });
  assert.equal(disabled.enabled, false);
  assert.equal(fs.lstatSync(path.join(codex, 'hooks.json')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
});

test('doctor reports unwritable runtime event storage instead of claiming healthy hooks', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-storage-'));
  setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-hook-runtime-'));
  const runtimePaths = {
    controlDbPath: path.join(runtime, 'control', 'control.sqlite3'),
    tasksRoot: path.join(runtime, 'tasks'),
    eventsRoot: path.join(runtime, 'events'),
    failuresRoot: path.join(runtime, 'failures'),
  };
  for (const directory of [runtimePaths.tasksRoot, runtimePaths.eventsRoot, runtimePaths.failuresRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(path.dirname(runtimePaths.controlDbPath), { recursive: true });
  const events = runtimePaths.controlDbPath;
  fs.writeFileSync(events, '');
  fs.chmodSync(events, 0o400);
  try {
    const report = doctorHooks({ projectRoot, pluginRoot: root, runtimePaths });
    assert.equal(report.runtimeStorageWritable, false);
    assert.equal(report.valid, false);
    assert.deepEqual(report.runtimeStorageBlocked, [events]);
  } finally {
    fs.chmodSync(events, 0o600);
  }
});
