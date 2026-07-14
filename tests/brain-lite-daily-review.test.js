'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildReview,
  loadV8Inputs,
  renderReview,
} = require('../scripts/brain-lite-daily-review');

function routed(timestamp, overrides = {}) {
  return {
    timestamp,
    taskId: `task-${timestamp}`,
    taskFamily: 'bounded-coding',
    routeId: 'spark-high',
    model: 'gpt-5.3-codex-spark',
    effort: 'high',
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 25,
    durationMs: 1000,
    infrastructureFailure: false,
    verifiable: true,
    verifierPassed: true,
    modelClaimedSuccess: true,
    finalDelivered: true,
    ...overrides,
  };
}

test('empty data produces an honest accumulating baseline', () => {
  const review = buildReview([], new Date('2026-07-12T12:00:00.000Z'), { timeZone: 'UTC' });
  const markdown = renderReview(review);

  assert.equal(review.today.totalTasks, 0);
  assert.equal(review.baselineAccumulating, true);
  assert.match(markdown, /基线积累中/);
  assert.doesNotMatch(markdown, /NaN|Infinity/);
});

test('today metrics combine routed and compact direct-task signals', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const events = [
    routed('2026-07-12T01:00:00.000Z', { taskId: 'routed-pass' }),
    routed('2026-07-12T02:00:00.000Z', {
      taskId: 'routed-fail',
      verifierPassed: false,
      modelClaimedSuccess: true,
      finalDelivered: false,
      userCorrected: true,
    }),
  ];
  const directSignals = [
    { timestamp: '2026-07-12T03:00:00.000Z', taskId: 'direct-1', status: 'completed', userCorrected: false },
  ];
  const review = buildReview(events, now, { timeZone: 'UTC', directSignals });

  assert.equal(review.today.totalTasks, 3);
  assert.equal(review.today.routedTasks, 2);
  assert.equal(review.today.directTasks, 1);
  assert.equal(review.today.firstPassRate, 0.5);
  assert.equal(review.today.finalPassRate, 0.5);
  assert.equal(review.today.falseGreenCount, 1);
  assert.equal(review.today.userCorrections, 1);
  assert.equal(review.today.verifierCoverageRate, 1);
  assert.equal(review.today.inputTokens, 200);
  assert.equal(review.today.outputTokens, 50);
});

test('rolling seven days compare with the immediately preceding seven days', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const events = [
    routed('2026-07-14T01:00:00.000Z', { taskId: 'current-1' }),
    routed('2026-07-08T01:00:00.000Z', { taskId: 'current-2' }),
    routed('2026-07-07T01:00:00.000Z', { taskId: 'previous-1', verifierPassed: false, finalDelivered: false }),
    routed('2026-07-01T01:00:00.000Z', { taskId: 'previous-2', verifierPassed: false, finalDelivered: false }),
    routed('2026-06-30T01:00:00.000Z', { taskId: 'too-old' }),
  ];
  const review = buildReview(events, now, { timeZone: 'UTC' });

  assert.equal(review.rolling7.routedTasks, 2);
  assert.equal(review.previous7.routedTasks, 2);
  assert.equal(review.trends.finalPassRateDelta, 1);
  assert.ok(review.progress.some((item) => /最终通过率/.test(item)));
});

test('infrastructure failures are separated from capability and completion rates', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const review = buildReview([
    routed('2026-07-12T01:00:00.000Z', {
      taskId: 'infra-1',
      infrastructureFailure: true,
      infrastructureFailureType: 'network',
      verifierPassed: false,
      finalDelivered: false,
    }),
    routed('2026-07-12T02:00:00.000Z', { taskId: 'pass-1' }),
  ], now, { timeZone: 'UTC' });

  assert.equal(review.today.infrastructureFailures, 1);
  assert.equal(review.today.capabilityTasks, 1);
  assert.equal(review.today.finalPassRate, 1);
  assert.equal(review.today.infrastructureFailureRate, 0.5);
  assert.ok(review.weaknesses.some((item) => /基础设施失败/.test(item)));
});

test('multiple attempts compute first-pass, final-pass, and escalation by task', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const review = buildReview([
    routed('2026-07-12T01:00:00.000Z', {
      taskId: 'retry-task',
      attempt: 1,
      verifierPassed: false,
      finalDelivered: false,
      modelClaimedSuccess: false,
    }),
    routed('2026-07-12T02:00:00.000Z', {
      taskId: 'retry-task',
      attempt: 2,
      escalated: true,
      routeId: 'terra-max',
      model: 'gpt-5.6-terra',
      effort: 'max',
    }),
  ], now, { timeZone: 'UTC' });

  assert.equal(review.today.capabilityTasks, 1);
  assert.equal(review.today.firstPassRate, 0);
  assert.equal(review.today.finalPassRate, 1);
  assert.equal(review.today.escalationRate, 1);
});

