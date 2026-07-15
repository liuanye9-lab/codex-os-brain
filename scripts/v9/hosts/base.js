'use strict';

/**
 * Host adapter contract: normalize host events → V9 decisions → host-shaped output.
 */

function createHostAdapter({ name, normalizeEvent, applyDecision }) {
  return {
    name,
    normalizeEvent: normalizeEvent || (raw => raw),
    applyDecision: applyDecision || (decision => decision),
    async handle(raw, dispatch) {
      const normalized = this.normalizeEvent(raw || {});
      const decision = await dispatch(normalized);
      return this.applyDecision(decision, normalized);
    },
  };
}

module.exports = { createHostAdapter };
