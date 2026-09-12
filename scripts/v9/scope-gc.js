'use strict';
// Project state is stored under a SHA-256 of the project path, which is one-way: once a
// directory is deleted or renamed, nothing on disk can say which project a scope folder
// belonged to. Measured on this machine, that produced 27 unreclaimable folders in a day,
// growing monotonically with no way to tell live state from dead state.
//
// The fix is deliberately boring: drop a small origin marker next to the scope so the
// folder can name itself, and reclaim only what is provably dead. Nothing here deletes
// anything unless asked twice -- `plan` is the default and `--confirm` is required.

const fs = require('node:fs');
const path = require('node:path');

const ORIGIN_FILE = 'origin.json';

function writeOriginMarker({ runtimeRoot, projectRoot, projectId }) {
  // Best effort: a missing marker must never break a hook, it only makes gc conservative.
  try {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const target = path.join(runtimeRoot, ORIGIN_FILE);
    const existing = readOriginMarker(runtimeRoot);
    if (existing && existing.projectRoot === projectRoot) return existing;
    const record = { version: 1, projectId, projectRoot, firstSeenAt: existing?.firstSeenAt || new Date().toISOString() };
    fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return record;
  } catch {
    return null;
  }
}

function readOriginMarker(runtimeRoot) {
  try {
    const raw = fs.readFileSync(path.join(runtimeRoot, ORIGIN_FILE), 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value.projectRoot === 'string' ? value : null;
  } catch {
    return null;
  }
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try { total += fs.statSync(full).size; } catch { /* raced away */ }
      }
    }
  }
  return total;
}

// Three states, and only one of them is safe to delete:
//   live    -> marker present and the project directory still exists
//   dead    -> marker present and the project directory is gone
//   unknown -> no marker (predates this change, or the write failed)
// `unknown` is never reclaimed automatically. Guessing wrong deletes the contract that is
// currently guarding a directory, which is far worse than leaving a few kilobytes behind.
function scanProjectScopes({ runtimeRoot } = {}) {
  const projectsRoot = path.join(runtimeRoot, 'projects');
  let ids;
  try { ids = fs.readdirSync(projectsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return { projectsRoot, scopes: [], live: 0, dead: 0, unknown: 0 }; }

  const scopes = ids.map(projectId => {
    const scopeRoot = path.join(projectsRoot, projectId);
    const origin = readOriginMarker(scopeRoot);
    let state = 'unknown';
    if (origin) state = fs.existsSync(origin.projectRoot) ? 'live' : 'dead';
    return { projectId, scopeRoot, projectRoot: origin?.projectRoot || null, firstSeenAt: origin?.firstSeenAt || null, state, sizeBytes: dirSizeBytes(scopeRoot) };
  });

  return {
    projectsRoot,
    scopes,
    live: scopes.filter(s => s.state === 'live').length,
    dead: scopes.filter(s => s.state === 'dead').length,
    unknown: scopes.filter(s => s.state === 'unknown').length,
  };
}

function collectProjectScopes({ runtimeRoot, confirm = false } = {}) {
  const report = scanProjectScopes({ runtimeRoot });
  const reclaimable = report.scopes.filter(s => s.state === 'dead');
  const reclaimableBytes = reclaimable.reduce((sum, s) => sum + s.sizeBytes, 0);

  if (!confirm) {
    return {
      mode: 'plan',
      ...report,
      reclaimable: reclaimable.map(s => ({ projectId: s.projectId, projectRoot: s.projectRoot, sizeBytes: s.sizeBytes })),
      reclaimableBytes,
      removed: [],
      hint: reclaimable.length ? 'Re-run with --confirm to remove these.' : 'Nothing is safe to reclaim.',
    };
  }

  const removed = [];
  const failed = [];
  for (const scope of reclaimable) {
    try { fs.rmSync(scope.scopeRoot, { recursive: true, force: true }); removed.push({ projectId: scope.projectId, projectRoot: scope.projectRoot, sizeBytes: scope.sizeBytes }); }
    catch (error) { failed.push({ projectId: scope.projectId, reason: error.code || 'remove_failed' }); }
  }
  return { mode: 'collect', ...report, reclaimable: [], reclaimableBytes, removed, failed, removedBytes: removed.reduce((s, r) => s + r.sizeBytes, 0) };
}

module.exports = { ORIGIN_FILE, collectProjectScopes, readOriginMarker, scanProjectScopes, writeOriginMarker };
