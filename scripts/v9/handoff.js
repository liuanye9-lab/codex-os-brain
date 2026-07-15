'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson, readJsonSafe } = require('./store');

/**
 * Session handoff artifacts — like a shift change log for the next engineer on duty.
 * .brain/feature-backlog.json  — checklist of features (only passes may flip after verify)
 * .brain/progress.md           — what this session did / left behind
 * .brain/smoke.sh              — bootstrap + minimal regression
 */

function resolveHandoffRoot(projectRoot = process.cwd()) {
  return path.resolve(projectRoot, '.brain');
}

function ensureHandoffDir(projectRoot) {
  const root = resolveHandoffRoot(projectRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function defaultSmokeScript() {
  return `#!/usr/bin/env bash
# V9 smoke: start clean, prove basics still work before new work.
set -euo pipefail
echo "[brain-smoke] pwd=$(pwd)"
if command -v git >/dev/null 2>&1; then
  git status --short || true
  git log --oneline -5 || true
fi
if [ -f package.json ]; then
  node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('[brain-smoke] package.json ok')"
fi
echo "[brain-smoke] ok"
`;
}

function defaultBacklog(objective = '') {
  return {
    schemaVersion: 1,
    objective: String(objective || ''),
    updatedAt: new Date().toISOString(),
    features: [
      {
        id: 'feat_bootstrap',
        category: 'meta',
        description: 'Environment boots and smoke script passes',
        steps: ['Run .brain/smoke.sh', 'Confirm exit code 0'],
        passes: false,
      },
    ],
  };
}

function initHandoff({ projectRoot = process.cwd(), objective = '', force = false } = {}) {
  const root = ensureHandoffDir(projectRoot);
  const backlogPath = path.join(root, 'feature-backlog.json');
  const progressPath = path.join(root, 'progress.md');
  const smokePath = path.join(root, 'smoke.sh');

  if (!fs.existsSync(backlogPath) || force) {
    atomicWriteJson(backlogPath, defaultBacklog(objective));
  } else if (objective) {
    const current = readJsonSafe(backlogPath, defaultBacklog()).value;
    current.objective = objective;
    current.updatedAt = new Date().toISOString();
    atomicWriteJson(backlogPath, current);
  }

  if (!fs.existsSync(progressPath) || force) {
    fs.writeFileSync(progressPath, `# Progress log\n\nObjective: ${objective || '(unset)'}\n\n## Sessions\n\n`, { mode: 0o600 });
  }

  if (!fs.existsSync(smokePath) || force) {
    fs.writeFileSync(smokePath, defaultSmokeScript(), { mode: 0o700 });
    try { fs.chmodSync(smokePath, 0o700); } catch { /* windows */ }
  }

  return statusHandoff({ projectRoot });
}

function readBacklog(projectRoot) {
  const file = path.join(resolveHandoffRoot(projectRoot), 'feature-backlog.json');
  return readJsonSafe(file, null).value;
}

function writeProgress({ projectRoot = process.cwd(), sessionSummary, taskId, objective } = {}) {
  const root = ensureHandoffDir(projectRoot);
  const progressPath = path.join(root, 'progress.md');
  if (!fs.existsSync(progressPath)) initHandoff({ projectRoot, objective });
  const stamp = new Date().toISOString();
  const block = [
    ``,
    `### ${stamp}${taskId ? ` — ${taskId}` : ''}`,
    objective ? `Objective: ${objective}` : '',
    sessionSummary || '(no summary)',
    '',
  ].filter(Boolean).join('\n');
  fs.appendFileSync(progressPath, `${block}\n`, { encoding: 'utf8' });
  return { progressPath, appended: true, stamp };
}

function setFeaturePass({ projectRoot = process.cwd(), featureId, passes, allowOnlyAfterVerify = true, verified = false } = {}) {
  if (allowOnlyAfterVerify && passes === true && !verified) {
    throw new Error('feature_pass_requires_verify');
  }
  const file = path.join(resolveHandoffRoot(projectRoot), 'feature-backlog.json');
  const backlog = readJsonSafe(file, null).value;
  if (!backlog) throw new Error('backlog_missing');
  const feature = (backlog.features || []).find(item => item.id === featureId);
  if (!feature) throw new Error('feature_not_found');
  feature.passes = passes === true;
  backlog.updatedAt = new Date().toISOString();
  atomicWriteJson(file, backlog);
  return feature;
}

function statusHandoff({ projectRoot = process.cwd() } = {}) {
  const root = resolveHandoffRoot(projectRoot);
  const backlogPath = path.join(root, 'feature-backlog.json');
  const progressPath = path.join(root, 'progress.md');
  const smokePath = path.join(root, 'smoke.sh');
  const backlog = readJsonSafe(backlogPath, null).value;
  const features = backlog?.features || [];
  return {
    root,
    ready: fs.existsSync(backlogPath) && fs.existsSync(progressPath) && fs.existsSync(smokePath),
    files: {
      backlog: fs.existsSync(backlogPath),
      progress: fs.existsSync(progressPath),
      smoke: fs.existsSync(smokePath),
    },
    objective: backlog?.objective || null,
    featureCount: features.length,
    passingCount: features.filter(item => item.passes).length,
    remaining: features.filter(item => !item.passes).map(item => item.id),
  };
}

function buildHandoffContext({ projectRoot = process.cwd(), contract = null, maxChars = 900 } = {}) {
  const status = statusHandoff({ projectRoot });
  if (!status.ready && !contract) return null;
  const backlog = readBacklog(projectRoot);
  const next = (backlog?.features || []).find(item => !item.passes);
  const progressPath = path.join(status.root, 'progress.md');
  let recent = '';
  if (fs.existsSync(progressPath)) {
    const text = fs.readFileSync(progressPath, 'utf8');
    recent = text.slice(Math.max(0, text.length - 400));
  }
  const lines = [
    'V9 handoff — like a shift change note for the next engineer:',
    contract ? `Active objective: ${contract.objective}` : status.objective ? `Backlog objective: ${status.objective}` : '',
    next ? `Next unfinished feature: ${next.id} — ${next.description}` : 'All backlog features marked passing (re-verify before trusting).',
    `Remaining features: ${status.remaining.join(', ') || 'none'}`,
    'Before new work: run .brain/smoke.sh, read .brain/progress.md and git log.',
    recent ? `Recent progress tail:\n${recent}` : '',
  ].filter(Boolean);
  return lines.join('\n').slice(0, maxChars);
}

module.exports = {
  buildHandoffContext,
  defaultBacklog,
  defaultSmokeScript,
  initHandoff,
  readBacklog,
  resolveHandoffRoot,
  setFeaturePass,
  statusHandoff,
  writeProgress,
};
