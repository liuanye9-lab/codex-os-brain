'use strict';
const { normalizeHookInput, blockDecision, additionalContext } = require('./hooks/input');

async function dispatchHook(raw, services) {
  const input = normalizeHookInput(raw);
  if (!services.enabled || !services.handlers[input.event]) return {};
  try {
    return await services.handlers[input.event](input);
  } catch (error) {
    try { services.auditInternalError(input.event, error); } catch { /* primary failure remains authoritative */ }
    if (services.failClosedEvents.has(input.event)) {
      const reasonCode = error.code === 'policy_boundary' ? 'policy_boundary' : 'hook_runtime_failed';
      return blockDecision(reasonCode, 'Action paused because the reliability hook could not complete its checks.');
    }
    return {
      ...additionalContext('[BRAIN HOOK DEGRADED] A reliability hook failed internally; its observation was not recorded.', input.event),
      reason_code: 'hook_runtime_failed',
    };
  }
}

module.exports = { dispatchHook };
