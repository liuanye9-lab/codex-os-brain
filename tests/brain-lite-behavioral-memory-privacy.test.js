'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCandidate, buildPrivacyExport } = require('../scripts/brain-lite-behavioral-privacy-export');

function secretCandidate() {
  return {
    schemaVersion: 1,
    candidateId: 'bm_20260713_12345_SECRET_PID',
    state: 'promoted',
    scopeKey: '/Users/lay/private/company/git.delivery',
    rule: 'SECRET RULE: never expose customer Acme password=topsecret',
    ruleHash: 'SECRET_RULE_HASH',
    risk: 'read-only',
    occurrences: 7,
    firstSeenDate: '2026-07-01',
    lastSeenDate: '2026-07-13',
    createdAt: '2026-07-13T12:34:56.789Z',
    sessionRef: 'SECRET_SESSION_ID',
    evidenceHashes: ['SECRET_EVIDENCE_HASH'],
    triggers: ['explicit_correction'],
    hosts: ['codex'],
    confidenceMax: 0.91,
    reviewRequired: false,
    conflictsWith: ['bm_other_secret'],
    replays: [{ passed: true }, { passed: true }, { passed: true }],
    experiment: { state: 'stable', benefit: 'tokens', samples: [{ raw: 'SECRET_SAMPLE' }] },
  };
}

test('exports a strict text-free whitelist with pseudonymous identifiers', () => {
  const row = sanitizeCandidate(secretCandidate(), 'participant-specific-salt-123');
  const serialized = JSON.stringify(row);
  for (const secret of ['SECRET RULE', 'Acme', 'topsecret', '/Users/lay', 'SECRET_SESSION_ID', 'SECRET_EVIDENCE_HASH', 'SECRET_RULE_HASH', '12345_SECRET_PID', 'SECRET_SAMPLE']) {
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
  }
  assert.match(row.ruleRef, /^rule_[a-f0-9]{16}$/);
  assert.match(row.scopeRef, /^scope_[a-f0-9]{16}$/);
  assert.equal(row.firstSeenDate, '2026-07-01');
  assert.equal(row.lastSeenDate, '2026-07-13');
  assert.equal(row.replayCount, 3);
  assert.equal(row.experimentState, 'stable');
});

test('pseudonyms are stable for one salt and unlinkable across salts', () => {
  const a1 = sanitizeCandidate(secretCandidate(), 'salt-aaaaaaaaaaaaaaaa');
  const a2 = sanitizeCandidate(secretCandidate(), 'salt-aaaaaaaaaaaaaaaa');
  const b = sanitizeCandidate(secretCandidate(), 'salt-bbbbbbbbbbbbbbbb');
  assert.equal(a1.ruleRef, a2.ruleRef);
  assert.notEqual(a1.ruleRef, b.ruleRef);
  assert.notEqual(a1.scopeRef, b.scopeRef);
});

test('buildPrivacyExport emits date-level metadata and no candidate text', () => {
  const output = buildPrivacyExport([secretCandidate()], 'participant-specific-salt-123', { now: '2026-07-13T23:59:58.123Z' });
  const serialized = JSON.stringify(output);
  assert.equal(output.generatedDate, '2026-07-13');
  assert.equal(output.rows.length, 1);
  assert.ok(!serialized.includes('23:59:58'));
  assert.ok(!serialized.includes('SECRET'));
  assert.ok(!serialized.includes('password'));
});

test('requires an explicit export salt rather than using a global identity', () => {
  assert.throws(() => sanitizeCandidate(secretCandidate(), ''), /salt/i);
  assert.throws(() => buildPrivacyExport([], 'short'), /salt/i);
});
