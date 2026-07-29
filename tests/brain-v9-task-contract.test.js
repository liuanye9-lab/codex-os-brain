'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskContract, applyContractPatch } = require('../scripts/v9/task-contract');

test('explicit constraints retain provenance and reject inferred overwrite', () => {
  const contract = createTaskContract({ taskId: 'task_2', objective: 'publish', constraints: [
    { id: 'privacy', text: 'public export must be sanitized', source: 'user', explicit: true },
  ] });
  assert.throws(() => applyContractPatch(contract, {
    constraints: [{ id: 'privacy', text: 'skip scan', source: 'inference', explicit: false }],
  }), /explicit_constraint_conflict/);
  assert.equal(contract.constraints[0].source, 'user');
});

test('contract patch advances compaction generation without mutating input', () => {
  const contract = createTaskContract({ taskId: 'task_3', objective: 'recover' });
  const next = applyContractPatch(contract, { compacted: true, unresolved: ['verify tests'] });
  assert.equal(next.compactionGeneration, 1);
  assert.equal(contract.compactionGeneration, 0);
  assert.deepEqual(next.unresolved, ['verify tests']);
});

test('repeated objectives get unique task instances and a stable analysis fingerprint', () => {
  const first = createTaskContract({ objective: 'repeatable objective', scope: { allowed: ['src'], forbidden: [] } });
  const second = createTaskContract({ objective: 'repeatable objective', scope: { allowed: ['src'], forbidden: [] } });
  assert.notEqual(first.taskId, second.taskId);
  assert.equal(first.taskFingerprint, second.taskFingerprint);
  assert.match(first.taskFingerprint, /^[a-f0-9]{64}$/);
});
