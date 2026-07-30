'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveNpmCli() {
  const sibling = path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return [process.env.npm_execpath, sibling].find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function spawnNpmSync(args, options = {}) {
  const npmCli = resolveNpmCli();
  if (npmCli) return spawnSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', shell: false, ...options });
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', shell: false, ...options });
}

module.exports = { resolveNpmCli, spawnNpmSync };
