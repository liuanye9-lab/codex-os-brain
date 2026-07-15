'use strict';

const { createHostAdapter } = require('./base');

function normalizeCodexEvent(raw = {}) {
  return {
    host: 'codex',
    hook_event_name: raw.hook_event_name || raw.hookEventName || raw.event,
    session_id: raw.session_id || raw.sessionId,
    turn_id: raw.turn_id || raw.turnId,
    task_id: raw.task_id || raw.taskId,
    tool_name: raw.tool_name || raw.toolName,
    tool_input: raw.tool_input || raw.toolInput || {},
    tool_result: raw.tool_result || raw.toolResult || raw.tool_response,
    error_type: raw.error_type || raw.errorType,
    completion_claim: raw.completion_claim ?? raw.completionClaim,
    project_root: raw.project_root || raw.cwd || process.cwd(),
  };
}

function applyCodexDecision(decision) {
  // Codex already consumes the V9 decision shape.
  return decision || {};
}

const codexAdapter = createHostAdapter({
  name: 'codex',
  normalizeEvent: normalizeCodexEvent,
  applyDecision: applyCodexDecision,
});

module.exports = { codexAdapter, normalizeCodexEvent, applyCodexDecision };
