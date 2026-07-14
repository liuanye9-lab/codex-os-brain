'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOrthogonality, evaluatePolicyExperiment } = require('../scripts/brain-lite-policy-lab');
const policy = {
  minimumDistinctSamples: 3,
  tokenBenefitThreshold: 0.15,
  latencyBenefitThreshold: 0.15,
  minimumAdditionalPasses: 1,
  orthogonalityGate: {
    enabled: true,
    requireUniqueFailureMode: true,
    requireBudgets: true,
    requireDisableCondition: true,
  },
};
const sample = (id) => ({ sampleId: id, verifierHash: 'hash-fixed', baseline: { passed: true, tokens: 1000, durationMs: 1000 }, candidate: { passed: true, tokens: 800, durationMs: 1000 }, criticalFailure: false });
const mechanism = (overrides = {}) => ({
  id: 'bounded-recall-attribution',
  failureModeId: 'unmeasured-recall-effect',
  overlapsWith: [],
  tokenBudget: 0,
  latencyBudgetMs: 50,
  verifierId: 'trace-outcome-linkage',
  disableCondition: 'five verified samples without quality gain',
  independentlyDisableable: true,
  ...overrides,
});
const experiment = (overrides = {}) => ({
  experimentId: 'exp-1',
  policyVersion: 'candidate-v1',
  baselinePolicyVersion: 'brain-lite-router-v2',
  risk: 'low',
  reversible: true,
  externalWrite: false,
  mechanism: mechanism(),
  samples: [sample('sample-0'), sample('sample-1'), sample('sample-2')],
  ...overrides,
});

test('orthogonality gate rejects missing declarations and overlapping mechanisms', () => {
  assert.deepEqual(evaluateOrthogonality({}, policy.orthogonalityGate), { passed: false, reason: 'missing-mechanism-declaration' });
  assert.deepEqual(evaluateOrthogonality(mechanism({ overlapsWith: ['context-economy'] }), policy.orthogonalityGate), { passed: false, reason: 'overlapping-mechanism', overlapsWith: ['context-economy'] });
});

test('orthogonality gate requires explicit budgets, verifier, disable condition, and off switch', () => {
  assert.equal(evaluateOrthogonality(mechanism({ tokenBudget: null }), policy.orthogonalityGate).reason, 'missing-mechanism-budget');
  assert.equal(evaluateOrthogonality(mechanism({ verifierId: '' }), policy.orthogonalityGate).reason, 'missing-mechanism-verifier');
  assert.equal(evaluateOrthogonality(mechanism({ disableCondition: '' }), policy.orthogonalityGate).reason, 'missing-disable-condition');
  assert.equal(evaluateOrthogonality(mechanism({ independentlyDisableable: false }), policy.orthogonalityGate).reason, 'mechanism-not-disableable');
});

test('three distinct paired passes with token benefit become stable', () => {
  const result = evaluatePolicyExperiment(experiment(), policy);
  assert.equal(result.state, 'stable');
  assert.equal(result.orthogonality.passed, true);
});
test('repeated sample IDs remain insufficient evidence', () => {
  assert.equal(evaluatePolicyExperiment(experiment({ experimentId: 'exp-2', samples: [sample('same'), sample('same'), sample('same')] }), policy).state, 'insufficient-evidence');
});
test('critical failure revokes and external writes require approval', () => {
  const critical = experiment({ experimentId: 'exp-3', samples: [{ ...sample('sample-critical'), candidate: { passed: false, tokens: 100, durationMs: 100 }, criticalFailure: true }] });
  assert.equal(evaluatePolicyExperiment(critical, policy).state, 'revoked');
  assert.equal(evaluatePolicyExperiment({ ...critical, experimentId: 'exp-4', externalWrite: true, samples: critical.samples.map((item) => ({ ...item, criticalFailure: false })) }, policy).state, 'needs-approval');
});

test('policy experiment stops before benefit evaluation when orthogonality fails', () => {
  const result = evaluatePolicyExperiment(experiment({ mechanism: mechanism({ overlapsWith: ['harness-tax'] }) }), policy);
  assert.equal(result.state, 'rejected');
  assert.equal(result.reason, 'overlapping-mechanism');
});
