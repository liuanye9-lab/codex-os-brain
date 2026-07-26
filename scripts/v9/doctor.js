'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEvidenceSealer } = require('./evidence-seal');
const { createTaskContract, sealTaskContract } = require('./task-contract');
const { evaluateCompletion, verifyCriterion } = require('./verification');

function runEvidenceSigningLoop(options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(options.tmpdir || os.tmpdir(), 'codex-brain-doctor-'));
  try {
    fs.writeFileSync(path.join(temporaryRoot, 'doctor.marker'), 'ok\n', { mode: 0o600 });
    const evidenceSealer = createEvidenceSealer({
      paths: { evidenceSealKeyPath: path.join(temporaryRoot, 'state', 'evidence', 'seal.key') },
      keyProvider: options.keyProvider,
    });
    const contract = sealTaskContract(createTaskContract({
      taskId: 'doctor-evidence-loop',
      objective: 'Verify contract and evidence signing round trip',
      scope: { allowed: [temporaryRoot], forbidden: [] },
      criteria: [{
        id: 'marker',
        required: true,
        verifier: 'file_exists',
        verifierSpec: { path: 'doctor.marker' },
      }],
    }), evidenceSealer);
    const verified = verifyCriterion(contract, 'marker', {}, {
      cwd: temporaryRoot,
      evidenceSealer,
    });
    const evaluation = evaluateCompletion(verified.contract, {
      verifyContract: evidenceSealer.verifyContract,
      verifyEvidence: evidenceSealer.verify,
    });
    return {
      passed: verified.result.status === 'passed' && evaluation.status === 'complete',
      providerType: evidenceSealer.providerType,
      verifierStatus: verified.result.status,
      completionStatus: evaluation.status,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = { runEvidenceSigningLoop };
