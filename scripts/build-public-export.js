#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function codeError(code) { const error = new Error(code); error.code = code; return error; }

function validatePublicPath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw codeError('unsafe_public_path');
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw codeError('unsafe_public_path');
  return normalized;
}

function allFiles(root) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', '.worktrees', 'node_modules'].includes(entry.name)) continue;
      if (current === root && ['runtime', 'data', 'reports'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).replaceAll('\\', '/');
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative);
    }
  }
  visit(root);
  return files;
}

function globRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') { source += '.*'; i += 1; }
    else if (char === '*') source += '[^/]*';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function isDataless(filePath) {
  if (process.platform !== 'darwin') return false;
  return /\bdataless\b/.test(spawnSync('/bin/ls', ['-lO', filePath], { encoding: 'utf8', timeout: 1500 }).stdout || '');
}

function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('base64url'); }

function buildPublicExport({ sourceRoot, outputRoot, allowlistPath }) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw codeError('output_not_empty');
  fs.mkdirSync(output, { recursive: true, mode: 0o755 });
  const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const candidates = allFiles(source);
  const mappings = new Map();
  for (const entry of allowlist.entries || []) mappings.set(validatePublicPath(entry.target), validatePublicPath(entry.source));
  for (const pattern of allowlist.patterns || []) {
    const regex = globRegex(validatePublicPath(pattern));
    for (const relative of candidates.filter(file => regex.test(file))) mappings.set(relative, relative);
  }
  const records = [];
  for (const [targetRelative, sourceRelative] of [...mappings.entries()].sort()) {
    const sourceFile = path.join(source, sourceRelative);
    const targetFile = path.join(output, targetRelative);
    const stat = fs.lstatSync(sourceFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw codeError('symlink_not_allowed');
    if (isDataless(sourceFile)) throw codeError('dataless_file');
    fs.mkdirSync(path.dirname(targetFile), { recursive: true, mode: 0o755 });
    fs.copyFileSync(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(targetFile, stat.mode & 0o111 ? 0o755 : 0o644);
    records.push({ path: targetRelative, sha256Base64Url: sha256(targetFile), bytes: fs.statSync(targetFile).size });
  }
  const manifest = { schemaVersion: 1, files: records.map(record => record.path), records };
  fs.writeFileSync(path.join(output, 'export-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('usage: build-public-export.js --output PATH');
  const root = path.resolve(__dirname, '..');
  const manifest = buildPublicExport({ sourceRoot: root, outputRoot: args[outputIndex + 1], allowlistPath: path.join(root, 'config', 'public-export-allowlist.json') });
  process.stdout.write(`${JSON.stringify({ output: path.resolve(args[outputIndex + 1]), files: manifest.files.length })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

module.exports = { buildPublicExport, validatePublicPath };
