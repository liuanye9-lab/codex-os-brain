#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('./brain-lite-common');
const { buildV8Review } = require('./brain-lite-v8-review');
const REQUIRED_FAMILIES = ['direct', 'vague', 'recall', 'delegate'];
function preflightEvaluation(cases, config = {}) {
  const minimum = Number(config.minimumCasesPerFamily || 1);
  const counts = Object.fromEntries(REQUIRED_FAMILIES.map((family) => [family, cases.filter((item) => item.family === family && item.verifierHash).length]));
  return { ready: REQUIRED_FAMILIES.every((family) => counts[family] >= minimum), counts };
}
function summarizeEvaluation(runs, thresholds = {}) {
  const v8 = runs.filter((run) => run.condition === 'v8');
  const baseline = runs.filter((run) => run.condition === 'baseline');
  const directV8 = v8.filter((run) => run.family === 'direct');
  const contextReview = buildV8Review(v8.map((run) => ({ taskId: run.caseId, contextPrecision: run.contextPrecision, contextUtilization: run.contextUtilization, harnessTokens: run.harnessTokens, harnessDurationMs: run.harnessDurationMs })));
  return { schemaVersion: 1, thresholds,
    quality: { baselinePasses: baseline.filter((run) => run.passed).length, v8Passes: v8.filter((run) => run.passed).length },
    tokens: { baseline: baseline.reduce((sum, run) => sum + Number(run.tokens || 0), 0), v8: v8.reduce((sum, run) => sum + Number(run.tokens || 0), 0) },
    latencyMs: { baseline: baseline.reduce((sum, run) => sum + Number(run.durationMs || 0), 0), v8: v8.reduce((sum, run) => sum + Number(run.durationMs || 0), 0) },
    nativeDirect: { zeroHarnessOverhead: directV8.every((run) => Number(run.harnessTokens || 0) === 0 && Number(run.harnessDurationMs || 0) === 0) },
    context: contextReview.context, harness: contextReview.harness };
}
function renderEvaluation(summary) {
  return ['# V8 Controlled Evaluation','','| Metric | Baseline | V8 |','|---|---:|---:|',`| Verified passes | ${summary.quality.baselinePasses} | ${summary.quality.v8Passes} |`,`| Tokens | ${summary.tokens.baseline} | ${summary.tokens.v8} |`,`| Latency ms | ${summary.latencyMs.baseline} | ${summary.latencyMs.v8} |`,'',`- Native direct zero harness overhead: ${summary.nativeDirect.zeroHarnessOverhead}`,`- Average context precision: ${summary.context.averagePrecision ?? 'insufficient-evidence'}`,`- Average context utilization: ${summary.context.averageUtilization ?? 'insufficient-evidence'}`,`- Harness tokens: ${summary.harness.tokens}`,`- Harness duration ms: ${summary.harness.durationMs}`,''].join('\n');
}
function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.preflight) {
    const cases = JSON.parse(fs.readFileSync(path.resolve(args.cases), 'utf8'));
    const result = preflightEvaluation(cases, { minimumCasesPerFamily: Number(args['minimum-cases'] || 3) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = result.ready ? 0 : 2; return;
  }
  if (args.summarize) {
    const runs = JSON.parse(fs.readFileSync(path.resolve(args.runs), 'utf8'));
    const summary = summarizeEvaluation(runs, { tokenBenefitThreshold: 0.15, latencyBenefitThreshold: 0.15 });
    const markdown = renderEvaluation(summary);
    if (args.output) { fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true }); fs.writeFileSync(path.resolve(args.output), markdown, 'utf8'); }
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); return;
  }
  throw new Error('--preflight or --summarize is required');
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write((error.stack || error.message) + '\n'); process.exitCode = 1; } }
module.exports = { main, preflightEvaluation, renderEvaluation, summarizeEvaluation };
