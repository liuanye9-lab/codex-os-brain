'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTaskContract } = require('../scripts/brain-lite-task-contract');

const policy = {
  enabled: true,
  clarificationSignals: [
    'hasObservableSignal',
    'hasFailingVerification',
    'hasFileScope',
    'hasRelevantContext',
  ],
};

test('ordinary clear work stays mother-direct', () => {
  const contract = buildTaskContract({
    taskId: 'direct-1', taskFamily: 'bounded-coding', promptClarity: 'clear',
    risk: 'low', verifiable: true, independent: false,
  }, policy);
  assert.equal(contract.action, 'mother-direct');
  assert.equal(contract.dispatchEligible, false);
});

test('vague work without evidence requires clarification', () => {
  const contract = buildTaskContract({ taskId: 'vague-1', promptClarity: 'vague' }, policy);
  assert.equal(contract.action, 'mother-clarify');
  assert.deepEqual(contract.requestedEvidence, [
    'observable symptom', 'failing verification', 'file scope', 'relevant context',
  ]);
});

test('historical continuity requests bounded recall before direct work', () => {
  const contract = buildTaskContract({
    taskId: 'recall-1', promptClarity: 'clear', hasRelevantContext: true,
    historicalContinuity: true, verifiable: true,
  }, policy);
  assert.equal(contract.action, 'recall-then-direct');
  assert.equal(contract.contextBudget, 900);
});

test('only independent verifiable work with measured advantage becomes a delegate candidate', () => {
  const contract = buildTaskContract({
    taskId: 'delegate-1', taskFamily: 'batch-analysis', promptClarity: 'clear',
    risk: 'low', verifiable: true, independent: true, measuredAdvantage: true, parallelLanes: 2,
  }, policy);
  assert.equal(contract.action, 'delegate-candidate');
  assert.equal(contract.dispatchEligible, true);
});

test('external writes never become automatic delegate candidates', () => {
  const contract = buildTaskContract({
    taskId: 'write-1', promptClarity: 'clear', risk: 'high', verifiable: true,
    independent: true, measuredAdvantage: true, externalWrite: true,
  }, policy);
  assert.equal(contract.action, 'mother-direct');
  assert.equal(contract.requiresApproval, true);
});
