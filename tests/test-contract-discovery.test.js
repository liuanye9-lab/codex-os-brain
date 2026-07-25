'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverSourceTests } = require('../scripts/test-contract');

test('source test contract discovers every test family instead of using a whitelist', () => {
  const files = discoverSourceTests();
  assert.ok(files.length > 0);
  assert.ok(files.includes('tests/brain-v9-verification.test.js'));
  assert.ok(files.includes('tests/brain-lite-routing-ledger.test.js'));
  assert.ok(files.includes('tests/public-entrypoint.test.js'));
});
