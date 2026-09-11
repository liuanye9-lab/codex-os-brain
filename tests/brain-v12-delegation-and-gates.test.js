'use strict';
// Coverage for the V12 additions: the stop-gate escape valve, the governance manifest gate,
// declared baseline exclusions, and the delegation ledger.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { clearStopGate, evaluateStopGate, readStopGate } = require('../scripts/v9/stop-gate');
const { assessSplit, claimUnits, completeUnit, fanoutStatus, registerUnits } = require('../scripts/v9/fanout');
const { withFileLock } = require('../scripts/v9/store');
const { captureVerifierBaseline, runVerifier, verifyVerifierBaseline } = require('../scripts/v9/verifiers');
const { handleStop } = require('../scripts/v9/hooks/stop');

function tempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v12-'));
  return { root, paths: { stopGateRoot: path.join(root, 'stop-gate'), fanoutRoot: path.join(root, 'fanout') } };
}

// ---------------------------------------------------------------- stop gate

test('stop gate keeps blocking while the agent is still closing criteria', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', taskId: 't' };
  for (const remaining of [['a', 'b', 'c'], ['a', 'b'], ['a']]) {
    assert.equal(evaluateStopGate({ ...scope, remaining }).allowBlock, true);
  }
});

test('stop gate releases when the same criteria repeat with no progress', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', taskId: 't', remaining: ['tests'] };
  assert.equal(evaluateStopGate(scope).allowBlock, true);
  assert.equal(evaluateStopGate(scope).allowBlock, true);
  const third = evaluateStopGate(scope);
  assert.equal(third.allowBlock, false);
  assert.equal(third.releaseReason, 'no_progress_between_attempts');
});

test('stop gate releases at the block cap even while criteria keep changing', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', taskId: 't' };
  const sets = [['a', 'b', 'c'], ['a', 'b'], ['a'], ['z']];
  const outcomes = sets.map(remaining => evaluateStopGate({ ...scope, remaining }));
  assert.deepEqual(outcomes.map(entry => entry.allowBlock), [true, true, true, false]);
  assert.equal(outcomes.at(-1).releaseReason, 'block_cap_reached');
});

test('a released stop gate stays released for the same unresolved set', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', taskId: 't', remaining: ['x'] };
  for (let i = 0; i < 4; i += 1) evaluateStopGate(scope);
  const again = evaluateStopGate(scope);
  assert.equal(again.allowBlock, false);
  assert.equal(again.alreadyReleased, true);
});

test('a genuine pass clears the ledger so the next task gets a full budget', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', taskId: 't' };
  evaluateStopGate({ ...scope, remaining: ['x'] });
  evaluateStopGate({ ...scope, remaining: ['x'] });
  assert.equal(clearStopGate(scope), true);
  assert.equal(readStopGate(scope).blocks, 0);
  assert.equal(evaluateStopGate({ ...scope, remaining: ['x'] }).allowBlock, true);
});

test('the escape valve is per task and per project, never global', () => {
  const { paths } = tempPaths();
  const stuck = { paths, projectScope: 'p1', taskId: 'stuck', remaining: ['x'] };
  for (let i = 0; i < 4; i += 1) evaluateStopGate(stuck);
  assert.equal(evaluateStopGate(stuck).allowBlock, false);
  // A different task, and the same task in another project, both start fresh.
  assert.equal(evaluateStopGate({ paths, projectScope: 'p1', taskId: 'other', remaining: ['x'] }).allowBlock, true);
  assert.equal(evaluateStopGate({ paths, projectScope: 'p2', taskId: 'stuck', remaining: ['x'] }).allowBlock, true);
});

test('Stop keeps blocking when the gate ledger cannot be read, rather than failing open', async () => {
  // Stop is a fail-closed event: an unwritable state dir must not become a way to disable the gate.
  const core = {
    paths: { stopGateRoot: '/proc/nonexistent-forbidden/stop-gate' },
    contracts: { active: () => ({ taskId: 't', objective: 'o' }) },
    verification: { run: () => ({ status: 'partial', failed: ['tests'] }) },
  };
  const output = await handleStop({ event: 'Stop', completionClaim: true, forceVerify: true, projectRoot: os.tmpdir() }, core);
  assert.equal(output.decision, 'block');
});

