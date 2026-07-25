'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalContractSpec, contractSpecHash } = require('./task-contract');

const KEYCHAIN_SERVICE = 'com.codex-brain.v9.evidence-signing';
const KEYCHAIN_ACCOUNT = 'contract-evidence-hmac';

function canonicalCriterionSpec(criterion = {}) {
  return JSON.stringify({
    id: criterion.id || null,
    required: criterion.required !== false,
    verifier: criterion.verifier || null,
    verifierSpec: criterion.verifierSpec || null,
  });
}

function canonicalEvidence(contract, criterion, evidence = {}) {
  return JSON.stringify({
    contractSpecHash: contractSpecHash(contract),
    criterionSpec: canonicalCriterionSpec(criterion),
    id: evidence.id || null,
    status: evidence.status || null,
    fingerprint: evidence.fingerprint || null,
    verifiedAt: evidence.verifiedAt || null,
    provenance: {
      kind: evidence.provenance?.kind || null,
      ref: evidence.provenance?.ref || null,
    },
  });
}

function createMacKeychainEvidenceKeyProvider({ service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT } = {}) {
  function run(args) {
    return spawnSync('/usr/bin/security', args, { encoding: 'utf8', timeout: 10_000 });
  }
  return {
    get({ create = false } = {}) {
      if (process.platform !== 'darwin') return null;
      let result = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (result.status !== 0 && create) {
        const generated = crypto.randomBytes(32).toString('base64');
        result = run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', generated]);
        if (result.status !== 0) return null;
        result = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      }
      if (result.status !== 0) return null;
      const loaded = Buffer.from(String(result.stdout || '').trim(), 'base64');
      return loaded.length >= 32 ? loaded : null;
    },
  };
}

function createEvidenceSealer({ paths, key, keyProvider } = {}) {
  const keyPath = process.env.NODE_TEST_CONTEXT ? paths?.evidenceSealKeyPath : null;
  const environmentKey = process.env.CODEX_BRAIN_EVIDENCE_KEY_B64
    ? Buffer.from(process.env.CODEX_BRAIN_EVIDENCE_KEY_B64, 'base64')
    : null;
  const provider = keyProvider || (
    environmentKey?.length >= 32
      ? { get: () => environmentKey }
      : process.platform === 'darwin' && !process.env.NODE_TEST_CONTEXT
        ? createMacKeychainEvidenceKeyProvider()
        : null
  );
  let cachedKey = key && Buffer.from(key).length >= 32 ? Buffer.from(key) : null;

  function loadKey({ create = false } = {}) {
    if (cachedKey) return cachedKey;
    if (provider) {
      const loaded = provider.get({ create });
      if (!loaded || loaded.length < 32) return null;
      cachedKey = Buffer.from(loaded);
      return cachedKey;
    }
    if (!keyPath) return null;
    try {
      const loaded = fs.readFileSync(keyPath);
      if (loaded.length < 32) return null;
      cachedKey = loaded;
      return cachedKey;
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) return null;
    }

    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const generated = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, generated, { flag: 'wx', mode: 0o600 });
      cachedKey = generated;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const loaded = fs.readFileSync(keyPath);
      if (loaded.length < 32) return null;
      cachedKey = loaded;
    }
    return cachedKey;
  }

  function sealContract(contract, metadata = {}) {
    const signingKey = loadKey({ create: true });
    if (!signingKey) throw new Error('evidence_seal_key_unavailable');
    return crypto.createHmac('sha256', signingKey)
      .update(JSON.stringify({
        spec: canonicalContractSpec(contract),
        specHash: metadata.specHash || contractSpecHash(contract),
        sealedAt: metadata.sealedAt || null,
      }))
      .digest('base64url');
  }

  function verifyContract(contract) {
    const trust = contract?.trust;
    if (!trust?.seal || trust.version !== 1 || typeof trust.sealedAt !== 'string') return false;
    const currentHash = contractSpecHash(contract);
    if (trust.specHash !== currentHash) return false;
    const signingKey = loadKey({ create: false });
    if (!signingKey) return false;
    const expected = crypto.createHmac('sha256', signingKey)
      .update(JSON.stringify({
        spec: canonicalContractSpec(contract),
        specHash: trust.specHash,
        sealedAt: trust.sealedAt,
      }))
      .digest();
    let received;
    try { received = Buffer.from(trust.seal, 'base64url'); }
    catch { return false; }
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  function seal(contract, criterion, evidence) {
    const signingKey = loadKey({ create: true });
    if (!signingKey) throw new Error('evidence_seal_key_unavailable');
    return crypto.createHmac('sha256', signingKey)
      .update(canonicalEvidence(contract, criterion, evidence))
      .digest('base64url');
  }

  function verify(contract, criterion, evidence) {
    if (!evidence?.seal || typeof evidence.seal !== 'string') return false;
    if (!verifyContract(contract)) return false;
    const signingKey = loadKey({ create: false });
    if (!signingKey) return false;
    const expected = crypto.createHmac('sha256', signingKey)
      .update(canonicalEvidence(contract, criterion, evidence))
      .digest();
    let received;
    try {
      received = Buffer.from(evidence.seal, 'base64url');
    } catch {
      return false;
    }
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  return { seal, sealContract, verify, verifyContract };
}

module.exports = {
  canonicalCriterionSpec,
  canonicalEvidence,
  createEvidenceSealer,
  createMacKeychainEvidenceKeyProvider,
};
