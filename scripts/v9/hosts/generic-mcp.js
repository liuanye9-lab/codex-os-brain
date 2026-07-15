'use strict';

const { createHostAdapter } = require('./base');

/**
 * Generic MCP-only host: no process hooks; clients poll tools / push claims via MCP.
 */

function normalizeMcpEvent(raw = {}) {
  return {
    host: 'mcp',
    hook_event_name: raw.event || raw.kind || 'McpClient',
    session_id: raw.sessionId,
    turn_id: raw.turnId,
    task_id: raw.taskId,
    tool_name: raw.toolName,
    tool_input: raw.toolInput || {},
    tool_result: raw.toolResult,
    error_type: raw.errorType,
    completion_claim: raw.completionClaim === true,
    project_root: raw.projectRoot || process.cwd(),
  };
}

function applyMcpDecision(decision = {}) {
  return {
    ok: decision.decision !== 'block' && decision.permissionDecision !== 'deny',
    decision,
  };
}

const genericMcpAdapter = createHostAdapter({
  name: 'generic-mcp',
  normalizeEvent: normalizeMcpEvent,
  applyDecision: applyMcpDecision,
});

module.exports = { genericMcpAdapter, normalizeMcpEvent, applyMcpDecision };
