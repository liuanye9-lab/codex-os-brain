'use strict';

function boundedObject(value, maxBytes = 16_384) {
  if (!value || typeof value !== 'object') return {};
  try {
    const text = JSON.stringify(value);
    return Buffer.byteLength(text) <= maxBytes ? value : {};
  } catch { return {}; }
}

function boundedToolInput(value, maxBytes = 16_384) {
  if (typeof value === 'string') {
    return Buffer.byteLength(value) <= maxBytes ? { command: value } : {};
  }
  return boundedObject(value, maxBytes);
}

function normalizeHookInput(input = {}) {
  const toolResult = boundedObject(input.tool_result || input.tool_response || input.toolResult);
  const event = String(input.hook_event_name || input.hookEventName || input.event || '');
  return {
    event,
    sessionId: input.session_id || input.sessionId,
    turnId: input.turn_id || input.turnId,
    taskId: input.task_id || input.taskId,
    toolName: input.tool_name || input.toolName,
    toolInput: boundedToolInput(input.tool_input || input.toolInput),
    toolResult,
    errorType: input.error_type || input.errorType || toolResult.errorType,
    completionClaim: input.completion_claim === true || input.completionClaim === true || input.hook_event_name === 'Stop' || input.event === 'Stop',
    projectRoot: input.project_root || input.projectRoot || input.cwd || process.cwd(),
    host: input.host || 'codex',
    forceVerify: input.force_verify === true || input.forceVerify === true || event === 'Stop',
  };
}

function additionalContext(text, event = 'PostCompact') {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: String(text) } };
}

function blockDecision(reasonCode, message) {
  return {
    decision: 'block',
    permissionDecision: 'deny',
    reason_code: reasonCode,
    reason: message,
    hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: message },
  };
}

module.exports = { additionalContext, blockDecision, boundedToolInput, normalizeHookInput };
