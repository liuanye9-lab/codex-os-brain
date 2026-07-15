'use strict';

const crypto = require('node:crypto');
const { runVerifier } = require('./verifiers');

/**
 * Evidence protocol:
 * - Agent may claim evidence (status stays unverified, harnessVerified=false)
 * - Only harness re-run via verifyCriterion/verifyActive can set harnessVerified=true and status passed|failed
 * - evaluateCompletion requires harnessVerified for complete
 */

function attachEvidence(contract, criterionId, evidenceRef) {
  if (!evidenceRef || !evidenceRef.id || !evidenceRef.provenance) throw new Error('evidence_provenance_required');
  const index = contract.criteria.findIndex(item => item.id === criterionId);
  if (index < 0) throw new Error('criterion_not_found');
  const next = {
    ...contract,
    revision: Number(contract.revision || 1) + 1,
    criteria: contract.criteria.map(item => ({ ...item, evidence: [...(item.evidence || [])] })),
  };
  const criterion = next.criteria[index];
  const harnessVerified = evidenceRef.harnessVerified === true;
  const status = harnessVerified
    ? (evidenceRef.status || 'unverified')
    : 'unverified'; // agent claims cannot pass
  criterion.evidence.push({
    id: evidenceRef.id,
    status,
    provenance: { ...evidenceRef.provenance },
    harnessVerified,
    fingerprint: evidenceRef.fingerprint || null,
    verifiedAt: harnessVerified ? (evidenceRef.verifiedAt || new Date().toISOString()) : null,
    summary: evidenceRef.summary || null,
  });
  // Criterion status: only harness can mark passed/failed.
  if (harnessVerified) {
    criterion.status = status;
    criterion.lastVerifiedAt = evidenceRef.verifiedAt || new Date().toISOString();
    criterion.lastVerifierFingerprint = evidenceRef.fingerprint || null;
  } else {
    criterion.status = criterion.status === 'passed' ? 'passed' : 'unverified';
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Agent-facing claim: always unverified until harness re-run. */
function claimEvidence(contract, criterionId, evidenceRef) {
  return attachEvidence(contract, criterionId, {
    ...evidenceRef,
    status: 'unverified',
    harnessVerified: false,
  });
}

function evaluateCompletion(contract, options = {}) {
  const requireHarness = options.requireHarness !== false;
  const required = contract.criteria.filter(item => item.required !== false);
  const failed = [];
  const unverified = [];
  const missing = [];
  for (const item of required) {
    const harnessOk = !requireHarness || item.evidence?.some(ev => ev.harnessVerified && ev.status === 'passed') || (item.harnessVerified === true && item.status === 'passed');
    if (item.status === 'failed') failed.push(item.id);
    else if (item.status === 'waived') continue;
    else if (item.status === 'passed' && harnessOk) continue;
    else if (item.status === 'passed' && !harnessOk) unverified.push(item.id);
    else if (item.status === 'unverified') unverified.push(item.id);
    else missing.push(item.id);
  }
  const status = failed.length || unverified.length || missing.length ? 'partial' : 'complete';
  return {
    status,
    missing,
    failed,
    unverified,
    requireHarness,
    lastVerifiedAt: contract.lastVerifiedAt || null,
  };
}

function verifyCriterion(contract, criterionId, spec = {}, context = {}) {
  const criterion = contract.criteria.find(item => item.id === criterionId);
  if (!criterion) throw new Error('criterion_not_found');
  const result = runVerifier(criterion, spec, context);
  const evidenceId = `ev_${crypto.randomBytes(8).toString('hex')}`;
  const verifiedAt = new Date().toISOString();
  const next = attachEvidence(contract, criterionId, {
    id: evidenceId,
    status: result.status,
    harnessVerified: true,
    fingerprint: result.fingerprint,
    verifiedAt,
    summary: result.summary,
    provenance: result.provenance,
  });
  next.lastVerifiedAt = verifiedAt;
  return { contract: next, result: { criterionId, evidenceId, ...result, verifiedAt } };
}

function verifyActive(contract, options = {}) {
  if (!contract) return { status: 'partial', missing: ['active_task'], failed: [], unverified: [], results: [] };
  const context = {
    cwd: options.cwd || process.cwd(),
    allowedPaths: contract.scope?.allowed || [],
    forbiddenPaths: contract.scope?.forbidden || [],
    attestationToken: options.attestationToken,
    providedToken: options.providedToken,
  };
  let current = contract;
  const results = [];
  const required = current.criteria.filter(item => item.required !== false);
  for (const criterion of required) {
    const spec = options.specs?.[criterion.id] || {};
    const { contract: next, result } = verifyCriterion(current, criterion.id, spec, context);
    current = next;
    results.push(result);
  }
  current.lastVerifiedAt = new Date().toISOString();
  const evaluation = evaluateCompletion(current, { requireHarness: true });
  return { contract: current, evaluation, results };
}

module.exports = {
  attachEvidence,
  claimEvidence,
  evaluateCompletion,
  verifyCriterion,
  verifyActive,
};
