'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { percentile } = require('../evals/v9-reliability/runner.cjs');
const { verifyReadmeLinks, verifyPackageContents, verifyVisualProvenance } = require('../scripts/verify-v9-release');

const root = path.resolve(__dirname, '..');

test('event schema accepts every status and lifecycle kind emitted by the runtime', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'brain-v9-event.schema.json'), 'utf8'));
  for (const status of ['observed', 'passed', 'failed', 'blocked', 'unverified', 'partial', 'complete']) {
    assert.ok(schema.properties.status.enum.includes(status), status);
  }
  for (const kind of ['session', 'subagent', 'tool', 'failure', 'checkpoint', 'verify']) {
    assert.ok(schema.properties.kind.enum.includes(kind), kind);
  }
});

test('README documents V9 external surfaces and adaptive lifecycle', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const required of ['Codex Brain V9', '```mermaid', 'brain status', 'brain mcp serve', 'PreToolUse', 'Stop', 'V1–V8', 'Ollama', 'brain embeddings doctor']) assert.ok(readme.includes(required), required);
  assert.equal((readme.match(/```mermaid/g) || []).length >= 2, true);
});

test('README explains V9 core ideas in plain Chinese with familiar analogies', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const required of ['安全副驾驶', '任务合同', '本地资料柜', '红绿灯', '小抄', 'v1/README.md']) assert.ok(readme.includes(required), required);
});

test('README names the AI engineering disciplines behind the plain-language metaphors', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const required of ['RAG（可选）', 'Loop engineering', 'Capability policy', 'Evidence-gated memory']) assert.ok(readme.includes(required), required);
});

test('research attribution records source, date, license, adoption, and limits', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'v9', 'research-and-attribution.md'), 'utf8');
  for (const heading of ['Source', 'Version or date', 'License', 'Adopted', 'Not copied']) assert.ok(text.includes(heading), heading);
  assert.ok(text.includes('2605.29442'));
});

test('README relative links resolve', () => {
  assert.deepEqual(verifyReadmeLinks(root).missing, []);
});

test('package policy rejects runtime and requires CLI, MCP, and installed-package self-tests', () => {
  const report = verifyPackageContents({ files: [
    { path: '.agents/plugins/marketplace.json' },
    { path: '.codex-plugin/plugin.json' },
    { path: '.mcp.json' },
    { path: 'bin/brain-lite.js' },
    { path: 'bin/brain.js' },
    { path: 'mcp/server.mjs' },
    { path: 'mcp/standalone.mjs' },
    { path: 'scripts/plugin-canary.js' },
    { path: 'scripts/package-selftest.js' },
    { path: 'scripts/test-contract.js' },
    { path: 'scripts/check-contract.js' },
    { path: 'runtime/private.json' },
  ] });
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.forbidden, ['runtime/private.json']);
});

test('README visual assets have declared provenance and local assets are hash-pinned', () => {
  assert.deepEqual(verifyVisualProvenance(root), {
    passed: true,
    missingManifest: false,
    undeclared: [],
    missing: [],
    hashMismatch: [],
  });
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-visuals-'));
  fs.mkdirSync(path.join(fixture, 'assets'));
  fs.writeFileSync(path.join(fixture, 'README.md'), '![undeclared](https://example.com/image.png)\n');
  fs.writeFileSync(path.join(fixture, 'assets', 'visual-provenance.json'), '{"schemaVersion":1,"assets":[]}');
  assert.equal(verifyVisualProvenance(fixture).passed, false);
});

test('latency reporting uses a real percentile rather than the arithmetic mean', () => {
  assert.equal(percentile([1, 2, 3, 100], 0.5), 2.5);
});

test('product, release, runtime contract, and compatibility identity are consistent', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const publicPackage = JSON.parse(fs.readFileSync(path.join(root, 'config', 'public-package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.deepEqual(packageJson.codexBrain, publicPackage.codexBrain);
  assert.equal(packageJson.codexBrain.productMajor, 10);
  assert.equal(packageJson.codexBrain.runtimeContract, 9);
  assert.equal(packageJson.codexBrain.releaseVersion, packageJson.version);
  assert.equal(packageJson.codexBrain.compatibilityName, packageJson.name);
  assert.equal(plugin.codexBrain.productMajor, 10);
  assert.equal(plugin.codexBrain.runtimeContract, 9);
});

test('GitHub Actions are immutable SHA pinned', () => {
  const workflows = fs.readdirSync(path.join(root, '.github', 'workflows')).filter(file => file.endsWith('.yml'));
  for (const file of workflows) {
    const text = fs.readFileSync(path.join(root, '.github', 'workflows', file), 'utf8');
    for (const match of text.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)) {
      assert.match(match[1], /^[a-f0-9]{40}$/, `${file}:${match[0]}`);
    }
  }
});

test('plugin canary runs on every supported CI platform', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'supply-chain.yml'), 'utf8');
  const job = workflow.split(/\n  plugin-canary:\s*\n/)[1];
  assert.ok(job, 'plugin-canary job');
  assert.match(job, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(job, /npm install --global --ignore-scripts @openai\/codex@0\.146\.0/);
  assert.match(job, /npm run test:plugin-canary/);
});
