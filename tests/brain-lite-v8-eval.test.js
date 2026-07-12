'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightEvaluation, summarizeEvaluation } = require('../scripts/brain-lite-v8-eval');
test('preflight requires direct, vague, recall, and delegated cases with fixed verifiers', () => {
  const cases = [{ caseId: 'direct-1', family: 'direct', verifierHash: 'hash-1' }, { caseId: 'vague-1', family: 'vague', verifierHash: 'hash-2' }, { caseId: 'recall-1', family: 'recall', verifierHash: 'hash-3' }, { caseId: 'delegate-1', family: 'delegate', verifierHash: 'hash-4' }];
  assert.equal(preflightEvaluation(cases, { minimumCasesPerFamily: 1 }).ready, true);
});
test('summary separates quality, cost, context, and harness tax', () => {
  const summary = summarizeEvaluation([
    { caseId: 'direct-1', condition: 'baseline', family: 'direct', passed: true, tokens: 1000, durationMs: 1000, harnessTokens: 0, harnessDurationMs: 0 },
    { caseId: 'direct-1', condition: 'v8', family: 'direct', passed: true, tokens: 1000, durationMs: 1000, harnessTokens: 0, harnessDurationMs: 0 },
    { caseId: 'recall-1', condition: 'v8', family: 'recall', passed: true, tokens: 800, durationMs: 900, harnessTokens: 50, harnessDurationMs: 50, contextPrecision: 1, contextUtilization: 0.8 },
  ], { tokenBenefitThreshold: 0.15, latencyBenefitThreshold: 0.15 });
  assert.equal(summary.quality.v8Passes, 2); assert.equal(summary.nativeDirect.zeroHarnessOverhead, true);
  assert.equal(summary.context.averagePrecision, 1); assert.equal(summary.context.averageUtilization, 0.8);
});
