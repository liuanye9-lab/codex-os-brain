'use strict';
function validateLifecycleEvidence(candidate, policy = {}) {
  if (candidate.state === 'revoked') return { decision: 'reject', reason: 'revoked' };
  if (candidate.risk !== 'read-only') return { decision: 'needs-approval', reason: candidate.risk };
  if (candidate.occurrences < Number(policy.minimumOccurrences || 3)) return { decision: 'reject', reason: 'insufficient-occurrences' };
  const replays = candidate.replays || [];
  if (replays.length < Number(policy.minimumPassingReplays || 3) || replays.some((item) => item.passed !== true)) return { decision: 'reject', reason: 'replay-failure' };
  if (candidate.experiment?.state !== 'stable') return { decision: 'reject', reason: 'policy-benefit-not-proven' };
  return { decision: 'eligible', reason: 'verified-benefit' };
}
function transitionSkill(candidate, event, policy = {}) {
  if (event.type === 'critical-failure' && policy.criticalFailureRevokes !== false) return { ...candidate, state: 'revoked', revokedReason: 'critical-failure' };
  if (candidate.state === 'candidate' && event.type === 'shadow-complete') return { ...candidate, state: 'shadow' };
  if (candidate.state === 'shadow' && event.type === 'replay-complete') return { ...candidate, state: 'replay', replays: event.replays || [] };
  if (candidate.state === 'replay' && event.type === 'canary-approved') {
    const decision = validateLifecycleEvidence({ ...candidate, state: 'canary' }, policy);
    return decision.decision === 'eligible' ? { ...candidate, state: 'canary' } : { ...candidate, state: decision.decision === 'needs-approval' ? 'needs-approval' : 'rejected' };
  }
  if (candidate.state === 'canary' && event.type === 'canary-passed') return { ...candidate, state: 'promoted' };
  return { ...candidate };
}
module.exports = { transitionSkill, validateLifecycleEvidence };
