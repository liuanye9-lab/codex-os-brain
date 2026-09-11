#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function run(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  run([path.join(root, 'scripts', 'test-contract.js')]);
  run([path.join(root, 'scripts', 'verify-v9-release.js')]);
  // The A/B eval protects behavioural properties the unit tests do not observe: false-block rate,
  // deadlock freedom, evasion resistance, and the adversarial split cases. Two rounds is enough to
  // catch a regression and to notice non-determinism; deeper runs are `npm run eval:gates`.
  run([path.join(root, 'evals', 'v12-ab', 'runner.cjs'), '--assert'], { AB_ROUNDS: '2' });
}

if (require.main === module) main();

module.exports = { main };
