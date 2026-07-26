'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalContractSpec, contractSpecHash } = require('./task-contract');

const KEYCHAIN_SERVICE = 'com.codex-brain.v9.evidence-signing';
const KEYCHAIN_ACCOUNT = 'contract-evidence-hmac';
const KEY_BYTES = 32;

function decodeKey(value) {
  if (Buffer.isBuffer(value)) return value.length >= KEY_BYTES ? Buffer.from(value) : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const decoded = Buffer.from(value.trim(), 'base64');
  return decoded.length >= KEY_BYTES ? decoded : null;
}

function createFileEvidenceKeyProvider({ keyPath, providerType = 'file-0600' } = {}) {
  return {
    type: providerType,
    get({ create = false } = {}) {
      if (!keyPath) return null;
      try {
        const loaded = fs.readFileSync(keyPath);
        return loaded.length >= KEY_BYTES ? loaded : null;
      } catch (error) {
        if (error.code !== 'ENOENT' || !create) return null;
      }
      fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
      const generated = crypto.randomBytes(KEY_BYTES);
      try {
        fs.writeFileSync(keyPath, generated, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const loaded = fs.readFileSync(keyPath);
        return loaded.length >= KEY_BYTES ? loaded : null;
      }
      try { fs.chmodSync(keyPath, 0o600); } catch {}
      return generated;
    },
  };
}

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
    type: 'macos-keychain',
    get({ create = false } = {}) {
      let result = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (result.status !== 0 && create) {
        const generated = crypto.randomBytes(32).toString('base64');
        result = run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', generated]);
        if (result.status !== 0) return null;
        result = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      }
      if (result.status !== 0) return null;
      return decodeKey(String(result.stdout || ''));
    },
  };
}

function createLinuxSecretServiceEvidenceKeyProvider({ run = spawnSync, service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT } = {}) {
  return {
    type: 'linux-libsecret',
    get({ create = false } = {}) {
      let result = run('secret-tool', ['lookup', 'service', service, 'account', account], {
        encoding: 'utf8', timeout: 10_000,
      });
      let loaded = result.status === 0 ? decodeKey(String(result.stdout || '')) : null;
      if (!loaded && create) {
        const encoded = crypto.randomBytes(KEY_BYTES).toString('base64');
        result = run('secret-tool', ['store', '--label', 'Codex Brain evidence signing key', 'service', service, 'account', account], {
          encoding: 'utf8', timeout: 10_000, input: `${encoded}\n`,
        });
        if (result.status === 0) loaded = decodeKey(encoded);
      }
      return loaded;
    },
  };
}

function createWindowsDpapiEvidenceKeyProvider({ keyPath, run = spawnSync } = {}) {
  const protectedPath = keyPath ? `${keyPath}.dpapi` : null;
  function powershell(script, values = {}) {
    const executable = process.env.ComSpec ? 'powershell.exe' : 'powershell';
    return run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_BRAIN_DPAPI_PATH: protectedPath || '',
        CODEX_BRAIN_DPAPI_VALUE: values.value || '',
      },
    });
  }
  return {
    type: 'windows-dpapi-current-user',
    get({ create = false } = {}) {
      if (!protectedPath) return null;
      if (fs.existsSync(protectedPath)) {
        const result = powershell(
          '$p=[System.IO.File]::ReadAllText($env:CODEX_BRAIN_DPAPI_PATH);$s=ConvertTo-SecureString $p;$b=[System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[System.Console]::Write([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}',
        );
        return result.status === 0 ? decodeKey(String(result.stdout || '')) : null;
      }
      if (!create) return null;
      fs.mkdirSync(path.dirname(protectedPath), { recursive: true, mode: 0o700 });
      const generated = crypto.randomBytes(KEY_BYTES);
      const result = powershell(
        '$s=ConvertTo-SecureString $env:CODEX_BRAIN_DPAPI_VALUE -AsPlainText -Force;$p=ConvertFrom-SecureString $s;[System.IO.File]::WriteAllText($env:CODEX_BRAIN_DPAPI_PATH,$p)',
        { value: generated.toString('base64') },
      );
      return result.status === 0 ? generated : null;
    },
  };
}

function createProductionEvidenceKeyProvider({ paths, platform = process.platform, run = spawnSync } = {}) {
  if (platform === 'darwin') return createMacKeychainEvidenceKeyProvider();
  if (platform === 'win32') return createWindowsDpapiEvidenceKeyProvider({ keyPath: paths?.evidenceSealKeyPath, run });
  if (platform === 'linux') {
    const secretService = createLinuxSecretServiceEvidenceKeyProvider({ run });
    return {
      type: 'linux-libsecret-or-file-0600',
      get(options = {}) {
        const secret = secretService.get(options);
        if (secret) return secret;
        return createFileEvidenceKeyProvider({ keyPath: paths?.evidenceSealKeyPath, providerType: 'linux-file-0600' }).get(options);
      },
    };
  }
  return createFileEvidenceKeyProvider({ keyPath: paths?.evidenceSealKeyPath });
}

function createEvidenceSealer({ paths, key, keyProvider } = {}) {
  let cachedKey = decodeKey(key);
  const environmentKey = decodeKey(process.env.CODEX_BRAIN_EVIDENCE_KEY_B64);
  const provider = cachedKey
    ? { type: 'explicit-key', get: () => cachedKey }
    : keyProvider
    || (environmentKey ? { type: 'external-environment', get: () => environmentKey } : null)
    || (process.env.NODE_TEST_CONTEXT
      ? createFileEvidenceKeyProvider({ keyPath: paths?.evidenceSealKeyPath, providerType: 'test-file-0600' })
      : createProductionEvidenceKeyProvider({ paths }));

  function loadKey({ create = false } = {}) {
    if (cachedKey) return cachedKey;
    if (provider) {
      const loaded = provider.get({ create });
      const decoded = decodeKey(loaded);
      if (!decoded) return null;
      cachedKey = decoded;
      return cachedKey;
    }
    return null;
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

  function sealValue(namespace, value) {
    const signingKey = loadKey({ create: true });
    if (!signingKey) throw new Error('evidence_seal_key_unavailable');
    return crypto.createHmac('sha256', signingKey)
      .update(JSON.stringify({ namespace: String(namespace), value }))
      .digest('base64url');
  }

  function verifyValue(namespace, value, receivedSeal) {
    if (typeof receivedSeal !== 'string') return false;
    const signingKey = loadKey({ create: false });
    if (!signingKey) return false;
    const expected = crypto.createHmac('sha256', signingKey)
      .update(JSON.stringify({ namespace: String(namespace), value }))
      .digest();
    let received;
    try { received = Buffer.from(receivedSeal, 'base64url'); } catch { return false; }
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
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

  return { seal, sealContract, sealValue, verify, verifyContract, verifyValue, providerType: provider?.type || 'unavailable' };
}

module.exports = {
  canonicalCriterionSpec,
  canonicalEvidence,
  createEvidenceSealer,
  createFileEvidenceKeyProvider,
  createLinuxSecretServiceEvidenceKeyProvider,
  createMacKeychainEvidenceKeyProvider,
  createProductionEvidenceKeyProvider,
  createWindowsDpapiEvidenceKeyProvider,
  decodeKey,
};
