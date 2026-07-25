'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function canonicalEvidence(taskId, criterionId, evidence = {}) {
  return JSON.stringify({
    taskId: taskId || null,
    criterionId: criterionId || null,
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

function createEvidenceSealer({ paths, key } = {}) {
  const keyPath = paths?.evidenceSealKeyPath;
  let cachedKey = key ? Buffer.from(key) : null;

  function loadKey({ create = false } = {}) {
    if (cachedKey) return cachedKey;
    if (!keyPath) return null;
    try {
      cachedKey = fs.readFileSync(keyPath);
      return cachedKey.length >= 32 ? cachedKey : null;
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
      cachedKey = fs.readFileSync(keyPath);
    }
    return cachedKey.length >= 32 ? cachedKey : null;
  }

  function seal(taskId, criterionId, evidence) {
    const signingKey = loadKey({ create: true });
    if (!signingKey) throw new Error('evidence_seal_key_unavailable');
    return crypto.createHmac('sha256', signingKey)
      .update(canonicalEvidence(taskId, criterionId, evidence))
      .digest('base64url');
  }

  function verify(taskId, criterionId, evidence) {
    if (!evidence?.seal || typeof evidence.seal !== 'string') return false;
    const signingKey = loadKey({ create: false });
    if (!signingKey) return false;
    const expected = crypto.createHmac('sha256', signingKey)
      .update(canonicalEvidence(taskId, criterionId, evidence))
      .digest();
    let received;
    try {
      received = Buffer.from(evidence.seal, 'base64url');
    } catch {
      return false;
    }
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  return { seal, verify };
}

module.exports = { canonicalEvidence, createEvidenceSealer };
