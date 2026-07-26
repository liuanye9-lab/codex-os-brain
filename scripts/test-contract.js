#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function discoverSourceTests(directory = path.join(root, 'tests')) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return discoverSourceTests(absolute);
      return /\.(?:test|spec)\.(?:cjs|mjs|js)$/.test(entry.name)
        ? [path.relative(root, absolute).replaceAll('\\', '/')]
        : [];
    })
    .sort();
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const available = discoverSourceTests();
  if (available.length) run(['--test', ...available]);
  run([path.join(root, 'scripts', 'package-selftest.js')]);
}

if (require.main === module) main();

module.exports = { discoverSourceTests, main };
