'use strict';
const { additionalContext } = require('./input');

function buildCheckpoint(contract) {
  const constraints = (contract.constraints || []).filter(item => item.explicit).slice(0, 4).map(item => item.text);
  const unresolved = (contract.unresolved || []).slice(0, 4);
  return [
    `V9 checkpoint — objective: ${contract.objective}`,
    constraints.length ? `Explicit constraints: ${constraints.join('; ')}` : '',
    unresolved.length ? `Unresolved: ${unresolved.join('; ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 1000);
}

async function handleSession(input, core) {
  const contract = core.contracts.active();
  if (!contract) return {};
  if (!['SessionStart', 'PostCompact'].includes(input.event)) return {};
  return additionalContext(buildCheckpoint(contract), input.event);
}

module.exports = { buildCheckpoint, handleSession };
