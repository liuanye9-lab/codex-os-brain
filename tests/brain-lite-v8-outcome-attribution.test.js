'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { attributeOutcomes } = require('../scripts/brain-lite-outcome-attribution');
const { skillId } = require('../scripts/brain-lite-trace-v2');

const evidenceId = 'ev_aaaaaaaaaaaaaaaaaaaa';
const recalledSkillId = skillId('codex-brain-recall');
const policy = {
  minimumDistinctTasks: 5,
  minimumVerifierCoverage: 0.8,
  qualityFloor: 0.8,
  correctionRateCeiling: 0.2,
  automaticLifecycleChanges: false,
};

function trace(taskNumber, overrides = {}) {
  const taskId = `task-${taskNumber}`;
  const traceId = `trace-${taskNumber}`;
  return [
    { traceId, taskId, kind: 'recall', evidenceIds: [evidenceId] },
    { traceId, taskId, kind: 'skill_lifecycle', skillIds: [recalledSkillId] },
    { traceId, taskId, kind: 'verification', verifierPassed: true, modelClaimedSuccess: true, finalDelivered: true, ...overrides },
  ];
}

test('attribution stays insufficient until five distinct tasks exist', () => {
  const result = attributeOutcomes([...trace(1), ...trace(2), ...trace(3), ...trace(4)], policy);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.decision === 'insufficient-evidence'));
  assert.ok(result.items.every((item) => item.automaticLifecycleChange === false));
});

test('verified activations without adverse evidence are retained, not called beneficial', () => {
  const result = attributeOutcomes(Array.from({ length: 5 }, (_, index) => trace(index + 1)).flat(), policy);
  const evidence = result.items.find((item) => item.subjectType === 'evidence');
  assert.equal(evidence.distinctTasks, 5);
  assert.equal(evidence.verifierCoverage, 1);
  assert.equal(evidence.passRate, 1);
  assert.equal(evidence.decision, 'retain');
  assert.equal(result.summary.retain, 2);
});

test('failed verification, false-green, or excessive corrections create review candidates only', () => {
  const events = [
    ...trace(1),
    ...trace(2),
    ...trace(3),
    ...trace(4, { verifierPassed: false, finalDelivered: false }),
    ...trace(5, { verifierPassed: false, finalDelivered: false, userCorrected: true }),
  ];
  const result = attributeOutcomes(events, policy);
  const skill = result.items.find((item) => item.subjectType === 'skill');
  assert.equal(skill.passRate, 0.6);
  assert.equal(skill.correctedTasks, 1);
  assert.equal(skill.falseGreenTasks, 2);
  assert.equal(skill.decision, 'review-candidate');
  assert.equal(skill.automaticLifecycleChange, false);
});

test('insufficient verifier coverage blocks lifecycle judgment', () => {
  const events = Array.from({ length: 5 }, (_, index) => {
    const rows = trace(index + 1);
    if (index >= 3) delete rows[2].verifierPassed;
    return rows;
  }).flat();
  const result = attributeOutcomes(events, policy);
  assert.ok(result.items.every((item) => item.decision === 'insufficient-verification'));
});
