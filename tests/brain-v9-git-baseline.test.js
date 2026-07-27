'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { captureGitBaseline, changedPathsSinceBaseline } = require('../scripts/v9/git-baseline');
const { verifierGitDiffBounded } = require('../scripts/v9/verifiers');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-baseline-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@invalid']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'secrets'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'one\n');
  fs.writeFileSync(path.join(root, 'secrets', 'token.txt'), 'initial\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'baseline']);
  return root;
}

test('baseline excludes pre-existing dirt but detects later changes to the same file', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'pre-existing\n');
  const baseline = captureGitBaseline(root);
  assert.deepEqual(changedPathsSinceBaseline(root, baseline).paths, []);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'changed-after-contract\n');
  assert.deepEqual(changedPathsSinceBaseline(root, baseline).paths, ['src/app.js']);
});

test('baseline detects committed, untracked, deleted, and forbidden changes', () => {
  const root = repository();
  const baseline = captureGitBaseline(root);
  fs.writeFileSync(path.join(root, 'src', 'new.js'), 'new\n');
  fs.unlinkSync(path.join(root, 'secrets', 'token.txt'));
  const changed = changedPathsSinceBaseline(root, baseline);
  assert.deepEqual(changed.paths, ['secrets/token.txt', 'src/new.js']);
  const result = verifierGitDiffBounded({
    baseline,
    allowedPaths: ['src/'],
    forbiddenPaths: ['secrets/'],
  }, { cwd: root });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.summary.violations, [{ path: 'secrets/token.txt', reason: 'forbidden' }]);
});

test('scope verifier fails closed without a signed baseline', () => {
  const root = repository();
  const result = verifierGitDiffBounded({ allowedPaths: ['src/'] }, { cwd: root });
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.reason, 'git_baseline_required');
});

test('baseline watches forbidden paths even when gitignore hides them', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored-secret.txt\n');
  git(root, ['add', '.gitignore']);
  git(root, ['commit', '-qm', 'ignore fixture']);
  const baseline = captureGitBaseline(root, { watchPaths: ['ignored-secret.txt'] });
  fs.writeFileSync(path.join(root, 'ignored-secret.txt'), 'secret\n');
  assert.deepEqual(changedPathsSinceBaseline(root, baseline).paths, ['ignored-secret.txt']);
});

test('committed rename reports both old and new path and chmod is visible', () => {
  const root = repository();
  const baseline = captureGitBaseline(root);
  fs.renameSync(path.join(root, 'secrets', 'token.txt'), path.join(root, 'src', 'token.txt'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'move token']);
  const renamed = changedPathsSinceBaseline(root, baseline).paths;
  assert.deepEqual(renamed, ['secrets/token.txt', 'src/token.txt']);

  const modeBaseline = captureGitBaseline(root);
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(root, 'src', 'app.js'), 0o755);
    assert.deepEqual(changedPathsSinceBaseline(root, modeBaseline).paths, ['src/app.js']);
  }
});
