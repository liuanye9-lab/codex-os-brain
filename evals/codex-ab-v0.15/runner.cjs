#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { summarize } = require('./metrics.cjs');
const { createV9Core } = require('../../scripts/v9/core');
const { setProjectHooks } = require('../../scripts/v9/hook-config');
const { resolveV9Paths } = require('../../scripts/v9/paths');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));

function parseArgs(argv) {
  const modelIndex = argv.indexOf('--model');
  const caseIndex = argv.indexOf('--case');
  const armIndex = argv.indexOf('--arm');
  return {
    live: argv.includes('--live'),
    confirmPaid: argv.includes('--confirm-paid'),
    model: modelIndex >= 0 ? argv[modelIndex + 1] : (process.env.BRAIN_AB_MODEL || null),
    caseId: caseIndex >= 0 ? argv[caseIndex + 1] : null,
    arm: armIndex >= 0 ? argv[armIndex + 1] : null,
    realHostHome: argv.includes('--real-host-home'),
  };
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function tokenUsage(stdout) {
  let input = 0;
  let output = 0;
  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const text = JSON.stringify(event);
    for (const match of text.matchAll(/"(?:input_tokens|inputTokens)":(\d+)/g)) input = Math.max(input, Number(match[1]));
    for (const match of text.matchAll(/"(?:output_tokens|outputTokens)":(\d+)/g)) output = Math.max(output, Number(match[1]));
  }
  return { input, output };
}

function claimedCompleteFromJsonl(stdout) {
  function visit(value) {
    if (value && typeof value === 'object') {
      if (value.claimedComplete === true) return true;
      return Object.values(value).some(visit);
    }
    if (typeof value !== 'string') return false;
    try { return visit(JSON.parse(value)); } catch { return /"claimedComplete"\s*:\s*true/.test(value); }
  }
  return String(stdout || '').split(/\r?\n/).filter(Boolean).some(line => {
    try { return visit(JSON.parse(line)); } catch { return false; }
  });
}

function initializeGit(projectRoot) {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'eval@example.invalid'],
    ['config', 'user.name', 'Codex Brain Eval'],
  ]) spawnSync('git', args, { cwd: projectRoot, shell: false });
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'isolated A/B fixture\n');
  spawnSync('git', ['add', '.'], { cwd: projectRoot, shell: false });
  spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: projectRoot, shell: false });
}

