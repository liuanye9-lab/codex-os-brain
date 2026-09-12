'use strict';
// The episodic slot, and deliberately nothing more.
//
// Harness-Bench (5,194 trajectories) found that stronger models need less prompt-level
// scaffolding but still need persistent state and evidence. So this hook never tells the
// model how to work -- it only replays a fact the model cannot obtain on its own: that a
// specific operation already failed the same way, more than once, in this project.
//
// Everything here is shaped by that one rule. No advice, no strategy, no checklists.

const { additionalContext } = require('./input');

// Two is the threshold because one failure is information the model already has in its
// own context. A second identical failure is the first moment replay adds anything.
const MIN_REPEATS = 2;
const MAX_ITEMS = 3;
const MAX_CHARS = 320;

function selectRepeated(circuits, { minRepeats = MIN_REPEATS, maxItems = MAX_ITEMS } = {}) {
  if (!Array.isArray(circuits)) return [];
  return circuits
    .filter(entry => entry && entry.status !== 'closed' && Number(entry.consecutive) >= minRepeats)
    .sort((a, b) => Number(b.consecutive) - Number(a.consecutive))
    .slice(0, maxItems);
}

function formatRecall(entries) {
  if (!entries.length) return '';
  const lines = entries.map(entry => {
    const operation = String(entry.operation || 'unknown operation').slice(0, 60);
    return `- ${operation}: failed ${entry.consecutive}x in a row here`;
  });
  return `Earlier in this project:\n${lines.join('\n')}`.slice(0, MAX_CHARS);
}

async function handleRecall(input, core) {
  // Silence is the default. A prompt hook that speaks on every turn becomes noise, and
  // noise is exactly the "harness as a cage" failure this design is trying to avoid.
  if (!core?.failures?.projectHistory) return {};
  let circuits;
  try { circuits = core.failures.projectHistory({ minConsecutive: MIN_REPEATS }); } catch { return {}; }

  const repeated = selectRepeated(circuits);
  if (!repeated.length) return {};

  const text = formatRecall(repeated);
  if (!text) return {};
  return { ...additionalContext(text, input.event), reason_code: 'repeated_failure_recall' };
}

module.exports = { MIN_REPEATS, formatRecall, handleRecall, selectRepeated };
