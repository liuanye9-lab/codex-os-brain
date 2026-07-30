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

function boundedString(value, maxChars) {
  if (value === undefined || value === null) return undefined;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxChars);
}

function normalizeHookInput(input = {}) {
  const toolResult = boundedObject(input.tool_result || input.tool_response || input.toolResult);
  const event = boundedString(input.hook_event_name || input.hookEventName || input.event || '', 80);
  return {
    event,
    sessionId: boundedString(input.session_id || input.sessionId, 160),
    turnId: boundedString(input.turn_id || input.turnId, 160),
    taskId: boundedString(input.task_id || input.taskId, 160),
    toolName: boundedString(input.tool_name || input.toolName, 200),
    toolInput: boundedToolInput(input.tool_input || input.toolInput),
    toolResult,
    errorType: boundedString(input.error_type || input.errorType || toolResult.errorType, 160),
    completionClaim: input.completion_claim === true || input.completionClaim === true || input.hook_event_name === 'Stop' || input.event === 'Stop',
    projectRoot: boundedString(input.project_root || input.projectRoot || input.cwd || process.cwd(), 4096),
    host: boundedString(input.host || 'codex', 80),
    forceVerify: input.force_verify === true || input.forceVerify === true || event === 'Stop',
  };
}

function additionalContext(text, event = 'PostCompact') {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: String(text) } };
}

function blockDecision(reasonCode, message, event = 'PreToolUse') {
  if (event === 'PermissionRequest') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: String(message) },
      },
    };
  }
  if (event === 'PreToolUse') {
    return {
      decision: 'block',
      permissionDecision: 'deny',
      reason_code: reasonCode,
      reason: message,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: message,
      },
    };
  }
  return {
    decision: 'block',
    permissionDecision: 'deny',
    reason_code: reasonCode,
    reason: message,
  };
}

module.exports = { additionalContext, blockDecision, boundedString, boundedToolInput, normalizeHookInput };