test('Stop reports the remaining gate budget so the agent knows the gate is bounded', async () => {
  const { root, paths } = tempPaths();
  const core = {
    paths,
    contracts: { active: () => ({ taskId: 'budget', objective: 'o' }) },
    verification: { run: () => ({ status: 'partial', failed: ['tests'] }) },
  };
  const output = await handleStop({ event: 'Stop', completionClaim: true, forceVerify: true, projectRoot: root }, core);
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Gate attempt 1\/3/);
});

test('Stop stops blocking once the gate releases, and records that it was not verified', async () => {
  const { root, paths } = tempPaths();
  const summaries = [];
  const core = {
    paths,
    contracts: { active: () => ({ taskId: 'stuck', objective: 'o' }) },
    verification: { run: () => ({ status: 'partial', failed: ['tests'] }) },
    handoff: { writeProgress: input => summaries.push(input.sessionSummary) },
  };
  const input = { event: 'Stop', completionClaim: true, forceVerify: true, projectRoot: root };
  assert.equal((await handleStop(input, core)).decision, 'block');
  assert.equal((await handleStop(input, core)).decision, 'block');
  assert.deepEqual(await handleStop(input, core), {});
  assert.match(summaries.at(-1), /released WITHOUT verification/);
  assert.match(summaries.at(-1), /no_progress_between_attempts/);
});

// --------------------------------------------------------- governance gate

function writeManifest(dir, value) {
  fs.writeFileSync(path.join(dir, 'knowledge-manifest.json'), JSON.stringify(value));
  return { cwd: dir };
}

test('governance gate blocks entries that are not production ready', () => {
  const { root } = tempPaths();
  const context = writeManifest(root, { entries: [{ id: 'a', production_ready: true }, { id: 'b', production_ready: false }] });
  const outcome = runVerifier({ id: 'governance' }, {}, context);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.summary.blocked, 1);
  assert.deepEqual(outcome.summary.blockingSample, [{ id: 'b', reason: 'not_production_ready' }]);
});

test('governance gate treats an absent readiness flag as consent withheld', () => {
  const { root } = tempPaths();
  const outcome = runVerifier({ id: 'governance' }, {}, writeManifest(root, { entries: [{ id: 'a' }] }));
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.summary.blockingSample[0].reason, 'production_ready_absent');
});

test('governance gate refuses a manifest whose references do not resolve', () => {
  const { root } = tempPaths();
  const context = writeManifest(root, { entries: [{ id: 'a', production_ready: true, source_ids: ['ghost'] }] });
  const outcome = runVerifier({ id: 'governance' }, {}, context);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.summary.danglingRefs, 1);
});

test('governance gate passes only when every entry is ready and every reference resolves', () => {
  const { root } = tempPaths();
  const context = writeManifest(root, {
    entries: [{ id: 'a', production_ready: true }, { id: 'b', production_ready: true, parent_id: 'a' }],
  });
  const outcome = runVerifier({ id: 'governance' }, {}, context);
  assert.equal(outcome.status, 'passed');
  assert.equal(outcome.summary.total, 2);
});

test('governance gate fails closed on a missing, empty or unreadable manifest', () => {
  const { root } = tempPaths();
  assert.equal(runVerifier({ id: 'governance' }, {}, { cwd: root }).summary.reason, 'manifest_missing');
  assert.equal(runVerifier({ id: 'governance' }, {}, writeManifest(root, { entries: [] })).summary.reason, 'manifest_empty');
  fs.writeFileSync(path.join(root, 'knowledge-manifest.json'), '{ not json');
  assert.equal(runVerifier({ id: 'governance' }, {}, { cwd: root }).summary.reason, 'manifest_unreadable');
});

