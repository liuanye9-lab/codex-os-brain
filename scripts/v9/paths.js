'use strict';

const os = require('node:os');
const path = require('node:path');

function resolveV9Paths(env = process.env, options = {}) {
  const pathImpl = options.pathImpl || path;
  const home = options.home || os.homedir();
  const brainHome = pathImpl.resolve(env.CODEX_BRAIN_HOME || pathImpl.join(home, '.codex-brain'));
  const runtimeRoot = pathImpl.join(brainHome, 'runtime', 'v9');
  return {
    brainHome,
    runtimeRoot,
    tasksRoot: pathImpl.join(runtimeRoot, 'tasks'),
    eventsRoot: pathImpl.join(runtimeRoot, 'events'),
    evidenceRoot: pathImpl.join(runtimeRoot, 'evidence'),
    failuresRoot: pathImpl.join(runtimeRoot, 'failures'),
    migrationRoot: pathImpl.join(runtimeRoot, 'migration'),
    configPath: pathImpl.join(brainHome, 'config', 'brain-lite-v9.json'),
  };
}

module.exports = { resolveV9Paths };
