'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskContract } = require('../scripts/v9/task-contract');
const { attachEvidence, evaluateCompletion } = require('../scripts/v9/verification');

test('completion requires evidence for every required criterion', () => {
  const contract = createTaskContract({ taskId: 'task_1', objective: 'change feature', criteria: [
    { id: 'tests', required: true, verifier: 'command' },
    { id: 'scope', required: true, verifier: 'scope' },
  ] });
  const one = attachEvidence(contract, 'tests', { id: 'ev_a', status: 'passed', provenance: { kind: 'command', ref: 'npm-test' } });
  assert.deepEqual(evaluateCompletion(one), { status: 'partial', missing: ['scope'], failed: [], unverified: [] });
});

test('failed evidence prevents completion and unknown criteria are rejected', () => {
  const contract = createTaskContract({ taskId: 'task_4', objective: 'verify', criteria: [{ id: 'tests', required: true }] });
  assert.throws(() => attachEvidence(contract, 'unknown', { id: 'ev_x', status: 'passed', provenance: {} }), /criterion_not_found/);
  const failed = attachEvidence(contract, 'tests', { id: 'ev_f', status: 'failed', provenance: { kind: 'command', ref: 'test' } });
  assert.deepEqual(evaluateCompletion(failed).failed, ['tests']);
});
