'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyHarnessWindow, computeHarnessTax } = require('../scripts/brain-lite-harness-tax');
test('paired sample is beneficial when quality holds and tokens drop at least fifteen percent', () => {
  const result = computeHarnessTax({ sampleId: 'sample-1', baseline: { passed: true, tokens: 1000, durationMs: 1000, corrections: 0 }, candidate: { passed: true, tokens: 800, durationMs: 1000, corrections: 0 }, harness: { tokens: 50, durationMs: 100, toolCalls: 1 } }, { tokenBenefitThreshold: 0.15, latencyBenefitThreshold: 0.15 });
  assert.equal(result.classification, 'beneficial'); assert.equal(result.tokenDeltaRatio, -0.2);
});
test('quality regression is harmful regardless of token savings', () => {
  const result = computeHarnessTax({ sampleId: 'sample-2', baseline: { passed: true, tokens: 1000, durationMs: 1000, corrections: 0 }, candidate: { passed: false, tokens: 100, durationMs: 100, corrections: 1 }, harness: { tokens: 10, durationMs: 10, toolCalls: 1 } }, { tokenBenefitThreshold: 0.15, latencyBenefitThreshold: 0.15 });
  assert.equal(result.classification, 'harmful');
});
test('five distinct neutral samples with more than ten percent overhead create a disable candidate', () => {
  const samples = Array.from({ length: 5 }, (_, index) => ({ sampleId: 'sample-' + index, classification: 'neutral', overheadTokenRatio: 0.12, overheadLatencyRatio: 0.11, qualityDelta: 0 }));
  assert.equal(classifyHarnessWindow(samples, { disableWindow: 5, overheadThreshold: 0.10 }).decision, 'disable-candidate');
});
