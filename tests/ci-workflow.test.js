'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CI installs lockfile dependencies before running checks', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'check.yml'), 'utf8');
  const setup = workflow.indexOf('actions/setup-node@v4');
  const install = workflow.indexOf('run: npm ci');
  const check = workflow.indexOf('run: npm run check');
  assert.ok(setup >= 0, 'setup-node step is required');
  assert.ok(install > setup, 'npm ci must run after Node setup');
  assert.ok(check > install, 'checks must run after npm ci');
});
