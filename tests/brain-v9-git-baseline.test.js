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

test('nested task roots use repository-relative paths and reject sibling changes', () => {
  const root = repository();
  const taskRoot = path.join(root, 'src');
  const baseline = captureGitBaseline(taskRoot, { watchPaths: ['forbidden.txt'] });
  assert.equal(baseline.repository, true);
  assert.equal(baseline.version, 3);
  assert.equal(baseline.scopePrefix, 'src');
  fs.writeFileSync(path.join(root, 'secrets', 'token.txt'), 'sibling change\n');
  const result = verifierGitDiffBounded({
    baseline,
    allowedPaths: ['app.js'],
  }, { cwd: taskRoot });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.summary.violations, [{ path: 'secrets/token.txt', reason: 'outside_scope_root' }]);
});

test('watch scan budgets fail closed', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'secrets', 'large.bin'), Buffer.alloc(64));
  const baseline = captureGitBaseline(root, {
    watchPaths: ['secrets'],
    scanLimits: { maxFiles: 10, maxFileBytes: 32, maxTotalBytes: 128, maxScanMs: 5_000 },
  });
  assert.equal(baseline.repository, false);
  assert.match(baseline.reason, /watch_scan_incomplete:max_file_bytes_exceeded/);
});

test('explicit watch roots never hide conventional large directories', () => {
  const root = repository();
  fs.mkdirSync(path.join(root, 'secrets', 'node_modules'));
  fs.writeFileSync(path.join(root, 'secrets', 'node_modules', 'large.bin'), Buffer.alloc(64));
  const limits = { maxFiles: 10, maxFileBytes: 32, maxTotalBytes: 128, maxScanMs: 5_000 };
  const parent = captureGitBaseline(root, { watchPaths: ['secrets'], scanLimits: limits });
  assert.equal(parent.repository, false);
  assert.match(parent.reason, /max_file_bytes_exceeded/);
  const explicit = captureGitBaseline(root, { watchPaths: ['secrets/node_modules'], scanLimits: limits });
  assert.equal(explicit.repository, false);
  assert.match(explicit.reason, /max_file_bytes_exceeded/);
});

test('ignored files under a forbidden parent remain visible', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, '.gitignore'), 'secrets/node_modules/\n');
  fs.mkdirSync(path.join(root, 'secrets', 'node_modules'));
  git(root, ['add', '.gitignore']);
  git(root, ['commit', '-qm', 'ignore nested dependencies']);
  const baseline = captureGitBaseline(root, { watchPaths: ['secrets'] });
  fs.writeFileSync(path.join(root, 'secrets', 'node_modules', 'token.txt'), 'secret\n');
  assert.deepEqual(changedPathsSinceBaseline(root, baseline).paths, ['secrets/node_modules/token.txt']);
});

test('large dirty files fail baseline creation instead of sharing an error fingerprint', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'large.bin'), Buffer.alloc(17 * 1024 * 1024, 1));
  const baseline = captureGitBaseline(root);
  assert.equal(baseline.repository, false);
  assert.equal(baseline.reason, 'dirty_fingerprint_incomplete');
});

test('explicit repository root must match Git discovery', () => {
  const root = repository();
  const taskRoot = path.join(root, 'src');
  const baseline = captureGitBaseline(taskRoot, { repositoryRoot: taskRoot });
  assert.equal(baseline.repository, false);
  assert.equal(baseline.reason, 'repository_root_mismatch');
});

test('overlapping watch roots are folded before budgets are counted', () => {
  const root = repository();
  fs.mkdirSync(path.join(root, 'watched', 'sub'), { recursive: true });
  for (let index = 0; index < 6; index += 1) fs.writeFileSync(path.join(root, 'watched', 'sub', `${index}.txt`), 'x');
  const baseline = captureGitBaseline(root, {
    watchPaths: ['watched', 'watched/sub'],
    scanLimits: { maxFiles: 10, maxEntries: 20, maxFileBytes: 32, maxTotalBytes: 64, maxScanMs: 5_000 },
  });
  assert.equal(baseline.repository, true);
  assert.deepEqual(baseline.watchRoots, ['watched']);
  assert.equal(baseline.scan.files, 6);
});

test('invalid watch paths fail closed', () => {
  const root = repository();
  const baseline = captureGitBaseline(root, { watchPaths: ['../outside'] });
  assert.equal(baseline.repository, false);
  assert.equal(baseline.reason, 'invalid_watch_path');
});
