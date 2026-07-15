'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Executable verifiers. Only harness re-runs can promote a criterion to passed.
 * Agent claims never set harnessVerified.
 */

function fingerprint(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

function runCommand({ command, cwd, timeoutMs = 60_000, env = process.env }) {
  if (!command || !String(command).trim()) {
    return { ok: false, status: 'failed', reason: 'command_required', exitCode: null, stdout: '', stderr: '' };
  }
  const result = spawnSync(command, {
    cwd: cwd || process.cwd(),
    env,
    encoding: 'utf8',
    shell: true,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const exitCode = result.status;
  const stdout = String(result.stdout || '').slice(0, 4000);
  const stderr = String(result.stderr || '').slice(0, 4000);
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { ok: false, status: 'failed', reason: 'timeout', exitCode: null, stdout, stderr };
  }
  return {
    ok: exitCode === 0,
    status: exitCode === 0 ? 'passed' : 'failed',
    reason: exitCode === 0 ? 'exit_0' : `exit_${exitCode}`,
    exitCode,
    stdout,
    stderr,
  };
}

function verifierCommandExit0(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const run = runCommand({ command: spec.command, cwd, timeoutMs: Number(spec.timeoutMs || 60_000) });
  const fp = fingerprint({ kind: 'command_exit_0', command: spec.command, cwd });
  return {
    kind: 'command_exit_0',
    status: run.status,
    harnessVerified: true,
    fingerprint: fp,
    summary: { exitCode: run.exitCode, reason: run.reason },
    provenance: { kind: 'command_exit_0', ref: `${spec.command}#${fp}` },
  };
}

function verifierTestRunner(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const command = spec.command || (fs.existsSync(path.join(cwd, 'package.json')) ? 'npm test' : 'echo no-test-command && exit 1');
  const run = runCommand({ command, cwd, timeoutMs: Number(spec.timeoutMs || 120_000) });
  const fp = fingerprint({ kind: 'test_runner', command, cwd });
  return {
    kind: 'test_runner',
    status: run.status,
    harnessVerified: true,
    fingerprint: fp,
    summary: { exitCode: run.exitCode, reason: run.reason },
    provenance: { kind: 'test_runner', ref: `${command}#${fp}` },
  };
}

function listChangedPaths(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
  });
  if (result.status !== 0) return { ok: false, paths: [], error: String(result.stderr || 'git_status_failed') };
  const paths = String(result.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  return { ok: true, paths };
}

function pathMatchesAny(filePath, patterns = []) {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some(pattern => {
    const p = String(pattern).replace(/\\/g, '/');
    if (p.endsWith('/')) return normalized.startsWith(p) || normalized.includes(`/${p}`);
    return normalized === p || normalized.endsWith(`/${p}`) || normalized.includes(p);
  });
}

function verifierGitDiffBounded(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const allowed = spec.allowedPaths || context.allowedPaths || [];
  const forbidden = spec.forbiddenPaths || context.forbiddenPaths || [];
  const listed = listChangedPaths(cwd);
  if (!listed.ok) {
    return {
      kind: 'git_diff_bounded',
      status: 'failed',
      harnessVerified: true,
      fingerprint: fingerprint({ kind: 'git_diff_bounded', error: listed.error }),
      summary: { reason: listed.error, paths: [] },
      provenance: { kind: 'git_diff_bounded', ref: 'git-status' },
    };
  }
  const violations = [];
  for (const filePath of listed.paths) {
    if (forbidden.length && pathMatchesAny(filePath, forbidden)) {
      violations.push({ path: filePath, reason: 'forbidden' });
      continue;
    }
    if (allowed.length && !pathMatchesAny(filePath, allowed)) {
      violations.push({ path: filePath, reason: 'outside_allowed' });
    }
  }
  const ok = violations.length === 0;
  const fp = fingerprint({ kind: 'git_diff_bounded', paths: listed.paths, allowed, forbidden });
  return {
    kind: 'git_diff_bounded',
    status: ok ? 'passed' : 'failed',
    harnessVerified: true,
    fingerprint: fp,
    summary: { paths: listed.paths, violations },
    provenance: { kind: 'git_diff_bounded', ref: `paths:${listed.paths.length}` },
  };
}

function verifierHumanAttestation(spec = {}, context = {}) {
  const expected = String(spec.token || context.attestationToken || '');
  const provided = String(spec.providedToken || context.providedToken || '');
  const ok = expected.length > 0 && provided.length > 0 && expected === provided;
  const fp = fingerprint({ kind: 'human_attestation', tokenHash: crypto.createHash('sha256').update(expected || 'none').digest('hex').slice(0, 12) });
  return {
    kind: 'human_attestation',
    status: ok ? 'passed' : 'failed',
    harnessVerified: true,
    fingerprint: fp,
    summary: { reason: ok ? 'attested' : 'attestation_missing_or_mismatch' },
    provenance: { kind: 'human_attestation', ref: `attest#${fp}` },
  };
}

function verifierFileExists(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const target = path.resolve(cwd, spec.path || '');
  const exists = Boolean(spec.path) && fs.existsSync(target);
  const fp = fingerprint({ kind: 'file_exists', path: target });
  return {
    kind: 'file_exists',
    status: exists ? 'passed' : 'failed',
    harnessVerified: true,
    fingerprint: fp,
    summary: { path: target, exists },
    provenance: { kind: 'file_exists', ref: target },
  };
}

const REGISTRY = {
  command_exit_0: verifierCommandExit0,
  command: verifierCommandExit0,
  test_runner: verifierTestRunner,
  tests: verifierTestRunner,
  git_diff_bounded: verifierGitDiffBounded,
  scope: verifierGitDiffBounded,
  human_attestation: verifierHumanAttestation,
  human: verifierHumanAttestation,
  file_exists: verifierFileExists,
};

function resolveVerifierKind(criterion = {}) {
  if (criterion.verifier) return String(criterion.verifier);
  if (criterion.id === 'tests') return 'test_runner';
  if (criterion.id === 'scope') return 'git_diff_bounded';
  return 'command_exit_0';
}

function runVerifier(criterion = {}, spec = {}, context = {}) {
  const kind = resolveVerifierKind(criterion);
  const runner = REGISTRY[kind];
  if (!runner) {
    return {
      kind,
      status: 'failed',
      harnessVerified: true,
      fingerprint: fingerprint({ kind, error: 'unknown_verifier' }),
      summary: { reason: 'unknown_verifier' },
      provenance: { kind: 'unknown', ref: kind },
    };
  }
  const mergedSpec = {
    ...(criterion.verifierSpec || {}),
    ...spec,
    command: spec.command || criterion.verifierSpec?.command || (kind === 'test_runner' || kind === 'tests' ? undefined : criterion.verifierSpec?.command),
  };
  return runner(mergedSpec, context);
}

module.exports = {
  REGISTRY,
  fingerprint,
  resolveVerifierKind,
  runCommand,
  runVerifier,
  verifierCommandExit0,
  verifierTestRunner,
  verifierGitDiffBounded,
  verifierHumanAttestation,
  verifierFileExists,
};
