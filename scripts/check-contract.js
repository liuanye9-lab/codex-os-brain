#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  run([path.join(root, 'scripts', 'test-contract.js')]);
  run([path.join(root, 'scripts', 'verify-v9-release.js')]);
}

if (require.main === module) main();

module.exports = { main };
