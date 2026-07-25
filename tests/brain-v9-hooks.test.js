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

test('non-policy hook failures are visible and fail-closed events block', async () => {
  const degraded = await dispatchHook({ hook_event_name: 'PostToolUse' }, {
    enabled: true,
    handlers: { PostToolUse: () => { throw new Error('disk full'); } },
    failClosedEvents: new Set(['PreToolUse', 'Stop']),
    auditInternalError() { throw new Error('audit unavailable'); },
  });
  assert.equal(degraded.reason_code, 'hook_runtime_failed');
  assert.match(degraded.hookSpecificOutput.additionalContext, /DEGRADED/);

  const blocked = await dispatchHook({ hook_event_name: 'Stop' }, {
    enabled: true,
    handlers: { Stop: () => { throw new Error('event store unavailable'); } },
    failClosedEvents: new Set(['Stop']),
    auditInternalError() {},
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.reason_code, 'hook_runtime_failed');
});

test('normalization keeps bounded identifiers and drops transcript path', () => {
  const value = normalizeHookInput({ hook_event_name: 'PostToolUse', session_id: 's1', turn_id: 't1', transcript_path: '/private/transcript.jsonl', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(value.event, 'PostToolUse');
  assert.equal(value.sessionId, 's1');
  assert.equal(value.transcriptPath, undefined);
  assert.deepEqual(value.toolInput, { command: 'npm test' });
});

test('normalized Stop events force a live verifier rerun', () => {
  assert.equal(normalizeHookInput({ hook_event_name: 'Stop' }).forceVerify, true);
});

test('Stop blocks when the live verifier crashes instead of trusting stale state', async () => {
  const core = {
    contracts: { active: () => ({ taskId: 'stale' }) },
    verification: {
      run: () => { throw new Error('verifier crashed'); },
      evaluateActive: () => ({ status: 'complete' }),
    },
  };
  const output = await handleStop({ event: 'Stop', completionClaim: true, forceVerify: true }, core);
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /verifier_runtime/);
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
  const warning = await handleObservation(input, core);
  assert.equal(warning.reason_code, 'repeated_failure_warning');
  const output = await handleObservation(input, core);
  assert.equal(output.reason_code, 'repeated_failure_circuit_open');
});

test('successful observation resets an existing circuit', async () => {
  let reset = false;
  const core = {
    failures: { succeed: () => { reset = true; } },
    events: { append() {} },
  };
  assert.deepEqual(await handleObservation({ event: 'PostToolUse', toolName: 'Bash', toolResult: { ok: true } }, core), {});
  assert.equal(reset, true);
});

test('SessionStart searches SQLite memory and makes retrieval failure visible', async () => {
  const contract = { taskId: 'memory-hook', objective: 'SQLite retrieval', constraints: [], unresolved: [], criteria: [] };
  let query;
  const core = {
    contracts: { active: () => contract },
    memory: {
      search: input => {
        query = input;
        return { results: [{ content: 'Use the current SQLite memory service.', sourceRef: 'memory:confirmed' }] };
      },
    },
  };
  const output = await handleSession({ event: 'SessionStart' }, core);
  assert.equal(query.query, contract.objective);
  assert.match(output.hookSpecificOutput.additionalContext, /UNVERIFIED MEMORY/);
  assert.match(output.hookSpecificOutput.additionalContext, /SQLite memory service/);

  const degraded = await handleSession({ event: 'SessionStart' }, {
    contracts: { active: () => contract },
    memory: { search: () => { throw new Error('database unavailable'); } },
    events: { append() {} },
  });
  assert.match(degraded.hookSpecificOutput.additionalContext, /MEMORY RETRIEVAL DEGRADED/);
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

test('Stop blocks when the active contract file disappears behind its guard', async () => {
  const core = {
    contracts: {
      state: () => ({ expected: true, contract: null, missing: true, corrupt: false }),
      active: () => null,
    },
  };
  const output = await handleStop({ event: 'Stop', completionClaim: true }, core);
  assert.equal(output.decision, 'block');
  assert.equal(output.reason_code, 'active_contract_missing');
});