test('policy state becomes readable candidates without silently changing base policy', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const policyState = {
    infrastructureRoutes: {
      'spark-high': { recentFailures: 2, cooldownUntil: '2026-07-12T13:00:00.000Z' },
    },
    taskFamilies: {
      extraction: {
        stableRoute: { routeId: 'luna-low', model: 'gpt-5.6-luna', effort: 'low' },
        trialRoute: null,
        blockedRoutes: [],
        routes: { 'luna-low': { status: 'stable', stableRevoked: false } },
      },
      architecture: {
        stableRoute: null,
        trialRoute: { routeId: 'terra-max', model: 'gpt-5.6-terra', effort: 'max' },
        blockedRoutes: ['terra-medium'],
        routes: { 'terra-medium': { status: 'blocked', stableRevoked: true } },
      },
    },
  };
  const review = buildReview([], now, { timeZone: 'UTC', policyState });
  const markdown = renderReview(review);

  assert.ok(review.policyCandidates.some((item) => item.type === 'stable' && item.taskFamily === 'extraction'));
  assert.ok(review.policyCandidates.some((item) => item.type === 'revoked' && item.taskFamily === 'architecture'));
  assert.ok(review.policyCandidates.some((item) => item.type === 'unavailable' && item.routeId === 'spark-high'));
  assert.match(markdown, /候选/);
  assert.match(markdown, /luna-low/);
});

test('daily review surfaces attribution and index health without automatic lifecycle changes', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const evidenceId = 'ev_aaaaaaaaaaaaaaaaaaaa';
  const traceEvents = Array.from({ length: 5 }, (_, index) => {
    const taskId = `v8-task-${index}`;
    const traceId = `v8-trace-${index}`;
    return [
      { taskId, traceId, kind: 'recall', evidenceIds: [evidenceId] },
      { taskId, traceId, kind: 'verification', verifierPassed: index < 3, modelClaimedSuccess: true, finalDelivered: index < 3, userCorrected: index === 4 },
    ];
  }).flat();
  const review = buildReview([], now, {
    timeZone: 'UTC',
    v8: {
      traceEvents,
      experiments: [],
      lifecycle: [],
      outcomeAttribution: { minimumDistinctTasks: 5, minimumVerifierCoverage: 0.8, qualityFloor: 0.8, correctionRateCeiling: 0.2, automaticLifecycleChanges: false },
      indexHealth: { status: 'degraded', stale: false, warningCounts: { dataless: 3 }, unindexedSources: 0, missingIndexedSources: 0, temporaryFiles: 0, fullPathsExposed: false },
    },
  });
  const markdown = renderReview(review);
  assert.equal(review.v8.attribution.summary['review-candidate'], 1);
  assert.equal(review.v8.indexHealth.status, 'degraded');
  assert.match(markdown, /V8 控制面/);
  assert.match(markdown, /review-candidate/);
  assert.match(markdown, /索引健康.*degraded/);
  assert.match(markdown, /不自动改变/);
});

test('daily review CLI loads V8 trace and index health from explicit configs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-daily-v8-'));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  const source = path.join(root, 'memory.md');
  const indexPath = path.join(dataDir, 'index.json');
  const ledgerPath = path.join(dataDir, 'ledger.jsonl');
  const tracePath = path.join(dataDir, 'trace.jsonl');
  const experimentsPath = path.join(dataDir, 'experiments.json');
  const lifecyclePath = path.join(dataDir, 'lifecycle.json');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(source, '# memory\n');
  fs.writeFileSync(indexPath, JSON.stringify({ builtAt: '2026-07-14T00:00:00.000Z', sourceFiles: [{ path: source, mtimeMs: fs.statSync(source).mtimeMs }], chunks: [], warnings: [] }));
  fs.writeFileSync(ledgerPath, '');
  fs.writeFileSync(tracePath, JSON.stringify({ traceId: 'trace-1', taskId: 'task-1', kind: 'recall', evidenceIds: ['ev_aaaaaaaaaaaaaaaaaaaa'] }) + '\n');
  fs.writeFileSync(experimentsPath, '[]');
  fs.writeFileSync(lifecyclePath, '[]');
  const v8ConfigPath = path.join(configDir, 'brain-lite-v8.json');
  const recallConfigPath = path.join(configDir, 'brain-lite.json');
  fs.writeFileSync(v8ConfigPath, JSON.stringify({
    outcomeAttribution: { enabled: true, minimumDistinctTasks: 5, minimumVerifierCoverage: 0.8, qualityFloor: 0.8, correctionRateCeiling: 0.2, automaticLifecycleChanges: false },
    indexHealth: { enabled: true, staleAfterHours: 48, autoRepair: false },
    paths: { trace: 'data/trace.jsonl', experiments: 'data/experiments.json', skillLifecycle: 'data/lifecycle.json' },
  }));
  fs.writeFileSync(recallConfigPath, JSON.stringify({ recall: { indexPath, sources: [source] } }));

  const loaded = loadV8Inputs({ v8ConfigPath, recallConfigPath, now: new Date('2026-07-14T12:00:00.000Z') });
  assert.equal(loaded.traceEvents.length, 1);
  assert.equal(loaded.indexHealth.status, 'healthy');
  assert.equal(loaded.outcomeAttribution.automaticLifecycleChanges, false);

  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '..', 'scripts', 'brain-lite-daily-review.js'),
    '--ledger', ledgerPath,
    '--v8-config', v8ConfigPath,
    '--recall-config', recallConfigPath,
    '--date', '2026-07-14T12:00:00.000Z',
    '--timezone', 'UTC',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /V8 控制面/);
  assert.match(result.stdout, /索引健康：healthy/);
});
