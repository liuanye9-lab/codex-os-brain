'use strict';
// Fan-out ledger: the state layer for delegating work to isolated sub-agents.
//
// Grounded in three measured results rather than in a preference for multi-agent architecture:
//
//   1. Step repetition is the single largest multi-agent failure mode (MAST: 17.14% of 1,600+
//      annotated traces). Telling a sub-agent "don't redo finished work" does not help, because it
//      cannot see what anyone else did. So completed units live in a ledger the lead owns and every
//      dispatch reads; dedup is enforced at the state layer, not asked for in a prompt.
//
//   2. Shared conversational context makes multi-agent worse than single-agent (agreement bias,
//      anchoring, shared blind spots). Each unit therefore carries only its own inputs, and this
//      ledger deliberately stores no transcript to hand around.
//
//   3. Under an equal thinking-token budget a single agent matches or beats a multi-agent system,
//      because every handoff can only lose information. Splitting is justified by task shape, not
//      by architecture taste -- see `assessSplit`.
//
// This is a ledger, not an orchestrator. It does not spawn, schedule or talk to models; it records
// what may be claimed, what is finished, and whether an output was ever checked.

const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteJson, readJsonSafe, withFileLock } = require('./store');

const LEDGER_VERSION = 1;
const TERMINAL = new Set(['completed', 'rejected', 'abandoned']);
// A claim is a lease. Long enough that a slow worker is never robbed mid-flight, short enough that
// a dead worker does not strand its units for the rest of the run.
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
// How long a worker will keep retrying a contended ledger before giving up and reporting it.
const LOCK_WAIT_MS = 10 * 1000;

function ledgerPath(paths, projectScope, planId) {
  const safe = String(planId || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return path.join(paths.fanoutRoot, projectScope, `${safe}.json`);
}

function emptyLedger(planId) {
  return { version: LEDGER_VERSION, planId: planId || 'default', units: {}, createdAt: null, updatedAt: null };
}

function loadLedger(file, planId) {
  const { value, corrupt } = readJsonSafe(file, null);
  if (corrupt || !value || value.version !== LEDGER_VERSION) return emptyLedger(planId);
  return value;
}

/** Stable id for a unit of work, so the same unit is recognised across dispatches. */
function unitKey(unit) {
  if (unit && typeof unit === 'object') {
    if (unit.id) return String(unit.id);
    return crypto.createHash('sha256').update(JSON.stringify(unit)).digest('hex').slice(0, 16);
  }
  return crypto.createHash('sha256').update(String(unit)).digest('hex').slice(0, 16);
}

/**
 * Take the ledger lock and apply a change.
 *
 * Under real concurrency the lock is contended, and failing immediately starves whichever workers
 * happen to lose the race — measured at four of five workers claiming nothing at all. Retry with
 * randomised backoff so contention slows a worker down instead of silently excluding it. The wait
 * is bounded: a lock that never frees must surface as an error, not as an infinite hang.
 */
function mutate(file, planId, fn) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let attempt = 0;
  for (;;) {
    try {
      return withFileLock(`${file}.lock`, () => {
        const ledger = loadLedger(file, planId);
        const now = new Date().toISOString();
        const result = fn(ledger, now);
        ledger.createdAt = ledger.createdAt || now;
        ledger.updatedAt = now;
        atomicWriteJson(file, ledger);
        return result;
      });
    } catch (error) {
      if (error.message !== 'lock_busy' || Date.now() >= deadline) throw error;
      attempt += 1;
      // Exponential backoff with jitter, so retrying workers do not resynchronise into a herd.
      const backoff = Math.min(2 ** attempt, 64) + Math.floor(Math.random() * 16);
      const until = Date.now() + backoff;
      while (Date.now() < until) { /* short spin; waits here are sub-100ms by construction */ }
    }
  }
}

/** Register the units this plan covers. Re-registering an existing unit never resets its state. */
function registerUnits({ paths, projectScope = 'default', planId = 'default', units = [] } = {}) {
  const file = ledgerPath(paths, projectScope, planId);
  return mutate(file, planId, (ledger, now) => {
    const added = [];
    for (const unit of units) {
      const key = unitKey(unit);
      if (ledger.units[key]) continue;
      ledger.units[key] = {
        key,
        label: typeof unit === 'object' ? unit.label || unit.id || key : String(unit),
        state: 'pending',
        claimedBy: null,
        verified: false,
        verifierRef: null,
        registeredAt: now,
      };
      added.push(key);
    }
    return { planId, added, total: Object.keys(ledger.units).length };
  });
}

/**
 * Claim the next units for one worker.
 *
 * Returns only units nobody holds and nobody finished, so two workers cannot be handed the same
 * work. `completedContext` is what the lead injects into the dispatch: a read-only list of what is
 * already done. Workers never write it.
 *
 * A worker that dies after claiming would otherwise strand its units forever, so a claim is a
 * lease: once it goes stale it returns to the pool. The unit is not lost, and it is not silently
 * handed out twice either — the reclaim is recorded.
 */
