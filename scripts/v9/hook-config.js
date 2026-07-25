'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { atomicWriteJson } = require('./store');
const { resolveV9Paths, scopeV9Paths } = require('./paths');

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

function writeTextAtomic(file, text, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const target = fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()
    ? fs.realpathSync(file)
    : file;
  const existingMode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : null;
  const mode = Number(options.mode ?? existingMode ?? 0o600);
  const temporary = `${target}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, text, { encoding: 'utf8', mode });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, mode);
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
  const invalidHooks = hooks.filter(hook => (
    hook.type !== 'command'
    || !hook.command
    || (hook.timeout !== undefined && !(hook.timeout > 0))
  ));
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

function nearestExisting(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
  return current;
}

function runtimeStorageWritable(projectRoot, runtimePaths) {
  const paths = runtimePaths || scopeV9Paths(resolveV9Paths(), projectRoot);
  const targets = [
    path.join(paths.tasksRoot, 'active.json'),
    path.join(paths.eventsRoot, 'events.jsonl'),
    path.join(paths.failuresRoot, 'circuit.json'),
  ];
  const blocked = [];
  for (const target of targets) {
    const probe = fs.existsSync(target) ? target : nearestExisting(path.dirname(target));
    try { fs.accessSync(probe, fs.constants.W_OK); }
    catch { blocked.push(target); }
  }
  return { writable: blocked.length === 0, blocked };
}

function doctorHooks({ projectRoot, pluginRoot = path.resolve(__dirname, '..', '..'), runtimePaths }) {
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
  let runtimeHealthy = null;
  let runtimeExitStatus = null;
  const runtimeStorage = runtimeStorageWritable(projectRoot, runtimePaths);
  if (enabled && ownershipValid && fingerprintMatch) {
    const smoke = spawnSync(process.execPath, [path.join(pluginRoot, 'bin', 'brain-hook.js')], {
      cwd: path.resolve(projectRoot),
      env: {
        ...process.env,
        BRAIN_V9_HOOKS: '1',
        BRAIN_PROJECT_ROOT: path.resolve(projectRoot),
      },
      input: `${JSON.stringify({ hook_event_name: 'UserPromptSubmit', project_root: path.resolve(projectRoot) })}\n`,
      encoding: 'utf8',
      shell: false,
      timeout: 5_000,
    });
    runtimeExitStatus = smoke.status;
    runtimeHealthy = smoke.status === 0 && String(smoke.stdout || '').trim() === '{}';
  }
  return {
    scope: 'project', owner: OWNER, enabled,
    valid: structural.valid && (!enabled || (ownershipValid && fingerprintMatch && runtimeHealthy && runtimeStorage.writable)),
    manifestValid: structural.valid, ownershipValid, eventsComplete, fingerprintMatch,
    runtimeHealthy, runtimeExitStatus,
    runtimeStorageWritable: runtimeStorage.writable,
    runtimeStorageBlocked: runtimeStorage.blocked,
    expectedFingerprint, observedFingerprint, missingEvents, mismatchedEvents, duplicateEvents,
    hookCount: allHookCount, ownedHookCount, foreignHookCount: allHookCount - ownedHookCount,
    invalidEvents: structural.invalidEvents, invalidGroups: structural.invalidGroups, invalidHooks: structural.invalidHooks,
    stateAvailable, backupAvailable, path: paths.file,
  };
}

function enableProjectHooks({ projectRoot, pluginRoot }) {
  const paths = configPaths(projectRoot);
  const filePresent = fs.existsSync(paths.file);
  const fileStat = filePresent ? fs.statSync(paths.file) : null;
  const originalMode = fileStat ? fileStat.mode & 0o777 : null;
  const originalWasSymlink = filePresent && fs.lstatSync(paths.file).isSymbolicLink();
  const originalSymlinkTarget = originalWasSymlink ? fs.readlinkSync(paths.file) : null;
  const fileRaw = filePresent ? fs.readFileSync(paths.file, 'utf8') : null;
  let existing = { version: 1, hooks: {} };
  if (filePresent) {
    try { existing = JSON.parse(fileRaw); }
    catch { throw new Error('invalid_project_hook_manifest'); }
    if (!validateManifest(existing).valid) throw new Error('invalid_project_hook_manifest');
  }
  let state = readState(paths.stateFile);
  const backupCreated = !state;
  if (!state) {
    if (fs.existsSync(paths.backupFile)) throw new Error('hook_backup_without_state');
    const adoptedExistingOwned = Object.values(ownedManifest(existing).hooks).some(groups => groups.length > 0);
    const originalManifest = adoptedExistingOwned ? removeOwnedHooks(existing) : existing;
    const hasOriginalHooks = Object.values(originalManifest.hooks || {}).some(groups => Array.isArray(groups) && groups.length > 0);
    const hasOriginalFields = Object.keys(originalManifest).some(key => !['version', 'hooks'].includes(key));
    const originalPresent = filePresent && (!adoptedExistingOwned || hasOriginalHooks || hasOriginalFields);
    const originalRaw = originalPresent
      ? (adoptedExistingOwned ? `${JSON.stringify(originalManifest, null, 2)}\n` : fileRaw)
      : null;
    if (originalPresent) writeTextAtomic(paths.backupFile, originalRaw);
    state = {
      schemaVersion: 1,
      owner: OWNER,
      phase: 'prepared',
      originalPresent,
      originalSha256: originalPresent ? hashText(originalRaw) : null,
      originalMode,
      originalWasSymlink,
      originalSymlinkTarget,
      adoptedExistingOwned,
      backupFile: originalPresent ? BACKUP_FILE : null,
      createdAt: new Date().toISOString(),
    };
    atomicWriteJson(paths.stateFile, state);
  } else if (state.owner !== OWNER) {
    throw new Error('hook_install_state_owner_mismatch');
  }
  const merged = mergeOwnedHooks(existing, buildProjectHookConfig(pluginRoot));
  writeTextAtomic(paths.file, `${JSON.stringify(merged, null, 2)}\n`, { mode: state.originalMode ?? 0o600 });
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
        writeTextAtomic(paths.file, backupRaw, { mode: state.originalMode ?? 0o600 });
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
      else writeTextAtomic(paths.file, `${JSON.stringify(next, null, 2)}\n`, { mode: state?.originalMode ?? 0o600 });
    }
  }
  const postRemoval = doctorHooks({ projectRoot, pluginRoot });
  if (postRemoval.enabled || postRemoval.ownedHookCount > 0) throw new Error('hook_disable_incomplete');
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
