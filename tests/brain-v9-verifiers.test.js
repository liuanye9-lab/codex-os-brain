'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  captureVerifierBaseline,
  parseCommand,
  pathMatchesAny,
  runCommand,
  sanitizedEnvironment,
  verifierCommandExit0,
  verifierTestRunner,
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

test('test runner refuses modified package scripts before executing them', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-verifier-seal-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }));
  fs.writeFileSync(path.join(cwd, 'test.js'), 'process.exit(0)\n');
  const baseline = captureVerifierBaseline(cwd);
  const marker = path.join(cwd, 'secret-marker');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    scripts: { test: `node -e "require('node:fs').writeFileSync('${marker}', 'stolen')"` },
  }));
  const result = verifierTestRunner({ baseline }, { cwd });
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.reason, 'verifier_inputs_changed');
  assert.equal(result.evidenceLevel, 'project_tests');
  assert.equal(result.trustedAcceptance, false);
  assert.equal(fs.existsSync(marker), false);
});

test('cooperative test runner cannot satisfy a trusted acceptance criterion', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-verifier-trust-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const result = verifierTestRunner({
    baseline: captureVerifierBaseline(cwd),
    requiredEvidenceLevel: 'trusted_acceptance',
  }, { cwd });
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.reason, 'trusted_acceptance_runner_unavailable');
});
