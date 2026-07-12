'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const config = require('../config/brain-lite-router.json');
const { nextRouteAfterOutcome, routeTask } = require('../scripts/brain-lite-router');

function route(features, policyState = {}) {
  return routeTask({ taskFamily: 'general', risk: 'low', ...features }, config, policyState);
}

test('keeps trivial work in the mother agent', () => {
  const decision = route({
    clarity: 'clear',
    verifiable: true,
    independent: false,
    estimatedToolCalls: 2,
    motherCanFinishQuickly: true,
  });

  assert.equal(decision.dispatch, false);
  assert.equal(decision.model, null);
  assert.equal(decision.effort, null);
  assert.equal(decision.routeId, 'mother-direct');
});

test('asks for one observable signal before routing a vague task with no usable context', () => {
  const decision = route({
    promptClarity: 'vague',
    hasObservableSignal: false,
    hasFailingVerification: false,
    hasFileScope: false,
    hasRelevantContext: false,
    verifiable: true,
    independent: true,
    estimatedToolCalls: 5,
  });

  assert.equal(decision.dispatch, false);
  assert.equal(decision.action, 'clarify');
  assert.equal(decision.routeId, 'mother-clarify');
  assert.equal(decision.clarificationRequired, true);
  assert.deepEqual(decision.clarificationFields, ['observable symptom', 'failing command or log', 'reproduction', 'relevant file']);
});

test('continues normal routing when a vague request has one concrete signal', () => {
  const decision = route({
    promptClarity: 'vague',
    hasObservableSignal: true,
    hasFailingVerification: false,
    hasFileScope: false,
    hasRelevantContext: false,
    verifiable: true,
    independent: true,
    estimatedToolCalls: 5,
  });

  assert.equal(decision.action, 'delegate');
  assert.equal(decision.routeId, 'terra-medium');
  assert.equal(decision.clarificationRequired, false);
});

test('uses Spark high for bounded text coding on the independent quota', () => {
  const decision = route({
    taskFamily: 'bounded-coding',
    clarity: 'clear',
    verifiable: true,
    independent: true,
    coding: true,
    textOnly: true,
    boundedChange: true,
    sparkQuotaAvailable: true,
    estimatedToolCalls: 5,
  });

  assert.equal(decision.dispatch, true);
  assert.equal(decision.model, 'gpt-5.3-codex-spark');
  assert.equal(decision.effort, 'high');
  assert.equal(decision.independentQuota, true);
  assert.equal(decision.policyVersion, 'brain-lite-router-v2');
  assert.equal(decision.executionBudget.maxInfrastructureRetries, 1);
  assert.equal(decision.executionBudget.maxCapabilityEscalations, 2);
});

test('uses the supplied 3/3 Luna max evidence for verifiable constraint work', () => {
  const decision = route({
    taskFamily: 'constraint-satisfaction',
    clarity: 'clear',
    verifiable: true,
    independent: true,
    batch: true,
    constraintCount: 20,
    estimatedToolCalls: 6,
  });

  assert.equal(decision.model, 'gpt-5.6-luna');
  assert.equal(decision.effort, 'max');
  assert.equal(decision.evidenceProfile, 'gpt56-effort-eval-v2-constraint-satisfaction');
  assert.match(decision.reason, /3\/3/);
});

test('starts ordinary multi-condition work at Terra medium', () => {
  const decision = route({
    taskFamily: 'daily-multi-condition',
    clarity: 'medium',
    verifiable: true,
    independent: true,
    estimatedToolCalls: 5,
  });

  assert.equal(decision.model, 'gpt-5.6-terra');
  assert.equal(decision.effort, 'medium');
  assert.equal(decision.probe, true);
  assert.equal(decision.probeBudget.maxEvidenceItems, 8);
});

test('escalates Terra medium failure directly to Terra max', () => {
  const decision = route({
    taskFamily: 'daily-multi-condition',
    clarity: 'medium',
    verifiable: true,
    independent: true,
    estimatedToolCalls: 5,
    previousRoute: { model: 'gpt-5.6-terra', effort: 'medium' },
    previousVerifiedFailure: true,
  });

  assert.equal(decision.model, 'gpt-5.6-terra');
  assert.equal(decision.effort, 'max');
  assert.doesNotMatch(decision.escalation.join(' '), /high|xhigh/);
});

test('uses Sol max for unfamiliar open high-cost work', () => {
  const decision = route({
    taskFamily: 'architecture',
    clarity: 'open',
    novelty: 'high',
    verifiable: false,
    independent: true,
    failureCost: 'high',
    estimatedToolCalls: 8,
    parallelizable: true,
  });

  assert.equal(decision.model, 'gpt-5.6-sol');
  assert.equal(decision.effort, 'max');
});

test('does not enable Ultra merely because max failed', () => {
  const decision = route({
    taskFamily: 'architecture',
    clarity: 'open',
    novelty: 'high',
    verifiable: true,
    independent: true,
    failureCost: 'high',
    estimatedToolCalls: 8,
    previousRoute: { model: 'gpt-5.6-sol', effort: 'max' },
    previousVerifiedFailure: true,
    parallelLanes: 2,
    mergeVerifier: true,
  });

  assert.equal(decision.effort, 'max');
  assert.equal(decision.ultraEligible, false);
});

