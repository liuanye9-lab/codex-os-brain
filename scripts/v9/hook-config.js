'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson } = require('./store');

const REQUIRED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop'];
const OWNER = 'codex-brain-v9';
const OWNER_MARKER = `BRAIN_V9_HOOK_OWNER=${OWNER}`;
const STATE_FILE = 'hooks.codex-brain-v9.state.json';
const BACKUP_FILE = 'hooks.json.codex-brain-v9.backup';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hashText(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fingerprint(value) { return hashText(JSON.stringify(value)); }
function configPaths(projectRoot) {
  const directory = path.join(path.resolve(projectRoot), '.codex');
  return {
    directory,
    file: path.join(directory, 'hooks.json'),
    stateFile: path.join(directory, STATE_FILE),
    backupFile: path.join(directory, BACKUP_FILE),
  };
}

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function sourceManifest(pluginRoot) {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
}

function buildProjectHookConfig(pluginRoot) {
  const resolved = path.resolve(pluginRoot);
  const manifest = sourceManifest(resolved);
  return JSON.parse(JSON.stringify(manifest).replaceAll('${PLUGIN_ROOT}', resolved.replaceAll('\\', '/')));
}

function validateManifest(manifest) {
  const hooksObjectValid = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    && manifest.hooks && typeof manifest.hooks === 'object' && !Array.isArray(manifest.hooks);
  const invalidEvents = hooksObjectValid
    ? Object.entries(manifest.hooks).filter(([, groups]) => !Array.isArray(groups)).map(([event]) => event)
    : [];
  const groups = hooksObjectValid
    ? Object.values(manifest.hooks).flatMap(value => Array.isArray(value) ? value : [])
    : [];
  const invalidGroups = groups.filter(group => !group || typeof group !== 'object' || !Array.isArray(group.hooks));
  const hooks = groups.flatMap(group => Array.isArray(group?.hooks) ? group.hooks : []);
  const invalidHooks = hooks.filter(hook => hook.type !== 'command' || !hook.command || !(hook.timeout > 0));
  return {
    valid: hooksObjectValid && invalidEvents.length === 0 && invalidGroups.length === 0 && invalidHooks.length === 0,
    invalidEvents,
    invalidGroups: invalidGroups.length,
    invalidHooks: invalidHooks.length,
    hookCount: hooks.length,
  };
}

function isOwnedHook(hook) {
  const command = String(hook?.command || '');
  return hook?.type === 'command'
    && command.includes('/bin/brain-hook.js')
    && (command.includes(OWNER_MARKER) || command.includes('BRAIN_V9_HOOKS=1'));
}

function isOwnedGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.length > 0 && group.hooks.every(isOwnedHook);
}

function ownedManifest(manifest) {
  const hooks = {};
  for (const event of REQUIRED_EVENTS) {
    const owned = (manifest?.hooks?.[event] || []).filter(isOwnedGroup);
    if (owned.length) hooks[event] = owned;
  }
  return { version: 1, hooks };
}

function mergeOwnedHooks(existing, desired) {
  const merged = clone(existing);
  if (!merged.hooks || typeof merged.hooks !== 'object' || Array.isArray(merged.hooks)) merged.hooks = {};
  if (merged.version === undefined) merged.version = desired.version || 1;
  for (const event of REQUIRED_EVENTS) {
    const foreign = Array.isArray(merged.hooks[event]) ? merged.hooks[event].filter(group => !isOwnedGroup(group)) : [];
    merged.hooks[event] = [...foreign, ...clone(desired.hooks[event] || [])];
  }
  return merged;
}

function removeOwnedHooks(manifest) {
  const next = clone(manifest);
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) return next;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const foreign = groups.filter(group => !isOwnedGroup(group));
    if (foreign.length) next.hooks[event] = foreign;
    else delete next.hooks[event];
  }
  return next;
}

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { throw new Error('hook_install_state_invalid'); }
}

