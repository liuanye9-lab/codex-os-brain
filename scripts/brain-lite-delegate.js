'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { appendEvent } = require('./brain-lite-routing-ledger');

const DEFAULT_CODEX_PATH = '/Applications/ChatGPT.app/Contents/Resources/codex';
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../schemas/brain-lite-child-output.schema.json');

function buildCodexArgs(route, options = {}) {
  if (!route?.model || !route?.effort) throw new TypeError('A route with model and effort is required');
  if (!options.cwd) throw new TypeError('cwd is required');
  if (!options.schemaPath) throw new TypeError('schemaPath is required');
  if (!options.outputPath) throw new TypeError('outputPath is required');

  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--model', route.model,
    '--config', `model_reasoning_effort=${route.effort}`,
    '--sandbox', 'read-only',
    '--cd', path.resolve(options.cwd),
    '--skip-git-repo-check',
    '--output-schema', path.resolve(options.schemaPath),
    '--output-last-message', path.resolve(options.outputPath),
    '--json',
    '-',
  ];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function taskFingerprint(task = {}) {
  const identity = {
    taskFamily: task.taskFamily || 'general',
    goal: task.goal || '',
    hardConstraints: stringArray(task.hardConstraints),
    relevantFiles: stringArray(task.relevantFiles),
    verificationCommands: stringArray(task.verificationCommands),
  };
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function buildTaskPacket(task = {}, options = {}) {
  if (!task.goal || typeof task.goal !== 'string') throw new TypeError('task.goal is required');
  return {
    schemaVersion: 1,
    goal: task.goal,
    taskFamily: typeof task.taskFamily === 'string' ? task.taskFamily : 'general',
    hardConstraints: stringArray(task.hardConstraints),
    relevantFiles: stringArray(task.relevantFiles),
    verificationCommands: stringArray(task.verificationCommands),
    outputContract: 'Return only structured JSON matching the provided schema. Cite concrete file or command evidence. Do not claim verification you did not run.',
    permissions: {
      filesystem: 'read-only',
      externalSideEffects: false,
    },
    mode: options.probe ? 'bounded-probe' : 'delegated-analysis',
    probeBudget: options.probe ? options.probeBudget || null : null,
  };
}

function parseUsageEvents(stdout = '') {
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, threadId: null };
  for (const line of String(stdout).split(/\r?\n/).filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!usage.threadId && (event.thread_id || event.threadId)) usage.threadId = event.thread_id || event.threadId;
    if (!event.usage || event.type !== 'turn.completed') continue;
    usage.inputTokens += Number(event.usage.input_tokens ?? event.usage.inputTokens ?? 0);
    usage.cachedInputTokens += Number(event.usage.cached_input_tokens ?? event.usage.cachedInputTokens ?? 0);
    usage.outputTokens += Number(event.usage.output_tokens ?? event.usage.outputTokens ?? 0);
  }
  return usage;
}

function classifyInfrastructureFailure(result = {}) {
  if (result.timedOut) return 'timeout';
  if (result.outputContractFailed) return 'output-contract';
  // A zero exit code means transport and the worker process completed normally.
  // Do not scan successful model prose: it can legitimately discuss quota,
  // network, authentication, or model availability as task content.
  if (Number(result.exitCode) === 0) return null;
  const text = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (/429|rate.?limit|quota|credit limit|usage limit/.test(text)) return 'quota';
  if (/connection|network|dns|socket|econn|timed? out|reset by peer|transport/.test(text)) return 'network';
  if (/auth|unauthori[sz]ed|forbidden|sign.?in|login required/.test(text)) return 'auth';
  if (/model.+(?:not found|unavailable|unsupported)|unsupported.+model/.test(text)) return 'model-unavailable';
  if (Number(result.exitCode) !== 0) return 'process';
  return null;
}

function runProcess(request) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = childProcess.spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env || process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, request.timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: `${Buffer.concat(stderr).toString('utf8')}\n${error.message}`.trim(),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
    child.stdin.end(request.input);
  });
}

