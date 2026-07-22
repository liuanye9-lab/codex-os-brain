'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { appendEvent, derivePolicyState, hashText, readEvents, writePolicyState } = require('./brain-lite-routing-ledger');
const { appendTraceEvent } = require('./brain-lite-trace-v2');

const FAILURE_ATTRIBUTIONS = new Set(['model-capability', 'pre-existing', 'verification-infrastructure', 'unknown']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash']);

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateReceipt(input = {}) {
  if (input.schemaVersion !== 1) throw coded('routing_receipt_schema_invalid');
  if (!input.task?.taskId || !input.task?.taskFamily || typeof input.task?.taskFingerprint !== 'string' || input.task.taskFingerprint.length < 8) throw coded('routing_receipt_task_identity_required');
  if (!input.route?.routeId) throw coded('routing_receipt_route_required');
  if (!Array.isArray(input.verification?.checks) || input.verification.checks.length === 0) throw coded('routing_receipt_verifier_required');
  if (!FAILURE_ATTRIBUTIONS.has(input.verification.failureAttribution || 'unknown')) throw coded('routing_receipt_failure_attribution_invalid');
  if (typeof input.delivery?.finalDelivered !== 'boolean') throw coded('routing_receipt_delivery_status_required');
  return input;
}

function commandIdentity(check) {
  return JSON.stringify({ command: path.basename(String(check.command || '')), args: stringArray(check.args) });
}

function runVerifier(check, options = {}, dependencies = {}) {
  if (!check?.command || typeof check.command !== 'string') throw coded('routing_verifier_command_required');
  const args = stringArray(check.args);
  const commandName = path.basename(check.command);
  if (SHELLS.has(commandName) && args.includes('-c')) throw coded('routing_verifier_shell_string_rejected');
  const timeoutMs = Math.min(Math.max(Number(check.timeoutMs || 300_000), 1_000), 1_200_000);
  const execute = dependencies.spawnSync || spawnSync;
  const startedAt = Date.now();
  const result = execute(check.command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: options.env || process.env,
  });
  const durationMs = Date.now() - startedAt;
  const exitStatus = Number.isInteger(result.status) ? result.status : null;
  const expectedExitStatus = Number.isInteger(check.expectedExitStatus) ? check.expectedExitStatus : 0;
  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  const unavailable = result.error?.code === 'ENOENT';
  const stdoutHash = hashText(result.stdout || '');
  const stderrHash = hashText(result.stderr || '');
  const verifierCommandHash = hashText(commandIdentity(check));
  const passed = !timedOut && !unavailable && exitStatus === expectedExitStatus;
  const evidenceId = `ev_${hashText(JSON.stringify({ verifierCommandHash, exitStatus, stdoutHash, stderrHash })).slice(0, 20)}`;
  return {
    kind: String(check.kind || 'command'),
    verifierCommandHash,
    evidenceId,
    passed,
    exitStatus,
    expectedExitStatus,
    durationMs,
    failureType: timedOut ? 'verifier-timeout' : unavailable ? 'verifier-unavailable' : passed ? null : 'verifier-failed',
  };
}

