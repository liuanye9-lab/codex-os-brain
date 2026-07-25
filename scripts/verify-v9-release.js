#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
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
  const required = ['bin/brain.js', 'mcp/server.mjs', 'scripts/package-selftest.js', 'scripts/test-contract.js', 'scripts/check-contract.js'];
  const missing = required.filter(file => !files.includes(file));
  const forbidden = files.filter(file => /^(runtime|data|reports|backups?)\/|(^|\/)MEMORY\.md$|(^|\/)\.env/i.test(file));
  return { passed: missing.length === 0 && forbidden.length === 0, files, missing, forbidden };
}

function markdownFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'runtime', 'data', 'reports'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  }
  visit(root);
  return files;
}

function verifyVisualProvenance(root) {
  const manifestPath = path.join(root, 'assets', 'visual-provenance.json');
  if (!fs.existsSync(manifestPath)) return { passed: false, missingManifest: true, undeclared: [], missing: [], hashMismatch: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const exact = new Map((manifest.assets || []).filter(item => item.src).map(item => [item.src, item]));
  const prefixes = (manifest.assets || []).filter(item => item.srcPrefix);
  const undeclared = [];
  const missing = [];
  const hashMismatch = [];
  for (const file of markdownFiles(root)) {
    const markdown = fs.readFileSync(file, 'utf8');
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const source = match[1].replace(/^<|>$/g, '');
      if (/^https?:/.test(source)) {
        if (!exact.has(source) && !prefixes.some(item => source.startsWith(item.srcPrefix))) undeclared.push(`${path.relative(root, file)}:${source}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), source.split('#')[0]);
      const relative = path.relative(root, resolved).replaceAll('\\', '/');
      const declaration = exact.get(relative);
      if (!declaration) { undeclared.push(`${path.relative(root, file)}:${relative}`); continue; }
      if (!fs.existsSync(resolved)) { missing.push(relative); continue; }
      if (declaration.sha256) {
        const observed = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
        if (observed !== declaration.sha256) hashMismatch.push(relative);
      }
    }
  }
  return {
    passed: undeclared.length === 0 && missing.length === 0 && hashMismatch.length === 0,
    missingManifest: false,
    undeclared: [...new Set(undeclared)],
    missing: [...new Set(missing)],
    hashMismatch: [...new Set(hashMismatch)],
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const links = verifyReadmeLinks(root);
  const visuals = verifyVisualProvenance(root);
  if (process.argv.includes('--docs-only')) {
    process.stdout.write(`${JSON.stringify({ passed: links.passed && visuals.passed, links, visuals }, null, 2)}\n`);
    if (!links.passed || !visuals.passed) process.exitCode = 1;
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-release-'));
  const exportRoot = path.join(temp, 'public');
  const manifest = buildPublicExport({ sourceRoot: root, outputRoot: exportRoot, allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') });
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: exportRoot, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'npm_pack_failed');
  const pack = JSON.parse(packed.stdout)[0];
  const contents = verifyPackageContents(pack);
  const report = { passed: links.passed && visuals.passed && contents.passed, exportedFiles: manifest.files.length, links, visuals, package: contents };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

module.exports = { verifyPackageContents, verifyReadmeLinks, verifyVisualProvenance };
