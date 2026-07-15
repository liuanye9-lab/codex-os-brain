'use strict';

const { createHostAdapter } = require('./base');

/**
 * Claude Code-oriented adapter. Maps Claude hook field names into V9 normalized events.
 * Hooks remain optional; this adapter is the integration seam.
 */

function normalizeClaudeEvent(raw = {}) {
  return {
    host: 'claude',
    hook_event_name: raw.hook_event_name || raw.event_name || raw.event || raw.type,
    session_id: raw.session_id || raw.sessionId,
    turn_id: raw.turn_id || raw.turnId || raw.message_id,
    task_id: raw.task_id || raw.taskId,
    tool_name: raw.tool_name || raw.toolName || raw.name,
    tool_input: raw.tool_input || raw.toolInput || raw.input || {},
    tool_result: raw.tool_result || raw.toolResult || raw.result,
    error_type: raw.error_type || raw.errorType || raw.error?.type,
    completion_claim: raw.completion_claim ?? raw.completionClaim ?? raw.hook_event_name === 'Stop',
    project_root: raw.cwd || raw.project_root || process.cwd(),
  };
}

function applyClaudeDecision(decision = {}) {
  // Map V9 deny into Claude-ish permission fields without losing reason codes.
  if (decision.permissionDecision === 'deny' || decision.decision === 'block') {
    return {
      ...decision,
      continue: false,
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason || decision.hookSpecificOutput?.permissionDecisionReason,
    };
  }
  if (decision.hookSpecificOutput?.additionalContext) {
    return {
      ...decision,
      systemMessage: decision.hookSpecificOutput.additionalContext,
    };
  }
  return decision;
}

const claudeAdapter = createHostAdapter({
  name: 'claude',
  normalizeEvent: normalizeClaudeEvent,
  applyDecision: applyClaudeDecision,
});

module.exports = { claudeAdapter, normalizeClaudeEvent, applyClaudeDecision };
