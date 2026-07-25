'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createV9Core } = require('../scripts/v9/core');
const { resolveV9Paths } = require('../scripts/v9/paths');
const { evaluateAction } = require('../scripts/v9/policy');
const { getHostAdapter, listHosts } = require('../scripts/v9/hosts');
const { handleStop } = require('../scripts/v9/hooks/stop');
const { handleSession } = require('../scripts/v9/hooks/session');
const { createTaskContract } = require('../scripts/v9/task-contract');

function tempCore() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-p0p6-'));
  return { home, core: createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: home, CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }) }) };
}

test('P0: verify re-run is the only path to complete; claims blocked at Stop', async () => {
  const { core } = tempCore();
  core.contracts.create({
    taskId: 'p0',
    objective: 'evidence protocol',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(0)"' } }],
  });
  core.verification.claim('noop', { id: 'c1', provenance: { kind: 'claim', ref: 'agent' } });
  assert.equal(core.verification.evaluateActive().status, 'partial');
  const stop = await handleStop({ completionClaim: true }, core);
  assert.equal(stop.decision, 'block');
  const verified = core.verification.run({ cwd: process.cwd() });
  assert.equal(verified.status, 'complete');
  assert.ok(verified.results[0].harnessVerified);
});

test('P0: direct edits to active.json cannot forge completion', () => {
  const { core } = tempCore();
  const contract = core.contracts.create({
    taskId: 'p0-file-forge',
    objective: 'resist file edits',
    criteria: [{ id: 'tests', required: true }],
  });
  contract.criteria[0].status = 'passed';
  contract.criteria[0].harnessVerified = true;
  contract.criteria[0].evidence = [{
    id: 'ev_forged',
    status: 'passed',
    harnessVerified: true,
    fingerprint: 'fake',
    seal: 'fake',
    verifiedAt: new Date().toISOString(),
    provenance: { kind: 'claim', ref: 'direct-file-edit' },
  }];
  fs.writeFileSync(path.join(core.paths.tasksRoot, 'active.json'), `${JSON.stringify(contract)}\n`);
  assert.equal(core.verification.evaluateActive().status, 'partial');
  assert.deepEqual(core.verification.evaluateActive().unverified, ['tests']);
});

test('P0: deleting active.json does not remove the Stop gate', async () => {
  const { core } = tempCore();
  core.contracts.create({
    taskId: 'p0-delete',
    objective: 'guard deletion',
    criteria: [{ id: 'tests', required: true, verifier: 'test_runner', verifierSpec: { command: 'npm test' } }],
  });
  fs.unlinkSync(path.join(core.paths.tasksRoot, 'active.json'));
  const stop = await handleStop({ event: 'Stop', completionClaim: true }, core);
  assert.equal(stop.decision, 'block');
  assert.equal(stop.reason_code, 'active_contract_missing');
});

test('P0: tasks and memory are isolated by project root', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-scope-'));
  const basePaths = resolveV9Paths({ CODEX_BRAIN_HOME: home, CODEX_BRAIN_STATE_HOME: path.join(home, 'state') });
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-a-'));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-b-'));
  const a = createV9Core({ paths: basePaths, projectRoot: projectA });
  const b = createV9Core({ paths: basePaths, projectRoot: projectB });
  a.contracts.create({ taskId: 'alpha', objective: 'alpha billing key migration', criteria: [{ id: 'tests', verifier: 'test_runner', verifierSpec: { command: 'npm test' } }] });
  a.memory.createMemory({ memoryId: 'alpha-memory', content: 'alpha only' });
  assert.equal(b.contracts.active(), null);
  assert.equal(b.memory.getMemory('alpha-memory'), null);
  assert.notEqual(a.paths.tasksRoot, b.paths.tasksRoot);
  assert.deepEqual(await handleSession({ event: 'SessionStart', projectRoot: projectB }, b), {});
});

