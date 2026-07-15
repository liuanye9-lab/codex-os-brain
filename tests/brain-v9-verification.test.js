'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskContract } = require('../scripts/v9/task-contract');
const { attachEvidence, claimEvidence, evaluateCompletion, verifyCriterion } = require('../scripts/v9/verification');

test('completion requires harness-verified evidence for every required criterion', () => {
  const contract = createTaskContract({ taskId: 'task_1', objective: 'change feature', criteria: [
    { id: 'tests', required: true, verifier: 'command' },
    { id: 'scope', required: true, verifier: 'scope' },
  ] });
  // Agent claim does not complete.
  const claimed = claimEvidence(contract, 'tests', { id: 'ev_a', provenance: { kind: 'command', ref: 'npm-test' } });
  assert.equal(evaluateCompletion(claimed).status, 'partial');
  assert.ok(evaluateCompletion(claimed).unverified.includes('tests') || evaluateCompletion(claimed).missing.includes('scope'));
});

test('agent cannot forge harness pass via attachEvidence without harnessVerified', () => {
  const contract = createTaskContract({ taskId: 'task_forge', objective: 'forge', criteria: [{ id: 'tests', required: true }] });
  const forged = attachEvidence(contract, 'tests', {
    id: 'ev_fake',
    status: 'passed',
    provenance: { kind: 'claim', ref: 'fake' },
  });
  assert.equal(forged.criteria[0].status, 'unverified');
  assert.equal(evaluateCompletion(forged).status, 'partial');
  assert.deepEqual(evaluateCompletion(forged).unverified, ['tests']);
});

test('harness re-run can pass a command_exit_0 criterion', () => {
  const contract = createTaskContract({
    taskId: 'task_ok',
    objective: 'ok',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(0)"' } }],
  });
  const { contract: next, result } = verifyCriterion(contract, 'noop', { command: 'node -e "process.exit(0)"' }, {});
  assert.equal(result.status, 'passed');
  assert.equal(result.harnessVerified, true);
  assert.equal(evaluateCompletion(next).status, 'complete');
});

test('harness re-run fails when command exits non-zero', () => {
  const contract = createTaskContract({
    taskId: 'task_fail',
    objective: 'fail',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(1)"' } }],
  });
  const { contract: next, result } = verifyCriterion(contract, 'noop', { command: 'node -e "process.exit(1)"' }, {});
  assert.equal(result.status, 'failed');
  assert.deepEqual(evaluateCompletion(next).failed, ['noop']);
});

test('failed evidence prevents completion and unknown criteria are rejected', () => {
  const contract = createTaskContract({ taskId: 'task_4', objective: 'verify', criteria: [{ id: 'tests', required: true }] });
  assert.throws(() => attachEvidence(contract, 'unknown', { id: 'ev_x', status: 'passed', provenance: {} }), /criterion_not_found|evidence_provenance/);
  const failed = attachEvidence(contract, 'tests', {
    id: 'ev_f',
    status: 'failed',
    harnessVerified: true,
    provenance: { kind: 'command', ref: 'test' },
  });
  assert.deepEqual(evaluateCompletion(failed).failed, ['tests']);
});