test('a caller-supplied verifier spec reaches the verifier', () => {
  // Regression: runVerifier used to discard its spec argument, so a manifest kept anywhere other
  // than the default path silently reported itself missing.
  const { root } = tempPaths();
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'workspace', 'knowledge-manifest.json'),
    JSON.stringify({ entries: [{ id: 'a', production_ready: false }] }),
  );
  const outcome = runVerifier({ id: 'governance' }, { manifest: 'workspace/knowledge-manifest.json' }, { cwd: root });
  assert.equal(outcome.summary.reason, 'entries_not_production_ready');
  assert.equal(outcome.summary.blockingSample[0].id, 'a');
});

test('the signed contract outranks a caller spec, so a verifier cannot be retargeted', () => {
  const { root } = tempPaths();
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'workspace', 'knowledge-manifest.json'),
    JSON.stringify({ entries: [{ id: 'blocked', production_ready: false }] }),
  );
  fs.writeFileSync(path.join(root, 'easy.json'), JSON.stringify({ entries: [{ id: 'ok', production_ready: true }] }));

  const outcome = runVerifier(
    { id: 'governance', verifierSpec: { manifest: 'workspace/knowledge-manifest.json' } },
    { manifest: 'easy.json' },
    { cwd: root },
  );
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.summary.manifest, path.join(root, 'workspace', 'knowledge-manifest.json'));
});

// ------------------------------------------------------ baseline exclusions

test('declared exclusions let a task write its own artifacts without tripping the seal', () => {
  const { root } = tempPaths();
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"true"}}');
  fs.writeFileSync(path.join(root, 'workspace', 'manifest.json'), '{"entries":[]}');

  const baseline = captureVerifierBaseline(root, ['package.json', 'workspace'], ['workspace']);
  fs.writeFileSync(path.join(root, 'workspace', 'manifest.json'), '{"entries":[{"id":"a"}]}');
  assert.equal(verifyVerifierBaseline(root, baseline).valid, true);
});

test('exclusions never weaken the seal over inputs that were not excluded', () => {
  const { root } = tempPaths();
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"real-suite"}}');
  fs.writeFileSync(path.join(root, 'workspace', 'out.txt'), 'a');

  const baseline = captureVerifierBaseline(root, ['package.json', 'workspace'], ['workspace']);
  // The classic abuse: rewrite the test command until it passes.
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"exit 0"}}');
  const outcome = verifyVerifierBaseline(root, baseline);
  assert.equal(outcome.valid, false);
  assert.equal(outcome.reason, 'verifier_inputs_changed');
});

// ------------------------------------------------------- delegation ledger

test('two workers are never handed the same unit', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] });
  const first = claimUnits({ ...scope, worker: 'A', limit: 2 }).claimed;
  const second = claimUnits({ ...scope, worker: 'B', limit: 2 }).claimed;
  assert.deepEqual(first, ['u1', 'u2']);
  assert.deepEqual(second, ['u3']);
  assert.equal(first.filter(unit => second.includes(unit)).length, 0);
});

test('finished work is injected into later dispatches instead of being re-claimed', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1', label: 'inventory A' }, { id: 'u2', label: 'inventory B' }] });
  claimUnits({ ...scope, worker: 'A', limit: 1 });
  completeUnit({ ...scope, unitId: 'u1', worker: 'A', verified: true, verifierRef: 'ev#1' });
  const next = claimUnits({ ...scope, worker: 'B', limit: 5 });
  assert.deepEqual(next.claimed, ['u2']);
  assert.deepEqual(next.completedContext, ['inventory A']);
});

test('re-registering a plan never resets work that is already finished', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1' }] });
  claimUnits({ ...scope, worker: 'A', limit: 1 });
  completeUnit({ ...scope, unitId: 'u1', worker: 'A', verified: true, verifierRef: 'ev#1' });
  registerUnits({ ...scope, units: [{ id: 'u1' }, { id: 'u2' }] });
  const status = fanoutStatus(scope);
  assert.equal(status.completed, 1);
  assert.equal(status.total, 2);
});

