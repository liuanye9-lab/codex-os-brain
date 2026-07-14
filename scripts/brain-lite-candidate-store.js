'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mergeCandidate } = require('./brain-lite-behavioral-memory');

class CandidateStoreCorruptError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'CandidateStoreCorruptError';
    this.code = 'BEHAVIORAL_STORE_CORRUPT';
  }
}

class CandidateStoreRevisionError extends Error {
  constructor(expected, actual) {
    super(`candidate store revision conflict: expected ${expected}, found ${actual}`);
    this.name = 'CandidateStoreRevisionError';
    this.code = 'BEHAVIORAL_STORE_REVISION_CONFLICT';
    this.expectedRevision = expected;
    this.actualRevision = actual;
  }
}

class CandidateStoreLockedError extends Error {
  constructor(filePath) {
    super(`candidate store is locked by another writer: ${filePath}`);
    this.name = 'CandidateStoreLockedError';
    this.code = 'BEHAVIORAL_STORE_LOCKED';
  }
}

function emptyStore() {
  return { schemaVersion: 1, revision: 0, candidates: [] };
}

function readCandidateStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CandidateStoreCorruptError(`candidate store is not valid JSON: ${filePath}`, error);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== 1 || !Array.isArray(parsed.candidates)
    || (parsed.revision !== undefined && (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0))) {
    throw new CandidateStoreCorruptError(`candidate store has an invalid top-level shape: ${filePath}`);
  }
  return {
    schemaVersion: 1,
    revision: parsed.revision ?? 0,
    candidates: parsed.candidates,
  };
}

function replaceFileAtomic(temporary, filePath, options = {}) {
  const fsImpl = options.fsImpl || fs;
  try {
    fsImpl.renameSync(temporary, filePath);
    return;
  } catch (error) {
    const windowsReplaceError = ['EACCES', 'EEXIST', 'EPERM'].includes(error.code);
    if (!windowsReplaceError || !fsImpl.existsSync(filePath)) throw error;
  }

  const backup = `${filePath}.bak.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fsImpl.renameSync(filePath, backup);
  try {
    fsImpl.renameSync(temporary, filePath);
    fsImpl.unlinkSync(backup);
  } catch (error) {
    try {
      if (!fsImpl.existsSync(filePath) && fsImpl.existsSync(backup)) fsImpl.renameSync(backup, filePath);
    } catch (restoreError) {
      error.restoreError = restoreError;
    }
    throw error;
  }
}

function ensurePrivateDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function withStoreLock(filePath, operation) {
  ensurePrivateDirectory(filePath);
  const lockPath = `${filePath}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new CandidateStoreLockedError(filePath);
    throw error;
  }
  try {
    return operation();
  } finally {
    try { if (descriptor !== undefined) fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function writeCandidateStoreLocked(filePath, store, options = {}) {
  const current = readCandidateStore(filePath);
  const expected = options.expectedRevision ?? store.revision ?? current.revision;
  if (current.revision !== expected) throw new CandidateStoreRevisionError(expected, current.revision);
  const next = {
    schemaVersion: 1,
    revision: current.revision + 1,
    candidates: Array.isArray(store.candidates) ? store.candidates : [],
  };
  const temporary = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    replaceFileAtomic(temporary, filePath, options);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return next;
}

function writeCandidateStore(filePath, store, options = {}) {
  return withStoreLock(filePath, () => writeCandidateStoreLocked(filePath, store, options));
}

function upsertCandidate(filePath, candidate) {
  return withStoreLock(filePath, () => {
    const store = readCandidateStore(filePath);
    const exactIndex = store.candidates.findIndex((item) =>
      item.candidateId === candidate.candidateId
      || (item.scopeKey === candidate.scopeKey && item.ruleHash && candidate.ruleHash && item.ruleHash === candidate.ruleHash)
    );
    let result;
    if (exactIndex >= 0) {
      const merged = mergeCandidate(store.candidates[exactIndex], candidate);
      store.candidates[exactIndex] = merged;
      result = { candidate: merged, disposition: 'merged' };
    } else {
      const conflicts = candidate.ruleHash
        ? store.candidates.filter((item) => item.scopeKey === candidate.scopeKey && item.ruleHash && item.ruleHash !== candidate.ruleHash)
        : [];
      if (conflicts.length > 0) {
        const conflictIds = conflicts.map((item) => item.candidateId);
        candidate = { ...candidate, reviewRequired: true, conflictsWith: [...new Set([...(candidate.conflictsWith || []), ...conflictIds])] };
        store.candidates = store.candidates.map((item) => {
          if (!conflictIds.includes(item.candidateId)) return item;
          return { ...item, reviewRequired: true, conflictsWith: [...new Set([...(item.conflictsWith || []), candidate.candidateId])] };
        });
        store.candidates.push(candidate);
        result = { candidate, disposition: 'conflict-review' };
      } else {
        store.candidates.push(candidate);
        result = { candidate, disposition: 'inserted' };
      }
    }
    const written = writeCandidateStoreLocked(filePath, store, { expectedRevision: store.revision });
    return { ...result, revision: written.revision };
  });
}

module.exports = {
  CandidateStoreCorruptError,
  CandidateStoreLockedError,
  CandidateStoreRevisionError,
  readCandidateStore,
  replaceFileAtomic,
  upsertCandidate,
  writeCandidateStore,
};
