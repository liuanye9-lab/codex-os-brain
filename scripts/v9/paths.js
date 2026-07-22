'use strict';

const os = require('node:os');
const path = require('node:path');

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
    memoryRoot: pathImpl.join(localRuntimeRoot, 'memory'),
    memoryDbPath: pathImpl.join(localRuntimeRoot, 'memory', 'memory.sqlite3'),
    memoryBackupRoot: pathImpl.join(localRuntimeRoot, 'memory', 'backups'),
    memoryEncryptedBackupRoot: pathImpl.join(localRuntimeRoot, 'memory', 'encrypted-backups'),
    memoryBackupStatePath: pathImpl.join(localRuntimeRoot, 'memory', 'backup-state.json'),
    memoryDeviceIdPath: pathImpl.join(localRuntimeRoot, 'memory', 'device-id'),
    configPath: pathImpl.join(brainHome, 'config', 'brain-lite-v9.json'),
  };
}

module.exports = { defaultLocalStateRoot, resolveV9Paths };
