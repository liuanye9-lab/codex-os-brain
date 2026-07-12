'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = function check(workspace) {
  delete require.cache[require.resolve(path.join(workspace, 'src', 'assign.js'))];
  const { assignGuests } = require(path.join(workspace, 'src', 'assign.js'));
  const assignments = assignGuests([
    { id: 'a', capacity: 2 },
    { id: 'b', capacity: 2 },
  ], [
    { id: 'g1', size: 2, avoid: ['a'] },
    { id: 'g2', size: 2, avoid: [] },
  ]);
  assert.deepEqual(assignments.map((assignment) => assignment.tableId), ['b', 'a']);
  assert.throws(() => assignGuests([{ id: 'a', capacity: 1 }], [{ id: 'oversized', size: 2, avoid: [] }]), /unassigned guest/);
};
