'use strict';
function benefit(sample, policy) {
  const tokenDelta = sample.baseline.tokens > 0 ? (sample.candidate.tokens - sample.baseline.tokens) / sample.baseline.tokens : 0;
  const latencyDelta = sample.baseline.durationMs > 0 ? (sample.candidate.durationMs - sample.baseline.durationMs) / sample.baseline.durationMs : 0;
  return { token: tokenDelta <= -Number(policy.tokenBenefitThreshold || 0.15), latency: latencyDelta <= -Number(policy.latencyBenefitThreshold || 0.15), additionalPass: Number(sample.candidate.passed) - Number(sample.baseline.passed) };
}
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isBudget(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function evaluateOrthogonality(mechanism, gate = {}) {
  if (gate.enabled === false) return { passed: true, reason: 'gate-disabled' };
  if (!mechanism || typeof mechanism !== 'object' || Array.isArray(mechanism) || Object.keys(mechanism).length === 0) return { passed: false, reason: 'missing-mechanism-declaration' };
  if (!isNonEmptyString(mechanism.id) || (gate.requireUniqueFailureMode !== false && !isNonEmptyString(mechanism.failureModeId))) return { passed: false, reason: 'missing-unique-failure-mode' };
  const overlapsWith = Array.isArray(mechanism.overlapsWith) ? [...new Set(mechanism.overlapsWith.filter(isNonEmptyString))] : null;
  if (overlapsWith === null) return { passed: false, reason: 'missing-overlap-declaration' };
  if (overlapsWith.length > 0) return { passed: false, reason: 'overlapping-mechanism', overlapsWith };
  if (gate.requireBudgets !== false && (!isBudget(mechanism.tokenBudget) || !isBudget(mechanism.latencyBudgetMs))) return { passed: false, reason: 'missing-mechanism-budget' };
  if (!isNonEmptyString(mechanism.verifierId)) return { passed: false, reason: 'missing-mechanism-verifier' };
  if (gate.requireDisableCondition !== false && !isNonEmptyString(mechanism.disableCondition)) return { passed: false, reason: 'missing-disable-condition' };
  if (mechanism.independentlyDisableable !== true) return { passed: false, reason: 'mechanism-not-disableable' };
  return {
    passed: true,
    mechanismId: mechanism.id,
    failureModeId: mechanism.failureModeId,
    tokenBudget: mechanism.tokenBudget,
    latencyBudgetMs: mechanism.latencyBudgetMs,
  };
}
function evaluatePolicyExperiment(experiment, policy = {}) {
  if ((experiment.samples || []).some((sample) => sample.criticalFailure === true)) return { state: 'revoked', reason: 'critical failure' };
  if (experiment.externalWrite === true || experiment.risk === 'high' || experiment.reversible !== true) return { state: 'needs-approval', reason: 'consequential policy' };
  const orthogonality = evaluateOrthogonality(experiment.mechanism, policy.orthogonalityGate || { enabled: false });
  if (!orthogonality.passed) return { state: 'rejected', reason: orthogonality.reason, orthogonality };
  const samples = [...new Map((experiment.samples || []).map((sample) => [sample.sampleId, sample])).values()];
  if (samples.length < Number(policy.minimumDistinctSamples || 3)) return { state: 'insufficient-evidence', sampleCount: samples.length };
  if (new Set(samples.map((sample) => sample.verifierHash)).size !== 1) return { state: 'rejected', reason: 'verifier drift' };
  if (samples.some((sample) => sample.candidate.passed !== true)) return { state: 'rejected', reason: 'quality floor not met' };
  const benefits = samples.map((sample) => benefit(sample, policy));
  const tokenBenefit = benefits.every((item) => item.token);
  const latencyBenefit = benefits.every((item) => item.latency);
  const qualityBenefit = benefits.reduce((sum, item) => sum + item.additionalPass, 0) >= Number(policy.minimumAdditionalPasses || 1);
  if (!tokenBenefit && !latencyBenefit && !qualityBenefit) return { state: 'trial', reason: 'quality holds but measured benefit is absent', orthogonality };
  return { state: 'stable', sampleCount: samples.length, benefit: tokenBenefit ? 'tokens' : latencyBenefit ? 'latency' : 'quality', orthogonality };
}
module.exports = { benefit, evaluateOrthogonality, evaluatePolicyExperiment };
