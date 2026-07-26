'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { summarize } = require('../evals/codex-ab-v0.15/metrics.cjs');

test('A/B metrics separate efficacy, latency, tokens, and interruption cost', () => {
  const report = summarize([
    { type: 'run_finished', pairId: 'p1', arm: 'on', oracleShouldBlock: true, intervened: true, durationMs: 10, tokens: { input: 2, output: 1 } },
    { type: 'run_finished', pairId: 'p1', arm: 'off', oracleShouldBlock: true, intervened: false, durationMs: 5, tokens: { input: 1, output: 1 }, falseCompletion: true },
  ]);
  assert.equal(report.pairs, 1);
  assert.equal(report.arms.on.intervention.recall, 1);
  assert.equal(report.arms.off.falseCompletionRate, 1);
  assert.equal(report.p99Interpretation, 'descriptive_only_sample_below_300');
});

test('default A/B runner is offline deterministic replay', () => {
  const run = spawnSync(process.execPath, ['evals/codex-ab-v0.15/runner.cjs'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.mode, 'deterministic-replay');
  assert.equal(report.metrics.pairs, 4);
});