function doctorHooks({ projectRoot, pluginRoot = path.resolve(__dirname, '..', '..') }) {
  const paths = configPaths(projectRoot);
  const desired = buildProjectHookConfig(pluginRoot);
  const expectedFingerprint = fingerprint(ownedManifest(desired));
  const stateAvailable = fs.existsSync(paths.stateFile);
  const backupAvailable = fs.existsSync(paths.backupFile);
  if (!fs.existsSync(paths.file)) {
    return {
      scope: 'project', owner: OWNER, enabled: false, valid: true, manifestValid: true,
      ownershipValid: false, eventsComplete: false, fingerprintMatch: false,
      expectedFingerprint, observedFingerprint: null, missingEvents: [...REQUIRED_EVENTS],
      mismatchedEvents: [], duplicateEvents: [], hookCount: 0, ownedHookCount: 0,
      foreignHookCount: 0, stateAvailable, backupAvailable, path: paths.file,
    };
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(paths.file, 'utf8')); }
  catch {
    return {
      scope: 'project', owner: OWNER, enabled: false, valid: false, manifestValid: false,
      ownershipValid: false, eventsComplete: false, fingerprintMatch: false,
      expectedFingerprint, observedFingerprint: null, missingEvents: [...REQUIRED_EVENTS],
      mismatchedEvents: [], duplicateEvents: [], hookCount: 0, ownedHookCount: 0,
      foreignHookCount: 0, stateAvailable, backupAvailable, reason: 'invalid_json', path: paths.file,
    };
  }
  const structural = validateManifest(manifest);
  const observedOwned = ownedManifest(manifest);
  const desiredOwned = ownedManifest(desired);
  const ownedGroups = Object.values(observedOwned.hooks).flat();
  const allGroups = Object.values(manifest.hooks || {}).flatMap(groups => Array.isArray(groups) ? groups : []);
  const ownedHookCount = ownedGroups.flatMap(group => group.hooks || []).length;
  const allHookCount = allGroups.flatMap(group => Array.isArray(group?.hooks) ? group.hooks : []).length;
  const enabled = ownedHookCount > 0;
  const missingEvents = REQUIRED_EVENTS.filter(event => !(observedOwned.hooks[event]?.length > 0));
  const duplicateEvents = REQUIRED_EVENTS.filter(event => (observedOwned.hooks[event]?.length || 0) > (desiredOwned.hooks[event]?.length || 0));
  const mismatchedEvents = REQUIRED_EVENTS.filter(event => {
    const observed = observedOwned.hooks[event] || [];
    const expected = desiredOwned.hooks[event] || [];
    return observed.length > 0 && JSON.stringify(observed) !== JSON.stringify(expected);
  });
  const observedFingerprint = enabled ? fingerprint(observedOwned) : null;
  const eventsComplete = missingEvents.length === 0;
  const fingerprintMatch = observedFingerprint === expectedFingerprint;
  const ownershipValid = enabled && eventsComplete && duplicateEvents.length === 0 && mismatchedEvents.length === 0;
  return {
    scope: 'project', owner: OWNER, enabled,
    valid: structural.valid && (!enabled || (ownershipValid && fingerprintMatch)),
    manifestValid: structural.valid, ownershipValid, eventsComplete, fingerprintMatch,
    expectedFingerprint, observedFingerprint, missingEvents, mismatchedEvents, duplicateEvents,
    hookCount: allHookCount, ownedHookCount, foreignHookCount: allHookCount - ownedHookCount,
    invalidEvents: structural.invalidEvents, invalidGroups: structural.invalidGroups, invalidHooks: structural.invalidHooks,
    stateAvailable, backupAvailable, path: paths.file,
  };
}

