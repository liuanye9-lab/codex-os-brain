'use strict';
const crypto = require('node:crypto');
const { sanitizeTraceEvent } = require('./brain-lite-trace-v2');

const ACTIONS = new Set(['captured', 'evaluated', 'canary-approved', 'canary-failed', 'recalled']);

function requireTraceKey(key) {
  const value = String(key || '');
  if (value.length < 16 || new Set(value).size < 8) throw new Error('behavioral trace key must be a strong local secret');
  return value;
}

function candidateReference(candidateId, key) {
  return 'bmc_' + crypto.createHmac('sha256', requireTraceKey(key))
    .update(`behavioral-trace\0${String(candidateId || '')}`)
    .digest('hex')
    .slice(0, 20);
}

function buildBehavioralTraceEvent(candidate, action, options = {}) {
  if (!candidate?.candidateId) throw new Error('candidate is required');
  if (!ACTIONS.has(action)) throw new Error(`unsupported behavioral trace action: ${action}`);
  const candidateRef = candidateReference(candidate.candidateId, options.key);
  return sanitizeTraceEvent({
    traceId: `trace_${candidateRef}`,
    taskId: `${candidateRef}:${action}`,
    kind: 'behavioral_memory',
    policyVersion: options.policyVersion || 'brain-lite-v8',
    timestamp: options.now || new Date().toISOString(),
    privacyClass: 'private',
    candidateRef,
    behavioralAction: action,
    behavioralState: String(candidate.state || 'unknown'),
  });
}

module.exports = { buildBehavioralTraceEvent, candidateReference };
