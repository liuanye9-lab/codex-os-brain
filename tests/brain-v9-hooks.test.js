'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { normalizeHookInput } = require('../scripts/v9/hooks/input');
const { dispatchHook } = require('../scripts/v9/hook-dispatch');
const { handleSession } = require('../scripts/v9/hooks/session');
const { handleRisk } = require('../scripts/v9/hooks/risk');
const { handleObservation } = require('../scripts/v9/hooks/observer');
const { handleStop } = require('../scripts/v9/hooks/stop');

test('unknown or disabled hooks produce an empty object', async () => {
  assert.deepEqual(await dispatchHook({ hook_event_name: 'Unknown' }, { enabled: false, handlers: {}, failClosedEvents: new Set(), auditInternalError() {} }), {});
});

test('normalization keeps bounded identifiers and drops transcript path', () => {
  const value = normalizeHookInput({ hook_event_name: 'PostToolUse', session_id: 's1', turn_id: 't1', transcript_path: '/private/transcript.jsonl', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(value.event, 'PostToolUse');
  assert.equal(value.sessionId, 's1');
  assert.equal(value.transcriptPath, undefined);
  assert.deepEqual(value.toolInput, { command: 'npm test' });
});

test('SessionStart is silent without an active task and compact recovery is bounded', async () => {
  assert.deepEqual(await handleSession({ event: 'SessionStart' }, { contracts: { active: () => null } }), {});
  const core = { contracts: { active: () => ({ objective: 'finish v9', constraints: [{ explicit: true, text: 'preserve v8' }], unresolved: ['verify'], criteria: [] }) } };
  const output = await handleSession({ event: 'PostCompact' }, core);
  assert.match(output.hookSpecificOutput.additionalContext, /finish v9/);
  assert.ok(output.hookSpecificOutput.additionalContext.length < 1000);
});

test('PreToolUse blocks forbidden scope and stays within latency budget', async () => {
  const core = { contracts: { evaluateAction: () => ({ level: 4, reasonCode: 'scope_forbidden', message: 'Forbidden.' }) } };
  const started = performance.now();
  const output = await handleRisk({ event: 'PreToolUse', toolName: 'Write', toolInput: { file_path: '/outside/secret' } }, core);
  assert.equal(output.permissionDecision, 'deny');
  assert.equal(output.reason_code, 'scope_forbidden');
  assert.ok(performance.now() - started < 100);
});

test('third identical failure opens the circuit', async () => {
  let count = 0;
  const core = { failures: { record: () => ({ state: { status: ++count >= 3 ? 'open' : 'warning' } }) }, events: { append() {} } };
  const input = { event: 'PostToolUse', toolName: 'Bash', toolResult: { ok: false }, errorType: 'ENOENT' };
  await handleObservation(input, core);
  await handleObservation(input, core);
  const output = await handleObservation(input, core);
  assert.equal(output.reason_code, 'repeated_failure_circuit_open');
});

test('Stop rejects completion without evidence', async () => {
  const core = { verification: { evaluateActive: () => ({ status: 'partial', missing: ['tests'], failed: [], unverified: [] }) } };
  const output = await handleStop({ event: 'Stop', completionClaim: true }, core);
  assert.equal(output.decision, 'block');
  assert.equal(output.reason_code, 'completion_unverified');
});

test('Stop stays silent when no V9 task contract is active', async () => {
  const core = {
    contracts: { active: () => null },
    verification: { evaluateActive: () => { throw new Error('must not evaluate'); } },
  };
  assert.deepEqual(await handleStop({ event: 'Stop', completionClaim: true }, core), {});
});
