'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLimit } = require('../src/parse-limit');

test('parses an ordinary positive numeric string', () => {
  assert.equal(parseLimit('12', 5), 12);
});

test('uses fallback for a non-numeric value', () => {
  assert.equal(parseLimit('not-a-number', 5), 5);
});
