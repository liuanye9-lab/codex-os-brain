'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { performance } = require('node:perf_hooks');
const { createV9Core, readV9Config } = require('../scripts/v9/core');
const { resolveV9Paths } = require('../scripts/v9/paths');
const { evaluateAction, normalizePath } = require('../scripts/v9/policy');
const { getHostAdapter, listHosts } = require('../scripts/v9/hosts');
const { handleStop } = require('../scripts/v9/hooks/stop');
const { handleSession } = require('../scripts/v9/hooks/session');
const { createTaskContract } = require('../scripts/v9/task-contract');

function tempCore() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-p0p6-'));
  const config = structuredClone(readV9Config());
  config.memory.enabled = true;
  return { home, core: createV9Core({ config, paths: resolveV9Paths({ CODEX_BRAIN_HOME: home, CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }) }) };
}

test('P0: verify re-run is the only path to complete; claims blocked at Stop', async () => {
  const { core } = tempCore();
  core.contracts.create({
    taskId: 'p0',
    objective: 'evidence protocol',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(0)"', humanApproved: true } }],
  });
  core.verification.claim('noop', { id: 'c1', provenance: { kind: 'claim', ref: 'agent' } });
  assert.equal(core.verification.evaluateActive().status, 'partial');
  const stop = await handleStop({ completionClaim: true }, core);
  assert.equal(stop.decision, 'block');
  const verified = core.verification.run({ cwd: process.cwd() });
  assert.equal(verified.status, 'complete');
  assert.ok(verified.results[0].harnessVerified);
});

test('P0: direct edits to the SQLite contract cannot forge completion', () => {
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
  const db = new DatabaseSync(core.paths.controlDbPath);
  try {
    db.prepare('UPDATE task_contracts SET contract_json=? WHERE task_id=?').run(JSON.stringify(contract), contract.taskId);
  } finally { db.close(); }
  assert.equal(core.verification.evaluateActive().status, 'partial');
  assert.deepEqual(core.verification.evaluateActive().unverified, ['tests']);
});

test('P0: deleting the active SQLite task does not remove the Stop gate', async () => {
  const { core } = tempCore();
  core.contracts.create({
    taskId: 'p0-delete',
    objective: 'guard deletion',
    criteria: [{ id: 'tests', required: true, verifier: 'test_runner', verifierSpec: { executable: 'npm', args: ['test'] } }],
  });
  const db = new DatabaseSync(core.paths.controlDbPath);
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('DELETE FROM task_contracts WHERE task_id=?').run('p0-delete');
  } finally { db.close(); }
  const stop = await handleStop({ event: 'Stop', completionClaim: true }, core);
  assert.equal(stop.decision, 'block');
  assert.equal(stop.reason_code, 'active_contract_missing');
});

test('P0: deleting the guard while SQLite still has an active task fails closed', () => {
  const { core } = tempCore();
  core.contracts.create({ taskId: 'p0-guard-delete', objective: 'guard must exist', criteria: [] });
  fs.unlinkSync(core.paths.controlGuardPath);
  const state = core.contracts.state();
  assert.equal(state.corrupt, true);
  assert.equal(state.contract, null);
  const decision = core.contracts.evaluateAction('Write', { file_path: 'src/file.js' });
  assert.equal(decision.level, 4);
  assert.equal(decision.reasonCode, 'active_contract_missing');
});

test('P0: duplicate explicit task id does not mutate the existing guard', () => {
  const { core } = tempCore();
  core.contracts.create({ taskId: 'duplicate', objective: 'original', criteria: [] });
  const before = fs.readFileSync(core.paths.controlGuardPath, 'utf8');
  assert.throws(
    () => core.contracts.create({ taskId: 'duplicate', objective: 'replacement', criteria: [] }),
    /task_id_exists/,
  );
  assert.equal(fs.readFileSync(core.paths.controlGuardPath, 'utf8'), before);
  assert.equal(core.contracts.active().objective, 'original');
});

test('P0: tasks and memory are isolated by project root', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-scope-'));
  const basePaths = resolveV9Paths({ CODEX_BRAIN_HOME: home, CODEX_BRAIN_STATE_HOME: path.join(home, 'state') });
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-a-'));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-project-b-'));
  const config = structuredClone(readV9Config());
  config.memory.enabled = true;
  const a = createV9Core({ config, paths: basePaths, projectRoot: projectA });
  const b = createV9Core({ config, paths: basePaths, projectRoot: projectB });
  a.contracts.create({ taskId: 'alpha', objective: 'alpha billing key migration', criteria: [{ id: 'tests', verifier: 'test_runner', verifierSpec: { executable: 'npm', args: ['test'] } }] });
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

test('P0: a new file below a symlinked parent is resolved outside the allowed scope', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-symlink-scope-'));
  const allowed = path.join(project, 'src');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-symlink-outside-'));
  fs.mkdirSync(allowed);
  fs.symlinkSync(outside, path.join(allowed, 'link'), 'dir');
  const decision = evaluateAction({
    toolName: 'Write',
    toolInput: { file_path: path.join(allowed, 'link', 'new-file.js') },
    contract: { risk: 'low', externalWrite: false, scope: { allowed: [allowed], forbidden: [] } },
    cwd: project,
  });
  assert.equal(decision.level, 4);
  assert.equal(decision.reasonCode, 'scope_outside_allowed');
  assert.equal(decision.path, normalizePath(path.join(outside, 'new-file.js')));
});

test('P3: unresolved shell paths require confirmation when the contract has an allowlist', () => {
  const decision = evaluateAction({
    toolName: 'Bash',
    toolInput: { command: 'node generated-script.js' },
    contract: { risk: 'low', externalWrite: false, scope: { allowed: ['src/'], forbidden: [] } },
    cwd: process.cwd(),
  });
  assert.equal(decision.level, 3);
  assert.equal(decision.reasonCode, 'scope_unresolved');
});

test('P3: apply_patch headers are scope checked and unknown MCP or Agent writes require confirmation', () => {
  const contract = { risk: 'low', externalWrite: false, scope: { allowed: ['src/'], forbidden: ['secrets/'] } };
  const patch = evaluateAction({
    toolName: 'apply_patch',
    toolInput: { command: '*** Begin Patch\n*** Update File: secrets/token.txt\n*** End Patch\n' },
    contract,
    cwd: process.cwd(),
  });
  assert.equal(patch.level, 4);
  assert.equal(patch.reasonCode, 'scope_forbidden');

  for (const toolName of ['mcp__database__query', 'Agent']) {
    const decision = evaluateAction({ toolName, toolInput: { query: 'opaque write' }, contract, cwd: process.cwd() });
    assert.equal(decision.level, 3);
    assert.equal(decision.reasonCode, 'scope_unresolved');
  }
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
