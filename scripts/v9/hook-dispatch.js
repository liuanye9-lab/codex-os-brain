'use strict';
const { normalizeHookInput, blockDecision } = require('./hooks/input');

async function dispatchHook(raw, services) {
  const input = normalizeHookInput(raw);
  if (!services.enabled || !services.handlers[input.event]) return {};
  try {
    return await services.handlers[input.event](input);
  } catch (error) {
    if (services.failClosedEvents.has(input.event) && error.code === 'policy_boundary') {
      return blockDecision('policy_boundary', 'Action paused because the reliability policy could not be verified.');
    }
    services.auditInternalError(input.event, error);
    return {};
  }
}

module.exports = { dispatchHook };
