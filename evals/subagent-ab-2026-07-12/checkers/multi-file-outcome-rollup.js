'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = function check(workspace) {
  delete require.cache[require.resolve(path.join(workspace, 'src', 'rollup.js'))];
  const { summarize } = require(path.join(workspace, 'src', 'rollup.js'));
  const result = summarize([
    { taskId: 'a', timestamp: '2026-01-01T09:00:00Z', phase: 'verified', verifierPassed: true, finalDelivered: true },
    { taskId: 'a', timestamp: '2026-01-01T10:00:00Z', phase: 'verified', verifierPassed: false, finalDelivered: false },
    { taskId: 'b', timestamp: '2026-01-01T11:00:00Z', phase: 'child', verifierPassed: true, finalDelivered: true },
    { taskId: 'c', timestamp: '2026-01-01T12:00:00Z', phase: 'verified', verifierPassed: false, finalDelivered: false, infrastructureFailure: true },
  ]);
  assert.deepEqual(result, { total: 1, passed: 0, failed: 1 });
};
