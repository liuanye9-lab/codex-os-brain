'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePolicyExperiment } = require('../scripts/brain-lite-policy-lab');
const policy = { minimumDistinctSamples: 3, tokenBenefitThreshold: 0.15, latencyBenefitThreshold: 0.15, minimumAdditionalPasses: 1 };
const sample = (id) => ({ sampleId: id, verifierHash: 'hash-fixed', baseline: { passed: true, tokens: 1000, durationMs: 1000 }, candidate: { passed: true, tokens: 800, durationMs: 1000 }, criticalFailure: false });
test('three distinct paired passes with token benefit become stable', () => {
  assert.equal(evaluatePolicyExperiment({ experimentId: 'exp-1', policyVersion: 'candidate-v1', baselinePolicyVersion: 'brain-lite-router-v2', risk: 'low', reversible: true, externalWrite: false, samples: [sample('sample-0'), sample('sample-1'), sample('sample-2')] }, policy).state, 'stable');
});
test('repeated sample IDs remain insufficient evidence', () => {
  assert.equal(evaluatePolicyExperiment({ experimentId: 'exp-2', policyVersion: 'candidate-v1', baselinePolicyVersion: 'brain-lite-router-v2', risk: 'low', reversible: true, externalWrite: false, samples: [sample('same'), sample('same'), sample('same')] }, policy).state, 'insufficient-evidence');
});
test('critical failure revokes and external writes require approval', () => {
  const critical = { experimentId: 'exp-3', policyVersion: 'candidate-v1', baselinePolicyVersion: 'brain-lite-router-v2', risk: 'low', reversible: true, externalWrite: false, samples: [{ ...sample('sample-critical'), candidate: { passed: false, tokens: 100, durationMs: 100 }, criticalFailure: true }] };
  assert.equal(evaluatePolicyExperiment(critical, policy).state, 'revoked');
  assert.equal(evaluatePolicyExperiment({ ...critical, experimentId: 'exp-4', externalWrite: true, samples: critical.samples.map((item) => ({ ...item, criticalFailure: false })) }, policy).state, 'needs-approval');
});
