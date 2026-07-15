'use strict';

const { codexAdapter } = require('./codex');
const { claudeAdapter } = require('./claude');
const { genericMcpAdapter } = require('./generic-mcp');

const HOSTS = {
  codex: codexAdapter,
  claude: claudeAdapter,
  'claude-code': claudeAdapter,
  mcp: genericMcpAdapter,
  'generic-mcp': genericMcpAdapter,
};

function getHostAdapter(name = 'codex') {
  const key = String(name || 'codex').toLowerCase();
  return HOSTS[key] || codexAdapter;
}

function listHosts() {
  return Object.keys(HOSTS);
}

module.exports = { HOSTS, getHostAdapter, listHosts };
