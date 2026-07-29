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

function canonicalFsPath(target) {
  const absolute = path.resolve(target);
  const resolved = fs.realpathSync.native
    ? fs.realpathSync.native(absolute)
    : fs.realpathSync(absolute);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameFsLocation(left, right) {
  try {
    const a = fs.statSync(left);
    const b = fs.statSync(right);
    if (a.dev === b.dev && a.ino === b.ino) return true;
  } catch { /* fall through to canonical path comparison */ }
  return canonicalFsPath(left) === canonicalFsPath(right);
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

const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxFiles: 25_000,
  maxEntries: 50_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxScanMs: 5_000,
  maxManifestBytes: 2_500_000,
});

function fileFingerprint(cwd, relativePath, limits = DEFAULT_SCAN_LIMITS) {
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
  if (stat.size > limits.maxFileBytes) return `error:file_too_large:${stat.size}`;
  return `file:${stat.mode & 0o7777}:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
}

function normalizeWatchPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.includes('..')) return null;
  return normalized;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function repoPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function statCacheKey(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs ?? BigInt(Math.trunc(stat.mtimeMs * 1e6)),
    stat.ctimeNs ?? BigInt(Math.trunc(stat.ctimeMs * 1e6)), stat.mode, stat.isSymbolicLink() ? 'l' : stat.isFile() ? 'f' : stat.isDirectory() ? 'd' : 'o'].join(':');
}

function watchedScan(cwd, watchPaths = [], options = {}) {
  const limits = { ...DEFAULT_SCAN_LIMITS, ...(options.limits || {}) };
  const priorMeta = options.priorMeta || {};
  const output = {};
  const meta = {};
  const started = Date.now();
  let files = 0;
  let entriesSeen = 0;
  let totalBytes = 0;
  function budget(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  function inspect(relativePath) {
    if (Date.now() - started > limits.maxScanMs) budget('max_scan_ms_exceeded');
    entriesSeen += 1;
    if (entriesSeen > limits.maxEntries) budget('max_entries_exceeded');
    const target = path.resolve(cwd, relativePath);
    let stat;
    try { stat = fs.lstatSync(target, { bigint: true }); }
    catch (error) {
      output[relativePath] = error.code === 'ENOENT' ? 'missing' : `error:${error.code || 'unknown'}`;
      meta[relativePath] = output[relativePath];
      if (error.code !== 'ENOENT') budget(`watch_read_failed:${error.code || 'unknown'}`);
      return;
    }
    const key = statCacheKey(stat);
    meta[relativePath] = key;
    if (stat.isFile()) {
      files += 1;
      totalBytes += Number(stat.size);
      if (files > limits.maxFiles) budget('max_files_exceeded');
      if (Number(stat.size) > limits.maxFileBytes) budget('max_file_bytes_exceeded');
      if (totalBytes > limits.maxTotalBytes) budget('max_total_bytes_exceeded');
    }
    output[relativePath] = priorMeta[relativePath] === key && options.priorFingerprints?.[relativePath]
      ? options.priorFingerprints[relativePath]
      : fileFingerprint(cwd, relativePath, limits);
    if (Date.now() - started > limits.maxScanMs) budget('max_scan_ms_exceeded');
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const entries = fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    if (Date.now() - started > limits.maxScanMs) budget('max_scan_ms_exceeded');
    for (const entry of entries) {
      inspect(`${relativePath}/${entry.name}`.replace(/^\/+/, ''));
    }
  }
  try {
    for (const raw of watchPaths) {
      const watched = normalizeWatchPath(raw);
      if (!watched) continue;
      inspect(watched);
    }
  } catch (error) {
    return { ok: false, fingerprints: {}, meta: {}, error: `watch_scan_incomplete:${error.code || error.message}` };
  }
  return {
    ok: true,
    fingerprints: Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b))),
    meta: Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b))),
    stats: { files, entries: entriesSeen, totalBytes, durationMs: Date.now() - started, limits },
  };
}

function watchedFingerprints(cwd, watchPaths = [], options = {}) {
  const scan = watchedScan(cwd, watchPaths, options);
  if (!scan.ok) return { __scan_error__: scan.error };
  return scan.fingerprints;
}

function resolveRoots(taskRoot, options = {}) {
  const task = canonicalFsPath(taskRoot);
  const discovered = runGit(task, ['rev-parse', '--show-toplevel']);
  if (!discovered.ok) return { ok: false, reason: discovered.stderr || 'git_root_unavailable' };
  const discoveredRoot = canonicalFsPath(discovered.stdout.toString('utf8').trim());
  const repository = canonicalFsPath(options.repositoryRoot || discovered.stdout.toString('utf8').trim());
  if (!sameFsLocation(discoveredRoot, repository)) return { ok: false, reason: 'repository_root_mismatch' };
  const scope = canonicalFsPath(options.scopeRoot || task);
  if (!isWithin(repository, task)) return { ok: false, reason: 'task_root_outside_repository' };
  if (!isWithin(repository, scope)) return { ok: false, reason: 'scope_root_outside_repository' };
  return {
    ok: true,
    repositoryRoot: repository,
    taskRoot: task,
    scopeRoot: scope,
    taskPrefix: repoPath(path.relative(repository, task)),
    scopePrefix: repoPath(path.relative(repository, scope)),
  };
}

function toRepositoryWatchPaths(scopePrefix, watchPaths) {
  const normalized = watchPaths.map(normalizeWatchPath);
  if (normalized.some(item => !item)) return null;
  const rooted = [...new Set(normalized.map(item => scopePrefix ? `${scopePrefix}/${item}` : item))]
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return rooted.filter((item, index) => !rooted.slice(0, index).some(parent => item === parent || item.startsWith(`${parent}/`)));
}

function legacyWatchedFingerprints(cwd, watchPaths = []) {
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

function captureGitBaseline(cwd, { watchPaths = [], repositoryRoot, scopeRoot, scanLimits } = {}) {
  const roots = resolveRoots(cwd, { repositoryRoot, scopeRoot });
  if (!roots.ok) return { version: 3, repository: false, reason: roots.reason };
  const root = roots.repositoryRoot;
  const head = runGit(root, ['rev-parse', 'HEAD']);
  const commonDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const gitDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const dirty = currentDirtyPaths(root);
  if (!head.ok || !commonDir.ok || !gitDir.ok || !dirty.ok) {
    return { version: 3, repository: false, reason: head.stderr || commonDir.stderr || gitDir.stderr || dirty.error || 'git_baseline_unavailable' };
  }
  const repositoryWatchPaths = toRepositoryWatchPaths(roots.scopePrefix, watchPaths);
  if (!repositoryWatchPaths) return { version: 3, repository: false, reason: 'invalid_watch_path' };
  const scan = watchedScan(root, repositoryWatchPaths, { limits: scanLimits });
  if (!scan.ok) return { version: 3, repository: false, reason: scan.error };
  const dirtyFingerprints = Object.fromEntries(dirty.paths.map(file => [file, fileFingerprint(root, file)]));
  if (Object.values(dirtyFingerprints).some(value => value.startsWith('error:'))) {
    return { version: 3, repository: false, reason: 'dirty_fingerprint_incomplete' };
  }
  const baseline = {
    version: 3,
    repository: true,
    head: head.stdout.toString('utf8').trim(),
    repositoryId: crypto.createHash('sha256').update(canonicalFsPath(commonDir.stdout.toString('utf8').trim())).digest('hex'),
    worktreeId: crypto.createHash('sha256').update(canonicalFsPath(gitDir.stdout.toString('utf8').trim())).digest('hex'),
    taskPrefix: roots.taskPrefix,
    scopePrefix: roots.scopePrefix,
    dirty: dirtyFingerprints,
    watched: scan.fingerprints,
    watchedMeta: scan.meta,
    watchRoots: repositoryWatchPaths,
    scan: scan.stats,
    capturedAt: new Date().toISOString(),
  };
  if (Buffer.byteLength(JSON.stringify(baseline)) > scan.stats.limits.maxManifestBytes) {
    return { version: 3, repository: false, reason: 'baseline_manifest_too_large' };
  }
  return baseline;
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
  if (![2, 3].includes(baseline.version) || baseline.repository !== true || !baseline.head || !baseline.dirty || !baseline.watched) {
    return { ok: false, paths: [], error: 'git_baseline_required' };
  }
  const roots = resolveRoots(cwd);
  if (!roots.ok) return { ok: false, paths: [], error: roots.reason };
  if (baseline.version === 2 && roots.taskPrefix) return { ok: false, paths: [], error: 'legacy_baseline_requires_repository_root' };
  const root = roots.repositoryRoot;
  const commonDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const gitDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
  if (!commonDir.ok || !gitDir.ok) return { ok: false, paths: [], error: 'git_identity_unavailable' };
  const repositoryId = crypto.createHash('sha256').update(canonicalFsPath(commonDir.stdout.toString('utf8').trim())).digest('hex');
  const worktreeId = crypto.createHash('sha256').update(canonicalFsPath(gitDir.stdout.toString('utf8').trim())).digest('hex');
  if (baseline.repositoryId !== repositoryId || baseline.worktreeId !== worktreeId) {
    return { ok: false, paths: [], error: 'git_repository_identity_mismatch' };
  }
  const dirty = currentDirtyPaths(root);
  if (!dirty.ok) return dirty;
  const committed = committedPathsSince(root, baseline.head);
  if (!committed.ok) return committed;
  const watchRoots = baseline.version === 3 ? baseline.watchRoots : Object.keys(baseline.watched);
  const scan = watchedScan(root, watchRoots, {
    limits: baseline.scan?.limits,
    priorMeta: baseline.watchedMeta,
    priorFingerprints: baseline.watched,
  });
  if (!scan.ok) return { ok: false, paths: [], error: scan.error };
  const currentWatched = scan.fingerprints;
  const candidates = new Set([
    ...Object.keys(baseline.dirty),
    ...Object.keys(baseline.watched),
    ...Object.keys(currentWatched),
    ...dirty.paths,
    ...committed.paths,
  ]);
  const changed = [];
  for (const file of candidates) {
    const current = Object.hasOwn(currentWatched, file) ? currentWatched[file] : fileFingerprint(root, file);
    if (current.startsWith('error:')) return { ok: false, paths: [], error: 'dirty_fingerprint_incomplete' };
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
  DEFAULT_SCAN_LIMITS,
  captureGitBaseline,
  changedPathsSinceBaseline,
  committedPathsSince,
  currentDirtyPaths,
  fileFingerprint,
  normalizeWatchPath,
  parseStatusZ,
  runGit,
  watchedScan,
  watchedFingerprints,
};
