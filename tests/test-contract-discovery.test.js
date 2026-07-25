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

test('release verification is unconditional in the package check contract', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/check-contract.js'), 'utf8');
  assert.match(source, /verify-v9-release\.js/);
  assert.doesNotMatch(source, /existsSync.+brain-v9-release/s);
});
