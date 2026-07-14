'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyReadmeLinks, verifyPackageContents } = require('../scripts/verify-v9-release');

const root = path.resolve(__dirname, '..');

test('README documents Version 9 external surfaces and adaptive lifecycle', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const required of ['Version 9', '```mermaid', 'brain status', 'brain mcp serve', 'PreToolUse', 'Stop', 'V1–V8', 'Ollama', 'brain embeddings configure']) assert.ok(readme.includes(required), required);
  assert.equal((readme.match(/```mermaid/g) || []).length >= 2, true);
});

test('research attribution records source, date, license, adoption, and limits', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'v9', 'research-and-attribution.md'), 'utf8');
  for (const heading of ['Source', 'Version or date', 'License', 'Adopted', 'Not copied']) assert.ok(text.includes(heading), heading);
  assert.ok(text.includes('2605.29442'));
});

test('README relative links resolve', () => {
  assert.deepEqual(verifyReadmeLinks(root).missing, []);
});

test('package policy rejects runtime and requires CLI plus MCP', () => {
  const report = verifyPackageContents({ files: [{ path: 'bin/brain.js' }, { path: 'mcp/server.mjs' }, { path: 'runtime/private.json' }] });
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.forbidden, ['runtime/private.json']);
});