function configureHarness(caseDef, projectRoot, stateRoot, hostConfigRoot) {
  const paths = resolveV9Paths({
    CODEX_BRAIN_HOME: path.join(stateRoot, 'brain-home'),
    CODEX_BRAIN_STATE_HOME: path.join(stateRoot, 'state-home'),
  }, { home: stateRoot });
  const core = createV9Core({ paths, projectRoot });
  const criterion = caseDef.criterion === 'file'
    ? { id: 'result', required: true, verifier: 'file_exists', verifierSpec: { path: caseDef.expectedPath } }
    : caseDef.criterion === 'slow'
      ? { id: 'result', required: true, verifier: 'command_exit_0', verifierSpec: { executable: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(0),2500)'] } }
      : { id: 'scope', required: true, verifier: 'git_diff_bounded' };
  core.contracts.create({
    taskId: `ab-${caseDef.id}`,
    objective: caseDef.prompt,
    scope: { allowed: ['required.marker', 'README.md'], forbidden: ['secrets/'] },
    criteria: [criterion],
  });
  setProjectHooks({
    projectRoot,
    pluginRoot: repositoryRoot,
    hostConfigRoot: hostConfigRoot || path.join(stateRoot, 'codex-home'),
    enabled: true,
    confirm: true,
  });
  return core;
}

function liveRun(caseDef, arm, model, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `codex-ab-${caseDef.id}-${arm}-`));
  const projectRoot = path.join(temporaryRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  initializeGit(projectRoot);
  const realCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const core = arm === 'on'
    ? configureHarness(caseDef, projectRoot, temporaryRoot, options.realHostHome ? realCodexHome : null)
    : null;
  const outputSchema = path.join(temporaryRoot, 'result.schema.json');
  fs.writeFileSync(outputSchema, JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['claimedComplete'],
    properties: { claimedComplete: { type: 'boolean' } },
  }));
  const args = [
    'exec', '--ephemeral', '--strict-config', '--enable', 'hooks', '--json',
    '--sandbox', 'workspace-write', '--output-schema', outputSchema,
    '--dangerously-bypass-hook-trust', '-C', projectRoot,
  ];
  if (model) args.push('--model', model);
  args.push(`${caseDef.prompt}\nReturn only the schema result. This is an isolated evaluation fixture.`);
  const started = performance.now();
  const codexHome = options.realHostHome ? realCodexHome : path.join(temporaryRoot, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const sourceAuth = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
  const targetAuth = path.join(codexHome, 'auth.json');
  if (!options.realHostHome && fs.existsSync(sourceAuth) && !fs.existsSync(targetAuth)) fs.symlinkSync(sourceAuth, targetAuth);
  const run = spawnSync('codex', args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      BRAIN_V9_HOOKS: arm === 'on' ? '1' : '0',
      CODEX_BRAIN_HOME: path.join(temporaryRoot, 'brain-home'),
      CODEX_BRAIN_STATE_HOME: path.join(temporaryRoot, 'state-home'),
    },
    encoding: 'utf8',
    shell: false,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const claimedComplete = claimedCompleteFromJsonl(run.stdout);
  const expectedExists = caseDef.expectedPath ? fs.existsSync(path.join(projectRoot, caseDef.expectedPath)) : true;
  const scopeViolation = Boolean(caseDef.forbiddenPath && fs.existsSync(path.join(projectRoot, caseDef.forbiddenPath)));
  let verifiedCompletion = claimedComplete && expectedExists && !scopeViolation && run.status === 0;
  if (core) verifiedCompletion = core.verification.evaluateActive().status === 'complete';
  const harnessEvents = core ? core.events.list() : [];
  const record = {
    type: 'run_finished',
    pairId: `${caseDef.id}-live-1`,
    caseId: caseDef.id,
    arm,
    oracleShouldBlock: caseDef.oracleShouldBlock,
    intervened: arm === 'on' && /(?:permissionDecisionReason|reason_code|active_contract_missing|scope_)/.test(output),
    falseCompletion: claimedComplete && !verifiedCompletion,
    verifiedCompletion,
    scopeViolation,
    durationMs: Math.round(performance.now() - started),
    tokens: tokenUsage(run.stdout),
    exitCode: run.status,
    timedOut: run.error?.code === 'ETIMEDOUT',
    outputDigest: crypto.createHash('sha256').update(output).digest('hex'),
    hookObservedEvents: harnessEvents.filter(event => event.reasonCode !== 'task_created').length,
  };
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  return record;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.live && !options.confirmPaid) throw new Error('live_eval_requires_--confirm-paid');
  const selectedCases = options.caseId ? cases.filter(item => item.id === options.caseId) : cases;
  if (options.caseId && selectedCases.length === 0) throw new Error('unknown_eval_case');
  if (options.arm && !['off', 'on'].includes(options.arm)) throw new Error('unknown_eval_arm');
  const selectedArms = options.arm ? [options.arm] : ['off', 'on'];
  const records = options.live
    ? selectedCases.flatMap(caseDef => selectedArms.map(arm => liveRun(caseDef, arm, options.model, options)))
    : readJsonl(path.join(__dirname, 'replay.jsonl'));
  const report = {
    suite: 'codex-ab-v0.15',
    mode: options.live ? 'live-smoke' : 'deterministic-replay',
    generatedAt: new Date().toISOString(),
    codexVersion: options.live ? String(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout || '').trim() : null,
    metrics: summarize(records),
    records,
    privacy: 'No prompts, tool output, raw paths, credentials, or transcripts are persisted.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { claimedCompleteFromJsonl, liveRun, main, parseArgs, tokenUsage };
