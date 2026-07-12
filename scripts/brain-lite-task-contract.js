'use strict';

const crypto = require('node:crypto');

const REQUESTED_EVIDENCE = [
  'observable symptom',
  'failing verification',
  'file scope',
  'relevant context',
];

function stableTaskId(features) {
  if (features.taskId) return String(features.taskId);
  return 'task_' + crypto.createHash('sha256')
    .update(JSON.stringify(features))
    .digest('hex')
    .slice(0, 16);
}

function buildTaskContract(features = {}, policy = {}) {
  const enabled = policy.enabled !== false;
  const signals = policy.clarificationSignals || [];
  const hasSignal = signals.some((name) => features[name] === true);
  const vagueWithoutEvidence = features.promptClarity === 'vague' && !hasSignal;
  const externalWrite = features.externalWrite === true;
  const requiresApproval = externalWrite || features.risk === 'high';
  const historical = features.historicalContinuity === true && features.hasRelevantContext === true;
  const dispatchEligible = enabled
    && !vagueWithoutEvidence
    && !requiresApproval
    && features.independent === true
    && features.verifiable === true
    && features.measuredAdvantage === true;

  let action = 'mother-direct';
  if (!enabled) action = 'mother-direct';
  else if (vagueWithoutEvidence) action = 'mother-clarify';
  else if (historical) action = 'recall-then-direct';
  else if (dispatchEligible) action = 'delegate-candidate';

  return {
    schemaVersion: 1,
    taskId: stableTaskId(features),
    taskFamily: String(features.taskFamily || 'general'),
    action,
    risk: ['low', 'medium', 'high'].includes(features.risk) ? features.risk : 'low',
    verifiable: features.verifiable === true,
    independent: features.independent === true,
    dispatchEligible,
    requiresApproval,
    externalWrite,
    parallelLanes: Math.max(0, Number(features.parallelLanes || 0)),
    contextBudget: historical ? Math.min(900, Number(features.contextBudget || 900)) : 0,
    requestedEvidence: vagueWithoutEvidence ? REQUESTED_EVIDENCE : [],
  };
}

module.exports = { buildTaskContract, stableTaskId };
