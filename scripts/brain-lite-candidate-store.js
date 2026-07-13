'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mergeCandidate } = require('./brain-lite-behavioral-memory');

function readCandidateStore(filePath) {
  if (!fs.existsSync(filePath)) return { schemaVersion: 1, candidates: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    schemaVersion: 1,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
  };
}

function writeCandidateStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(filePath), 0o700); } catch {}
  const temporary = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function upsertCandidate(filePath, candidate) {
  const store = readCandidateStore(filePath);
  const exactIndex = store.candidates.findIndex((item) =>
    item.candidateId === candidate.candidateId ||
    (item.scopeKey === candidate.scopeKey && item.ruleHash && candidate.ruleHash && item.ruleHash === candidate.ruleHash)
  );
  if (exactIndex >= 0) {
    const merged = mergeCandidate(store.candidates[exactIndex], candidate);
    store.candidates[exactIndex] = merged;
    writeCandidateStore(filePath, store);
    return { candidate: merged, disposition: 'merged' };
  }

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
    writeCandidateStore(filePath, store);
    return { candidate, disposition: 'conflict-review' };
  }

  store.candidates.push(candidate);
  writeCandidateStore(filePath, store);
  return { candidate, disposition: 'inserted' };
}

module.exports = { readCandidateStore, upsertCandidate, writeCandidateStore };
