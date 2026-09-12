'use strict';
// Coverage for the episodic loop: PostToolUse records, UserPromptSubmit replays.
//
// The design rule these tests defend is that recall states facts and never gives advice.
// Harness-Bench (5,194 trajectories) found procedural scaffolding loses value as models
// improve, while persistent state and evidence do not. So the assertions below care about
// two things: that a *new* session can see what an earlier one learned, and that the hook
// stays quiet whenever it has nothing factual to add.

const test = require('node:test');
const assert = require('node:assert/strict');

const { MIN_REPEATS, formatRecall, handleRecall, selectRepeated } = require('../scripts/v9/hooks/recall');

function circuit(operation, consecutive, status = 'warning') {
  return { operation, consecutive, status, signature: `sig_${operation}` };
}

function coreWith(history) {
  return { failures: { projectHistory: () => history } };
}

test('a single failure is not replayed', () => {
  // One failure is already in the model's own context. Replaying it is pure noise.
  assert.deepEqual(selectRepeated([circuit('Bash', 1)]), []);
});

test('a repeated failure is replayed', () => {
  const picked = selectRepeated([circuit('Bash', 2)]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].operation, 'Bash');
});

test('a recovered operation is not replayed', () => {
  assert.deepEqual(selectRepeated([{ operation: 'Bash', consecutive: 5, status: 'closed' }]), []);
});

test('the worst streaks come first and the list is capped', () => {
  const picked = selectRepeated([circuit('a', 2), circuit('b', 9), circuit('c', 4), circuit('d', 3)]);
  assert.deepEqual(picked.map(entry => entry.operation), ['b', 'c', 'd']);
});

test('recall states a fact and gives no instructions', () => {
  // The whole point of option B: report history, never prescribe process.
  const text = formatRecall([circuit('Bash', 3)]);
  assert.match(text, /failed 3x/);
  for (const word of ['should', 'must', 'try', 'instead', 'consider', 'avoid', 'verify', 'check']) {
    assert.ok(!text.toLowerCase().includes(word), `recall must not advise: found "${word}"`);
  }
});

test('recall output stays bounded', () => {
  const text = formatRecall([circuit('x'.repeat(500), 2), circuit('y'.repeat(500), 3)]);
  assert.ok(text.length <= 320, `expected bounded output, got ${text.length}`);
});

test('the hook is silent when the project has no repeated failures', async () => {
  assert.deepEqual(await handleRecall({ event: 'UserPromptSubmit' }, coreWith([])), {});
});

test('the hook is silent when failure history is unavailable', async () => {
  assert.deepEqual(await handleRecall({ event: 'UserPromptSubmit' }, {}), {});
});

test('the hook survives a failing history lookup', async () => {
  const core = { failures: { projectHistory() { throw new Error('db gone'); } } };
  assert.deepEqual(await handleRecall({ event: 'UserPromptSubmit' }, core), {});
});

test('the hook speaks when a repeated failure exists', async () => {
  const result = await handleRecall({ event: 'UserPromptSubmit' }, coreWith([circuit('Bash', 2)]));
  assert.equal(result.reason_code, 'repeated_failure_recall');
  assert.match(result.hookSpecificOutput.additionalContext, /Bash/);
});

test('recall reads project history, not the current session', async () => {
  // Regression: circuits are keyed by session_id, so an earlier implementation read
  // session-scoped state and a new session always saw nothing -- which is precisely the
  // case recall exists to serve.
  let usedProjectScope = false;
  const core = {
    failures: {
      status() { throw new Error('recall must not read session-scoped circuits'); },
      projectHistory() { usedProjectScope = true; return [circuit('Bash', 2)]; },
    },
  };
  const result = await handleRecall({ event: 'UserPromptSubmit' }, core);
  assert.ok(usedProjectScope, 'recall must query project-scoped history');
  assert.equal(result.reason_code, 'repeated_failure_recall');
});

test('the repeat threshold is two', () => {
  assert.equal(MIN_REPEATS, 2);
});
