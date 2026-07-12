'use strict';
function benefit(sample, policy) {
  const tokenDelta = sample.baseline.tokens > 0 ? (sample.candidate.tokens - sample.baseline.tokens) / sample.baseline.tokens : 0;
  const latencyDelta = sample.baseline.durationMs > 0 ? (sample.candidate.durationMs - sample.baseline.durationMs) / sample.baseline.durationMs : 0;
  return { token: tokenDelta <= -Number(policy.tokenBenefitThreshold || 0.15), latency: latencyDelta <= -Number(policy.latencyBenefitThreshold || 0.15), additionalPass: Number(sample.candidate.passed) - Number(sample.baseline.passed) };
}
function evaluatePolicyExperiment(experiment, policy = {}) {
  if ((experiment.samples || []).some((sample) => sample.criticalFailure === true)) return { state: 'revoked', reason: 'critical failure' };
  if (experiment.externalWrite === true || experiment.risk === 'high' || experiment.reversible !== true) return { state: 'needs-approval', reason: 'consequential policy' };
  const samples = [...new Map((experiment.samples || []).map((sample) => [sample.sampleId, sample])).values()];
  if (samples.length < Number(policy.minimumDistinctSamples || 3)) return { state: 'insufficient-evidence', sampleCount: samples.length };
  if (new Set(samples.map((sample) => sample.verifierHash)).size !== 1) return { state: 'rejected', reason: 'verifier drift' };
  if (samples.some((sample) => sample.candidate.passed !== true)) return { state: 'rejected', reason: 'quality floor not met' };
  const benefits = samples.map((sample) => benefit(sample, policy));
  const tokenBenefit = benefits.every((item) => item.token);
  const latencyBenefit = benefits.every((item) => item.latency);
  const qualityBenefit = benefits.reduce((sum, item) => sum + item.additionalPass, 0) >= Number(policy.minimumAdditionalPasses || 1);
  if (!tokenBenefit && !latencyBenefit && !qualityBenefit) return { state: 'trial', reason: 'quality holds but measured benefit is absent' };
  return { state: 'stable', sampleCount: samples.length, benefit: tokenBenefit ? 'tokens' : latencyBenefit ? 'latency' : 'quality' };
}
module.exports = { benefit, evaluatePolicyExperiment };