function claimUnits({
  paths, projectScope = 'default', planId = 'default', worker, limit = 1, leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  if (!worker) throw new Error('fanout_worker_required');
  const file = ledgerPath(paths, projectScope, planId);
  return mutate(file, planId, (ledger, now) => {
    const claimed = [];
    const reclaimed = [];
    const deadline = Date.parse(now) - Number(leaseMs);

    for (const unit of Object.values(ledger.units)) {
      if (unit.state !== 'claimed') continue;
      const claimedAt = Date.parse(unit.claimedAt || 0);
      if (Number.isFinite(claimedAt) && claimedAt < deadline) {
        unit.state = 'pending';
        unit.reclaimedFrom = unit.claimedBy;
        unit.reclaimCount = (unit.reclaimCount || 0) + 1;
        unit.claimedBy = null;
        unit.claimedAt = null;
        reclaimed.push(unit.key);
      }
    }

    for (const unit of Object.values(ledger.units)) {
      if (claimed.length >= limit) break;
      if (unit.state !== 'pending') continue;
      unit.state = 'claimed';
      unit.claimedBy = String(worker);
      unit.claimedAt = now;
      claimed.push(unit.key);
    }
    const completedContext = Object.values(ledger.units)
      .filter(unit => unit.state === 'completed')
      .map(unit => unit.label);
    return { planId, worker: String(worker), claimed, reclaimed, completedContext };
  });
}

/**
 * Record a worker's output.
 *
 * `verified` may only be set by a harness check; an unverified output is still recorded, but it is
 * counted against the zero-verification rate rather than being silently trusted.
 */
function completeUnit({
  paths, projectScope = 'default', planId = 'default', unitId, worker,
  verified = false, verifierRef = null, state = 'completed',
} = {}) {
  const file = ledgerPath(paths, projectScope, planId);
  return mutate(file, planId, (ledger, now) => {
    const unit = ledger.units[String(unitId)];
    if (!unit) return { ok: false, reason: 'unknown_unit', unitId };
    if (TERMINAL.has(unit.state)) return { ok: false, reason: 'already_terminal', unitId, state: unit.state };
    if (unit.claimedBy && worker && unit.claimedBy !== String(worker)) {
      return { ok: false, reason: 'claimed_by_other_worker', unitId };
    }
    unit.state = String(state);
    unit.verified = verified === true;
    unit.verifierRef = verified === true ? verifierRef : null;
    unit.completedAt = now;
    return { ok: true, unitId, state: unit.state, verified: unit.verified };
  });
}

/**
 * Plan status, including the metric worth watching: how much delegated output was adopted with no
 * check at all. A high zero-verification rate means the fan-out is propagating unexamined work.
 */
function fanoutStatus({ paths, projectScope = 'default', planId = 'default', leaseMs = DEFAULT_LEASE_MS } = {}) {
  const ledger = loadLedger(ledgerPath(paths, projectScope, planId), planId);
  const units = Object.values(ledger.units);
  const completed = units.filter(unit => unit.state === 'completed');
  const verified = completed.filter(unit => unit.verified === true);
  const unverified = completed.filter(unit => unit.verified !== true);
  const deadline = Date.now() - Number(leaseMs);
  // Held past their lease: a worker took these and never came back.
  const stalled = units.filter(unit => unit.state === 'claimed' && Date.parse(unit.claimedAt || 0) < deadline);
  return {
    planId: ledger.planId,
    total: units.length,
    pending: units.filter(unit => unit.state === 'pending').length,
    claimed: units.filter(unit => unit.state === 'claimed').length,
    stalled: stalled.length,
    stalledSample: stalled.slice(0, 10).map(unit => unit.label),
    reclaimed: units.filter(unit => (unit.reclaimCount || 0) > 0).length,
    completed: completed.length,
    verified: verified.length,
    unverified: unverified.length,
    zeroVerificationRate: completed.length === 0 ? 0 : Number((unverified.length / completed.length).toFixed(4)),
    unverifiedSample: unverified.slice(0, 10).map(unit => unit.label),
    updatedAt: ledger.updatedAt,
  };
}

/**
 * Should this work be split at all?
 *
 * The only criterion that survives contact with the evidence is task shape: split when sub-tasks do
 * not need to talk to each other. Everything else -- speed, "more agents", architectural fashion --
 * is not a reason. Wall-clock time is not accuracy, and extra compute can be bought far more
 * cheaply by raising a single agent's thinking budget than by paying for orchestration.
 *
 * Two distinctions the first version got wrong, both found by cases written to break it:
 *
 *  - Shared *read-only* context (a style guide, a schema, a constant) is not coupling. It can be
 *     copied into every dispatch at no correctness cost. Only shared *mutable* state forces one
 *     agent, so `sharedContextRequired` now asks whether the shared thing is written to.
 *  - Ordering is a dependency even without data flow. Units that must be produced in sequence
 *     cannot be worked in parallel, however independent their contents are.
 */
function assessSplit({
  units = 0,
  crossUnitDependency = true,
  sharedContextRequired = true,
  sharedContextMutable = null,
  orderDependent = false,
  exceedsSingleContext = false,
  perUnitVerifiable = false,
} = {}) {
  const blockers = [];
  if (crossUnitDependency) blockers.push('units_must_talk_to_each_other');

  // Default to the cautious reading when the caller does not say whether the shared context is
  // mutable: an unqualified "shared context required" is treated as coupling, as before.
  const mutableShared = sharedContextMutable === null ? sharedContextRequired : sharedContextMutable;
  if (sharedContextRequired && mutableShared) blockers.push('shared_mutable_state');

  if (orderDependent) blockers.push('units_must_be_produced_in_order');
  if (!perUnitVerifiable) blockers.push('no_independent_per_unit_check');
  if (units < 3 && !exceedsSingleContext) blockers.push('too_few_units_to_pay_for_handoffs');

  const recommend = blockers.length === 0 ? 'fan_out' : 'single_agent';
  return {
    recommend,
    blockers,
    rationale: recommend === 'fan_out'
      ? 'Units are independent, individually checkable, and numerous enough to offset handoff loss.'
      : 'Every handoff loses information; raise the single-agent thinking budget before adding agents.',
  };
}

module.exports = { assessSplit, claimUnits, completeUnit, fanoutStatus, registerUnits, unitKey };
