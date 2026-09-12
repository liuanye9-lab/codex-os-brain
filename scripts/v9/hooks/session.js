'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { additionalContext } = require('./input');
const handoff = require('../handoff');

// A directory is only guarded once it has a contract: policy.evaluateAction returns level 0
// with no contract, so an unadopted directory silently has no gates at all. Measured on this
// machine, five real sessions ran that way. SessionStart is the one moment we can say so.
//
// It stays a notice rather than an auto-adopt: creating contracts in every directory Codex
// opens would litter state and adopt throwaway dirs. And it is deliberately quiet about
// scratch space -- a prompt that fires in /tmp trains you to ignore it, which costs more than
// the reminder is worth.
function unmanagedNotice(projectRoot) {
  try {
    const resolved = path.resolve(projectRoot);
    const home = os.homedir();
    if (resolved === home || resolved === path.parse(resolved).root) return '';
    const tmp = path.resolve(os.tmpdir());
    if (resolved === tmp || resolved.startsWith(tmp + path.sep)) return '';
    if (resolved.split(path.sep).includes('node_modules')) return '';
    // Real work is version controlled; that keeps this off scratch directories.
    if (!fs.existsSync(path.join(resolved, '.git'))) return '';
    return [
      `NOT GUARDED — ${path.basename(resolved)} has no task contract, so the harness gates are inert here.`,
      'Destructive writes are not denied and completion claims are not verified in this directory.',
      'Run `brain adopt --json` to turn them on.',
    ].join('\n');
  } catch {
    return '';
  }
}

function buildCheckpoint(contract) {
  const constraints = (contract.constraints || []).filter(item => item.explicit).slice(0, 4).map(item => item.text);
  const unresolved = (contract.unresolved || []).slice(0, 4);
  return [
    `V9 checkpoint — objective: ${contract.objective}`,
    constraints.length ? `Explicit constraints: ${constraints.join('; ')}` : '',
    unresolved.length ? `Unresolved: ${unresolved.join('; ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 1000);
}

function formatMemorySearchForInjection(report = {}) {
  const rows = Array.isArray(report.results) ? report.results.slice(0, 3) : [];
  if (!rows.length) return '';
  const lines = rows.map(item => {
    const content = String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const source = item.sourceRef ? ` [source:${item.sourceRef}]` : '';
    return content ? `- ${content}${source}` : '';
  }).filter(Boolean);
  return lines.length ? `UNVERIFIED MEMORY — review before use\n${lines.join('\n')}`.slice(0, 500) : '';
}

async function handleSession(input, core) {
  if (!['SessionStart', 'PostCompact', 'PreCompact'].includes(input.event)) return {};

  const contract = core.contracts.active();
  const projectRoot = input.projectRoot || core.projectRoot?.() || process.cwd();
  const parts = [];

  if (contract) parts.push(buildCheckpoint(contract));
  else {
    const notice = unmanagedNotice(projectRoot);
    if (notice) parts.push(notice);
  }

  // Shift-change notes for the next session.
  try {
    if (input.event === 'PreCompact' && contract) {
      core.handoff?.writeProgress?.({
        projectRoot,
        taskId: contract.taskId,
        objective: contract.objective,
        sessionSummary: `PreCompact handoff. Unresolved: ${(contract.unresolved || []).join('; ') || 'none'}. Criteria: ${(contract.criteria || []).map(c => `${c.id}:${c.status}`).join(', ')}`,
      });
    }
    const handoffText = core.handoff?.buildHandoffContext?.({ projectRoot, contract, maxChars: 700 });
    if (handoffText) parts.push(handoffText);
  } catch {
    // handoff optional
  }

  // Memory recall banner (unverified by default).
  try {
    if (contract && core.memory) {
      const recalled = core.memory.search({ query: contract.objective, limit: 3 });
      const banner = formatMemorySearchForInjection(recalled);
      if (banner) parts.push(banner.slice(0, 500));
    }
  } catch {
    parts.push('[MEMORY RETRIEVAL DEGRADED] SQLite memory search failed; no memory was injected.');
    core.events?.append?.({
      kind: 'checkpoint',
      taskId: contract?.taskId,
      status: 'failed',
      reasonCode: 'memory_retrieval_failed',
    });
  }

  // Active skills budget banner.
  try {
    const activeSkills = core.skills?.readState?.()?.active || [];
    for (const skill of activeSkills.slice(0, 2)) {
      parts.push(core.skills.injectionBanner(skill));
    }
  } catch {
    // skills optional
  }

  if (!parts.length) return {};
  return additionalContext(parts.join('\n\n').slice(0, 1200), input.event === 'PreCompact' ? 'PostCompact' : input.event);
}

module.exports = { buildCheckpoint, formatMemorySearchForInjection, handleSession };
