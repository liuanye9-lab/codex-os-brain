'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskContract, sealTaskContract } = require('../scripts/v9/task-contract');
const { attachEvidence, claimEvidence, evaluateCompletion, verifyCriterion } = require('../scripts/v9/verification');
const { createEvidenceSealer } = require('../scripts/v9/evidence-seal');

function testSealer() {
  return createEvidenceSealer({ key: Buffer.alloc(32, 7) });
}

function trustedContract(input, evidenceSealer = testSealer()) {
  return sealTaskContract(createTaskContract(input), evidenceSealer);
}

function evaluate(contract, evidenceSealer) {
  return evaluateCompletion(contract, {
    verifyEvidence: evidenceSealer.verify,
    verifyContract: evidenceSealer.verifyContract,
  });
}

test('completion requires harness-verified evidence for every required criterion', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({ taskId: 'task_1', objective: 'change feature', criteria: [
    { id: 'tests', required: true, verifier: 'command' },
    { id: 'scope', required: true, verifier: 'scope' },
  ] }, evidenceSealer);
  // Agent claim does not complete.
  const claimed = claimEvidence(contract, 'tests', { id: 'ev_a', provenance: { kind: 'command', ref: 'npm-test' } });
  assert.equal(evaluate(claimed, evidenceSealer).status, 'partial');
  assert.ok(evaluate(claimed, evidenceSealer).unverified.includes('tests') || evaluate(claimed, evidenceSealer).missing.includes('scope'));
});

test('agent cannot forge harness pass via attachEvidence without harnessVerified', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({ taskId: 'task_forge', objective: 'forge', criteria: [{ id: 'tests', required: true }] }, evidenceSealer);
  const forged = attachEvidence(contract, 'tests', {
    id: 'ev_fake',
    status: 'passed',
    provenance: { kind: 'claim', ref: 'fake' },
  });
  assert.equal(forged.criteria[0].status, 'unverified');
  assert.equal(evaluate(forged, evidenceSealer).status, 'partial');
  assert.deepEqual(evaluate(forged, evidenceSealer).unverified, ['tests']);
});

test('harness re-run can pass a command_exit_0 criterion', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({
    taskId: 'task_ok',
    objective: 'ok',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(0)"', humanApproved: true } }],
  }, evidenceSealer);
  const { contract: next, result } = verifyCriterion(contract, 'noop', { command: 'node -e "process.exit(0)"' }, { evidenceSealer });
  assert.equal(result.status, 'passed');
  assert.equal(result.harnessVerified, true);
  assert.equal(evaluate(next, evidenceSealer).status, 'complete');
});

test('harness re-run fails when command exits non-zero', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({
    taskId: 'task_fail',
    objective: 'fail',
    criteria: [{ id: 'noop', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(1)"', humanApproved: true } }],
  }, evidenceSealer);
  const { contract: next, result } = verifyCriterion(contract, 'noop', { command: 'node -e "process.exit(1)"' }, { evidenceSealer });
  assert.equal(result.status, 'failed');
  assert.deepEqual(evaluate(next, evidenceSealer).failed, ['noop']);
});

test('direct contract file forgery cannot create a harness-verified pass', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({
    taskId: 'task_file_forge',
    objective: 'resist direct JSON edits',
    criteria: [{ id: 'tests', required: true }],
  }, evidenceSealer);
  contract.criteria[0].status = 'passed';
  contract.criteria[0].harnessVerified = true;
  contract.criteria[0].evidence.push({
    id: 'ev_forged',
    status: 'passed',
    harnessVerified: true,
    fingerprint: 'fake',
    seal: 'fake',
    verifiedAt: new Date().toISOString(),
    provenance: { kind: 'claim', ref: 'direct-file-edit' },
  });
  const evaluation = evaluate(contract, evidenceSealer);
  assert.equal(evaluation.status, 'partial');
  assert.deepEqual(evaluation.unverified, ['tests']);
});

test('failed evidence prevents completion and unknown criteria are rejected', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({ taskId: 'task_4', objective: 'verify', criteria: [{ id: 'tests', required: true }] }, evidenceSealer);
  assert.throws(() => attachEvidence(contract, 'unknown', { id: 'ev_x', status: 'passed', provenance: {} }), /criterion_not_found|evidence_provenance/);
  const failed = attachEvidence(contract, 'tests', {
    id: 'ev_f',
    status: 'failed',
    harnessVerified: true,
    provenance: { kind: 'command', ref: 'test' },
  });
  assert.deepEqual(evaluate(failed, evidenceSealer).failed, ['tests']);
});

test('contract signature pins verifier command, required flags, and nonempty criteria', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({
    taskId: 'task_pinned',
    objective: 'pin the acceptance question',
    criteria: [{ id: 'tests', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(1)"', humanApproved: true } }],
  }, evidenceSealer);
  contract.criteria[0].verifierSpec.command = 'echo ok';
  assert.deepEqual(evaluate(contract, evidenceSealer).failed, ['contract_integrity']);
  assert.throws(() => verifyCriterion(contract, 'tests', { command: 'echo ok' }, { evidenceSealer }), /contract_integrity_invalid/);

  const optional = trustedContract({
    taskId: 'task_required',
    objective: 'pin required',
    criteria: [{ id: 'tests', required: true, verifier: 'command_exit_0', verifierSpec: { command: 'node -e "process.exit(0)"', humanApproved: true } }],
  }, evidenceSealer);
  optional.criteria[0].required = false;
  assert.deepEqual(evaluate(optional, evidenceSealer).failed, ['contract_integrity']);

  const empty = trustedContract({ taskId: 'task_empty', objective: 'must have criteria', criteria: [] }, evidenceSealer);
  assert.deepEqual(evaluate(empty, evidenceSealer).missing, ['criteria_required']);
});

test('waived status and requireHarness false cannot bypass signed evidence', () => {
  const evidenceSealer = testSealer();
  const contract = trustedContract({
    taskId: 'task_waive',
    objective: 'no unsigned waivers',
    criteria: [{ id: 'tests', required: true }],
  }, evidenceSealer);
  contract.criteria[0].status = 'waived';
  const result = evaluateCompletion(contract, {
    requireHarness: false,
    verifyEvidence: evidenceSealer.verify,
    verifyContract: evidenceSealer.verifyContract,
  });
  assert.equal(result.requireHarness, true);
  assert.deepEqual(result.unverified, ['tests']);
});

test('weak key providers never become cached valid signing keys', () => {
  const weak = createEvidenceSealer({ keyProvider: { get: () => Buffer.alloc(1, 9) } });
  const contract = createTaskContract({ taskId: 'weak', objective: 'weak', criteria: [{ id: 'x' }] });
  contract.trust = { version: 1, specHash: 'bad', sealedAt: new Date().toISOString(), seal: 'bad' };
  assert.equal(weak.verifyContract(contract), false);
  assert.equal(weak.verifyContract(contract), false);
});
