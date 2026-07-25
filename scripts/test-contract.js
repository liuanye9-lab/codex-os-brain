#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceTests = [
  'tests/ci-workflow.test.js',
  'tests/brain-v9-store.test.js',
  'tests/brain-v9-task-contract.test.js',
  'tests/brain-v9-verification.test.js',
  'tests/brain-v9-failure-controller.test.js',
  'tests/brain-v9-embeddings.test.js',
  'tests/brain-v9-migration.test.js',
  'tests/brain-v9-memory-db.test.js',
  'tests/brain-v9-memory-service.test.js',
  'tests/brain-v9-memory-harness.test.js',
  'tests/brain-v9-memory-encrypted-backup.test.js',
  'tests/brain-v9-memory-recovery.test.js',
  'tests/brain-v9-hooks.test.js',
  'tests/brain-v9-hook-config.test.js',
  'tests/brain-v9-cli.test.js',
  'tests/brain-v9-mcp.test.mjs',
  'tests/brain-v9-cross-surface.test.mjs',
  'tests/brain-v9-p0-p6.test.js',
  'tests/brain-v9-public-export.test.js',
  'tests/brain-v9-release.test.js',
  'tests/brain-v9-eval-isolation.test.js',
  'tests/brain-lite-routing-receipt.test.js',
];

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const available = sourceTests.filter(file => fs.existsSync(path.join(root, file)));
  if (available.length) run(['--test', ...available]);
  run([path.join(root, 'scripts', 'package-selftest.js')]);
}

if (require.main === module) main();

module.exports = { main, sourceTests };
