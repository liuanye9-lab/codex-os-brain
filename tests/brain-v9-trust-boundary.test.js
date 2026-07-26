'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectTrustBoundary } = require('../scripts/v9/trust-boundary');

test('trust report never upgrades same-UID local HMAC to strong isolation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-trust-'));
  fs.chmodSync(root, 0o700);
  const report = inspectTrustBoundary({ pluginRoot: root, paths: {} });
  assert.equal(report.trustMode, 'cooperative-local-user');
  assert.equal(report.strength, 'guardrail');
  assert.equal(report.sameUidIsolation, false);
  assert.equal(report.externalAuthorityConfigured, false);
});