test('a worker cannot complete a unit another worker holds, or complete one twice', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1' }] });
  claimUnits({ ...scope, worker: 'A', limit: 1 });
  assert.equal(completeUnit({ ...scope, unitId: 'u1', worker: 'B' }).reason, 'claimed_by_other_worker');
  assert.equal(completeUnit({ ...scope, unitId: 'u1', worker: 'A' }).ok, true);
  assert.equal(completeUnit({ ...scope, unitId: 'u1', worker: 'A' }).reason, 'already_terminal');
  assert.equal(completeUnit({ ...scope, unitId: 'ghost', worker: 'A' }).reason, 'unknown_unit');
});

test('unchecked delegated output is measured, not silently trusted', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1', label: 'A' }, { id: 'u2', label: 'B' }, { id: 'u3', label: 'C' }] });
  claimUnits({ ...scope, worker: 'W', limit: 3 });
  completeUnit({ ...scope, unitId: 'u1', worker: 'W', verified: true, verifierRef: 'ev#1' });
  completeUnit({ ...scope, unitId: 'u2', worker: 'W', verified: false });
  completeUnit({ ...scope, unitId: 'u3', worker: 'W', verified: false });
  const status = fanoutStatus(scope);
  assert.equal(status.completed, 3);
  assert.equal(status.verified, 1);
  assert.equal(status.zeroVerificationRate, 0.6667);
  assert.deepEqual(status.unverifiedSample, ['B', 'C']);
});

test('a verified claim without a verifier reference is not recorded as verified', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'plan' };
  registerUnits({ ...scope, units: [{ id: 'u1' }] });
  claimUnits({ ...scope, worker: 'W', limit: 1 });
  completeUnit({ ...scope, unitId: 'u1', worker: 'W', verified: false, verifierRef: 'ignored' });
  assert.equal(fanoutStatus(scope).verified, 0);
});

test('a claim is a lease, so a crashed worker never strands its units', () => {
  // Found by the A/B eval: units held by a worker that never reported back were unreachable
  // forever, and the work was silently lost.
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'lease' };
  registerUnits({ ...scope, units: [{ id: 'u1' }, { id: 'u2' }] });
  claimUnits({ ...scope, worker: 'crashed', limit: 2 });

  // While the lease is live, nobody may take the work away.
  assert.deepEqual(claimUnits({ ...scope, worker: 'healthy', limit: 5 }).claimed, []);

  // Once it expires, the units return to the pool and the reclaim is recorded.
  const retry = claimUnits({ ...scope, worker: 'healthy', limit: 5, leaseMs: 0 });
  assert.deepEqual(retry.reclaimed, ['u1', 'u2']);
  assert.deepEqual(retry.claimed, ['u1', 'u2']);
  assert.equal(fanoutStatus({ ...scope, leaseMs: 0 }).reclaimed, 2);
});

test('status surfaces units held past their lease instead of hiding them', () => {
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'stall' };
  registerUnits({ ...scope, units: [{ id: 'u1', label: 'stuck unit' }] });
  claimUnits({ ...scope, worker: 'crashed', limit: 1 });

  // Let the claim age past a 1ms lease, so the assertion does not depend on sub-millisecond timing.
  const until = Date.now() + 5;
  while (Date.now() < until) { /* deliberate short wait */ }

  const status = fanoutStatus({ ...scope, leaseMs: 1 });
  assert.equal(status.stalled, 1);
  assert.deepEqual(status.stalledSample, ['stuck unit']);

  // A unit still inside its lease is not reported as stalled.
  assert.equal(fanoutStatus({ ...scope, leaseMs: 60_000 }).stalled, 0);
});

test('a contended ledger makes workers wait instead of starving them', () => {
  // Found by a real 5-process concurrency run: lock_busy threw straight out of claimUnits, so
  // whichever workers lost the race silently received no work at all.
  const { paths } = tempPaths();
  const scope = { paths, projectScope: 'p', planId: 'contended' };
  registerUnits({ ...scope, units: [{ id: 'u1' }, { id: 'u2' }] });

  const file = path.join(paths.fanoutRoot, 'p', 'contended.json');
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999 }));

  // A lock older than the stale window must be broken rather than waited on forever.
  const past = Date.now() - 60_000;
  fs.utimesSync(lock, past / 1000, past / 1000);

  const claim = claimUnits({ ...scope, worker: 'patient', limit: 1 });
  assert.deepEqual(claim.claimed, ['u1']);
});

