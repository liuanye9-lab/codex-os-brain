'use strict';
const { evaluatePolicyExperiment } = require('./brain-lite-policy-lab');
const { transitionSkill, validateLifecycleEvidence } = require('./brain-lite-skill-lifecycle-v2');

function evaluateBehavioralCandidate(candidate, samples = [], policy = {}) {
  if (!candidate || !candidate.candidateId) throw new Error('candidate is required');
  if (candidate.state === 'needs-synthesis' || !candidate.rule) {
    return { ...candidate, evaluation: { lifecycleDecision: 'reject', lifecycleReason: 'rule-not-synthesized' } };
  }
  if (candidate.reviewRequired === true) {
    return { ...candidate, state: 'needs-approval', evaluation: { lifecycleDecision: 'needs-approval', lifecycleReason: 'conflict-review' } };
  }

  const experimentInput = {
    candidateId: candidate.candidateId,
    samples,
    externalWrite: candidate.risk === 'external-write',
    risk: candidate.risk === 'high' ? 'high' : 'low',
    reversible: candidate.risk === 'read-only',
  };
  const experiment = evaluatePolicyExperiment(experimentInput, policy);
  let updated = { ...candidate, experiment };

  if (experiment.state === 'revoked') {
    updated = transitionSkill(updated, { type: 'critical-failure' }, policy);
    return { ...updated, evaluation: { lifecycleDecision: 'reject', lifecycleReason: experiment.reason } };
  }
  if (experiment.state === 'needs-approval') {
    return { ...updated, state: 'needs-approval', evaluation: { lifecycleDecision: 'needs-approval', lifecycleReason: experiment.reason } };
  }
  if (experiment.state === 'rejected') {
    return { ...updated, state: 'rejected', evaluation: { lifecycleDecision: 'reject', lifecycleReason: experiment.reason } };
  }

  const lifecycle = validateLifecycleEvidence(updated, policy);
  if (experiment.state === 'stable' && lifecycle.decision === 'eligible') {
    return { ...updated, state: 'canary', evaluation: { lifecycleDecision: lifecycle.decision, lifecycleReason: lifecycle.reason } };
  }
  const nextState = lifecycle.reason === 'insufficient-occurrences' ? 'candidate' : 'replay';
  return { ...updated, state: nextState, evaluation: { lifecycleDecision: lifecycle.decision, lifecycleReason: lifecycle.reason } };
}

function approveBehavioralCanary(candidate, passed, policy = {}) {
  if (!candidate || candidate.state !== 'canary') throw new Error('candidate must be in canary state');
  if (passed === true) return transitionSkill(candidate, { type: 'canary-passed' }, policy);
  return transitionSkill(candidate, { type: 'critical-failure' }, policy);
}

module.exports = { approveBehavioralCanary, evaluateBehavioralCandidate };
