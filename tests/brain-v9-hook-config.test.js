'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { doctorHooks, setProjectHooks } = require('../scripts/v9/hook-config');

const root = path.resolve(__dirname, '..');

test('hook manifest uses PLUGIN_ROOT and explicit short timeouts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.values(manifest.hooks).flatMap(groups => groups.flatMap(group => group.hooks));
  assert.ok(commands.every(hook => hook.command.includes('${PLUGIN_ROOT}')));
  assert.ok(commands.every(hook => hook.timeout <= 2));
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop']) assert.ok(manifest.hooks[event]);
});

test('enable writes only project hooks after confirmation', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-project-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-home-'));
  assert.throws(() => setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: false }), /confirmation_required/);
  const report = setProjectHooks({ projectRoot, pluginRoot: root, enabled: true, confirm: true });
  assert.equal(report.valid, true);
  assert.equal(fs.existsSync(path.join(projectRoot, '.codex', 'hooks.json')), true);
  assert.equal(fs.existsSync(path.join(fakeHome, '.codex', 'hooks.json')), false);
  assert.equal(doctorHooks({ projectRoot }).scope, 'project');
});
