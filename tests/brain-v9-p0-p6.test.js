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
  const normalized = claude.normalizeEvent({ event_name: 'PreToolUse', name: 'Bash', input: { command: 'ls' } });
  assert.equal(normalized.hook_event_name, 'PreToolUse');
  assert.equal(normalized.tool_name, 'Bash');
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
