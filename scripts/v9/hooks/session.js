'use strict';
const { additionalContext } = require('./input');
const handoff = require('../handoff');

function buildCheckpoint(contract) {
  const constraints = (contract.constraints || []).filter(item => item.explicit).slice(0, 4).map(item => item.text);
  const unresolved = (contract.unresolved || []).slice(0, 4);
  return [
    `V9 checkpoint — objective: ${contract.objective}`,
    constraints.length ? `Explicit constraints: ${constraints.join('; ')}` : '',
    unresolved.length ? `Unresolved: ${unresolved.join('; ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 1000);
}

async function handleSession(input, core) {
  if (!['SessionStart', 'PostCompact', 'PreCompact'].includes(input.event)) return {};

  const contract = core.contracts.active();
  const projectRoot = input.projectRoot || core.projectRoot?.() || process.cwd();
  const parts = [];

  if (contract) parts.push(buildCheckpoint(contract));

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
      const recalled = core.memory.recall({ query: contract.objective, limit: 3 });
      const banner = core.memory.formatForInjection(recalled);
      if (banner) parts.push(banner.slice(0, 500));
    }
  } catch {
    // memory optional
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

module.exports = { buildCheckpoint, handleSession };
