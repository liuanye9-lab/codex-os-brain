'use strict';
const { contentHash } = require('./brain-lite-common');

function normalizeRule(rule) {
  return String(rule || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function dateOnly(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function createCandidate(input = {}) {
  const event = input.event || {};
  const detection = input.detection || {};
  if (detection.matched !== true) throw new Error('correction detection must be matched');
  const scopeKey = String(input.scopeKey || event.taskFamily || 'general').trim() || 'general';
  const rule = normalizeRule(input.proposedRule);
  const evidenceHash = contentHash(`${event.host || 'generic'}\0${String(event.text || '')}`);
  const ruleHash = rule ? contentHash(rule.toLowerCase()) : null;
  const candidateIdentity = ruleHash || contentHash(`${scopeKey}\0${evidenceHash}`);
  const seenDate = dateOnly(input.now || event.timestamp);
  return {
    schemaVersion: 1,
    candidateId: `bm_${candidateIdentity.slice(0, 20)}`,
    state: rule ? 'candidate' : 'needs-synthesis',
    scopeKey,
    rule: rule || null,
    ruleHash,
    risk: ['read-only', 'external-write', 'high'].includes(input.risk) ? input.risk : 'read-only',
    occurrences: 1,
    firstSeenDate: seenDate,
    lastSeenDate: seenDate,
    evidenceHashes: [evidenceHash],
    triggers: unique([detection.trigger]),
    hosts: unique([event.host || 'generic']),
    confidenceMax: Number(detection.confidence || 0),
    reviewRequired: false,
    conflictsWith: [],
    replays: [],
    experiment: null,
  };
}

function mergeCandidate(existing, incoming) {
  if (!existing || !incoming) throw new Error('both candidates are required');
  const sameRule = existing.ruleHash && incoming.ruleHash && existing.ruleHash === incoming.ruleHash;
  const sameCandidate = existing.candidateId === incoming.candidateId;
  if (!sameRule && !sameCandidate) throw new Error('cannot merge unrelated candidates');
  const evidenceHashes = unique([...(existing.evidenceHashes || []), ...(incoming.evidenceHashes || [])]);
  const addedEvidence = evidenceHashes.length - unique(existing.evidenceHashes || []).length;
  return {
    ...existing,
    state: existing.state === 'needs-synthesis' && incoming.rule ? 'candidate' : existing.state,
    rule: existing.rule || incoming.rule || null,
    ruleHash: existing.ruleHash || incoming.ruleHash || null,
    occurrences: Number(existing.occurrences || 0) + Math.max(0, addedEvidence),
    firstSeenDate: [existing.firstSeenDate, incoming.firstSeenDate].filter(Boolean).sort()[0] || null,
    lastSeenDate: [existing.lastSeenDate, incoming.lastSeenDate].filter(Boolean).sort().at(-1) || null,
    evidenceHashes,
    triggers: unique([...(existing.triggers || []), ...(incoming.triggers || [])]),
    hosts: unique([...(existing.hosts || []), ...(incoming.hosts || [])]),
    confidenceMax: Math.max(Number(existing.confidenceMax || 0), Number(incoming.confidenceMax || 0)),
  };
}

module.exports = { createCandidate, mergeCandidate, normalizeRule };