function hashArtifacts(files, cwd) {
  const artifacts = [];
  for (const file of stringArray(files)) {
    const target = path.resolve(cwd, file);
    if (!within(cwd, target)) throw coded('routing_receipt_artifact_outside_cwd');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw coded('routing_receipt_artifact_invalid');
    artifacts.push({ name: path.basename(target), sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name) || a.sha256.localeCompare(b.sha256));
  return artifacts.length ? hashText(JSON.stringify(artifacts)) : null;
}

function buildReceiptEvent(input, results, options = {}) {
  validateReceipt(input);
  const infrastructureFailureType = results.find((item) => ['verifier-timeout', 'verifier-unavailable'].includes(item.failureType))?.failureType
    || input.execution?.infrastructureFailureType
    || null;
  const verifierPassed = results.every((item) => item.passed);
  const failureAttribution = input.verification.failureAttribution || 'unknown';
  const capabilityOutcome = verifierPassed
    ? 'pass'
    : failureAttribution === 'model-capability'
      ? 'fail'
      : 'unknown';
  const outcomeEligible = infrastructureFailureType === null
    && (capabilityOutcome === 'pass' || capabilityOutcome === 'fail')
    && input.delivery.finalDelivered === verifierPassed;
  const combinedCommandHash = hashText(results.map((item) => item.verifierCommandHash).sort().join('\n'));
  const route = input.route;
  const execution = input.execution || {};
  const task = input.task;
  return {
    schemaVersion: 1,
    receiptVersion: 1,
    timestamp: options.timestamp || new Date().toISOString(),
    taskId: task.taskId,
    taskFamily: task.taskFamily,
    taskFingerprint: task.taskFingerprint,
    traceId: route.traceId || `trace_${hashText(`${task.taskId}\0${task.taskFingerprint}`).slice(0, 32)}`,
    policyVersion: route.policyVersion || null,
    phase: 'verified',
    routeId: route.routeId,
    model: route.model || null,
    effort: route.effort || null,
    executionMode: route.executionMode || (route.routeId === 'mother-direct' ? 'mother-direct' : 'delegated'),
    taskRisk: task.risk || 'low',
    verifiable: true,
    relevantFiles: stringArray(task.relevantFiles),
    inputTokens: Number(execution.inputTokens || 0),
    cachedInputTokens: Number(execution.cachedInputTokens || 0),
    outputTokens: Number(execution.outputTokens || 0),
    durationMs: Number(execution.durationMs || 0) + results.reduce((sum, item) => sum + item.durationMs, 0),
    verificationDurationMs: results.reduce((sum, item) => sum + item.durationMs, 0),
    exitStatus: Number(execution.exitStatus ?? 0),
    verifierCommandHash: combinedCommandHash,
    verifierPassed,
    verifierCount: results.length,
    verifierKinds: [...new Set(results.map((item) => item.kind))].sort(),
    evidenceIds: results.map((item) => item.evidenceId),
    artifactHash: options.artifactHash || null,
    outcomeSource: 'independent-verifier',
    verifierAuthority: 'mother-agent',
    failureAttribution,
    capabilityOutcome,
    outcomeEligible,
    modelClaimedSuccess: execution.modelClaimedSuccess === true,
    infrastructureFailure: infrastructureFailureType !== null,
    infrastructureFailureType,
    finalDelivered: input.delivery.finalDelivered,
    userCorrected: input.delivery.userCorrected === true,
    criticalFailure: input.delivery.criticalFailure === true,
    attempt: Number(route.attempt || 1),
    maxAttempts: Number(route.maxAttempts || 1),
    probe: route.probe === true,
  };
}

function traceFromReceipt(event) {
  return {
    traceId: event.traceId,
    taskId: event.taskId,
    taskFingerprint: event.taskFingerprint,
    kind: 'verification',
    policyVersion: event.policyVersion || 'brain-lite-v8',
    privacyClass: 'private',
    routeId: event.routeId,
    model: event.model,
    effort: event.effort,
    attempt: event.attempt,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    durationMs: event.durationMs,
    verifierCommandHash: event.verifierCommandHash,
    verifierPassed: event.verifierPassed,
    finalDelivered: event.finalDelivered,
    modelClaimedSuccess: event.modelClaimedSuccess,
    userCorrected: event.userCorrected,
    failureClass: event.infrastructureFailureType || (event.capabilityOutcome === 'fail' ? 'capability' : null),
    evidenceIds: event.evidenceIds,
    artifactHash: event.artifactHash,
    harnessDurationMs: event.verificationDurationMs,
  };
}

function recordVerifiedReceipt(input, options = {}, dependencies = {}) {
  validateReceipt(input);
  const cwd = path.resolve(options.cwd || process.cwd());
  const results = input.verification.checks.map((check) => runVerifier(check, { cwd, env: options.env }, dependencies));
  const artifactHash = hashArtifacts(input.verification.artifacts, cwd);
  const event = buildReceiptEvent(input, results, { timestamp: options.timestamp, artifactHash });
  const saved = appendEvent(options.ledger, event);
  const trace = options.trace ? appendTraceEvent(options.trace, traceFromReceipt(saved)) : null;
  let policyState = null;
  if (options.policyState) {
    policyState = derivePolicyState(readEvents(options.ledger));
    writePolicyState(options.policyState, policyState);
  }
  return { event: saved, verification: results, trace, policyState };
}

function parseCli(argv) {
  const options = { command: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && !options.command) options.command = arg;
    else if (arg === '--receipt-file') options.receiptFile = path.resolve(argv[++index]);
    else if (arg === '--ledger') options.ledger = path.resolve(argv[++index]);
    else if (arg === '--trace') options.trace = path.resolve(argv[++index]);
    else if (arg === '--policy-state') options.policyState = path.resolve(argv[++index]);
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return 'Usage: node scripts/brain-lite-routing-receipt.js verify --receipt-file FILE --ledger FILE --cwd DIR [--trace FILE] [--policy-state FILE]';
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else {
      if (options.command !== 'verify' || !options.receiptFile || !options.ledger || !options.cwd) throw coded('routing_receipt_arguments_required');
      const input = JSON.parse(fs.readFileSync(options.receiptFile, 'utf8'));
      const result = recordVerifiedReceipt(input, options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.event.verifierPassed !== true) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReceiptEvent,
  hashArtifacts,
  recordVerifiedReceipt,
  runVerifier,
  traceFromReceipt,
  validateReceipt,
};
