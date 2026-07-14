'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson } = require('./store');

const REQUIRED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop'];

function sourceManifest(pluginRoot) {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
}

function buildProjectHookConfig(pluginRoot) {
  const resolved = path.resolve(pluginRoot);
  const manifest = sourceManifest(resolved);
  return JSON.parse(JSON.stringify(manifest).replaceAll('${PLUGIN_ROOT}', resolved.replaceAll('\\', '/')));
}

function validateManifest(manifest) {
  const missingEvents = REQUIRED_EVENTS.filter(event => !Array.isArray(manifest.hooks?.[event]));
  const hooks = Object.values(manifest.hooks || {}).flatMap(groups => groups.flatMap(group => group.hooks || []));
  const invalidHooks = hooks.filter(hook => hook.type !== 'command' || !hook.command || !(hook.timeout > 0 && hook.timeout <= 2));
  return { valid: missingEvents.length === 0 && invalidHooks.length === 0, missingEvents, invalidHooks: invalidHooks.length, hookCount: hooks.length };
}

function doctorHooks({ projectRoot }) {
  const file = path.join(path.resolve(projectRoot), '.codex', 'hooks.json');
  if (!fs.existsSync(file)) return { scope: 'project', enabled: false, valid: true, hookCount: 0, path: file };
  try { return { scope: 'project', enabled: true, path: file, ...validateManifest(JSON.parse(fs.readFileSync(file, 'utf8'))) }; }
  catch { return { scope: 'project', enabled: true, valid: false, reason: 'invalid_json', path: file }; }
}

function setProjectHooks({ projectRoot, pluginRoot, enabled, confirm }) {
  if (confirm !== true) throw new Error('confirmation_required');
  const file = path.join(path.resolve(projectRoot), '.codex', 'hooks.json');
  if (enabled) atomicWriteJson(file, buildProjectHookConfig(pluginRoot));
  else if (fs.existsSync(file)) atomicWriteJson(file, { version: 1, hooks: {} });
  return doctorHooks({ projectRoot });
}

module.exports = { buildProjectHookConfig, doctorHooks, setProjectHooks, validateManifest };
