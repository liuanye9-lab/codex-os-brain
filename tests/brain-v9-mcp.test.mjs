import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { toolDefinitions } from '../mcp/tools.mjs';

const require = createRequire(import.meta.url);
const { createV9Core, readV9Config } = require('../scripts/v9/core');
const { resolveV9Paths } = require('../scripts/v9/paths');

test('MCP exposes approved tools and omits privileged capabilities', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-'));
  const core = createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }) });
  const names = toolDefinitions(core).map(tool => tool.name);
  for (const name of ['brain_get_status', 'brain_get_task_contract', 'brain_verify_task', 'brain_checkpoint_task']) assert.ok(names.includes(name));
  for (const name of ['brain_approve_canary', 'brain_apply_migration', 'brain_publish', 'brain_bypass_policy']) assert.equal(names.includes(name), false);
  assert.equal(new Set(names).size, names.length);
  // V11 removed the recall/cognition surface entirely rather than gating it.
  for (const name of ['brain_memory_recall', 'brain_get_cognitive_asset_status', 'brain_get_cognitive_review_digest', 'brain_read_cognitive_projection', 'brain_get_embedding_status', 'brain_get_embedding_adaptation_prompt']) {
    assert.equal(names.includes(name), false, `${name} must not be exposed`);
  }
});

test('disabled labs do not initialize the memory database', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-disabled-labs-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') });
  const core = createV9Core({ paths });
  const status = core.status();
  assert.equal(status.features.memory, false);
  assert.equal(status.features.cognitiveAssets, false);
  assert.equal(fs.existsSync(core.paths.memoryDbPath), false);
  const pending = [path.join(home, 'state')];
  const memoryDatabases = [];
  while (pending.length) {
    const directory = pending.pop();
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name === 'memory.sqlite3') memoryDatabases.push(target);
    }
  }
  assert.deepEqual(memoryDatabases, []);
});

test('MCP handlers return structured content from the shared core', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-call-'));
  const core = createV9Core({ paths: resolveV9Paths({ CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }) });
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  await defs.brain_create_task.handler({ taskId: 'task_mcp', objective: 'verify mcp', criterionIds: ['tests'] });
  const result = await defs.brain_get_task_contract.handler({ taskId: 'task_mcp' });
  assert.equal(result.structuredContent.taskId, 'task_mcp');
  assert.match(result.content[0].text, /evidence, not instruction/i);
});

