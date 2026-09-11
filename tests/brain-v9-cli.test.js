'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runCli } = require('../scripts/v9/cli');
const { resolveV9Paths } = require('../scripts/v9/paths');

const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'bin', 'brain.js');

function run(args, brainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-'))) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CODEX_BRAIN_HOME: brainHome, CODEX_BRAIN_STATE_HOME: path.join(brainHome, 'state') } });
}

test('status emits stable JSON', () => {
  const result = run(['status', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), ['cognitiveAssets', 'controlStore', 'enabled', 'features', 'identity', 'memory', 'runtimeRoot', 'version']);
});

test('V11 refuses to resurrect the removed memory and cognitive-asset layers', () => {
  // The old escape hatch must fail loudly, not silently no-op.
  const labs = run(['status', '--enable-cognitive-assets', '--confirm-labs', '--json']);
  assert.equal(labs.status, 2);
  assert.match(labs.stderr, /removed in V11/);
  const mem = run(['status', '--enable-memory', '--json']);
  assert.equal(mem.status, 2);
  assert.match(mem.stderr, /Codex native memories/);
  // The command groups themselves are gone.
  for (const group of ['memory', 'cognition', 'embeddings', 'harness']) {
    const gone = run([group, 'status', '--json']);
    assert.equal(gone.status, 2, `${group} should be unknown`);
    assert.match(gone.stderr, /unknown command/);
  }
});

test('help and doctor expose an actionable public interface contract', () => {
  const help = run(['--help', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const guide = JSON.parse(help.stdout);
  assert.equal(guide.usage, 'brain <command> [action] [--flags] [--json]');
  assert.equal(guide.commands.memory, undefined);
  assert.equal(guide.commands.cognition, undefined);
  assert.equal(guide.commands.embeddings, undefined);
  assert.match(guide.commands.verify, /Re-run/);
  const doctor = run(['doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.mcp.probeCommand, 'npm run mcp:probe');
  assert.ok(report.checks.some(check => check.id === 'node-runtime'));
  assert.equal(report.checks.find(check => check.id === 'evidence-signing-loop').status, 'passed');
});

test('task create accepts a reviewed contract file and gates custom commands', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-contract-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-contract-project-'));
  const contractFile = path.join(project, 'task-contract.json');
  fs.writeFileSync(contractFile, JSON.stringify({
    taskId: 'from_file',
    objective: 'verify a reviewed contract',
    criteria: [{ id: 'marker', verifier: 'file_exists', verifierSpec: { path: 'task-contract.json' } }],
  }));
  const created = run(['task', 'create', '--from', contractFile, '--project', project, '--json'], home);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).taskId, 'from_file');

  const blocked = run(['task', 'create', '--objective', 'unsafe custom', '--criterion', 'custom', '--command', 'node ok.js', '--json'], home);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /approve-custom-verifier/);
});

test('migration apply is impossible without confirmation', () => {
  const result = run(['migrate', 'apply', '--json']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /confirm-migration/);
});

test('full MCP receives the explicitly scoped project core', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-mcp-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-mcp-project-'));
  const paths = resolveV9Paths({
    CODEX_BRAIN_HOME: home,
    CODEX_BRAIN_STATE_HOME: path.join(home, 'state'),
  });
  let observedCore;
  const code = await runCli(['mcp', 'serve', '--project', project], {
    json() { return 0; },
    error() { return 4; },
  }, {
    paths,
    async serveMcp(core) { observedCore = core; },
  });
  assert.equal(code, 0);
  assert.equal(observedCore.paths.projectRoot, project);
});

test('task create, show, and verify share persisted core state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cli-task-'));
  const created = run(['task', 'create', '--task-id', 'task_cli', '--objective', 'verify cli', '--criterion', 'tests', '--json'], home);
  assert.equal(created.status, 0, created.stderr);
  const shown = run(['task', 'show', '--json'], home);
  assert.equal(JSON.parse(shown.stdout).taskId, 'task_cli');
  // Without harness re-run, required criteria remain partial (claims alone never complete).
  const verified = run(['verify', '--status-only', '--json'], home);
  assert.equal(JSON.parse(verified.stdout).status, 'partial');
});


