'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Capability-style action policy: path canonicalization + risk table.
 * Replaces brittle JSON.stringify includes matching for scope/risk.
 */

const DEFAULT_RISK_TABLE = Object.freeze({
  tools: {
    Bash: 'high',
    Shell: 'high',
    shell: 'high',
    Write: 'medium',
    Edit: 'medium',
    MultiEdit: 'medium',
    Delete: 'critical',
    NotebookEdit: 'medium',
    WebFetch: 'medium',
    WebSearch: 'low',
    Read: 'low',
    Grep: 'low',
    Glob: 'low',
    LS: 'low',
  },
  commandPatterns: [
    { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//i, risk: 'critical', reasonCode: 'destructive_delete' },
    { pattern: /\brm\s+-rf\b/i, risk: 'critical', reasonCode: 'destructive_delete' },
    { pattern: /\bgit\s+push\b.*--force\b/i, risk: 'critical', reasonCode: 'force_push' },
    { pattern: /\bgit\s+push\b/i, risk: 'high', reasonCode: 'remote_write' },
    { pattern: /\b(curl|wget)\b.*\|\s*(ba)?sh\b/i, risk: 'critical', reasonCode: 'remote_code_exec' },
    { pattern: /\b(deploy|publish|npm\s+publish)\b/i, risk: 'high', reasonCode: 'publish' },
    { pattern: /\b(drop\s+table|truncate\s+table)\b/i, risk: 'critical', reasonCode: 'data_destruction' },
  ],
});

function riskRank(level) {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level] ?? 0;
}

function maxRisk(a, b) {
  return riskRank(a) >= riskRank(b) ? a : b;
}

function normalizePath(inputPath, cwd = process.cwd()) {
  if (!inputPath || typeof inputPath !== 'string') return null;
  const expanded = inputPath.startsWith('~/')
    ? path.join(require('node:os').homedir(), inputPath.slice(2))
    : inputPath;
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(absolute) : fs.realpathSync(absolute);
  } catch {
    // Path may not exist yet (writes). Normalize without realpath.
    return path.normalize(absolute);
  }
}

function extractPathsFromToolInput(toolInput = {}) {
  const keys = ['file_path', 'filePath', 'path', 'target', 'directory', 'dir', 'cwd'];
  const found = [];
  for (const key of keys) {
    if (typeof toolInput[key] === 'string') found.push(toolInput[key]);
  }
  if (Array.isArray(toolInput.paths)) {
    for (const item of toolInput.paths) if (typeof item === 'string') found.push(item);
  }
  if (typeof toolInput.command === 'string') {
    // Light extraction of absolute-ish path tokens from shell commands.
    const tokens = toolInput.command.match(/(?:\/|\.\/|\.\.\\)[^\s;'"]+/g) || [];
    found.push(...tokens);
  }
  return found;
}

function pathMatchesPattern(normalizedPath, pattern, cwd) {
  if (!normalizedPath || !pattern) return false;
  const needle = String(pattern).replace(/\\/g, '/');
  const hay = normalizedPath.replace(/\\/g, '/');
  if (needle.startsWith('/') || /^[A-Za-z]:/.test(needle)) {
    const abs = normalizePath(needle, cwd)?.replace(/\\/g, '/') || needle;
    return hay === abs || hay.startsWith(abs.endsWith('/') ? abs : `${abs}/`) || hay.includes(abs);
  }
  return hay.endsWith(`/${needle}`) || hay.includes(`/${needle}/`) || hay.endsWith(needle) || hay.includes(needle);
}

function evaluatePathScope(toolInput, scope = {}, cwd = process.cwd()) {
  const allowed = scope.allowed || [];
  const forbidden = scope.forbidden || [];
  const paths = extractPathsFromToolInput(toolInput).map(p => normalizePath(p, cwd)).filter(Boolean);
  for (const p of paths) {
    if (forbidden.some(item => pathMatchesPattern(p, item, cwd))) {
      return { blocked: true, level: 4, reasonCode: 'scope_forbidden', message: `Action targets forbidden path: ${p}`, path: p };
    }
  }
  if (allowed.length > 0 && paths.length > 0) {
    for (const p of paths) {
      if (!allowed.some(item => pathMatchesPattern(p, item, cwd))) {
        return { blocked: true, level: 4, reasonCode: 'scope_outside_allowed', message: `Action path outside allowed scope: ${p}`, path: p };
      }
    }
  }
  return { blocked: false, paths };
}

function classifyToolRisk(toolName, toolInput = {}, riskTable = DEFAULT_RISK_TABLE) {
  let risk = riskTable.tools?.[toolName] || 'low';
  let reasonCode = 'tool_risk';
  const command = String(toolInput.command || toolInput.cmd || '');
  if (command) {
    for (const row of riskTable.commandPatterns || []) {
      if (row.pattern.test(command)) {
        risk = maxRisk(risk, row.risk);
        reasonCode = row.reasonCode;
      }
    }
  }
  if (/rm|delete|publish|push|deploy/i.test(String(toolName))) {
    risk = maxRisk(risk, 'high');
    reasonCode = 'high_risk_write';
  }
  return { risk, reasonCode };
}

function evaluateAction({ toolName, toolInput = {}, contract = null, cwd = process.cwd(), riskTable = DEFAULT_RISK_TABLE } = {}) {
  if (!contract) return { level: 0, reasonCode: 'no_active_task', risk: 'low' };

  const scopeDecision = evaluatePathScope(toolInput, contract.scope || {}, cwd);
  if (scopeDecision.blocked) {
    return {
      level: scopeDecision.level,
      reasonCode: scopeDecision.reasonCode,
      message: scopeDecision.message,
      risk: 'critical',
      path: scopeDecision.path,
    };
  }

  const { risk, reasonCode } = classifyToolRisk(toolName, toolInput, riskTable);
  if (contract.externalWrite || contract.risk === 'critical') {
    return { level: 3, reasonCode: 'confirmation_required', risk: 'critical', message: 'Human confirmation is required before this action.' };
  }
  if (contract.risk === 'high' && riskRank(risk) >= riskRank('medium')) {
    return { level: 3, reasonCode: 'confirmation_required', risk, message: 'High-risk task requires confirmation for this write.' };
  }
  if (risk === 'critical') {
    return { level: 3, reasonCode, risk, message: 'Critical-risk action requires human confirmation.' };
  }
  if (risk === 'high') {
    return { level: 2, reasonCode, risk, message: 'High-risk write requires verification.' };
  }
  return { level: 0, reasonCode: 'allowed', risk };
}

module.exports = {
  DEFAULT_RISK_TABLE,
  classifyToolRisk,
  evaluateAction,
  evaluatePathScope,
  extractPathsFromToolInput,
  maxRisk,
  normalizePath,
  pathMatchesPattern,
  riskRank,
};
