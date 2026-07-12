'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assignGuests } = require('../src/assign');

test('assigns guests when ordinary capacity is available', () => {
  const assignments = assignGuests([
    { id: 'a', capacity: 4 },
    { id: 'b', capacity: 4 },
  ], [
    { id: 'g1', size: 2, avoid: [] },
    { id: 'g2', size: 2, avoid: [] },
  ]);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].tableId, 'a');
});
