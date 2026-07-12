'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendTraceEvent, readTrace, sanitizeTraceEvent } = require('../scripts/brain-lite-trace-v2');

test('trace keeps parent-child evidence while dropping raw private content', () => {
  const event = sanitizeTraceEvent({ traceId: 'trace_1', parentEventId: 'evt_parent', taskId: 'task_1', kind: 'dispatch', policyVersion: 'brain-lite-v8', routeId: 'terra-medium', inputTokens: 100, rawPrompt: 'private prompt', chainOfThought: 'private reasoning', path: 'workspace/repo/file.js', credential: 'credential-placeholder' });
  assert.equal(event.parentEventId, 'evt_parent');
  assert.equal(event.kind, 'dispatch');
  assert.equal(event.inputTokens, 100);
  assert.equal(event.rawPrompt, undefined);
  assert.equal(event.chainOfThought, undefined);
  assert.equal(event.credential, undefined);
  assert.equal(event.path, undefined);
});

test('append is idempotent for the same event identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-trace-'));
  const file = path.join(dir, 'trace.jsonl');
  const source = { traceId: 'trace_2', taskId: 'task_2', kind: 'verification', attempt: 1, verifierPassed: true };
  appendTraceEvent(file, source); appendTraceEvent(file, source);
  assert.equal(readTrace(file).length, 1);
});
