'use strict';

const fs = require('node:fs');
const path = require('node:path');

function inspectPath(target) {
  try {
    const stat = fs.lstatSync(target);
    return {
      path: target,
      exists: true,
      symlink: stat.isSymbolicLink(),
      ownerUid: typeof stat.uid === 'number' ? stat.uid : null,
      mode: stat.mode & 0o777,
      groupOrWorldWritable: Boolean(stat.mode & 0o022),
    };
  } catch (error) {
    return { path: target, exists: false, error: error.code || 'unknown' };
  }
}

function inspectTrustBoundary({ pluginRoot, paths, hookPath } = {}) {
  const inspected = [pluginRoot, hookPath, paths?.controlDbPath, paths?.controlGuardPath, paths?.evidenceSealKeyPath]
    .filter(Boolean).map(target => inspectPath(path.resolve(target)));
  const driftRisks = inspected.filter(item => item.symlink || item.groupOrWorldWritable);
  return {
    trustMode: 'cooperative-local-user',
    strength: 'guardrail',
    sameUidIsolation: false,
    externalAuthorityConfigured: false,
    localIntegrityChecksPassed: driftRisks.length === 0,
    inspected,
    driftRisks,
    residualRisk: 'A malicious process running as the same OS user can replace the package or hook runtime and can use that user credential context. Local HMAC and file modes do not create an independent security boundary.',
    strongIsolationRequires: [
      'a different OS account or protected service',
      'an ACL-protected signing or policy endpoint outside the agent UID',
      'or a protected CI/container/VM trust domain',
    ],
  };
}

module.exports = { inspectPath, inspectTrustBoundary };