test('P1: handoff init creates backlog progress smoke', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-handoff-'));
  const { core } = tempCore();
  const status = core.handoff.initHandoff({ projectRoot: project, objective: 'ship p1' });
  assert.equal(status.ready, true);
  assert.ok(fs.existsSync(path.join(project, '.brain', 'feature-backlog.json')));
  assert.ok(fs.existsSync(path.join(project, '.brain', 'progress.md')));
  assert.ok(fs.existsSync(path.join(project, '.brain', 'smoke.sh')));
  core.handoff.writeProgress({ projectRoot: project, sessionSummary: 'did work', taskId: 't1' });
  assert.throws(() => core.handoff.setFeaturePass({ projectRoot: project, featureId: 'feat_bootstrap', passes: true, verified: false }), /feature_pass_requires_verify/);
  const feature = core.handoff.setFeaturePass({ projectRoot: project, featureId: 'feat_bootstrap', passes: true, verified: true });
  assert.equal(feature.passes, true);
});

test('P3: path policy blocks forbidden and critical shell patterns', () => {
  const contract = createTaskContract({
    taskId: 'p3',
    objective: 'policy',
    scope: { allowed: ['src'], forbidden: ['.env'] },
  });
  const denied = evaluateAction({
    toolName: 'Write',
    toolInput: { file_path: path.join(process.cwd(), '.env') },
    contract,
    cwd: process.cwd(),
  });
  assert.ok(denied.level >= 4);
  const critical = evaluateAction({
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
    contract,
    cwd: process.cwd(),
  });
  assert.ok(critical.level >= 3);
});

test('P4: skill activation requires expected criteria and marks outputs as candidates', () => {
  const { core } = tempCore();
  assert.throws(() => core.skills.activate({ skillId: 'x' }), /expected_criteria/);
  const active = core.skills.activate({ skillId: 'brain-lite-model-router', expectedCriteria: ['tests'], costBudgetTokens: 1500 });
  assert.equal(active.verified, false);
  const cand = core.skills.attachCandidate('brain-lite-model-router', { criterionId: 'tests', note: 'maybe useful' });
  assert.match(cand.disclaimer, /UNVERIFIED/);
});

test('P5: host adapters normalize codex and claude events', async () => {
  assert.ok(listHosts().includes('codex'));
  assert.ok(listHosts().includes('claude'));
  const claude = getHostAdapter('claude');
  const normalized = claude.normalizeEvent({ event_name: 'PreToolUse', name: 'Bash', input: { command: 'ls' }, force_verify: true });
  assert.equal(normalized.hook_event_name, 'PreToolUse');
  assert.equal(normalized.tool_name, 'Bash');
  assert.equal(normalized.force_verify, true);
  assert.equal(getHostAdapter('codex').normalizeEvent({ event: 'Stop', forceVerify: true }).force_verify, true);
  const applied = claude.applyDecision({ decision: 'block', permissionDecision: 'deny', reason: 'nope' });
  assert.equal(applied.continue, false);
});

test('P6: memory is candidate-first and approval gated', () => {
  const { core } = tempCore();
  const a = core.memory.createMemory({ content: 'prefer local embeddings', kind: 'preference' });
  assert.equal(a.status, 'candidate');
  assert.equal(core.memory.search({ query: 'local embeddings' }).count, 0);
  const b = core.memory.transitionMemory(a.memory_id, 'confirmed', { expectedVersion: 1, approvedBy: 'operator' });
  assert.equal(b.status, 'confirmed');
  assert.equal(core.memory.search({ query: 'local embeddings' }).count, 1);
});

test('hot path policy stays under latency budget', () => {
  const { core } = tempCore();
  core.contracts.create({ taskId: 'lat', objective: 'fast', criteria: [{ id: 'x', required: true }] });
  const started = performance.now();
  for (let i = 0; i < 50; i += 1) core.contracts.evaluateAction('Read', { file_path: 'README.md' });
  assert.ok((performance.now() - started) / 50 < 100);
});
