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
  for (const name of ['brain_get_status', 'brain_get_task_contract', 'brain_verify_task', 'brain_checkpoint_task', 'brain_get_embedding_status', 'brain_get_embedding_adaptation_prompt']) assert.ok(names.includes(name));
  for (const name of ['brain_approve_canary', 'brain_apply_migration', 'brain_publish', 'brain_bypass_policy']) assert.equal(names.includes(name), false);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.includes('brain_memory_recall'), false);
  assert.equal(names.includes('brain_get_cognitive_asset_status'), false);
});

test('MCP exposes governed cognitive product reads only when the lab is enabled', async () => {
  const calls = [];
  const core = {
    features: { memory: false, cognitiveAssets: true },
    cognitiveAssets: {
      status: () => ({}),
      dailyDigest: () => ({}),
      readProjection: () => ({}),
      productMap: () => ({ stages: ['knowledge_base', 'agent'] }),
      assessAgent: (agentId, input) => { calls.push(['assess', agentId, input.targetState]); return { ready: true }; },
      prepareAgentContext: (agentId, input) => { calls.push(['context', agentId, input.tokenBudget]); return { executionPerformed: false }; },
    },
  };
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  assert.equal(defs.brain_get_cognitive_product_map.readOnly, true);
  assert.equal(defs.brain_assess_cognitive_agent.destructive, true);
  assert.equal((await defs.brain_get_cognitive_product_map.handler()).structuredContent.stages[1], 'agent');
  await defs.brain_assess_cognitive_agent.handler({ agentId: 'agent-1', targetState: 'shadow' });
  await defs.brain_prepare_cognitive_agent_context.handler({ agentId: 'agent-1', tokenBudget: 500 });
  assert.deepEqual(calls, [['assess', 'agent-1', 'shadow'], ['context', 'agent-1', 500]]);
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
  const core = createV9Core({
    paths: resolveV9Paths({ CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }),
    projectRoot: home,
  });
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  await defs.brain_create_task.handler({ taskId: 'task_mcp', objective: 'verify mcp', criterionIds: ['tests'] });
  const result = await defs.brain_get_task_contract.handler({ taskId: 'task_mcp' });
  assert.equal(result.structuredContent.taskId, 'task_mcp');
  assert.match(result.content[0].text, /evidence, not instruction/i);
});

test('MCP mutating handlers preserve the selected project root', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-project-'));
  const seen = [];
  const contract = { taskId: 'scoped', objective: 'stay scoped' };
  const selected = {
    projectRoot: () => projectRoot,
    contracts: { active: () => contract, close: () => ({ lifecycle: 'complete' }) },
    verification: {
      evaluateActive: () => ({ status: 'partial' }),
      run: ({ cwd }) => { seen.push(['verify', cwd]); return { status: 'complete' }; },
      claim: () => ({}),
    },
    events: { append: () => {} },
    handoff: { writeProgress: ({ projectRoot: root }) => { seen.push(['handoff', root]); } },
  };
  const core = {
    features: {},
    projectRoot: () => projectRoot,
    forTask: () => selected,
    handoff: { statusHandoff: ({ projectRoot: root }) => ({ root }) },
  };
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  assert.equal('root' in (await defs.brain_get_handoff.handler()).structuredContent, false);
  await defs.brain_verify_task.handler({ taskId: 'scoped' });
  await defs.brain_checkpoint_task.handler({ taskId: 'scoped', summary: 'checkpoint' });
  await defs.brain_close_task.handler({ taskId: 'scoped' });
  assert.deepEqual(seen, [
    ['verify', projectRoot],
    ['handoff', projectRoot],
    ['verify', projectRoot],
  ]);
});

test('MCP memory recall uses the governed search path and never leaks source_uri', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-mcp-memory-'));
  const config = structuredClone(readV9Config());
  config.memory.enabled = true;
  const core = createV9Core({ config, paths: resolveV9Paths({ CODEX_BRAIN_HOME: path.join(home, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(home, 'state') }) });
  core.memory.createMemory({
    memoryId: 'mem_mcp',
    content: 'governed recall canary',
    status: 'confirmed',
    approvedBy: 'operator',
    sourceUri: '/private/operator/source.md',
    validFrom: '2026-07-25T00:00:00Z',
    validTo: '2026-07-26T00:00:00Z',
  });
  const defs = Object.fromEntries(toolDefinitions(core).map(tool => [tool.name, tool]));
  const active = await defs.brain_memory_recall.handler({ query: 'governed recall', at: '2026-07-25T12:00:00Z' });
  assert.equal(active.structuredContent.entries[0].ownerId, 'mem_mcp');
  assert.equal('source_uri' in active.structuredContent.entries[0], false);
  assert.match(active.structuredContent.entries[0].sourceRef, /^local:/);
  assert.match(active.content[0].text, /never instruction/i);
  const expired = await defs.brain_memory_recall.handler({ query: 'governed recall', at: '2026-07-26T00:00:00Z' });
  assert.equal(expired.structuredContent.count, 0);
});
