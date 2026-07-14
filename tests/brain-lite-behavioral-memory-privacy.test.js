'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCandidate, buildPrivacyExport } = require('../scripts/brain-lite-behavioral-privacy-export');

const SALT_A = 'a94f73c10b8d2e65f0974c31da826eb7';
const SALT_B = 'd61e08a4f2c93b75e14790ca3d682bf5';

function privateCandidate() {
  return {
    schemaVersion: 1,
    candidateId: 'bm_20260713_12345_RAW_PID',
    state: 'promoted',
    scopeKey: '/workspace/internal/org/git.delivery',
    rule: 'PRIVATE_RULE_MARKER: do not expose INTERNAL_VALUE_MARKER',
    ruleHash: 'PRIVATE_RULE_HASH_MARKER',
    risk: 'read-only',
    occurrences: 7,
    firstSeenDate: '2026-07-01',
    lastSeenDate: '2026-07-13',
    createdAt: '2026-07-13T12:34:56.789Z',
    sessionRef: 'PRIVATE_SESSION_MARKER',
    evidenceHashes: ['PRIVATE_EVIDENCE_MARKER'],
    triggers: ['explicit_correction'],
    hosts: ['codex'],
    confidenceMax: 0.91,
    reviewRequired: false,
    conflictsWith: ['bm_other_private'],
    replays: [{ passed: true }, { passed: true }, { passed: true }],
    experiment: { state: 'stable', benefit: 'tokens', samples: [{ raw: 'PRIVATE_SAMPLE_MARKER' }] },
  };
}

test('exports a strict text-free whitelist with pseudonymous identifiers', () => {
  const row = sanitizeCandidate(privateCandidate(), SALT_A);
  const serialized = JSON.stringify(row);
  for (const marker of ['PRIVATE_RULE_MARKER', 'INTERNAL_VALUE_MARKER', '/workspace/internal', 'PRIVATE_SESSION_MARKER', 'PRIVATE_EVIDENCE_MARKER', 'PRIVATE_RULE_HASH_MARKER', '12345_RAW_PID', 'PRIVATE_SAMPLE_MARKER']) {
    assert.ok(!serialized.includes(marker), `leaked ${marker}`);
  }
  assert.match(row.ruleRef, /^rule_[a-f0-9]{16}$/);
  assert.match(row.scopeRef, /^scope_[a-f0-9]{16}$/);
  assert.equal(row.firstSeenDate, '2026-07-01');
  assert.equal(row.lastSeenDate, '2026-07-13');
  assert.equal(row.replayCount, 3);
  assert.equal(row.experimentState, 'stable');
});

test('pseudonyms are stable for one salt and unlinkable across salts', () => {
  const a1 = sanitizeCandidate(privateCandidate(), SALT_A);
  const a2 = sanitizeCandidate(privateCandidate(), SALT_A);
  const b = sanitizeCandidate(privateCandidate(), SALT_B);
  assert.equal(a1.ruleRef, a2.ruleRef);
  assert.notEqual(a1.ruleRef, b.ruleRef);
  assert.notEqual(a1.scopeRef, b.scopeRef);
});

test('buildPrivacyExport emits date-level metadata and no candidate text', () => {
  const output = buildPrivacyExport([privateCandidate()], SALT_A, { now: '2026-07-13T23:59:58.123Z' });
  const serialized = JSON.stringify(output);
  assert.equal(output.generatedDate, '2026-07-13');
  assert.equal(output.rows.length, 1);
  assert.ok(!serialized.includes('23:59:58'));
  assert.ok(!serialized.includes('PRIVATE_RULE_MARKER'));
  assert.ok(!serialized.includes('INTERNAL_VALUE_MARKER'));
});

test('requires an explicit export salt rather than using a global identity', () => {
  assert.throws(() => sanitizeCandidate(privateCandidate(), ''), /salt/i);
  assert.throws(() => buildPrivacyExport([], 'short'), /salt/i);
  assert.throws(() => buildPrivacyExport([], 'a'.repeat(64)), /strong|random/i);
  assert.throws(() => buildPrivacyExport([], 'participant-specific-salt-123456789'), /strong|random/i);
});

test('recursive private fields cannot cross the export whitelist', () => {
  const source = privateCandidate();
  source.nested = {
    rawPrompt: 'RECURSIVE_PRIVATE_MARKER',
    children: [{ correctionText: 'NESTED_CORRECTION_MARKER' }],
  };
  source.experiment.samples[0].nested = { path: 'INTERNAL_PATH_MARKER' };
  const serialized = JSON.stringify(buildPrivacyExport([source], SALT_A));
  for (const marker of ['RECURSIVE_PRIVATE_MARKER', 'NESTED_CORRECTION_MARKER', 'INTERNAL_PATH_MARKER']) {
    assert.ok(!serialized.includes(marker), `leaked ${marker}`);
  }
});
