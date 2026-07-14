'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildV8Review } = require('../scripts/brain-lite-v8-review');
test('review surfaces harness cost, context use, policy state, and revoke candidates', () => {
  const review = buildV8Review([{ taskId: 'task-1', kind: 'recall', contextPrecision: 0.5, contextUtilization: 0.4, harnessTokens: 100, harnessDurationMs: 50 }, { taskId: 'task-1', kind: 'verification', verifierPassed: true, finalDelivered: true }], [{ experimentId: 'exp-1', state: 'trial' }], [{ slug: 'workflow-1', state: 'revoked' }]);
  assert.equal(review.context.averagePrecision, 0.5); assert.equal(review.context.averageUtilization, 0.4);
  assert.equal(review.harness.tokens, 100); assert.equal(review.policies.trial, 1); assert.equal(review.skills.revoked, 1);
  assert.equal(review.attribution.summary.total, 0);
});
