'use strict';
const crypto = require('node:crypto');

function requireSalt(salt) {
  if (typeof salt !== 'string' || salt.length < 16) throw new Error('export salt must contain at least 16 characters');
  return salt;
}

function pseudonym(prefix, value, salt) {
  return `${prefix}_${crypto.createHmac('sha256', requireSalt(salt)).update(String(value || 'unknown')).digest('hex').slice(0, 16)}`;
}

function confidenceBucket(value) {
  const score = Number(value || 0);
  if (score >= 0.9) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

function sanitizeCandidate(candidate = {}, salt) {
  requireSalt(salt);
  return {
    schemaVersion: 1,
    ruleRef: pseudonym('rule', candidate.candidateId || candidate.ruleHash || 'unknown', salt),
    scopeRef: pseudonym('scope', candidate.scopeKey || 'general', salt),
    state: String(candidate.state || 'unknown'),
    risk: String(candidate.risk || 'unknown'),
    occurrences: Math.max(0, Number(candidate.occurrences || 0)),
    firstSeenDate: typeof candidate.firstSeenDate === 'string' ? candidate.firstSeenDate.slice(0, 10) : null,
    lastSeenDate: typeof candidate.lastSeenDate === 'string' ? candidate.lastSeenDate.slice(0, 10) : null,
    triggerClasses: Array.isArray(candidate.triggers) ? [...new Set(candidate.triggers.map(String))].sort() : [],
    hostClasses: Array.isArray(candidate.hosts) ? [...new Set(candidate.hosts.map(String))].sort() : [],
    confidenceBucket: confidenceBucket(candidate.confidenceMax),
    reviewRequired: candidate.reviewRequired === true,
    conflictCount: Array.isArray(candidate.conflictsWith) ? candidate.conflictsWith.length : 0,
    replayCount: Array.isArray(candidate.replays) ? candidate.replays.length : 0,
    replayPassCount: Array.isArray(candidate.replays) ? candidate.replays.filter((item) => item?.passed === true).length : 0,
    experimentState: candidate.experiment?.state || null,
    experimentBenefit: candidate.experiment?.benefit || null,
  };
}

function buildPrivacyExport(candidates = [], salt, options = {}) {
  requireSalt(salt);
  const now = new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('invalid export date');
  return {
    schemaVersion: 1,
    generatedDate: now.toISOString().slice(0, 10),
    rowCount: candidates.length,
    rows: candidates.map((candidate) => sanitizeCandidate(candidate, salt)),
  };
}

module.exports = { buildPrivacyExport, confidenceBucket, pseudonym, sanitizeCandidate };
