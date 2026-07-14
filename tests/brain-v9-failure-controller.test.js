'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceCircuit, classifyFailure, failureSignature, shouldRetry } = require('../scripts/v9/failure-controller');

test('third identical failure opens the circuit', () => {
  let state = { signature: null, consecutive: 0, status: 'closed' };
  const failure = { class: 'environment', signature: 'sig_same', retryable: true };
  state = advanceCircuit(state, failure);
  state = advanceCircuit(state, failure);
  assert.equal(state.status, 'warning');
  state = advanceCircuit(state, failure);
  assert.equal(state.status, 'open');
  assert.equal(shouldRetry(failure, state), false);
});

test('security failures never auto-retry', () => {
  const failure = classifyFailure({ errorType: 'PolicyDenied', message: 'credential boundary' });
  assert.equal(failure.class, 'security_policy');
  assert.equal(failure.retryable, false);
});

test('signatures are stable hashes and do not expose raw errors', () => {
  const signature = failureSignature({ class: 'environment', operation: 'write', code: 'ENOENT' });
  assert.match(signature, /^sig_[a-f0-9]{24}$/);
  assert.doesNotMatch(signature, /write|ENOENT/);
});
