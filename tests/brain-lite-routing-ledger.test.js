'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  appendEvent,
  readEvents,
  sanitizeEvent,
  derivePolicyState,
  hashText,
} = require('../scripts/brain-lite-routing-ledger');

function tempLedger() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-ledger-'));
  return path.join(root, 'nested', 'router-ledger.jsonl');
}

function event(overrides = {}) {
  const output = {
    receiptVersion: 1,
    timestamp: '2026-07-12T03:00:00.000Z',
    taskId: 'task-1',
    taskFamily: 'bounded-coding',
    taskFingerprint: 'abc123',
    routeId: 'spark-high',
    model: 'gpt-5.3-codex-spark',
    effort: 'high',
    taskRisk: 'low',
    verifiable: true,
    verifierPassed: true,
    phase: 'verified',
    outcomeSource: 'pinned-local-verifier',
    verifierAuthority: 'codex-brain-policy-v1',
    verifierPolicyHash: 'a'.repeat(64),
    outcomeEligible: true,
    capabilityOutcome: 'pass',
    modelClaimedSuccess: true,
    finalDelivered: true,
    exitStatus: 0,
    ...overrides,
  };
  if (overrides.capabilityOutcome === undefined) output.capabilityOutcome = output.verifierPassed ? 'pass' : 'fail';
  if (output.infrastructureFailure || output.infrastructureFailureType) {
    if (overrides.outcomeEligible === undefined) output.outcomeEligible = false;
    if (overrides.capabilityOutcome === undefined) output.capabilityOutcome = 'unknown';
  }
  return output;
}

test('appendEvent keeps an allowlisted, redacted, path-minimized JSONL record', () => {
  const file = tempLedger();
  const githubToken = ['ghp', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('_'); // pragma: allowlist secret
  const syntheticEmail = ['owner', 'example.com'].join('@');
  const homePath = ['', 'Users', 'example', 'secret', 'project', 'app.js'].join('/');
  const envKey = ['API', 'KEY'].join('_');
  const secretValue = ['live', 'secret', 'value'].join('-');
  appendEvent(file, event({
    taskId: `${syntheticEmail}-${githubToken}`,
    reason: `Read ${homePath} with ${envKey}=${secretValue}.`,
    relevantFiles: [homePath, '/tmp/work/test.js'],
    rawPrompt: 'This must never be stored',
    rawOutput: 'This must never be stored either',
  }));

  const raw = fs.readFileSync(file, 'utf8');
  const [saved] = readEvents(file);
  assert.doesNotMatch(raw, /owner@example\.com|ghp_|live-secret-value|Users\/example|rawPrompt|rawOutput/);
  assert.deepEqual(saved.relevantFiles, ['app.js', 'test.js']);
  assert.match(saved.taskId, /\[redacted-email\]/);
  assert.equal(saved.schemaVersion, 1);
  assert.match(saved.eventId, /^evt_[a-f0-9]{24}$/);
});

test('appendEvent is idempotent for the same trace phase and outcome', () => {
  const file = tempLedger();
  const original = event({ traceId: 'trace-1', phase: 'verified', attempt: 1 });
  const first = appendEvent(file, original);
  const second = appendEvent(file, original);

  assert.equal(first.eventId, second.eventId);
  assert.equal(readEvents(file).length, 1);
});

test('ledger hash chain rejects manual edits', () => {
  const file = tempLedger();
  appendEvent(file, event({ taskId: 'chain-1', taskFingerprint: 'chain-fp-1' }));
  appendEvent(file, event({ taskId: 'chain-2', taskFingerprint: 'chain-fp-2' }));
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].verifierPassed = false;
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  assert.throws(() => readEvents(file), /Invalid ledger hash/);
});

