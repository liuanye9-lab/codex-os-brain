'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function defaultLocalStateRoot(home, pathImpl = path) {
  if (process.platform === 'darwin') return pathImpl.join(home, 'Library', 'Application Support', 'CodexBrain');
  if (process.platform === 'win32') return pathImpl.join(process.env.LOCALAPPDATA || pathImpl.join(home, 'AppData', 'Local'), 'CodexBrain');
  return pathImpl.join(process.env.XDG_STATE_HOME || pathImpl.join(home, '.local', 'state'), 'codex-brain');
}

function resolveV9Paths(env = process.env, options = {}) {
  const pathImpl = options.pathImpl || path;
  const home = options.home || os.homedir();
  const brainHome = pathImpl.resolve(env.CODEX_BRAIN_HOME || pathImpl.join(home, '.codex-brain'));
  const runtimeRoot = pathImpl.join(brainHome, 'runtime', 'v9');
  const localStateRoot = pathImpl.resolve(env.CODEX_BRAIN_STATE_HOME || defaultLocalStateRoot(home, pathImpl));
  const localRuntimeRoot = pathImpl.join(localStateRoot, 'runtime', 'v9');
  return {
    brainHome,
    runtimeRoot,
    tasksRoot: pathImpl.join(runtimeRoot, 'tasks'),
    eventsRoot: pathImpl.join(runtimeRoot, 'events'),
    evidenceRoot: pathImpl.join(runtimeRoot, 'evidence'),
    failuresRoot: pathImpl.join(runtimeRoot, 'failures'),
    embeddingsRoot: pathImpl.join(runtimeRoot, 'embeddings'),
    embeddingConfigPath: pathImpl.join(runtimeRoot, 'embeddings', 'config.json'),
    migrationRoot: pathImpl.join(runtimeRoot, 'migration'),
    localStateRoot,
    localRuntimeRoot,
    evidenceSealKeyPath: pathImpl.join(localRuntimeRoot, 'evidence', 'seal.key'),
    controlDbPath: pathImpl.join(localRuntimeRoot, 'control', 'control.sqlite3'),
    controlGuardPath: pathImpl.join(runtimeRoot, 'control', 'active.guard.json'),
    stopGateRoot: pathImpl.join(localRuntimeRoot, 'stop-gate'),
    fanoutRoot: pathImpl.join(runtimeRoot, 'fanout'),
    configPath: pathImpl.join(brainHome, 'config', 'brain-lite-v9.json'),
  };
}

function projectScopeId(projectRoot, pathImpl = path) {
  const resolved = pathImpl.resolve(projectRoot);
  let normalized = resolved;
  try { normalized = fs.realpathSync.native(resolved); } catch {}
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function scopeV9Paths(paths, projectRoot, pathImpl = path) {
  const projectId = projectScopeId(projectRoot, pathImpl);
  const projectRuntimeRoot = pathImpl.join(paths.runtimeRoot, 'projects', projectId);
  const projectLocalRuntimeRoot = pathImpl.join(paths.localRuntimeRoot, 'projects', projectId);
  return {
    ...paths,
    projectId,
    projectRoot: pathImpl.resolve(projectRoot),
    runtimeRoot: projectRuntimeRoot,
    tasksRoot: pathImpl.join(projectRuntimeRoot, 'tasks'),
    eventsRoot: pathImpl.join(projectRuntimeRoot, 'events'),
    evidenceRoot: pathImpl.join(projectRuntimeRoot, 'evidence'),
    failuresRoot: pathImpl.join(projectRuntimeRoot, 'failures'),
    embeddingsRoot: pathImpl.join(projectRuntimeRoot, 'embeddings'),
    embeddingConfigPath: pathImpl.join(projectRuntimeRoot, 'embeddings', 'config.json'),
    localRuntimeRoot: projectLocalRuntimeRoot,
    controlDbPath: pathImpl.join(projectLocalRuntimeRoot, 'control', 'control.sqlite3'),
    controlGuardPath: pathImpl.join(projectRuntimeRoot, 'control', 'active.guard.json'),
    memoryRoot: pathImpl.join(projectLocalRuntimeRoot, 'memory'),
    memoryDbPath: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'memory.sqlite3'),
    memoryBackupRoot: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'backups'),
    memoryEncryptedBackupRoot: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'encrypted-backups'),
    memoryBackupStatePath: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'backup-state.json'),
    memoryDeviceIdPath: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'device-id'),
    memoryRestoreRoot: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'restore'),
    memoryRestoreLockPath: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'restore.lock'),
    memoryRestoreJournalPath: pathImpl.join(projectLocalRuntimeRoot, 'memory', 'restore-journal.json'),
  };
}

module.exports = { defaultLocalStateRoot, projectScopeId, resolveV9Paths, scopeV9Paths };
