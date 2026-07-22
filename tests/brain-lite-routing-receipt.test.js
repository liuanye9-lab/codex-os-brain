'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readEvents } = require('../scripts/brain-lite-routing-ledger');
const { recordVerifiedReceipt, runVerifier } = require('../scripts/brain-lite-routing-receipt');

function fixture(overrides = {}) {
  const value = {
    schemaVersion: 1,
    task: { taskId: 'task-receipt-1', taskFamily: 'bounded-coding', taskFingerprint: 'fingerprint-0001', risk: 'low', relevantFiles: ['src/app.js'] },
    route: { routeId: 'spark-high', model: 'gpt-5.3-codex-spark', effort: 'high', policyVersion: 'brain-lite-router-v1', traceId: 'trace-receipt-1', executionMode: 'delegated', attempt: 1, maxAttempts: 3 },
    execution: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 25, durationMs: 500, exitStatus: 0, modelClaimedSuccess: true },
    verification: { failureAttribution: 'unknown', checks: [{ kind: 'test', command: 'node', args: ['--test', 'tests/example.test.js'] }], artifacts: ['artifact.txt'] },
    delivery: { finalDelivered: true, userCorrected: false, criticalFailure: false },
  };
  return { ...value, ...overrides };
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-routing-receipt-'));
  fs.writeFileSync(path.join(root, 'artifact.txt'), 'verified artifact\n');
  return { root, ledger: path.join(root, 'router-ledger.jsonl'), trace: path.join(root, 'trace.jsonl'), policy: path.join(root, 'policy.json') };
}

test('verifier uses argv without shell interpolation and stores only hashes', () => {
  let invocation;
  const result = runVerifier({ kind: 'test', command: 'node', args: ['--test', 'tests/unit.test.js'] }, { cwd: '/tmp/project' }, {
    spawnSync: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: 'private test output', stderr: '', signal: null };
    },
  });
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.args, ['--test', 'tests/unit.test.js']);
  assert.equal(result.passed, true);
  assert.match(result.verifierCommandHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('private test output'), false);
});

test('passing independent verifier creates an eligible ledger receipt and V8 trace', () => {
  const files = workspace();
  const result = recordVerifiedReceipt(fixture(), { cwd: files.root, ledger: files.ledger, trace: files.trace, policyState: files.policy, timestamp: '2026-07-22T02:00:00.000Z' }, {
    spawnSync: () => ({ status: 0, stdout: 'ok', stderr: '', signal: null }),
  });
  assert.equal(result.event.receiptVersion, 1);
  assert.equal(result.event.verifierPassed, true);
  assert.equal(result.event.capabilityOutcome, 'pass');
  assert.equal(result.event.outcomeEligible, true);
  assert.equal(result.event.outcomeSource, 'independent-verifier');
  assert.equal(result.event.verifierAuthority, 'mother-agent');
  assert.match(result.event.artifactHash, /^[a-f0-9]{64}$/);
  assert.equal(readEvents(files.ledger).length, 1);
  assert.equal(fs.readFileSync(files.ledger, 'utf8').includes('private test output'), false);
  assert.equal(JSON.parse(fs.readFileSync(files.policy, 'utf8')).evidenceQuality.eligibleReceipts, 1);
  assert.equal(fs.readFileSync(files.trace, 'utf8').split(/\n/).filter(Boolean).length, 1);
});

test('failed verifier is excluded until failure attribution identifies model capability', () => {
  const unknown = workspace();
  const unknownResult = recordVerifiedReceipt(fixture({ delivery: { finalDelivered: false }, verification: { failureAttribution: 'unknown', checks: [{ kind: 'test', command: 'node', args: ['--test'] }] } }), { cwd: unknown.root, ledger: unknown.ledger }, {
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'assertion failed', signal: null }),
  });
  assert.equal(unknownResult.event.verifierPassed, false);
  assert.equal(unknownResult.event.capabilityOutcome, 'unknown');
  assert.equal(unknownResult.event.outcomeEligible, false);

  const attributed = workspace();
  const attributedResult = recordVerifiedReceipt(fixture({ delivery: { finalDelivered: false }, verification: { failureAttribution: 'model-capability', checks: [{ kind: 'test', command: 'node', args: ['--test'] }] } }), { cwd: attributed.root, ledger: attributed.ledger, policyState: attributed.policy }, {
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'assertion failed', signal: null }),
  });
  assert.equal(attributedResult.event.capabilityOutcome, 'fail');
  assert.equal(attributedResult.event.outcomeEligible, true);
  assert.equal(JSON.parse(fs.readFileSync(attributed.policy, 'utf8')).evidenceQuality.eligibleReceipts, 1);
});

test('verifier timeout is infrastructure and never becomes a model-capability sample', () => {
  const files = workspace();
  const result = recordVerifiedReceipt(fixture({ delivery: { finalDelivered: false }, verification: { failureAttribution: 'model-capability', checks: [{ kind: 'test', command: 'node', args: ['--test'] }] } }), { cwd: files.root, ledger: files.ledger }, {
    spawnSync: () => ({ status: null, stdout: '', stderr: '', signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }),
  });
  assert.equal(result.event.infrastructureFailureType, 'verifier-timeout');
  assert.equal(result.event.outcomeEligible, false);
});

test('receipt rejects shell strings and artifacts outside the verifier cwd', () => {
  assert.throws(() => runVerifier({ command: 'bash', args: ['-c', 'npm test'] }, { cwd: '/tmp' }, { spawnSync }), /routing_verifier_shell_string_rejected/);
  const files = workspace();
  const input = fixture({ verification: { failureAttribution: 'unknown', checks: [{ kind: 'test', command: 'node', args: ['--test'] }], artifacts: ['../outside.txt'] } });
  assert.throws(() => recordVerifiedReceipt(input, { cwd: files.root, ledger: files.ledger }, { spawnSync: () => ({ status: 0, stdout: '', stderr: '' }) }), /routing_receipt_artifact_outside_cwd/);
});

test('receipt CLI requires file-based input and explicit cwd', () => {
  const script = path.resolve(__dirname, '../scripts/brain-lite-routing-receipt.js');
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--receipt-file/);
  assert.match(result.stdout, /--ledger/);
  assert.match(result.stdout, /--cwd/);
});
