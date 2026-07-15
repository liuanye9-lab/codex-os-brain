'use strict';

const crypto = require('node:crypto');

function failureSignature(input = {}) {
  const stable = [input.class || 'unknown', input.operation || '', input.code || input.status || ''].join('\0');
  return `sig_${crypto.createHash('sha256').update(stable).digest('hex').slice(0, 24)}`;
}

function classifyFailure(input = {}) {
  const type = String(input.errorType || input.code || '').toLowerCase();
  const message = String(input.message || '').slice(0, 500).toLowerCase();
  let failureClass = 'unknown';
  let retryable = false;
  if (/policy|credential|secret|privacy|scope/.test(`${type} ${message}`)) failureClass = 'security_policy';
  else if (/eacces|eperm|permission|denied/.test(`${type} ${message}`)) failureClass = 'permission';
  else if (/timeout|rate.?limit|econnreset|temporar|503|429/.test(`${type} ${message}`)) { failureClass = 'transient'; retryable = true; }
  else if (/enoent|environment|not found|command not found/.test(`${type} ${message}`)) { failureClass = 'environment'; retryable = true; }
  else if (/json|schema|malformed|invalid argument/.test(`${type} ${message}`)) failureClass = 'malformed_tool';
  else if (/stale|conflict|changed since/.test(`${type} ${message}`)) { failureClass = 'stale_state'; retryable = true; }
  else if (/assert|test fail|typeerror|referenceerror|implementation/.test(`${type} ${message}`)) failureClass = 'implementation';
  const failure = { class: failureClass, retryable, code: String(input.code || input.errorType || '') };
  return { ...failure, signature: failureSignature({ ...failure, operation: input.operation }) };
}

function advanceCircuit(state = {}, failure, circuitConfig = {}) {
  const warningAfter = Number(circuitConfig.warningAfter || 2);
  const openAfter = Number(circuitConfig.openAfter || 3);
  const consecutive = state.signature === failure.signature ? Number(state.consecutive || 0) + 1 : 1;
  let status = 'closed';
  if (consecutive >= openAfter) status = 'open';
  else if (consecutive >= warningAfter) status = 'warning';
  return { signature: failure.signature, consecutive, status };
}

function shouldRetry(failure, state) {
  return failure.retryable === true && state.status !== 'open' && failure.class !== 'security_policy';
}

module.exports = { advanceCircuit, classifyFailure, failureSignature, shouldRetry };
