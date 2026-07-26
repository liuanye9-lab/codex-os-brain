'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseCommand,
  pathMatchesAny,
  runCommand,
  sanitizedEnvironment,
  verifierCommandExit0,
} = require('../scripts/v9/verifiers');

test('verifier commands use argv execution and reject shell operators', () => {
  assert.deepEqual(parseCommand('node -e "process.exit(0)"'), {
    executable: 'node',
    args: ['-e', 'process.exit(0)'],
  });
  assert.deepEqual(parseCommand('C:\\Tools\\node.exe script.js'), {
    executable: 'C:\\Tools\\node.exe',
    args: ['script.js'],
  });
  assert.throws(() => parseCommand('node ok.js && npm publish'), /shell_operator_rejected/);
  const rejected = runCommand({ command: 'node -e "process.exit(0)" | cat' });
  assert.equal(rejected.reason, 'shell_operator_rejected');
});

test('rejected shell injection cannot create its side-effect file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-shell-injection-'));
  const marker = path.join(cwd, 'should-not-exist');
  const result = runCommand({
    command: `node -e "process.exit(0)" && node -e "require('node:fs').writeFileSync('${marker}', 'bad')"`,
    cwd,
  });
  assert.equal(result.reason, 'shell_operator_rejected');
  assert.equal(fs.existsSync(marker), false);
});

test('custom command verifier requires signed human approval', () => {
  const blocked = verifierCommandExit0({ command: 'node -e "process.exit(0)"' });
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.summary.reason, 'custom_verifier_approval_required');
  const passed = verifierCommandExit0({ executable: process.execPath, args: ['-e', 'process.exit(0)'], humanApproved: true });
  assert.equal(passed.status, 'passed');
});

test('verifier subprocess receives only the environment allowlist', () => {
  const env = sanitizedEnvironment({ PATH: '/bin', HOME: '/tmp/home', SECRET_TOKEN: 'must-not-pass' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/tmp/home' });
});

test('scope matching uses path boundaries instead of substring matching', () => {
  assert.equal(pathMatchesAny('src/safe/file.js', ['src/safe']), true);
  assert.equal(pathMatchesAny('src/safehouse/file.js', ['src/safe']), false);
  assert.equal(pathMatchesAny('config/.env', ['.env']), true);
  assert.equal(pathMatchesAny('config/.environment', ['.env']), false);
});

test('argv execution works in a temporary directory without a shell', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-verifier-'));
  const marker = path.join(cwd, 'marker.txt');
  const result = runCommand({
    executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`],
    cwd,
  });
  assert.equal(result.status, 'passed');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');
});
