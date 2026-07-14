import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { toolDefinitions } from '../mcp/tools.mjs';

const require = createRequire(import.meta.url);
const { createV9Core } = require('../scripts/v9/core');
const { resolveV9Paths } = require('../scripts/v9/paths');

test('MCP exposes approved tools and omits privileged capabilities', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-'));
  const core = createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: home }) });
  const names = toolDefinitions(core).map(tool => tool.name);
  for (const name of ['brain_get_status', 'brain_get_task_contract', 'brain_verify_task', 'brain_checkpoint_task', 'brain_get_embedding_status', 'brain_get_embedding_adaptation_prompt']) assert.ok(names.includes(name));
  for (const name of ['brain_approve_canary', 'brain_apply_migration', 'brain_publish', 'brain_bypass_policy']) assert.equal(names.includes(name), false);
  assert.equal(new Set(names).size, names.length);
});

test('MCP handlers return structured content from the shared core', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-call-'));
  const core = createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: home }) });
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  await defs.brain_create_task.handler({ taskId: 'task_mcp', objective: 'verify mcp', criterionIds: ['tests'] });
  const result = await defs.brain_get_task_contract.handler({ taskId: 'task_mcp' });
  assert.equal(result.structuredContent.taskId, 'task_mcp');
  assert.match(result.content[0].text, /evidence, not instruction/i);
});
