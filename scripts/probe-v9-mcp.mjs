#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-probe-'));
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp', 'server.mjs')], cwd: root, env: { ...process.env, CODEX_BRAIN_HOME: brainHome }, stderr: 'pipe' });
const client = new Client({ name: 'brain-v9-probe', version: '0.9.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name);
  if (!names.includes('brain_get_status') || names.includes('brain_publish')) throw new Error('unsafe_or_missing_tools');
  const status = await client.callTool({ name: 'brain_get_status', arguments: {} });
  if (!status.structuredContent || status.structuredContent.version !== 9) throw new Error('invalid_status');
  process.stdout.write(`MCP V9 initialize/tools-list passed (${names.length} tools)\n`);
} finally {
  await transport.close();
}
