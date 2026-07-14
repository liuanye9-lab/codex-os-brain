'use strict';

function attachEvidence(contract, criterionId, evidenceRef) {
  if (!evidenceRef || !evidenceRef.id || !evidenceRef.provenance) throw new Error('evidence_provenance_required');
  const index = contract.criteria.findIndex(item => item.id === criterionId);
  if (index < 0) throw new Error('criterion_not_found');
  const next = { ...contract, revision: Number(contract.revision || 1) + 1, criteria: contract.criteria.map(item => ({ ...item, evidence: [...(item.evidence || [])] })) };
  const criterion = next.criteria[index];
  criterion.evidence.push({ ...evidenceRef });
  criterion.status = evidenceRef.status || 'unverified';
  next.updatedAt = new Date().toISOString();
  return next;
}

function evaluateCompletion(contract) {
  const required = contract.criteria.filter(item => item.required !== false);
  const failed = required.filter(item => item.status === 'failed').map(item => item.id);
  const unverified = required.filter(item => item.status === 'unverified').map(item => item.id);
  const missing = required.filter(item => !['passed', 'failed', 'unverified', 'waived'].includes(item.status)).map(item => item.id);
  return { status: failed.length || unverified.length || missing.length ? 'partial' : 'complete', missing, failed, unverified };
}

module.exports = { attachEvidence, evaluateCompletion };