function parseStructuredOutput(readFile, outputPath) {
  const value = JSON.parse(readFile(outputPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Child output is not an object');
  const required = ['summary', 'evidence', 'proposedPatch', 'verification', 'risks', 'needsEscalation', 'escalationReason'];
  for (const key of required) {
    if (!(key in value)) throw new Error(`Child output is missing ${key}`);
  }
  return value;
}

async function runDelegatedTask(options, dependencies = {}) {
  const route = options?.route;
  const task = options?.task || {};
  const attempt = Number(task.attempt || options?.attempt || 1);
  const maxAttempts = Number(route?.executionBudget?.maxAttempts || options?.maxAttempts || 1);
  if (attempt > maxAttempts) throw new Error(`attempt budget exhausted: attempt ${attempt} exceeds ${maxAttempts}`);
  const totalWallTimeMs = Number(route?.executionBudget?.totalWallTimeMs || options?.totalWallTimeMs || Number.MAX_SAFE_INTEGER);
  const elapsedWallTimeMs = Number(task.elapsedWallTimeMs || options?.elapsedWallTimeMs || 0);
  const remainingWallTimeMs = totalWallTimeMs - elapsedWallTimeMs;
  if (remainingWallTimeMs <= 0) throw new Error('wall-time budget exhausted before delegation');
  const cwd = path.resolve(options?.cwd || process.cwd());
  const schemaPath = path.resolve(options?.schemaPath || DEFAULT_SCHEMA_PATH);
  const temporaryRoot = options?.outputPath ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-child-'));
  const outputPath = path.resolve(options?.outputPath || path.join(temporaryRoot, 'last-message.json'));
  const codexPath = options?.codexPath || process.env.CODEX_PATH || DEFAULT_CODEX_PATH;
  const execute = dependencies.runProcess || runProcess;
  const readFile = dependencies.readFile || fs.readFileSync;
  const packet = buildTaskPacket(task, { probe: route.probe === true, probeBudget: route.probeBudget });
  const args = buildCodexArgs(route, { cwd, schemaPath, outputPath });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let processResult;
  let output = null;
  let outputContractFailed = false;
  try {
    processResult = await execute({
      command: codexPath,
      args,
      input: `${JSON.stringify(packet, null, 2)}\n`,
      cwd,
      timeoutMs: Math.min(Number(options?.timeoutMs || route.timeoutMs || 900000), remainingWallTimeMs),
      shell: false,
    });
    if (Number(processResult.exitCode) === 0 && !processResult.timedOut) {
      try {
        output = parseStructuredOutput(readFile, outputPath);
      } catch {
        outputContractFailed = true;
      }
    }
  } finally {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  const usage = parseUsageEvents(processResult?.stdout || '');
  const infrastructureFailure = classifyInfrastructureFailure({ ...processResult, outputContractFailed });
  const modelClaimedSuccess = Boolean(output && output.needsEscalation === false);
  const fingerprint = task.taskFingerprint || taskFingerprint(task);
  const traceId = task.traceId || `trace_${crypto.createHash('sha256').update(task.taskId || fingerprint).digest('hex').slice(0, 32)}`;
  const ledgerEvent = {
    timestamp: new Date().toISOString(),
    taskId: task.taskId || null,
    taskFamily: task.taskFamily || 'general',
    taskFingerprint: fingerprint,
    traceId,
    policyVersion: route.policyVersion || null,
    phase: 'child',
    routeId: route.routeId || null,
    model: route.model,
    effort: route.effort,
    taskRisk: task.risk || 'low',
    verifiable: stringArray(task.verificationCommands).length > 0,
    relevantFiles: stringArray(task.relevantFiles),
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Number(processResult?.durationMs || 0),
    exitStatus: Number(processResult?.exitCode ?? 1),
    verifierPassed: null,
    modelClaimedSuccess,
    infrastructureFailure: infrastructureFailure !== null,
    infrastructureFailureType: infrastructureFailure,
    finalDelivered: false,
    attempt,
    maxAttempts,
    probe: route.probe === true,
  };

  return {
    output,
    usage,
    exitCode: Number(processResult?.exitCode ?? 1),
    durationMs: Number(processResult?.durationMs || 0),
    infrastructureFailure,
    ledgerEvent,
  };
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--route-file') options.routeFile = path.resolve(argv[++index]);
    else if (arg === '--task-file') options.taskFile = path.resolve(argv[++index]);
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index]);
    else if (arg === '--schema') options.schemaPath = path.resolve(argv[++index]);
    else if (arg === '--output') options.outputPath = path.resolve(argv[++index]);
    else if (arg === '--ledger') options.ledger = path.resolve(argv[++index]);
    else if (arg === '--codex') options.codexPath = path.resolve(argv[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/brain-lite-delegate.js --route-file FILE --task-file FILE --cwd DIR [options]',
    'Options:',
    '  --schema FILE       Structured child-output schema',
    '  --output FILE       Keep the structured last message at this path',
    '  --ledger FILE       Append a sanitized preliminary routing event',
    '  --codex FILE        Codex executable path',
    '  --timeout-ms N      Hard child timeout',
    '',
    'Route and task content are read from files; task text is never interpolated into a shell command.',
  ].join('\n');
}

if (require.main === module) {
  (async () => {
    try {
      const cli = parseCli(process.argv.slice(2));
      if (cli.help) {
        process.stdout.write(`${usage()}\n`);
        return;
      }
      if (!cli.routeFile || !cli.taskFile || !cli.cwd) throw new Error('--route-file, --task-file, and --cwd are required');
      const route = JSON.parse(fs.readFileSync(cli.routeFile, 'utf8'));
      if (route.dispatch === false) throw new Error('The supplied route is mother-direct and must not launch a child');
      const task = JSON.parse(fs.readFileSync(cli.taskFile, 'utf8'));
      const result = await runDelegatedTask({
        route,
        task,
        cwd: cli.cwd,
        schemaPath: cli.schemaPath || DEFAULT_SCHEMA_PATH,
        outputPath: cli.outputPath,
        codexPath: cli.codexPath,
        timeoutMs: cli.timeoutMs,
      });
      if (cli.ledger) appendEvent(cli.ledger, result.ledgerEvent);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.exitCode !== 0 || result.infrastructureFailure) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  DEFAULT_CODEX_PATH,
  DEFAULT_SCHEMA_PATH,
  buildCodexArgs,
  buildTaskPacket,
  classifyInfrastructureFailure,
  parseUsageEvents,
  taskFingerprint,
  usage,
  runDelegatedTask,
  runProcess,
};