function enableProjectHooks({ projectRoot, pluginRoot }) {
  const paths = configPaths(projectRoot);
  const originalPresent = fs.existsSync(paths.file);
  const originalRaw = originalPresent ? fs.readFileSync(paths.file, 'utf8') : null;
  let existing = { version: 1, hooks: {} };
  if (originalPresent) {
    try { existing = JSON.parse(originalRaw); }
    catch { throw new Error('invalid_project_hook_manifest'); }
    if (!validateManifest(existing).valid) throw new Error('invalid_project_hook_manifest');
  }
  let state = readState(paths.stateFile);
  const backupCreated = !state;
  if (!state) {
    if (fs.existsSync(paths.backupFile)) throw new Error('hook_backup_without_state');
    if (originalPresent) writeTextAtomic(paths.backupFile, originalRaw);
    state = {
      schemaVersion: 1,
      owner: OWNER,
      phase: 'prepared',
      originalPresent,
      originalSha256: originalPresent ? hashText(originalRaw) : null,
      backupFile: originalPresent ? BACKUP_FILE : null,
      createdAt: new Date().toISOString(),
    };
    atomicWriteJson(paths.stateFile, state);
  } else if (state.owner !== OWNER) {
    throw new Error('hook_install_state_owner_mismatch');
  }
  const merged = mergeOwnedHooks(existing, buildProjectHookConfig(pluginRoot));
  atomicWriteJson(paths.file, merged);
  const installedRaw = fs.readFileSync(paths.file, 'utf8');
  atomicWriteJson(paths.stateFile, {
    ...state,
    phase: 'installed',
    installedManifestSha256: hashText(installedRaw),
    installedFingerprint: fingerprint(ownedManifest(merged)),
    updatedAt: new Date().toISOString(),
  });
  return { operation: 'enabled', backupCreated, ...doctorHooks({ projectRoot, pluginRoot }) };
}

function disableProjectHooks({ projectRoot, pluginRoot }) {
  const paths = configPaths(projectRoot);
  const state = readState(paths.stateFile);
  let restoration = 'owned_hooks_removed';
  if (fs.existsSync(paths.file)) {
    const currentRaw = fs.readFileSync(paths.file, 'utf8');
    if (state?.phase === 'installed' && state.installedManifestSha256 === hashText(currentRaw)) {
      if (state.originalPresent) {
        if (!fs.existsSync(paths.backupFile)) throw new Error('hook_backup_missing');
        const backupRaw = fs.readFileSync(paths.backupFile, 'utf8');
        if (hashText(backupRaw) !== state.originalSha256) throw new Error('hook_backup_fingerprint_mismatch');
        writeTextAtomic(paths.file, backupRaw);
      } else {
        fs.unlinkSync(paths.file);
      }
      restoration = 'original_restored';
    } else {
      let current;
      try { current = JSON.parse(currentRaw); }
      catch { throw new Error('invalid_project_hook_manifest'); }
      const next = removeOwnedHooks(current);
      const hasHooks = Object.values(next.hooks || {}).some(groups => Array.isArray(groups) && groups.length > 0);
      const hasOtherFields = Object.keys(next).some(key => !['version', 'hooks'].includes(key));
      if (!hasHooks && !hasOtherFields && state?.originalPresent === false) fs.unlinkSync(paths.file);
      else atomicWriteJson(paths.file, next);
    }
  }
  if (fs.existsSync(paths.stateFile)) fs.unlinkSync(paths.stateFile);
  if (fs.existsSync(paths.backupFile)) fs.unlinkSync(paths.backupFile);
  return { operation: 'disabled', restoration, ...doctorHooks({ projectRoot, pluginRoot }) };
}

function setProjectHooks({ projectRoot, pluginRoot, enabled, confirm }) {
  if (confirm !== true) throw new Error('confirmation_required');
  return enabled
    ? enableProjectHooks({ projectRoot, pluginRoot })
    : disableProjectHooks({ projectRoot, pluginRoot });
}

module.exports = {
  BACKUP_FILE, OWNER, REQUIRED_EVENTS, STATE_FILE,
  buildProjectHookConfig, doctorHooks, isOwnedGroup, mergeOwnedHooks, removeOwnedHooks,
  setProjectHooks, validateManifest,
};
