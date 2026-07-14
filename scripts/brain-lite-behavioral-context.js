'use strict';
const { buildContextPacket, markEvidenceUse } = require('./brain-lite-context-economy');

const USE_TYPES = new Set(['constraint', 'decision', 'implementation', 'verification']);

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

function markBehavioralContextUse(packet, uses = []) {
  const allowedEvidence = new Set((packet.injected || []).map((item) => item.evidenceId));
  const sanitizedUses = (Array.isArray(uses) ? uses : [])
    .filter((use) => use && allowedEvidence.has(use.evidenceId) && USE_TYPES.has(use.useType))
    .map((use) => ({ evidenceId: use.evidenceId, useType: use.useType }));
  return markEvidenceUse(packet, sanitizedUses);
}

module.exports = { buildBehavioralContextPacket, markBehavioralContextUse };
