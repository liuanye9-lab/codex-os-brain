'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/rollup');

test('counts verified delivered events', () => {
  assert.deepEqual(summarize([
    { taskId: 'a', timestamp: '2026-01-01T00:00:00Z', phase: 'verified', verifierPassed: true, finalDelivered: true },
    { taskId: 'b', timestamp: '2026-01-01T00:00:00Z', phase: 'verified', verifierPassed: false, finalDelivered: false },
  ]), { total: 2, passed: 1, failed: 1 });
});
