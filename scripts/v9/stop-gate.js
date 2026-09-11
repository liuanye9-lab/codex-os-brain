'use strict';
// Stop-gate ledger: bounds how long the completion gate may hold a session.
//
// The gate exists to stop an agent from declaring success it did not earn. But a gate with no
// bound is its own failure mode: a criterion that can never pass (a missing binary, a verifier
// that always errors, a contract nobody can satisfy) would refuse every stop forever and the
// session becomes unusable. So the gate is allowed to block only while it is making a
// difference, and it must be able to give up.
//
// Two independent releases, both fail-open by construction:
//   1. block cap        - the same task may be blocked at most N times.
//   2. stall detection  - if the remaining-criteria set stops shrinking across consecutive
//                         blocks, the agent is looping rather than converging.
//
// Releasing is not the same as passing. A released stop is recorded as `released_*`, stays in the
// ledger, and is reported to the user; the criteria remain unverified and the contract stays open.

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson, readJsonSafe } = require('./store');

const DEFAULT_BLOCK_CAP = 3;
const DEFAULT_STALL_LIMIT = 2;
const LEDGER_VERSION = 1;

function ledgerPath(paths, projectScope, taskId) {
  const safeTask = String(taskId || 'unbound').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return path.join(paths.stopGateRoot, projectScope, `${safeTask}.json`);
}

function readLedger(file) {
  // readJsonSafe returns an envelope: { value, missing, corrupt }.
  const { value, corrupt } = readJsonSafe(file, null);
  if (corrupt || !value || value.version !== LEDGER_VERSION) {
    return { version: LEDGER_VERSION, blocks: 0, lastSignature: null, repeats: 0, released: null, history: [] };
  }
  return value;
}

/** Order-independent fingerprint of what is still unverified. */
function remainingSignature(remaining = []) {
  return [...new Set(remaining.map(String))].sort().join('|');
}

/**
 * Decide whether the completion gate may block once more.
 *
 * Returns `{ allowBlock: true, ... }` to keep gating, or `{ allowBlock: false, releaseReason }`
 * when the gate must let the stop through despite unverified criteria.
 */
function evaluateStopGate({
  paths,
  projectScope = 'default',
  taskId,
  remaining = [],
  blockCap = DEFAULT_BLOCK_CAP,
  stallLimit = DEFAULT_STALL_LIMIT,
  now = () => new Date().toISOString(),
} = {}) {
  const file = ledgerPath(paths, projectScope, taskId);
  const ledger = readLedger(file);
  const signature = remainingSignature(remaining);

  // Already released for this task: never re-arm on the same unresolved set.
  if (ledger.released && ledger.released.signature === signature) {
    return {
      allowBlock: false,
      releaseReason: ledger.released.reason,
      blocks: ledger.blocks,
      repeats: ledger.repeats,
      alreadyReleased: true,
    };
  }

  const repeats = signature && signature === ledger.lastSignature ? ledger.repeats + 1 : 0;
  const blocks = ledger.blocks + 1;

  let releaseReason = null;
  if (blocks > blockCap) releaseReason = 'block_cap_reached';
  else if (repeats >= stallLimit) releaseReason = 'no_progress_between_attempts';

  const next = {
    version: LEDGER_VERSION,
    blocks,
    lastSignature: signature,
    repeats,
    released: releaseReason ? { reason: releaseReason, signature, at: now() } : null,
    history: [...(ledger.history || []), { at: now(), blocks, repeats, remaining: remaining.slice(0, 20) }].slice(-20),
  };
  atomicWriteJson(file, next);

  if (releaseReason) {
    return { allowBlock: false, releaseReason, blocks, repeats, alreadyReleased: false };
  }
  return { allowBlock: true, blocks, repeats, blockCap, remainingBlocks: Math.max(0, blockCap - blocks) };
}

/** Clear the ledger once a task genuinely verifies, so a later task starts with a full budget. */
function clearStopGate({ paths, projectScope = 'default', taskId } = {}) {
  const file = ledgerPath(paths, projectScope, taskId);
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
    return true;
  } catch { return false; }
}

function readStopGate({ paths, projectScope = 'default', taskId } = {}) {
  return readLedger(ledgerPath(paths, projectScope, taskId));
}

module.exports = {
  DEFAULT_BLOCK_CAP,
  DEFAULT_STALL_LIMIT,
  clearStopGate,
  evaluateStopGate,
  readStopGate,
  remainingSignature,
};
