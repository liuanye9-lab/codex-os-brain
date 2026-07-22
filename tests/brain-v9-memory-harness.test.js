'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryHarness } = require('../scripts/v9/memory-harness');
const { createMemoryService } = require('../scripts/v9/memory-service');
const { resolveV9Paths } = require('../scripts/v9/paths');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-memory-harness-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  return { memory: createMemoryService({ paths }), harness: createMemoryHarness({ paths, minSamples: 5 }) };
}

test('harness learns from accumulated feedback but only creates reviewable candidates', () => {
  const { memory, harness } = setup();
  memory.importDocument({ sourceUri: 'source:test', content: '可检索来源证据' });
  const evidence = memory.search({ query: '可检索来源证据' }).results[0];
  memory.addEvalCase({ caseId: 'case_1', query: '可检索来源证据', expectedOwnerIds: [evidence.ownerId], tags: ['zh'] });
  for (let i = 0; i < 5; i += 1) memory.feedback({ query: `missing ${i}`, signal: 'missed' });
  const run = harness.cycle();
  assert.equal(run.candidateOnly, true);
  assert.equal(run.metrics.retrievalEval.recallAtK, 1);
  assert.equal(run.metrics.retrievalEval.mrr, 1);
  assert.equal(run.findings[0].automaticApply, false);
  const candidates = harness.candidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'pending');
  const second = harness.cycle();
  assert.equal(second.findings.some(item => item.level === 'candidate'), false);
});
