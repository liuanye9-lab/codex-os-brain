'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildCodexArgs,
  buildTaskPacket,
  classifyInfrastructureFailure,
  parseUsageEvents,
  runDelegatedTask,
} = require('../scripts/brain-lite-delegate');

const schemaPath = path.resolve(__dirname, '../schemas/brain-lite-child-output.schema.json');
const route = {
  routeId: 'spark-high',
  model: 'gpt-5.3-codex-spark',
  effort: 'high',
  timeoutMs: 600000,
  policyVersion: 'brain-lite-router-v1',
  probe: false,
  executionBudget: {
    maxAttempts: 3,
    maxInfrastructureRetries: 1,
    maxCapabilityEscalations: 2,
    totalWallTimeMs: 1800000,
  },
};

test('buildCodexArgs fixes the model, effort, read-only sandbox, ephemeral session, and schema', () => {
  const args = buildCodexArgs(route, {
    cwd: '/tmp/brain-project',
    schemaPath,
    outputPath: '/tmp/brain-child-output.json',
  });

  assert.deepEqual(args.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(args.includes('--ignore-user-config'));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', route.model]);
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.deepEqual(args.slice(args.indexOf('--output-schema'), args.indexOf('--output-schema') + 2), ['--output-schema', schemaPath]);
  assert.ok(args.includes('model_reasoning_effort=high'));
  assert.equal(args.at(-1), '-');
  assert.equal(args.some((arg) => /rm -rf|user prompt/.test(arg)), false);
});

test('buildTaskPacket sends only the bounded contract and explicit read-only boundary', () => {
  const packet = buildTaskPacket({
    goal: 'Inspect the parser and propose a minimal fix.',
    taskFamily: 'bounded-coding',
    hardConstraints: ['Do not modify files'],
    relevantFiles: ['src/parser.js'],
    verificationCommands: ['node --test tests/parser.test.js'],
    fullConversation: 'must not leak',
    privateMemory: 'must not leak',
  });

  assert.equal(packet.goal, 'Inspect the parser and propose a minimal fix.');
  assert.deepEqual(packet.permissions, { filesystem: 'read-only', externalSideEffects: false });
  assert.equal('fullConversation' in packet, false);
  assert.equal('privateMemory' in packet, false);
  assert.match(packet.outputContract, /structured JSON/i);
});

test('parseUsageEvents totals usage from JSONL without trusting the final prose', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 8 } }),
  ].join('\n');

  assert.deepEqual(parseUsageEvents(stdout), {
    inputTokens: 150,
    cachedInputTokens: 50,
    outputTokens: 28,
    threadId: 'thread-1',
  });
});

test('classifies timeout, quota, network, auth, and process failures separately', () => {
  assert.equal(classifyInfrastructureFailure({ timedOut: true }), 'timeout');
  assert.equal(classifyInfrastructureFailure({ exitCode: 1, stderr: '429 rate limit exceeded' }), 'quota');
  assert.equal(classifyInfrastructureFailure({ exitCode: 1, stderr: 'connection reset by peer' }), 'network');
  assert.equal(classifyInfrastructureFailure({ exitCode: 1, stderr: 'authentication required' }), 'auth');
  assert.equal(classifyInfrastructureFailure({ exitCode: 1, stderr: 'unexpected child failure' }), 'process');
  assert.equal(classifyInfrastructureFailure({ exitCode: 0, stderr: '' }), null);
  assert.equal(
    classifyInfrastructureFailure({ exitCode: 0, stdout: '{"summary":"Discusses quota and network limits."}', stderr: '' }),
    null,
    'a successful model response must not be reclassified from incidental prose',
  );
});

test('runDelegatedTask uses argv plus stdin, returns structured output and a ledger-ready event', async () => {
  let invocation;
  const output = {
    summary: 'The parser misses the empty-input branch.',
    evidence: ['src/parser.js:18'],
    proposedPatch: 'Add an early return for empty input.',
    verification: ['node --test tests/parser.test.js'],
    risks: [],
    needsEscalation: false,
    escalationReason: null,
  };
  const result = await runDelegatedTask({
    route,
    task: {
      taskId: 'task-safe-1',
      taskFamily: 'bounded-coding',
      goal: 'Inspect the parser.',
      relevantFiles: ['src/parser.js'],
      verificationCommands: ['node --test tests/parser.test.js'],
    },
    cwd: '/tmp/brain-project',
    schemaPath,
    outputPath: '/tmp/brain-child-output.json',
    codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex',
  }, {
    runProcess: async (request) => {
      invocation = request;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 25, cached_input_tokens: 5, output_tokens: 10 } }),
        stderr: '',
        timedOut: false,
        durationMs: 123,
      };
    },
    readFile: () => JSON.stringify(output),
  });

  assert.equal(invocation.shell, false);
  assert.equal(invocation.command, '/Applications/ChatGPT.app/Contents/Resources/codex');
  assert.match(invocation.input, /Inspect the parser/);
  assert.equal(invocation.args.includes('Inspect the parser.'), false);
  assert.deepEqual(result.output, output);
  assert.equal(result.usage.outputTokens, 10);
  assert.equal(result.infrastructureFailure, null);
  assert.equal(result.ledgerEvent.modelClaimedSuccess, true);
  assert.equal(result.ledgerEvent.verifierPassed, null);
  assert.match(result.ledgerEvent.traceId, /^trace_/);
  assert.match(result.ledgerEvent.taskFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.ledgerEvent.phase, 'child');
  assert.equal(result.ledgerEvent.policyVersion, 'brain-lite-router-v1');
  assert.equal(result.ledgerEvent.attempt, 1);
  assert.equal(result.ledgerEvent.maxAttempts, 3);
});

test('delegate CLI exposes file-based inputs so task text never needs shell interpolation', () => {
  const script = path.resolve(__dirname, '../scripts/brain-lite-delegate.js');
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--route-file/);
  assert.match(result.stdout, /--task-file/);
  assert.match(result.stdout, /--ledger/);
});

test('delegation refuses attempts beyond the route budget before launching a process', async () => {
  let launched = false;
  await assert.rejects(() => runDelegatedTask({
    route,
    task: { goal: 'Inspect one file.', taskFamily: 'bounded-coding', attempt: 4 },
    cwd: '/tmp/brain-project',
    schemaPath,
    outputPath: '/tmp/brain-child-output.json',
  }, {
    runProcess: async () => {
      launched = true;
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
    },
  }), /attempt budget exhausted/);
  assert.equal(launched, false);
});
