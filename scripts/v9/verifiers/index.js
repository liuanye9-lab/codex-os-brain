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

const DEFAULT_BASELINE_PATHS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'test', 'tests'];

/**
 * Snapshot the inputs that define what "pass" means, so a verifier cannot be silently retargeted
 * mid-task (editing the test script until it goes green is the canonical abuse).
 *
 * `excludePaths` exists to keep that seal honest in one specific case: artifacts the task is
 * *supposed* to write. A governance workflow maintains its own manifest as it works; a plan-driven
 * workflow rewrites its plan. Those are task outputs, not verifier inputs, and sealing them would
 * report tampering for doing the job. Excluding an input weakens the seal, so it must be declared
 * on the contract and never inferred.
 */
function verifierInputSnapshot(cwd, inputPaths = DEFAULT_BASELINE_PATHS, excludePaths = []) {
  const root = path.resolve(cwd || process.cwd());
  const entries = [];
  let files = 0;
  let bytes = 0;
  const excluded = (excludePaths || [])
    .map(value => String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
  const isExcluded = relative => {
    const normal = relative.replaceAll('\\', '/');
    return excluded.some(rule => normal === rule || normal.startsWith(`${rule}/`));
  };
  const visit = relative => {
    if (isExcluded(relative)) return;
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push([relative.replaceAll('\\', '/'), 'symlink', fs.readlinkSync(absolute)]);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
      return;
    }
    if (!stat.isFile()) return;
    files += 1;
    bytes += stat.size;
    if (files > 2000 || bytes > 20 * 1024 * 1024) throw new Error('verifier_baseline_budget_exceeded');
    entries.push([
      relative.replaceAll('\\', '/'),
      stat.size,
      crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
    ]);
  };
  for (const relative of inputPaths) visit(relative);
  return {
    version: 1,
    inputPaths,
    excludePaths: excluded,
    files,
    bytes,
    digest: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

function captureVerifierBaseline(cwd, inputPaths, excludePaths) {
  try {
    return verifierInputSnapshot(cwd, inputPaths, excludePaths);
  } catch (error) {
    return { version: 1, inputPaths: inputPaths || [], excludePaths: excludePaths || [], error: error.message };
  }
}

function verifyVerifierBaseline(cwd, baseline) {
  if (!baseline || baseline.version !== 1 || !baseline.digest) {
    return { valid: false, reason: baseline?.error || 'verifier_baseline_required' };
  }
  // Re-measure under the exclusions the contract was sealed with, so the comparison is like-for-like.
  const current = captureVerifierBaseline(cwd, baseline.inputPaths, baseline.excludePaths);
  if (!current.digest) return { valid: false, reason: current.error || 'verifier_baseline_unavailable' };
  return {
    valid: current.digest === baseline.digest,
    reason: current.digest === baseline.digest ? null : 'verifier_inputs_changed',
    expectedDigest: baseline.digest,
    currentDigest: current.digest,
  };
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
  const baseline = verifyVerifierBaseline(cwd, spec.baseline);
  if (!baseline.valid) {
    const fp = fingerprint({ kind: 'test_runner', reason: baseline.reason, expectedDigest: baseline.expectedDigest });
    return {
      kind: 'test_runner',
      status: 'failed',
      harnessVerified: true,
      evidenceLevel: 'project_tests',
      trustedAcceptance: false,
      fingerprint: fp,
      summary: { exitCode: null, reason: baseline.reason },
      provenance: { kind: 'test_runner', ref: `sealed-inputs#${fp}` },
    };
  }
  if (spec.requiredEvidenceLevel === 'trusted_acceptance') {
    const fp = fingerprint({ kind: 'test_runner', reason: 'trusted_acceptance_runner_unavailable' });
    return {
      kind: 'test_runner',
      status: 'failed',
      harnessVerified: true,
      evidenceLevel: 'project_tests',
      trustedAcceptance: false,
      fingerprint: fp,
      summary: { exitCode: null, reason: 'trusted_acceptance_runner_unavailable' },
      provenance: { kind: 'test_runner', ref: `cooperative-runner#${fp}` },
    };
  }
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
    evidenceLevel: 'project_tests',
    trustedAcceptance: false,
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
  const scopePrefix = spec.baseline?.version === 3 ? String(spec.baseline.scopePrefix || '').replace(/\/+$/, '') : '';
  const scoped = patterns => patterns.map(pattern => {
    const normalized = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
    return scopePrefix ? `${scopePrefix}/${normalized}` : normalized;
  });
  const repositoryAllowed = scoped(allowed);
  const repositoryForbidden = scoped(forbidden);
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
    if (scopePrefix && filePath !== scopePrefix && !filePath.startsWith(`${scopePrefix}/`)) {
      violations.push({ path: filePath, reason: 'outside_scope_root' });
      continue;
    }
    if (repositoryForbidden.length && pathMatchesAny(filePath, repositoryForbidden)) {
      violations.push({ path: filePath, reason: 'forbidden' });
      continue;
    }
    if (repositoryAllowed.length && !pathMatchesAny(filePath, repositoryAllowed)) {
      violations.push({ path: filePath, reason: 'outside_allowed' });
    }
  }
  const ok = violations.length === 0;
  const fp = fingerprint({ kind: 'git_diff_bounded', paths: listed.paths, allowed: repositoryAllowed, forbidden: repositoryForbidden, scopePrefix });
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

/**
 * Governance-manifest gate.
 *
 * A content-governance workflow decides, per delivered entry, whether it may enter production.
 * Written as prose in a skill, that decision depends on the agent choosing to honour it. This
 * verifier reads the manifest the workflow already maintains and refuses completion while any
 * entry is still unresolved, so "do not publish an unadjudicated conflict" becomes mechanical.
 *
 * Fails closed: an unreadable, malformed or empty manifest is a failure, never a pass.
 */
function verifierManifestGate(spec = {}, context = {}) {
  const cwd = spec.cwd || context.cwd || process.cwd();
  const manifestPath = path.resolve(cwd, spec.manifest || spec.path || 'knowledge-manifest.json');
  const readyField = String(spec.readyField || 'production_ready');
  const entriesField = String(spec.entriesField || 'entries');
  const requireNonEmpty = spec.requireNonEmpty !== false;
  const fp = fingerprint({ kind: 'manifest_gate', manifestPath, readyField });
  const base = { kind: 'manifest_gate', harnessVerified: true, fingerprint: fp, provenance: { kind: 'manifest_gate', ref: manifestPath } };

  if (!fs.existsSync(manifestPath)) {
    return { ...base, status: 'failed', summary: { reason: 'manifest_missing', manifest: manifestPath } };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ...base, status: 'failed', summary: { reason: 'manifest_unreadable', manifest: manifestPath } };
  }

  const entries = Array.isArray(parsed) ? parsed : parsed?.[entriesField];
  if (!Array.isArray(entries)) {
    return { ...base, status: 'failed', summary: { reason: 'manifest_entries_missing', entriesField, manifest: manifestPath } };
  }
  if (requireNonEmpty && entries.length === 0) {
    return { ...base, status: 'failed', summary: { reason: 'manifest_empty', manifest: manifestPath } };
  }

  // An entry passes only by saying so explicitly; a missing flag is not consent.
  const blocking = [];
  for (const [index, entry] of entries.entries()) {
    const id = String(entry?.id ?? entry?.node_token ?? entry?.title ?? `#${index}`);
    if (entry?.[readyField] !== true) {
      blocking.push({ id, reason: entry?.[readyField] === false ? 'not_production_ready' : 'production_ready_absent' });
    }
  }

  // Dangling references mean the manifest cannot be trusted to describe what shipped.
  const known = new Set(entries.map((entry, index) => String(entry?.id ?? `#${index}`)));
  const dangling = [];
  for (const [index, entry] of entries.entries()) {
    const id = String(entry?.id ?? `#${index}`);
    for (const field of ['parent_id', 'source_ids', 'related_ids']) {
      const value = entry?.[field];
      if (value === undefined || value === null) continue;
      for (const ref of Array.isArray(value) ? value : [value]) {
        if (ref && !known.has(String(ref))) dangling.push({ id, field, missingRef: String(ref) });
      }
    }
  }

  const ok = blocking.length === 0 && dangling.length === 0;
  return {
    ...base,
    status: ok ? 'passed' : 'failed',
    summary: {
      manifest: manifestPath,
      total: entries.length,
      blocked: blocking.length,
      danglingRefs: dangling.length,
      blockingSample: blocking.slice(0, 10),
      danglingSample: dangling.slice(0, 10),
      reason: ok ? 'all_entries_production_ready' : 'entries_not_production_ready',
    },
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
  manifest_gate: verifierManifestGate,
  governance: verifierManifestGate,
};

function resolveVerifierKind(criterion = {}) {
  if (criterion.verifier) return String(criterion.verifier);
  if (criterion.id === 'tests') return 'test_runner';
  if (criterion.id === 'scope') return 'git_diff_bounded';
  if (criterion.id === 'governance') return 'manifest_gate';
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
  // The caller may supply a spec, but the contract wins on every key it defines: verifierSpec is
  // part of the signed contract, and letting a call-site override it would be a way to retarget a
  // verifier at something easier to satisfy.
  const mergedSpec = { ...spec, ...(criterion.verifierSpec || {}) };
  return runner(mergedSpec, context);
}

module.exports = {
  REGISTRY,
  captureVerifierBaseline,
  fingerprint,
  parseCommand,
  pathMatchesAny,
  resolveVerifierKind,
  runCommand,
  runVerifier,
  sanitizedEnvironment,
  verifyVerifierBaseline,
  verifierCommandExit0,
  verifierTestRunner,
  verifierGitDiffBounded,
  verifierHumanAttestation,
  verifierFileExists,
};
