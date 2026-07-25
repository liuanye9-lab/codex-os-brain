'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REQUIRED, verifyCapabilities } = require('../scripts/v9/capability-verifier');

test('capability verifier rejects zero-byte namesake files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-capability-empty-'));
  for (const relative of REQUIRED) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }
  const report = verifyCapabilities({ root });
  assert.equal(report.passed, false);
  assert.ok(report.files.every(file => file.present && file.bytes === 0));
});
