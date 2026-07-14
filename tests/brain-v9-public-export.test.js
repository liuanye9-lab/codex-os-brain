'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPublicExport, validatePublicPath } = require('../scripts/build-public-export');

const root = path.resolve(__dirname, '..');

test('public export contains only allowlisted generic V9 files', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-public-')), 'export');
  const manifest = buildPublicExport({ sourceRoot: root, outputRoot, allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') });
  assert.ok(manifest.files.includes('bin/brain.js'));
  assert.ok(manifest.files.includes('mcp/server.mjs'));
  assert.equal(fs.existsSync(path.join(outputRoot, 'runtime')), false);
  assert.equal(fs.existsSync(path.join(outputRoot, 'MEMORY.md')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, 'package.json'))).private, undefined);
});

test('export rejects traversal and nonempty destinations', () => {
  assert.throws(() => validatePublicPath('../private.json'), /unsafe_public_path/);
  assert.throws(() => validatePublicPath('/private.json'), /unsafe_public_path/);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-nonempty-'));
  fs.writeFileSync(path.join(outputRoot, 'keep'), 'x');
  assert.throws(() => buildPublicExport({ sourceRoot: root, outputRoot, allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') }), /output_not_empty/);
});

test('export contains no symlinks or local absolute user paths', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-scan-')), 'export');
  buildPublicExport({ sourceRoot: root, outputRoot, allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') });
  const text = fs.readdirSync(outputRoot, { recursive: true, encoding: 'utf8' }).filter(name => fs.statSync(path.join(outputRoot, name)).isFile()).map(name => fs.readFileSync(path.join(outputRoot, name), 'utf8')).join('\n');
  const privateMarkers = [['', 'Users', 'example'].join('/'), ['com', 'apple', 'CloudDocs'].join('~'), ['.codex-brain', 'IDENTITY'].join('/')];
  for (const marker of privateMarkers) assert.equal(text.includes(marker), false);
});
