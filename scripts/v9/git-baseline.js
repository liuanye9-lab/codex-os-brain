'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'buffer',
    shell: false,
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || Buffer.alloc(0),
    stderr: String(result.stderr || ''),
  };
}

function parseStatusZ(buffer) {
  const entries = buffer.toString('utf8').split('\0');
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const target = entry.slice(3);
    if (target) paths.push(target);
    if (/[RC]/.test(status) && entries[index + 1]) paths.push(entries[++index]);
  }
  return [...new Set(paths.map(item => item.replaceAll('\\', '/')))].sort();
}

function fileFingerprint(cwd, relativePath) {
  const target = path.resolve(cwd, relativePath);
  const root = `${path.resolve(cwd)}${path.sep}`;
  if (target !== path.resolve(cwd) && !target.startsWith(root)) return 'outside-root';
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) { return error.code === 'ENOENT' ? 'missing' : `error:${error.code || 'unknown'}`; }
  if (stat.isSymbolicLink()) {
    return `symlink:${stat.mode & 0o7777}:${crypto.createHash('sha256').update(fs.readlinkSync(target)).digest('hex')}`;
  }
  if (!stat.isFile()) return `type:${stat.mode & 0o177777}`;
  return `file:${stat.mode & 0o7777}:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
}

function normalizeWatchPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.includes('..')) return null;
  return normalized;
}

function watchedFingerprints(cwd, watchPaths = []) {
  const output = {};
  for (const raw of watchPaths) {
    const watched = normalizeWatchPath(raw);
    if (!watched) continue;
    const target = path.resolve(cwd, watched);
    let stat;
    try { stat = fs.lstatSync(target); }
    catch (error) {
      output[watched] = error.code === 'ENOENT' ? 'missing' : `error:${error.code || 'unknown'}`;
      continue;
    }
    output[watched] = fileFingerprint(cwd, watched);
    if (!stat.isDirectory()) continue;
    const pending = [watched];
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(path.resolve(cwd, directory), { withFileTypes: true })) {
        const child = `${directory}/${entry.name}`;
        output[child] = fileFingerprint(cwd, child);
        if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(child);
      }
    }
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}

function currentDirtyPaths(cwd) {
  const status = runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!status.ok) return { ok: false, paths: [], error: status.stderr || 'git_status_failed' };
  return { ok: true, paths: parseStatusZ(status.stdout) };
}

function captureGitBaseline(cwd, { watchPaths = [] } = {}) {
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
  const head = runGit(cwd, ['rev-parse', 'HEAD']);
  const commonDir = runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const gitDir = runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const dirty = currentDirtyPaths(cwd);
  if (!root.ok || !head.ok || !commonDir.ok || !gitDir.ok || !dirty.ok) {
    return { version: 2, repository: false, reason: root.stderr || head.stderr || commonDir.stderr || gitDir.stderr || dirty.error || 'git_baseline_unavailable' };
  }
  const normalizedRoot = fs.realpathSync(path.resolve(root.stdout.toString('utf8').trim()));
  const normalizedCwd = fs.realpathSync(path.resolve(cwd));
  if (normalizedRoot !== normalizedCwd) {
    return { version: 2, repository: false, reason: 'project_root_must_equal_git_root' };
  }
  const dirtyFingerprints = Object.fromEntries(dirty.paths.map(file => [file, fileFingerprint(cwd, file)]));
  return {
    version: 2,
    repository: true,
    head: head.stdout.toString('utf8').trim(),
    repositoryId: crypto.createHash('sha256').update(fs.realpathSync(commonDir.stdout.toString('utf8').trim())).digest('hex'),
    worktreeId: crypto.createHash('sha256').update(fs.realpathSync(gitDir.stdout.toString('utf8').trim())).digest('hex'),
    dirty: dirtyFingerprints,
    watched: watchedFingerprints(cwd, watchPaths),
    capturedAt: new Date().toISOString(),
  };
}

function committedPathsSince(cwd, baselineHead) {
  const diff = runGit(cwd, ['diff', '--name-only', '-z', '--no-renames', baselineHead, 'HEAD']);
  if (!diff.ok) return { ok: false, paths: [], error: diff.stderr || 'git_baseline_head_unavailable' };
  return {
    ok: true,
    paths: diff.stdout.toString('utf8').split('\0').filter(Boolean).map(item => item.replaceAll('\\', '/')),
  };
}

function changedPathsSinceBaseline(cwd, baseline = {}) {
  if (baseline.version !== 2 || baseline.repository !== true || !baseline.head || !baseline.dirty || !baseline.watched) {
    return { ok: false, paths: [], error: 'git_baseline_required' };
  }
  const dirty = currentDirtyPaths(cwd);
  if (!dirty.ok) return dirty;
  const committed = committedPathsSince(cwd, baseline.head);
  if (!committed.ok) return committed;
  const currentWatched = watchedFingerprints(cwd, Object.keys(baseline.watched));
  const candidates = new Set([
    ...Object.keys(baseline.dirty),
    ...Object.keys(baseline.watched),
    ...Object.keys(currentWatched),
    ...dirty.paths,
    ...committed.paths,
  ]);
  const changed = [];
  for (const file of candidates) {
    const current = fileFingerprint(cwd, file);
    if (Object.hasOwn(baseline.watched, file)) {
      if (current !== baseline.watched[file]) changed.push(file);
    } else if (Object.hasOwn(baseline.dirty, file)) {
      if (current !== baseline.dirty[file]) changed.push(file);
    } else {
      changed.push(file);
    }
  }
  return { ok: true, paths: [...new Set(changed)].sort() };
}

module.exports = {
  captureGitBaseline,
  changedPathsSinceBaseline,
  committedPathsSince,
  currentDirtyPaths,
  fileFingerprint,
  normalizeWatchPath,
  parseStatusZ,
  runGit,
  watchedFingerprints,
};
