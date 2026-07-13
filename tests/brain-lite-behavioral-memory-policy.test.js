'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBehavioralCandidate, approveBehavioralCanary } = require('../scripts/brain-lite-behavioral-policy');
const { buildBehavioralContextPacket } = require('../scripts/brain-lite-behavioral-context');

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateId: 'bm_aaaaaaaaaaaaaaaaaaaa',
    state: 'candidate',
    scopeKey: 'verification.delivery',
    rule: 'Run independent verification before claiming completion.',
    ruleHash: 'hash',
    risk: 'read-only',
    occurrences: 3,
    evidenceHashes: ['a', 'b', 'c'],
    triggers: ['explicit_correction'],
    hosts: ['codex'],
    confidenceMax: 0.85,
    reviewRequired: false,
    conflictsWith: [],
    replays: [{ passed: true }, { passed: true }, { passed: true }],
    experiment: null,
    ...overrides,
  };
}

function sample(id, overrides = {}) {
  return {
    sampleId: id,
    verifierHash: 'verifier-v1',
    baseline: { passed: true, tokens: 1000, durationMs: 1000 },
    candidate: { passed: true, tokens: 800, durationMs: 900 },
    ...overrides,
  };
}

const policy = {
  minimumOccurrences: 3,
  minimumPassingReplays: 3,
  minimumDistinctSamples: 3,
  tokenBenefitThreshold: 0.15,
  latencyBenefitThreshold: 0.15,
  minimumAdditionalPasses: 1,
  criticalFailureRevokes: true,
};

test('does not advance a candidate with insufficient repeated corrections', () => {
  const result = evaluateBehavioralCandidate(candidate({ occurrences: 2 }), [sample('1'), sample('2'), sample('3')], policy);
  assert.equal(result.state, 'candidate');
  assert.equal(result.evaluation.lifecycleDecision, 'reject');
  assert.equal(result.evaluation.lifecycleReason, 'insufficient-occurrences');
});

test('rejects verifier drift rather than treating mixed graders as evidence', () => {
  const samples = [sample('1'), sample('2', { verifierHash: 'verifier-v2' }), sample('3')];
  const result = evaluateBehavioralCandidate(candidate(), samples, policy);
  assert.equal(result.state, 'rejected');
  assert.equal(result.experiment.state, 'rejected');
  assert.equal(result.experiment.reason, 'verifier drift');
});

test('rejects a candidate when any paired run falls below the quality floor', () => {
  const samples = [sample('1'), sample('2', { candidate: { passed: false, tokens: 700, durationMs: 700 } }), sample('3')];
  const result = evaluateBehavioralCandidate(candidate(), samples, policy);
  assert.equal(result.state, 'rejected');
  assert.equal(result.experiment.reason, 'quality floor not met');
});

test('advances a repeated rule with passing replays and stable paired benefit to canary', () => {
  const result = evaluateBehavioralCandidate(candidate(), [sample('1'), sample('2'), sample('3')], policy);
  assert.equal(result.experiment.state, 'stable');
  assert.equal(result.experiment.benefit, 'tokens');
  assert.equal(result.evaluation.lifecycleDecision, 'eligible');
  assert.equal(result.state, 'canary');
});

test('requires explicit canary result before promotion and revokes a critical failure', () => {
  const canary = evaluateBehavioralCandidate(candidate(), [sample('1'), sample('2'), sample('3')], policy);
  assert.equal(approveBehavioralCanary(canary, true, policy).state, 'promoted');
  assert.equal(approveBehavioralCanary(canary, false, policy).state, 'revoked');
});

test('recalls only promoted, conflict-free rules through a bounded context packet', () => {
  const candidates = [
    candidate({ candidateId: 'bm_1', state: 'promoted', occurrences: 5, rule: 'Run verifier A before delivery.' }),
    candidate({ candidateId: 'bm_2', state: 'promoted', occurrences: 4, rule: 'Report the exact failing command.' }),
    candidate({ candidateId: 'bm_3', state: 'candidate', occurrences: 9, rule: 'Unproven candidate must not appear.' }),
    candidate({ candidateId: 'bm_4', state: 'promoted', reviewRequired: true, rule: 'Conflicted rule must not appear.' }),
  ];
  const packet = buildBehavioralContextPacket(candidates);
  assert.equal(packet.tokenBudget, 300);
  assert.equal(packet.injected.length, 2);
  assert.ok(packet.injected.every((item) => !item.content.includes('Unproven')));
  assert.ok(packet.injected.every((item) => !item.content.includes('Conflicted')));
  assert.ok(packet.estimatedTokens <= 300);
});

test('external-write behavioral rules require approval and never auto-enter canary', () => {
  const result = evaluateBehavioralCandidate(candidate({ risk: 'external-write' }), [sample('1'), sample('2'), sample('3')], policy);
  assert.equal(result.state, 'needs-approval');
  assert.equal(result.experiment.state, 'needs-approval');
});
