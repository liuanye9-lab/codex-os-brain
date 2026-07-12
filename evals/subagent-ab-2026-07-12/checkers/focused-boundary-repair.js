'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = function check(workspace) {
  delete require.cache[require.resolve(path.join(workspace, 'src', 'parse-limit.js'))];
  const { parseLimit } = require(path.join(workspace, 'src', 'parse-limit.js'));
  assert.equal(parseLimit('0', 5), 0);
  assert.equal(parseLimit(-1, 5), 5);
  assert.equal(parseLimit('Infinity', 5), 5);
};