test('enables Ultra only after verified max failure with three lanes and a merge verifier', () => {
  const decision = route({
    taskFamily: 'architecture',
    clarity: 'open',
    novelty: 'high',
    verifiable: true,
    independent: true,
    failureCost: 'high',
    estimatedToolCalls: 8,
    previousRoute: { model: 'gpt-5.6-sol', effort: 'max' },
    previousVerifiedFailure: true,
    parallelLanes: 3,
    mergeVerifier: true,
  });

  assert.equal(decision.model, 'gpt-5.6-sol');
  assert.equal(decision.effort, 'ultra');
  assert.equal(decision.ultraEligible, true);
});

test('uses learned stable routes only for low-risk verifiable work', () => {
  const state = {
    taskFamilies: {
      extraction: {
        stableRoute: { model: 'gpt-5.6-luna', effort: 'low', routeId: 'luna-low' },
      },
    },
  };

  const lowRisk = route({
    taskFamily: 'extraction',
    clarity: 'clear',
    verifiable: true,
    independent: true,
    batch: true,
  }, state);
  const highRisk = route({
    taskFamily: 'extraction',
    clarity: 'clear',
    verifiable: false,
    independent: true,
    failureCost: 'high',
    estimatedToolCalls: 5,
  }, state);

  assert.equal(lowRisk.routeId, 'luna-low');
  assert.equal(highRisk.routeId, 'sol-max');
});

test('exports the configured source fingerprint without a temporary attachment path', () => {
  const profile = config.evidenceProfiles['gpt56-effort-eval-v2-constraint-satisfaction'];
  assert.equal(profile.archiveSha256, '66b0a22967ebcc887d281cd9dc296cd8f2bf8fc9cd6ef9b86fd595066bd40dfa');
  assert.equal(JSON.stringify(profile).includes('/tmp/'), false);
  assert.equal(path.isAbsolute(profile.sourceId), false);
});

test('temporarily unavailable routes use an infrastructure fallback without changing capability evidence', () => {
  const policyState = {
    infrastructureRoutes: {
      'spark-high': { cooldownUntil: '2026-07-12T12:30:00.000Z', recentFailures: 2 },
    },
  };
  const decision = routeTask({
    taskFamily: 'bounded-coding',
    clarity: 'clear',
    risk: 'low',
    verifiable: true,
    independent: true,
    coding: true,
    textOnly: true,
    boundedChange: true,
    sparkQuotaAvailable: true,
    estimatedToolCalls: 5,
    now: '2026-07-12T12:00:00.000Z',
  }, config, policyState);

  assert.equal(decision.routeId, 'luna-max');
  assert.equal(decision.availabilityFallbackFrom, 'spark-high');
  assert.match(decision.reason, /temporarily unavailable/);
});

test('outcome routing retries infrastructure once, then uses an availability fallback', () => {
  const decision = route({
    taskFamily: 'bounded-coding',
    clarity: 'clear',
    verifiable: true,
    independent: true,
    coding: true,
    textOnly: true,
    boundedChange: true,
    sparkQuotaAvailable: true,
    estimatedToolCalls: 5,
  });
  const retry = nextRouteAfterOutcome(decision, {
    failureType: 'infrastructure',
    infrastructureRetriesUsed: 0,
    capabilityEscalationsUsed: 0,
    attemptsUsed: 1,
    elapsedWallTimeMs: 1000,
  }, config);
  const fallback = nextRouteAfterOutcome(decision, {
    failureType: 'infrastructure',
    infrastructureRetriesUsed: 1,
    capabilityEscalationsUsed: 0,
    attemptsUsed: 2,
    elapsedWallTimeMs: 1000,
  }, config);

  assert.deepEqual(retry, { action: 'retry', routeId: 'spark-high', reason: 'bounded infrastructure retry' });
  assert.equal(fallback.action, 'fallback');
  assert.equal(fallback.routeId, 'luna-max');
});

test('outcome routing escalates capability failure but stops at hard attempt or time budgets', () => {
  const decision = route({
    taskFamily: 'daily-multi-condition',
    clarity: 'medium',
    verifiable: true,
    independent: true,
    estimatedToolCalls: 5,
  });
  const escalation = nextRouteAfterOutcome(decision, {
    failureType: 'capability',
    infrastructureRetriesUsed: 0,
    capabilityEscalationsUsed: 0,
    attemptsUsed: 1,
    elapsedWallTimeMs: 1000,
  }, config);
  const attemptsExhausted = nextRouteAfterOutcome(decision, {
    failureType: 'capability',
    infrastructureRetriesUsed: 0,
    capabilityEscalationsUsed: 1,
    attemptsUsed: 3,
    elapsedWallTimeMs: 1000,
  }, config);
  const timeExhausted = nextRouteAfterOutcome(decision, {
    failureType: 'capability',
    infrastructureRetriesUsed: 0,
    capabilityEscalationsUsed: 1,
    attemptsUsed: 1,
    elapsedWallTimeMs: 1800000,
  }, config);

  assert.equal(escalation.action, 'escalate');
  assert.equal(escalation.routeId, 'terra-max');
  assert.equal(attemptsExhausted.action, 'stop');
  assert.equal(timeExhausted.action, 'stop');
});
