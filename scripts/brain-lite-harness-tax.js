'use strict';
function ratio(delta, baseline) { return baseline > 0 ? Number((delta / baseline).toFixed(6)) : null; }
function computeHarnessTax(sample, thresholds = {}) {
  const { baseline, candidate, harness } = sample;
  const qualityDelta = Number(candidate.passed) - Number(baseline.passed);
  const tokenDeltaRatio = ratio(candidate.tokens - baseline.tokens, baseline.tokens);
  const latencyDeltaRatio = ratio(candidate.durationMs - baseline.durationMs, baseline.durationMs);
  const overheadTokenRatio = ratio(harness.tokens, candidate.tokens);
  const overheadLatencyRatio = ratio(harness.durationMs, candidate.durationMs);
  const correctionDelta = Number(candidate.corrections || 0) - Number(baseline.corrections || 0);
  const tokenBenefit = tokenDeltaRatio !== null && tokenDeltaRatio <= -Number(thresholds.tokenBenefitThreshold || 0.15);
  const latencyBenefit = latencyDeltaRatio !== null && latencyDeltaRatio <= -Number(thresholds.latencyBenefitThreshold || 0.15);
  let classification = 'neutral';
  if (qualityDelta < 0 || correctionDelta > 0) classification = 'harmful';
  else if (qualityDelta > 0 || tokenBenefit || latencyBenefit) classification = 'beneficial';
  return { schemaVersion: 1, sampleId: sample.sampleId, qualityDelta, correctionDelta, tokenDeltaRatio, latencyDeltaRatio, overheadTokenRatio, overheadLatencyRatio, verifiedCompletionsPerThousandTokens: candidate.tokens > 0 ? Number(((candidate.passed ? 1 : 0) * 1000 / candidate.tokens).toFixed(6)) : null, classification };
}
function classifyHarnessWindow(samples, thresholds = {}) {
  const distinct = [...new Map(samples.map((sample) => [sample.sampleId, sample])).values()];
  const windowSize = Number(thresholds.disableWindow || 5);
  if (distinct.length < windowSize) return { decision: 'insufficient-evidence', sampleCount: distinct.length };
  const recent = distinct.slice(-windowSize);
  const noQualityGain = recent.every((sample) => Number(sample.qualityDelta || 0) <= 0);
  const costly = recent.every((sample) => Number(sample.overheadTokenRatio || 0) > Number(thresholds.overheadThreshold || 0.10) || Number(sample.overheadLatencyRatio || 0) > Number(thresholds.overheadThreshold || 0.10));
  return { decision: noQualityGain && costly ? 'disable-candidate' : 'keep', sampleCount: recent.length };
}
module.exports = { classifyHarnessWindow, computeHarnessTax };
