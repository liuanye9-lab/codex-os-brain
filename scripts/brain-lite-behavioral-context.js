'use strict';
const { buildContextPacket } = require('./brain-lite-context-economy');

function buildBehavioralContextPacket(candidates = [], options = {}) {
  const eligible = candidates
    .filter((candidate) => candidate.state === 'promoted' && candidate.rule && candidate.reviewRequired !== true)
    .map((candidate) => ({
      source: 'behavioral-memory',
      heading: candidate.scopeKey || 'general',
      content: candidate.rule,
      modifiedAt: candidate.lastSeenDate || null,
      score: Number(candidate.occurrences || 0) + Number(candidate.confidenceMax || 0),
    }));
  return buildContextPacket(eligible, {
    tokenBudget: Math.min(300, Number(options.tokenBudget || 300)),
    maxItems: Math.min(2, Number(options.maxItems || 2)),
    maxItemsPerSource: Math.min(2, Number(options.maxItemsPerSource || 2)),
  });
}

module.exports = { buildBehavioralContextPacket };
