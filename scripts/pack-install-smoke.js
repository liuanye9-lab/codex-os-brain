#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPublicExport } = require('./build-public-export');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command}_failed`);
  return result.stdout;
}

function main() {
  const sourceRoot = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-brain-pack-smoke-'));
  const exportRoot = path.join(temp, 'public');
  const consumer = path.join(temp, 'consumer');
  const npmUserConfig = path.join(temp, 'isolated.npmrc');
  fs.mkdirSync(consumer);
  fs.writeFileSync(npmUserConfig, 'ignore-scripts=true\nstrict-allow-scripts=false\n', { mode: 0o600 });
  const npmEnv = { ...process.env, NPM_CONFIG_USERCONFIG: npmUserConfig };
  for (const key of Object.keys(npmEnv)) {
    if (key.toLowerCase() === 'npm_config_allow_scripts') delete npmEnv[key];
  }
  try {
    buildPublicExport({
      sourceRoot,
      outputRoot: exportRoot,
      allowlistPath: path.join(sourceRoot, 'config', 'public-export-allowlist.json'),
    });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: exportRoot, env: npmEnv });
    run(npm, ['run', 'check'], { cwd: exportRoot, env: npmEnv });
    const packed = JSON.parse(run(npm, ['pack', '--json'], { cwd: exportRoot, env: npmEnv }))[0];
    const tarball = path.join(exportRoot, packed.filename);
    run(npm, ['init', '-y'], { cwd: consumer, env: npmEnv });
    run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, env: npmEnv });
    run(process.execPath, ['--input-type=module', '--eval',
      "import('codex-brain-v9').then(async root => { const core = await import('codex-brain-v9/core'); if (!root.default || typeof core.default?.core?.createV9Core !== 'function') process.exit(1); await import('codex-brain-v9/labs/cognitive-assets').then(() => process.exit(1), () => {}); })"],
    { cwd: consumer });
    run(process.execPath, [path.join(consumer, 'node_modules', '.bin', 'brain'), '--help', '--json'], { cwd: consumer });
    process.stdout.write(`${JSON.stringify({ passed: true, package: packed.filename })}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { main };