test('ledger MAC rejects an attacker who recomputes the public hash chain', () => {
  const file = tempLedger();
  const integrityKey = Buffer.alloc(32, 3);
  appendEvent(file, event({ taskId: 'mac-1', taskFingerprint: 'mac-fp-1' }), { integrityKey });
  appendEvent(file, event({ taskId: 'mac-2', taskFingerprint: 'mac-fp-2' }), { integrityKey });

  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].verifierPassed = false;
  const unhashed = { ...rows[0] };
  delete unhashed.eventHash;
  delete unhashed.ledgerMac;
  rows[0].eventHash = hashText(JSON.stringify(unhashed));
  rows[1].previousEventHash = rows[0].eventHash;
  const secondUnhashed = { ...rows[1] };
  delete secondUnhashed.eventHash;
  delete secondUnhashed.ledgerMac;
  rows[1].eventHash = hashText(JSON.stringify(secondUnhashed));
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  assert.throws(() => readEvents(file, { integrityKey }), /Invalid ledger MAC/);
});

test('ledger cannot bypass MAC verification by downgrading records to an unsigned format', () => {
  const file = tempLedger();
  const integrityKey = Buffer.alloc(32, 4);
  appendEvent(file, event({ taskId: 'downgrade-1', taskFingerprint: 'downgrade-fp-1' }), { integrityKey });

  const [row] = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  delete row.integrityVersion;
  delete row.previousEventHash;
  delete row.eventHash;
  delete row.ledgerMac;
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`);

  assert.throws(() => readEvents(file, { integrityKey }), /Unsigned ledger event/);
});

test('sanitizeEvent drops unknown nested content rather than recursively storing it', () => {
  const saved = sanitizeEvent(event({
    privateMemory: { raw: 'private' },
    featureSummary: { clarity: 'clear', verifiable: true, secret: 'nope' }, // pragma: allowlist secret
  }));

  assert.equal('privateMemory' in saved, false);
  assert.deepEqual(saved.featureSummary, { clarity: 'clear', verifiable: true });
});

test('three independently verified passes establish a stable route', () => {
  const events = [0, 1, 2].map((index) => event({
    taskId: `task-${index}`,
    taskFingerprint: `fingerprint-${index}`,
    timestamp: `2026-07-1${index}T03:00:00.000Z`,
  }));
  const state = derivePolicyState(events, { windowSize: 3 });

  assert.equal(state.taskFamilies['bounded-coding'].stableRoute.routeId, 'spark-high');
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].status, 'stable');
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].passes, 3);
});

test('repeating one representative sample cannot establish a stable route', () => {
  const events = [0, 1, 2].map((index) => event({
    taskId: `repeat-${index}`,
    taskFingerprint: 'same-sample',
    timestamp: `2026-07-1${index}T03:00:00.000Z`,
  }));
  const state = derivePolicyState(events, { windowSize: 3 });
  const route = state.taskFamilies['bounded-coding'].routes['spark-high'];

  assert.equal(route.status, 'accumulating');
  assert.equal(route.distinctSamples, 1);
  assert.equal(state.taskFamilies['bounded-coding'].stableRoute, null);
});

test('two of three verified passes remain a trial route', () => {
  const events = [
    event({ taskId: 'task-1', taskFingerprint: 'fp-1', timestamp: '2026-07-10T03:00:00.000Z' }),
    event({ taskId: 'task-2', taskFingerprint: 'fp-2', timestamp: '2026-07-11T03:00:00.000Z', verifierPassed: false, finalDelivered: false }),
    event({ taskId: 'task-3', taskFingerprint: 'fp-3', timestamp: '2026-07-12T03:00:00.000Z' }),
  ];
  const state = derivePolicyState(events, { windowSize: 3 });

  assert.equal(state.taskFamilies['bounded-coding'].stableRoute, null);
  assert.equal(state.taskFamilies['bounded-coding'].trialRoute.routeId, 'spark-high');
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].status, 'trial');
});

test('fewer than two of three passes blocks a route from becoming the default', () => {
  const events = [
    event({ taskId: 'task-1', taskFingerprint: 'fp-1', verifierPassed: false, finalDelivered: false }),
    event({ taskId: 'task-2', taskFingerprint: 'fp-2', verifierPassed: false, finalDelivered: false }),
    event({ taskId: 'task-3', taskFingerprint: 'fp-3' }),
  ];
  const state = derivePolicyState(events, { windowSize: 3 });

  assert.deepEqual(state.taskFamilies['bounded-coding'].blockedRoutes, ['spark-high']);
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].status, 'blocked');
});

test('infrastructure failures do not count as capability attempts', () => {
  const events = [
    event({ taskId: 'task-1', taskFingerprint: 'fp-1' }),
    event({ taskId: 'task-2', taskFingerprint: 'fp-2' }),
    event({ taskId: 'task-infra', infrastructureFailure: true, infrastructureFailureType: 'network', verifierPassed: false, finalDelivered: false }),
    event({ taskId: 'task-3', taskFingerprint: 'fp-3' }),
  ];
  const state = derivePolicyState(events, { windowSize: 3 });
  const route = state.taskFamilies['bounded-coding'].routes['spark-high'];

  assert.equal(route.attempts, 3);
  assert.equal(route.excludedInfrastructureFailures, 1);
  assert.equal(route.status, 'stable');
});

test('a recent critical failure revokes an older stable classification', () => {
  const events = [
    event({ taskId: 'task-1', taskFingerprint: 'fp-1', timestamp: '2026-07-08T03:00:00.000Z' }),
    event({ taskId: 'task-2', taskFingerprint: 'fp-2', timestamp: '2026-07-09T03:00:00.000Z' }),
    event({ taskId: 'task-3', taskFingerprint: 'fp-3', timestamp: '2026-07-10T03:00:00.000Z' }),
    event({ taskId: 'task-4', taskFingerprint: 'fp-4', timestamp: '2026-07-11T03:00:00.000Z', verifierPassed: false, finalDelivered: false, criticalFailure: true }),
  ];
  const state = derivePolicyState(events, { windowSize: 3 });

  assert.equal(state.taskFamilies['bounded-coding'].stableRoute, null);
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].status, 'trial');
  assert.equal(state.taskFamilies['bounded-coding'].routes['spark-high'].stableRevoked, true);
});

test('preliminary child events never count as capability failures', () => {
  const state = derivePolicyState([
    event({ phase: 'child', verifierPassed: null, finalDelivered: false }),
  ], { windowSize: 3 });
  const route = state.taskFamilies['bounded-coding'].routes['spark-high'];
  assert.equal(route.attempts, 0);
  assert.equal(route.status, 'accumulating');
});

test('repeated recent infrastructure failures open a temporary route circuit', () => {
  const events = [
    event({ taskId: 'infra-1', timestamp: '2026-07-12T10:10:00.000Z', infrastructureFailure: true, infrastructureFailureType: 'network', verifierPassed: null, finalDelivered: false }),
    event({ taskId: 'infra-2', timestamp: '2026-07-12T10:20:00.000Z', infrastructureFailure: true, infrastructureFailureType: 'timeout', verifierPassed: null, finalDelivered: false }),
  ];
  const state = derivePolicyState(events, {
    now: '2026-07-12T10:30:00.000Z',
    infrastructureFailureThreshold: 2,
    infrastructureWindowMs: 60 * 60 * 1000,
    cooldownMs: 30 * 60 * 1000,
  });

  assert.equal(state.infrastructureRoutes['spark-high'].recentFailures, 2);
  assert.equal(state.infrastructureRoutes['spark-high'].cooldownUntil, '2026-07-12T11:00:00.000Z');
});

test('ledger CLI supports file-based append and deterministic policy derivation', () => {
  const script = path.resolve(__dirname, '../scripts/brain-lite-routing-ledger.js');
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /append.+--event-file/s);
  assert.match(result.stdout, /derive.+--output/s);
});
