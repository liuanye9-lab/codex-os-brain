#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setProjectHooks } = require('./v9/hook-config');

const root = path.resolve(__dirname, '..');

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `command_failed:${args.join(' ')}`);
  return result.stdout;
}

function main() {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-brain-package-selftest-'));
  const projectRoot = path.join(isolated, 'project');
  const codex = path.join(isolated, 'codex-home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  const original = '{"version":1,"marker":"preserve","hooks":{"PreToolUse":[{"matcher":"Custom","hooks":[{"type":"command","command":"node custom.js","timeout":5}]}]}}\n';
  fs.writeFileSync(path.join(codex, 'hooks.json'), original);
  const env = {
    ...process.env,
    CODEX_BRAIN_HOME: path.join(isolated, 'brain-home'),
    CODEX_BRAIN_STATE_HOME: path.join(isolated, 'state-home'),
    CODEX_HOME: codex,
  };
  try {
    const help = JSON.parse(runNode([path.join(root, 'bin', 'brain.js'), '--help', '--json'], { cwd: projectRoot, env }));
    if (help.usage !== 'brain <command> [action] [--flags] [--json]') throw new Error('cli_help_contract_failed');
    const doctor = JSON.parse(runNode([path.join(root, 'bin', 'brain.js'), 'doctor', '--project', projectRoot, '--json'], { cwd: projectRoot, env }));
    if (!doctor.ok) throw new Error('doctor_contract_failed');

    const enabled = setProjectHooks({ projectRoot, pluginRoot: root, hostConfigRoot: codex, enabled: true, confirm: true });
    if (!enabled.valid || !enabled.eventsComplete || !enabled.fingerprintMatch || enabled.foreignHookCount !== 1) throw new Error('hook_install_contract_failed');
    const disabled = setProjectHooks({ projectRoot, pluginRoot: root, hostConfigRoot: codex, enabled: false, confirm: true });
    if (disabled.enabled || fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8') !== original) throw new Error('hook_restore_contract_failed');

    const mcp = runNode([path.join(root, 'scripts', 'probe-v9-mcp.mjs')], { cwd: projectRoot, env }).trim();
    const api = runNode([
      '--eval',
      "import(process.argv[1]).then(({ default: api }) => { if (typeof api.taskContract?.buildTaskContract !== 'function' || typeof api.v9?.core?.createV9Core !== 'function' || typeof api.v9?.evidenceSeal?.createEvidenceSealer !== 'function') process.exit(1); process.stdout.write('public-api-v9-ok'); })",
      path.join(root, 'index.js'),
    ], { cwd: projectRoot, env }).trim();
    process.stdout.write(`${JSON.stringify({ passed: true, cli: true, doctor: true, hooks: true, api, mcp }, null, 2)}\n`);
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { main };
