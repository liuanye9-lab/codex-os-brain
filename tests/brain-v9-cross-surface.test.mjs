import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { toolDefinitions } from '../mcp/tools.mjs';

const require = createRequire(import.meta.url);
const { createV9Core } = require('../scripts/v9/core');
const { resolveV9Paths } = require('../scripts/v9/paths');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('core, CLI, and MCP report the same contract revision and lifecycle', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cross-'));
  const core = createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: home }) });
  const direct = core.contracts.create({ taskId: 'task_1', objective: 'conform', criteria: [] });
  assert.equal(direct.revision, 1);
  const cliRun = spawnSync(process.execPath, [path.join(root, 'bin', 'brain.js'), 'task', 'show', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, CODEX_BRAIN_HOME: home } });
  assert.equal(cliRun.status, 0, cliRun.stderr);
  const cli = JSON.parse(cliRun.stdout);
  const mcpTool = toolDefinitions(core).find(tool => tool.name === 'brain_get_task_contract');
  const mcp = (await mcpTool.handler({ taskId: 'task_1' })).structuredContent;
  assert.equal(cli.revision, direct.revision);
  assert.equal(mcp.revision, direct.revision);
  assert.equal(cli.lifecycle, mcp.lifecycle);
});
