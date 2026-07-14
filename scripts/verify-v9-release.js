#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPublicExport } = require('./build-public-export');

function verifyReadmeLinks(root) {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const missing = [];
  for (const match of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(root, target))) missing.push(target);
  }
  return { passed: missing.length === 0, missing: [...new Set(missing)] };
}

function verifyPackageContents(pack) {
  const files = (pack.files || []).map(item => item.path);
  const required = ['bin/brain.js', 'mcp/server.mjs'];
  const missing = required.filter(file => !files.includes(file));
  const forbidden = files.filter(file => /^(runtime|data|reports|backups?)\/|(^|\/)MEMORY\.md$|(^|\/)\.env/i.test(file));
  return { passed: missing.length === 0 && forbidden.length === 0, files, missing, forbidden };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const links = verifyReadmeLinks(root);
  if (process.argv.includes('--docs-only')) {
    process.stdout.write(`${JSON.stringify({ passed: links.passed, links }, null, 2)}\n`);
    if (!links.passed) process.exitCode = 1;
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-release-'));
  const exportRoot = path.join(temp, 'public');
  const manifest = buildPublicExport({ sourceRoot: root, outputRoot: exportRoot, allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') });
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: exportRoot, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'npm_pack_failed');
  const pack = JSON.parse(packed.stdout)[0];
  const contents = verifyPackageContents(pack);
  const report = { passed: links.passed && contents.passed, exportedFiles: manifest.files.length, links, package: contents };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

module.exports = { verifyPackageContents, verifyReadmeLinks };
