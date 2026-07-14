'use strict';
const { blockDecision } = require('./input');

async function handleStop(input, core) {
  if (!input.completionClaim) return {};
  const result = core.verification.evaluateActive();
  if (result.status === 'complete') return {};
  const remaining = [...result.missing, ...result.failed, ...result.unverified];
  return blockDecision('completion_unverified', `Required criteria remain: ${remaining.join(', ')}`);
}

module.exports = { handleStop };
