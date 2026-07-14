'use strict';
const { blockDecision } = require('./input');

async function handleRisk(input, core) {
  const decision = core.contracts.evaluateAction(input.toolName, input.toolInput);
  if (decision.level < 2) return {};
  if (decision.level === 3) return blockDecision(decision.reasonCode, 'Human confirmation is required before this action.');
  return blockDecision(decision.reasonCode, decision.message || 'Action is outside the verified task boundary.');
}

module.exports = { handleRisk };
