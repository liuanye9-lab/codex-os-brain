'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { transitionSkill, validateLifecycleEvidence } = require('../scripts/brain-lite-skill-lifecycle-v2');
const policy = { minimumOccurrences: 3, minimumPassingReplays: 3, criticalFailureRevokes: true };
test('read-only skill advances through shadow, replay, canary, and promoted', () => {
  let candidate = { slug: 'safe-workflow', state: 'candidate', risk: 'read-only', occurrences: 3, replays: [], experiment: { state: 'stable' } };
  candidate = transitionSkill(candidate, { type: 'shadow-complete' }, policy); assert.equal(candidate.state, 'shadow');
  candidate = transitionSkill(candidate, { type: 'replay-complete', replays: [{ passed: true }, { passed: true }, { passed: true }] }, policy); assert.equal(candidate.state, 'replay');
  candidate = transitionSkill(candidate, { type: 'canary-approved' }, policy); assert.equal(candidate.state, 'canary');
  candidate = transitionSkill(candidate, { type: 'canary-passed' }, policy); assert.equal(candidate.state, 'promoted');
});
test('critical failure immediately revokes a promoted skill', () => {
  const candidate = transitionSkill({ slug: 'safe-workflow', state: 'promoted', risk: 'read-only', occurrences: 3, replays: [{ passed: true }, { passed: true }, { passed: true }], experiment: { state: 'stable' } }, { type: 'critical-failure' }, policy);
  assert.equal(candidate.state, 'revoked');
});
test('external-write skill never auto-promotes', () => {
  const decision = validateLifecycleEvidence({ slug: 'publish-workflow', state: 'canary', risk: 'external-write', occurrences: 3, replays: [{ passed: true }, { passed: true }, { passed: true }], experiment: { state: 'stable' } }, policy);
  assert.equal(decision.decision, 'needs-approval');
});
