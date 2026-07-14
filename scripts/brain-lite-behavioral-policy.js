'use strict';
const { contentHash } = require('./brain-lite-common');
const { evaluatePolicyExperiment } = require('./brain-lite-policy-lab');
const { transitionSkill, validateLifecycleEvidence } = require('./brain-lite-skill-lifecycle-v2');

function replayEvidence(samples = []) {
  const replayByRef = new Map();
  for (const sample of samples) {
    if (!sample || sample.sampleId === undefined) continue;
    const sampleRef = `sample_${contentHash(String(sample.sampleId)).slice(0, 16)}`;
    replayByRef.set(sampleRef, {
      sampleRef,
      verifierRef: `verifier_${contentHash(String(sample.verifierHash || 'unknown')).slice(0, 16)}`,
      passed: sample.candidate?.passed === true && sample.criticalFailure !== true,
    });
  }
  return [...replayByRef.values()];
}

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
    mechanism: {
      id: 'behavioral-memory',
      failureModeId: 'repeated-correction-not-retained',
      overlapsWith: [],
      tokenBudget: Number(policy.contextTokenBudget || 300),
      latencyBudgetMs: Number(policy.latencyBudgetMs || 0),
      verifierId: 'paired-fixed-verifier',
      disableCondition: 'critical failure or repeated verified no-benefit samples',
      independentlyDisableable: true,
    },
    samples,
    externalWrite: candidate.risk === 'external-write',
    risk: candidate.risk === 'high' ? 'high' : 'low',
    reversible: candidate.risk === 'read-only',
  };
  const experiment = evaluatePolicyExperiment(experimentInput, policy);
  const replays = samples.length > 0 ? replayEvidence(samples) : (candidate.replays || []);
  let updated = { ...candidate, experiment, replays };

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
  if (candidate.risk !== 'read-only') throw new Error('consequential candidates cannot be promoted by behavioral canary approval');
  if (passed === true) return transitionSkill(candidate, { type: 'canary-passed' }, policy);
  return transitionSkill(candidate, { type: 'critical-failure' }, policy);
}

module.exports = { approveBehavioralCanary, evaluateBehavioralCandidate, replayEvidence };