test('releasing a lock another process already cleared is not an error', () => {
  // The stale-lock cleanup raced itself under real concurrency and threw ENOENT mid-run.
  const { root } = tempPaths();
  const lock = path.join(root, 'racy.lock');
  const outcome = withFileLock(lock, () => {
    fs.unlinkSync(lock); // simulate another process winning the cleanup
    return 'completed';
  });
  assert.equal(outcome, 'completed');
});

test('plans and projects keep separate ledgers', () => {
  const { paths } = tempPaths();
  registerUnits({ paths, projectScope: 'p1', planId: 'x', units: [{ id: 'u1' }] });
  assert.equal(fanoutStatus({ paths, projectScope: 'p1', planId: 'x' }).total, 1);
  assert.equal(fanoutStatus({ paths, projectScope: 'p1', planId: 'y' }).total, 0);
  assert.equal(fanoutStatus({ paths, projectScope: 'p2', planId: 'x' }).total, 0);
});

// ------------------------------------------------------------ split policy

test('splitting is refused whenever units are coupled, however many there are', () => {
  const coupled = assessSplit({ units: 500, crossUnitDependency: true, sharedContextRequired: false, perUnitVerifiable: true });
  assert.equal(coupled.recommend, 'single_agent');
  assert.ok(coupled.blockers.includes('units_must_talk_to_each_other'));

  // An unqualified "shared context required" is still read as coupling.
  const shared = assessSplit({ units: 500, crossUnitDependency: false, sharedContextRequired: true, perUnitVerifiable: true });
  assert.equal(shared.recommend, 'single_agent');
  assert.ok(shared.blockers.includes('shared_mutable_state'));
});

test('shared read-only context is not coupling, but shared mutable state is', () => {
  // Found by an adversarial eval case: copying a style guide into every dispatch costs nothing,
  // so it must not force a thousand independent units back onto one agent.
  const readOnly = assessSplit({
    units: 1000, crossUnitDependency: false, sharedContextRequired: true, sharedContextMutable: false, perUnitVerifiable: true,
  });
  assert.equal(readOnly.recommend, 'fan_out');

  const mutable = assessSplit({
    units: 1000, crossUnitDependency: false, sharedContextRequired: true, sharedContextMutable: true, perUnitVerifiable: true,
  });
  assert.equal(mutable.recommend, 'single_agent');
  assert.ok(mutable.blockers.includes('shared_mutable_state'));
});

test('ordering is a dependency even when units share no data', () => {
  const ordered = assessSplit({
    units: 40, crossUnitDependency: false, sharedContextRequired: false, orderDependent: true, perUnitVerifiable: true,
  });
  assert.equal(ordered.recommend, 'single_agent');
  assert.ok(ordered.blockers.includes('units_must_be_produced_in_order'));
});

test('splitting is refused when a unit cannot be checked on its own', () => {
  const outcome = assessSplit({ units: 50, crossUnitDependency: false, sharedContextRequired: false, perUnitVerifiable: false });
  assert.equal(outcome.recommend, 'single_agent');
  assert.ok(outcome.blockers.includes('no_independent_per_unit_check'));
});

test('a handful of units does not pay for handoff loss unless context overflows', () => {
  const few = assessSplit({ units: 2, crossUnitDependency: false, sharedContextRequired: false, perUnitVerifiable: true });
  assert.equal(few.recommend, 'single_agent');
  assert.ok(few.blockers.includes('too_few_units_to_pay_for_handoffs'));

  const overflowing = assessSplit({
    units: 2, crossUnitDependency: false, sharedContextRequired: false, perUnitVerifiable: true, exceedsSingleContext: true,
  });
  assert.equal(overflowing.recommend, 'fan_out');
});

test('splitting is recommended only for many independent, individually checkable units', () => {
  const outcome = assessSplit({ units: 500, crossUnitDependency: false, sharedContextRequired: false, perUnitVerifiable: true });
  assert.equal(outcome.recommend, 'fan_out');
  assert.deepEqual(outcome.blockers, []);
});
