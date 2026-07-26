'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { changedPathsSinceBaseline } = require('../git-baseline');

/**
 * Executable verifiers. Only harness re-runs can promote a criterion to passed.
 * Agent claims never set harnessVerified.
 */

function fingerprint(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

function sanitizedEnvironment(source = process.env) {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'NODE_ENV',
    'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR',
  ];
  return Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function parseCommand(command) {
  const value = String(command || '').trim();
  if (!value) return null;
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      const next = value[index + 1];
      if (quote === '"' || next === '"' || next === "'" || next === '\\' || /\s/.test(next || '')) {
        escaped = true;
        continue;
      }
      current += character;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\n' || character === '\r' || character === ';'
      || character === '|' || character === '&' || character === '>' || character === '<'
      || character === '`' || (character === '$' && value[index + 1] === '(')) {
      throw new Error('shell_operator_rejected');
    }
    if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (escaped || quote) throw new Error('command_quote_invalid');
  if (current) args.push(current);
  if (!args.length) return null;
  return { executable: args[0], args: args.slice(1) };
}

function runCommand({ executable, args, command, cwd, timeoutMs = 60_000, env = process.env }) {
  let invocation;
  try {
    invocation = executable
      ? { executable: String(executable), args: Array.isArray(args) ? args.map(String) : [] }
      : parseCommand(command);
  } catch (error) {
    return { ok: false, status: 'failed', reason: error.message, exitCode: null, stdout: '', stderr: '' };
  }
  if (!invocation?.executable) {
    return { ok: false, status: 'failed', reason: 'command_required', exitCode: null, stdout: '', stderr: '' };
  }
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: cwd || process.cwd(),
    env: sanitizedEnvironment(env),
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const exitCode = result.status;
  const stdout = String(result.stdout || '').slice(0, 4000);
  const stderr = String(result.stderr || '').slice(0, 4000);
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { ok: false, status: 'failed', reason: 'timeout', exitCode: null, stdout, stderr };
  }
  if (result.error) {
    return {
      ok: false,
      status: 'failed',
      reason: `spawn_error_${result.error.code || 'unknown'}`,
      exitCode: null,
      stdout,
      stderr,
      invocation,
    };
  }
  return {
    ok: exitCode === 0,
    status: exitCode === 0 ? 'passed' : 'failed',
    reason: exitCode === 0 ? 'exit_0' : `exit_${exitCode}`,
    exitCode,
    stdout,
    stderr,
    invocation,
  };
}

function verifierCommandExit0(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  if (spec.humanApproved !== true) {
    const fp = fingerprint({ kind: 'command_exit_0', approval: false, cwd });
    return {
      kind: 'command_exit_0',
      status: 'failed',
      harnessVerified: true,
      fingerprint: fp,
      summary: { exitCode: null, reason: 'custom_verifier_approval_required' },
      provenance: { kind: 'command_exit_0', ref: `unapproved#${fp}` },
    };
  }
  const run = runCommand({
    executable: spec.executable,
    args: spec.args,
    command: spec.command,
    cwd,
    timeoutMs: Number(spec.timeoutMs || 60_000),
  });
  const invocation = run.invocation || { executable: spec.executable, args: spec.args, command: spec.command };
  const fp = fingerprint({ kind: 'command_exit_0', invocation, cwd });
  return {
    kind: 'command_exit_0',
    status: run.status,
    harnessVerified: true,
    fingerprint: fp,
    summary: { exitCode: run.exitCode, reason: run.reason },
    provenance: { kind: 'command_exit_0', ref: `${invocation.executable || 'invalid'}#${fp}` },
  };
}

function verifierTestRunner(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const hasPackage = fs.existsSync(path.join(cwd, 'package.json'));
  const executable = spec.executable || (!spec.command && hasPackage ? 'npm' : undefined);
  const args = spec.args || (!spec.command && hasPackage ? ['test'] : undefined);
  const run = runCommand({ executable, args, command: spec.command, cwd, timeoutMs: Number(spec.timeoutMs || 120_000) });
  const invocation = run.invocation || { executable, args, command: spec.command };
  const fp = fingerprint({ kind: 'test_runner', invocation, cwd });
  return {
    kind: 'test_runner',
    status: run.status,
    harnessVerified: true,
    fingerprint: fp,
    summary: { exitCode: run.exitCode, reason: run.reason },
    provenance: { kind: 'test_runner', ref: `${invocation.executable || 'missing'}#${fp}` },
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
    .flatMap(line => {
      const value = line.slice(3).trim().replace(/^"|"$/g, '');
      const rename = value.split(' -> ').map(item => item.replace(/^"|"$/g, ''));
      return rename.length === 2 ? rename : [value];
    })
    .filter(Boolean);
  return { ok: true, paths: [...new Set(paths)] };
}

function pathMatchesAny(filePath, patterns = []) {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some(pattern => {
    const p = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!p) return false;
    if (p.endsWith('/')) return normalized === p.slice(0, -1) || normalized.startsWith(p);
    if (!p.includes('/')) return path.posix.basename(normalized) === p;
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

function verifierGitDiffBounded(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const allowed = spec.allowedPaths || context.allowedPaths || [];
  const forbidden = spec.forbiddenPaths || context.forbiddenPaths || [];
  const listed = spec.baseline
    ? changedPathsSinceBaseline(cwd, spec.baseline)
    : { ok: false, paths: [], error: 'git_baseline_required' };
  if (!listed.ok) {
    return {
      kind: 'git_diff_bounded',
      status: 'failed',
      harnessVerified: true,
      fingerprint: fingerprint({ kind: 'git_diff_bounded', error: listed.error }),
      summary: { reason: listed.error, paths: [] },
      provenance: { kind: 'git_diff_bounded', ref: 'git-baseline' },
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
    provenance: { kind: 'git_diff_bounded', ref: `baseline:${spec.baseline?.head || 'missing'}#paths:${listed.paths.length}` },
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
  const mergedSpec = { ...(criterion.verifierSpec || {}) };
  return runner(mergedSpec, context);
}

module.exports = {
  REGISTRY,
  fingerprint,
  parseCommand,
  pathMatchesAny,
  resolveVerifierKind,
  runCommand,
  runVerifier,
  sanitizedEnvironment,
  verifierCommandExit0,
  verifierTestRunner,
  verifierGitDiffBounded,
  verifierHumanAttestation,
  verifierFileExists,
};
