'use strict';
// Coverage for adoption: the step that decides whether any gate applies at all.
//
// Why this file exists: an audit of five real Codex sessions on this machine found none of
// them running in a managed directory, so every gate shipped so far was installed and inert.
// policy.evaluateAction returns level 0 without a contract, so "is this directory adopted"
// is the switch in front of the whole harness, and it deserves its own tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleSession } = require('../scripts/v9/hooks/session');
const { evaluateAction } = require('../scripts/v9/policy');
const { createV9Core } = require('../scripts/v9/core');
const { resolveV9Paths, scopeV9Paths } = require('../scripts/v9/paths');

const ENABLED = { enabled: true, hooks: { enabled: true } };

function tempProject({ git = true, pkg = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-adopt-'));
  // Tests must not live under os.tmpdir() for notice assertions, since scratch space is
  // deliberately exempt. Callers that need a "real work" directory pass a relocated root.
  if (git) fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  if (pkg) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}

function realWorkProject({ git = true } = {}) {
  // Place it outside os.tmpdir() so the scratch-space exemption does not hide the notice.
  const base = fs.mkdtempSync(path.join(os.homedir(), '.brain-adopt-test-'));
  if (git) fs.mkdirSync(path.join(base, '.git'), { recursive: true });
  return base;
}

async function sessionParts(projectRoot, contract = null) {
  const core = { contracts: { active: () => contract }, projectRoot: () => projectRoot };
  return handleSession({ event: 'SessionStart', projectRoot }, core);
}

// ------------------------------------------------- the gate depends on a contract

test('without a contract no action is gated, however destructive', () => {
  // This is the mechanism behind the audit finding: not a bug, but the reason an installed
  // harness can still be inert. If this ever starts blocking, adoption stopped being the switch.
  const decision = evaluateAction({
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /Users/someone/Documents' },
    contract: null,
  });
  assert.equal(decision.level, 0);
  assert.equal(decision.reasonCode, 'no_active_task');
});

test('the same action is gated once a contract exists', () => {
  const decision = evaluateAction({
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /Users/someone/Documents' },
    contract: { taskId: 't', objective: 'o', scope: {}, criteria: [] },
  });
  assert.ok(decision.level >= 2, `expected a gated level, got ${decision.level}`);
});

// ------------------------------------------------- the unmanaged notice

test('an unmanaged git project is told it is not guarded', async () => {
  const root = realWorkProject();
  try {
    const out = await sessionParts(root);
    const text = JSON.stringify(out);
    assert.match(text, /NOT GUARDED/);
    assert.match(text, /brain adopt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an adopted project gets its contract, not the notice', async () => {
  const root = realWorkProject();
  try {
    const contract = { taskId: 't1', objective: 'ship the thing', constraints: [], unresolved: [], criteria: [] };
    const out = await sessionParts(root, contract);
    const text = JSON.stringify(out);
    assert.doesNotMatch(text, /NOT GUARDED/);
    assert.match(text, /ship the thing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scratch space stays silent so the notice keeps its meaning', async () => {
  // A prompt that fires in every throwaway directory trains you to ignore it, which costs
  // more than the reminder is worth.
  const scratch = tempProject();
  try {
    assert.deepEqual(await sessionParts(scratch), {});
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a directory with no git history stays silent', async () => {
  const root = realWorkProject({ git: false });
  try {
    assert.deepEqual(await sessionParts(root), {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the home directory itself stays silent', async () => {
  assert.deepEqual(await sessionParts(os.homedir()), {});
});

test('node_modules stays silent', async () => {
  const base = realWorkProject();
  const nested = path.join(base, 'node_modules', 'some-pkg');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  try {
    assert.deepEqual(await sessionParts(nested), {});
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('an unreadable project root degrades to silence rather than throwing', async () => {
  // SessionStart runs on every session; a notice helper must never be able to break startup.
  assert.deepEqual(await sessionParts(path.join(os.homedir(), 'does-not-exist-' + Date.now())), {});
});

test('an adopted project is not falsely told it is unguarded', async () => {
  // Regression: contracts bind to the first session that claims them, so a new session in an
  // adopted project sees contract=null with expected/missing set. The notice used to read that
  // as "unadopted" and printed NOT GUARDED in projects whose gates were provably denying --
  // a false alarm, which is the fastest way to train someone to ignore the warning.
  const root = realWorkProject();
  try {
    const core = {
      contracts: {
        active: () => null,
        state: () => ({ expected: true, contract: null, missing: true, corrupt: false }),
      },
      projectRoot: () => root,
    };
    const out = await handleSession({ event: 'SessionStart', projectRoot: root }, core);
    assert.doesNotMatch(JSON.stringify(out), /NOT GUARDED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a genuinely unadopted project still gets the notice', async () => {
  const root = realWorkProject();
  try {
    const core = {
      contracts: { active: () => null, state: () => ({ expected: false, contract: null, missing: false, corrupt: false }) },
      projectRoot: () => root,
    };
    assert.match(JSON.stringify(await handleSession({ event: 'SessionStart', projectRoot: root }, core)), /NOT GUARDED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an adopted directory stays guarded in later sessions', () => {
  // Regression: `brain adopt` binds the contract to the session that created it. A later
  // session found no *unbound* contract, reported the selector as missing, and PreToolUse
  // denied every command -- including `npm test` -- in the directory adopt was meant to
  // protect. Measured on three real adopted directories before the fix.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-adopt-resume-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-adopt-project-'));
  const env = { CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') };
  const paths = scopeV9Paths(resolveV9Paths(env), projectRoot);

  const first = createV9Core({ config: ENABLED, paths, projectRoot, sessionId: 'session-that-adopted' });
  first.contracts.create({ taskId: 'adopt-x', objective: 'guard this directory', criterionIds: ['scope'] });
  assert.equal(first.contracts.state().contract.taskId, 'adopt-x');

  const later = createV9Core({ config: ENABLED, paths, projectRoot, sessionId: 'a-totally-different-session' });
  const state = later.contracts.state();
  assert.equal(state.missing, false, 'a later session must not report the contract as missing');
  assert.equal(state.contract?.taskId, 'adopt-x');
});

test('two active contracts stay ambiguous rather than guessing', () => {
  // The inherit path must not paper over genuine ambiguity: picking one of two active
  // contracts would silently enforce the wrong boundary.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-adopt-ambig-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-adopt-ambig-p-'));
  const env = { CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') };
  const paths = scopeV9Paths(resolveV9Paths(env), projectRoot);

  const owner = createV9Core({ config: ENABLED, paths, projectRoot, sessionId: 'owner-a' });
  owner.contracts.create({ taskId: 'task-a', objective: 'first', criterionIds: ['scope'] });
  // A second session is required: one session may hold only one active task.
  const other = createV9Core({ config: ENABLED, paths, projectRoot, sessionId: 'owner-b' });
  other.contracts.create({ taskId: 'task-b', objective: 'second', criterionIds: ['scope'] });

  const later = createV9Core({ config: ENABLED, paths, projectRoot, sessionId: 'later' });
  const state = later.contracts.state();
  assert.equal(state.contract, null);
  assert.equal(state.missing, true);
});
