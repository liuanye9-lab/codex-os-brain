#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createV9Core } = require('./v9/core');
const { setProjectHooks } = require('./v9/hook-config');
const { resolveV9Paths } = require('./v9/paths');

const pluginRoot = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-brain-production-smoke-'));
const projectRoot = path.join(temporaryRoot, 'project');
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'smoke.marker'), 'ok\n', { mode: 0o600 });

const previousTestContext = process.env.NODE_TEST_CONTEXT;
const previousEvidenceKey = process.env.CODEX_BRAIN_EVIDENCE_KEY_B64;
delete process.env.NODE_TEST_CONTEXT;
delete process.env.CODEX_BRAIN_EVIDENCE_KEY_B64;

try {
  const paths = resolveV9Paths({
    CODEX_BRAIN_HOME: path.join(temporaryRoot, 'brain-home'),
    CODEX_BRAIN_STATE_HOME: path.join(temporaryRoot, 'state-home'),
  }, { home: temporaryRoot });
  const core = createV9Core({ paths, projectRoot });
  core.contracts.create({
    taskId: 'production-smoke',
    objective: 'Exercise the production evidence provider without test mode',
    criteria: [{
      id: 'marker',
      required: true,
      verifier: 'file_exists',
      verifierSpec: { path: 'smoke.marker' },
    }],
  });
  const verification = core.verification.run({ cwd: projectRoot });
  if (verification.status !== 'complete') throw new Error('production_evidence_round_trip_failed');

  const hostConfigRoot = path.join(temporaryRoot, 'codex-home');
  const enabled = setProjectHooks({ projectRoot, pluginRoot, hostConfigRoot, enabled: true, confirm: true });
  if (!enabled.valid || !enabled.runtimeDigestMatch || !enabled.packageVersionMatch) {
    throw new Error('production_hook_install_failed');
  }
  const disabled = setProjectHooks({ projectRoot, pluginRoot, hostConfigRoot, enabled: false, confirm: true });
  if (disabled.enabled) throw new Error('production_hook_uninstall_failed');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    platform: process.platform,
    evidence: verification.status,
    hooks: { enabled: enabled.valid, restoration: disabled.restoration },
  })}\n`);
} finally {
  if (previousTestContext === undefined) delete process.env.NODE_TEST_CONTEXT;
  else process.env.NODE_TEST_CONTEXT = previousTestContext;
  if (previousEvidenceKey === undefined) delete process.env.CODEX_BRAIN_EVIDENCE_KEY_B64;
  else process.env.CODEX_BRAIN_EVIDENCE_KEY_B64 = previousEvidenceKey;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
