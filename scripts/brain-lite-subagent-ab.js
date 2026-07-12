'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const routerConfig = require('../config/brain-lite-router.json');
const { routeTask } = require('./brain-lite-router');
const { classifyInfrastructureFailure, parseUsageEvents, runProcess } = require('./brain-lite-delegate');

const ROOT = path.resolve(__dirname, '../evals/subagent-ab-2026-07-12');
const SCHEMA_PATH = path.resolve(__dirname, '../schemas/brain-lite-child-output.schema.json');
const CODEX_PATH = '/Applications/ChatGPT.app/Contents/Resources/codex';
const PARENT = { model: 'gpt-5.6-terra', effort: 'high', timeoutMs: 3 * 60 * 1000 };
const VAGUE_USER_PROMPT = '修复我前面出现的问题并测试我。';
const VAGUE_CHILD_GOALS = [
  'Investigate the user\'s vague report using only this workspace. Read source and public tests, and run the public test if useful. State the observable defect and a smallest evidence-backed repair direction. Do not edit files.',
  'Independently recover the intended behavior from public interfaces, source, callers, and public tests in this workspace. State the behavioral contract, unresolved ambiguity, and regression risks. Do not edit files.',
];

const TASKS = [
  {
    id: 'focused-boundary-repair',
    title: 'Focused boundary repair',
    brief: 'Fix the defect in src/parse-limit.js. Preserve the exported API. Values must be finite non-negative numeric limits; invalid, negative, or non-finite values must use fallback. Modify only src/** and run the public test command.',
    childLanes: [
      {
        id: 'source-evidence',
        goal: 'Inspect src/parse-limit.js and test/public.test.js. Identify the smallest behavior gap likely missed by public tests. Return concrete evidence and a minimal patch suggestion; do not edit files.',
        features: { taskFamily: 'simple-extraction', clarity: 'clear', risk: 'low', verifiable: true, independent: true, estimatedToolCalls: 4 },
      },
      {
        id: 'edge-verifier',
        goal: 'Inspect the parser contract and enumerate edge cases that a deterministic verifier should test. Return only concise evidence and risks; do not edit files.',
        features: { taskFamily: 'daily-multi-condition', clarity: 'medium', risk: 'low', verifiable: true, independent: true, estimatedToolCalls: 4 },
      },
    ],
  },
  {
    id: 'multi-file-outcome-rollup',
    title: 'Multi-file outcome rollup',
    brief: 'Fix src/rollup.js using the existing normalize module. A summary must use only verified non-infrastructure events and the latest timestamp per task. Preserve exports, modify only src/**, and run the public test command.',
    childLanes: [
      {
        id: 'source-evidence',
        goal: 'Read src/normalize.js and src/rollup.js. Identify mismatch between child, verified, and infrastructure event semantics. Return file evidence and a minimal suggestion; do not edit files.',
        features: { taskFamily: 'simple-extraction', clarity: 'clear', risk: 'low', verifiable: true, independent: true, estimatedToolCalls: 4 },
      },
      {
        id: 'invariant-probe',
        goal: 'Review the rollup behavior for ordering, duplicate task attempts, and verifier semantics. Return a short invariant checklist and risks; do not edit files.',
        features: { taskFamily: 'daily-multi-condition', clarity: 'medium', risk: 'low', verifiable: true, independent: true, estimatedToolCalls: 5 },
      },
    ],
  },
  {
    id: 'constraint-assignment',
    title: 'Constraint assignment',
    brief: 'Fix src/assign.js. Each guest must be assigned once without exceeding capacity or using a table listed in guest.avoid. Throw an Error containing "unassigned guest" if no valid assignment exists. Preserve exports, modify only src/**, and run public tests.',
    childLanes: [
      {
        id: 'source-evidence',
        goal: 'Inspect src/assign.js and public tests. Identify the minimum missing allocation constraint. Return concrete code evidence and a minimal suggestion; do not edit files.',
        features: { taskFamily: 'simple-extraction', clarity: 'clear', risk: 'low', verifiable: true, independent: true, estimatedToolCalls: 4 },
      },
      {
        id: 'constraint-probe',
        goal: 'Independently enumerate capacity, avoidance, and completeness invariants for the assignment API. Return a bounded verification checklist and risks; do not edit files.',
        features: { taskFamily: 'constraint-satisfaction', clarity: 'clear', risk: 'low', verifiable: true, independent: true, batch: true, constraintCount: 8, estimatedToolCalls: 5 },
      },
    ],
  },
];

function taskById(taskId) {
  const task = TASKS.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown benchmark task: ${taskId}`);
  return task;
}

function promptSpec(task, mode = 'clear') {
  if (mode === 'clear') {
    return {
      promptMode: mode,
      userPrompt: task.brief,
      childGoals: task.childLanes.map((lane) => lane.goal),
    };
  }
  if (mode === 'vague-user') {
    return {
      promptMode: mode,
      userPrompt: VAGUE_USER_PROMPT,
      childGoals: [...VAGUE_CHILD_GOALS],
    };
  }
  throw new Error(`Unknown prompt mode: ${mode}`);
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function immutableHashes(workspace) {
  const files = ['package.json', path.join('test', 'public.test.js')];
  return Object.fromEntries(files.map((file) => [file, hashFile(path.join(workspace, file))]));
}

function prepareWorkspace(taskId, options = {}) {
  const taskRoot = path.join(ROOT, 'fixtures', taskId, 'base');
  const root = path.resolve(options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-subagent-ab-')));
  const runId = options.runId || crypto.randomUUID();
  const workspace = path.join(root, 'workspaces', `${taskId}-${runId}`);
  fs.mkdirSync(path.dirname(workspace), { recursive: true, mode: 0o700 });
  fs.cpSync(taskRoot, workspace, { recursive: true, errorOnExist: true });
  fs.writeFileSync(path.join(workspace, '.brain-lite-immutable.json'), `${JSON.stringify(immutableHashes(workspace), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return workspace;
}

function runPublicTests(workspace) {
  const result = childProcess.spawnSync(process.execPath, ['--test', 'test/public.test.js'], { cwd: workspace, encoding: 'utf8', timeout: 20000 });
  return { passed: result.status === 0, stderr: String(result.stderr || '').slice(0, 600) };
}

function checkImmutableFiles(workspace) {
  const expected = JSON.parse(fs.readFileSync(path.join(workspace, '.brain-lite-immutable.json'), 'utf8'));
  return Object.entries(expected).every(([file, hash]) => fs.existsSync(path.join(workspace, file)) && hashFile(path.join(workspace, file)) === hash);
}

function gradeWorkspace(taskId, workspace) {
  const publicResult = runPublicTests(workspace);
  const immutableFilesPassed = checkImmutableFiles(workspace);
  const failures = [];
  let hiddenChecksPassed = false;
  try {
    const checker = require(path.join(ROOT, 'checkers', `${taskId}.js`));
    checker(workspace);
    hiddenChecksPassed = true;
  } catch (error) {
    failures.push(String(error.message || error).slice(0, 600));
  }
  if (!publicResult.passed) failures.push(`public tests: ${publicResult.stderr || 'failed'}`);
  if (!immutableFilesPassed) failures.push('immutable public test or package file changed');
  return {
    passed: publicResult.passed && hiddenChecksPassed && immutableFilesPassed,
    publicTestsPassed: publicResult.passed,
    hiddenChecksPassed,
    immutableFilesPassed,
    failures,
  };
}

function outputPathFor(root, role, taskId, laneId = '') {
  return path.join(root, 'outputs', `${taskId}-${role}${laneId ? `-${laneId}` : ''}-${crypto.randomUUID()}.json`);
}

function buildArgs(request) {
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--model', request.model,
    '--config', `model_reasoning_effort=${request.effort}`,
    '--sandbox', request.sandbox,
    '--cd', request.cwd,
    '--skip-git-repo-check',
    '--output-schema', SCHEMA_PATH,
    '--output-last-message', request.outputPath,
    '--json',
    '-',
  ];
}

async function defaultRunWorker(request) {
  fs.mkdirSync(path.dirname(request.outputPath), { recursive: true, mode: 0o700 });
  try {
    const result = await runProcess({
      command: process.env.CODEX_PATH || CODEX_PATH,
      args: buildArgs(request),
      input: `${JSON.stringify(request.packet, null, 2)}\n`,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      shell: false,
    });
    let output = null;
    let outputContractFailed = false;
    if (result.exitCode === 0 && !result.timedOut) {
      try {
        output = JSON.parse(fs.readFileSync(request.outputPath, 'utf8'));
      } catch {
        outputContractFailed = true;
      }
    }
    return { ...result, output, infrastructureFailure: classifyInfrastructureFailure({ ...result, outputContractFailed }) };
  } finally {
    // The structured response is needed only long enough to build the bounded
    // evaluation record. Keep raw model prose out of the report directory.
    fs.rmSync(request.outputPath, { force: true });
  }
}

async function runPreflight(options = {}, dependencies = {}) {
  const root = path.resolve(options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-subagent-ab-preflight-')));
  const runWorker = dependencies.runWorker || defaultRunWorker;
  const request = {
    role: 'preflight',
    cwd: root,
    model: PARENT.model,
    effort: PARENT.effort,
    sandbox: 'read-only',
    timeoutMs: Number(options.timeoutMs || 60 * 1000),
    outputPath: outputPathFor(root, 'preflight', 'connectivity'),
    packet: {
      goal: 'Return a structured JSON response confirming that the metered evaluation worker is available. Do not use tools and do not modify files.',
      taskFamily: 'subagent-ab-preflight',
      hardConstraints: ['Do not use tools', 'Do not modify files', 'Do not access unrelated files'],
      relevantFiles: [],
      verificationCommands: [],
      outputContract: 'Return only the supplied structured JSON schema.',
    },
  };
  const result = await runWorker(request);
  const usage = parseUsageEvents(result.stdout || '');
  const infrastructureFailure = result.infrastructureFailure || classifyInfrastructureFailure(result);
  const preflight = {
    available: result.exitCode === 0 && !infrastructureFailure && Boolean(result.output),
    telemetryAvailable: usage.inputTokens + usage.cachedInputTokens + usage.outputTokens > 0,
    usage,
    durationMs: Number(result.durationMs || 0),
    infrastructureFailure: infrastructureFailure || null,
  };
  if (options.output) {
    fs.mkdirSync(options.output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(options.output, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return preflight;
}

function workerPacket(task, goal, childEvidence = []) {
  return {
    goal,
    taskFamily: 'subagent-ab-evaluation',
    hardConstraints: [
      'Do not modify test/**, package.json, or .brain-lite-immutable.json.',
      'Do not access files outside the supplied workspace.',
      'Run the public test command before reporting completion.',
    ],
    relevantFiles: ['src', 'test/public.test.js'],
    verificationCommands: ['node --test test/public.test.js'],
    childEvidence,
    outputContract: 'Return structured JSON matching the supplied schema. Do not claim hidden tests were run.',
  };
}

function compactChildResult(lane, route, result) {
  const usage = parseUsageEvents(result.stdout || '');
  return {
    lane: lane.id,
    routeId: route.routeId,
    model: route.model,
    effort: route.effort,
    sandbox: 'read-only',
    durationMs: Number(result.durationMs || 0),
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    infrastructureFailure: result.infrastructureFailure || null,
    evidence: (result.output?.evidence || []).slice(0, 8),
    suggestion: typeof result.output?.proposedPatch === 'string' ? result.output.proposedPatch.slice(0, 1200) : null,
    risks: (result.output?.risks || []).slice(0, 8),
  };
}

function tokenTotal(record) {
  return Number(record.inputTokens || 0) + Number(record.outputTokens || 0);
}

async function runCondition(options, dependencies = {}) {
  const task = taskById(options.taskId);
  const condition = options.condition;
  if (!['mother-only', 'routed-subagents'].includes(condition)) throw new Error(`Unknown condition: ${condition}`);
  const prompt = promptSpec(task, options.promptMode || 'clear');
  const now = dependencies.now || (() => new Date());
  const runWorker = dependencies.runWorker || defaultRunWorker;
  const root = path.resolve(options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-subagent-ab-run-')));
  const startedAt = now().getTime();
  const workspace = prepareWorkspace(task.id, { root, runId: `${condition}-${crypto.randomUUID()}` });
  const children = [];

  if (condition === 'routed-subagents') {
    const childRuns = task.childLanes.map(async (lane, index) => {
      const route = routeTask(lane.features, routerConfig, {});
      if (!route.dispatch) throw new Error(`Child lane ${lane.id} did not pass the router gate`);
      const request = {
        role: 'child',
        cwd: workspace,
        model: route.model,
        effort: route.effort,
        sandbox: 'read-only',
        timeoutMs: Math.min(route.timeoutMs || 180000, 3 * 60 * 1000),
        outputPath: outputPathFor(root, 'child', task.id, lane.id),
        packet: workerPacket(task, prompt.childGoals[index]),
      };
      const result = await runWorker(request);
      return compactChildResult(lane, route, result);
    });
    children.push(...await Promise.all(childRuns));
  }

  const childEvidence = children.map((child) => ({
    lane: child.lane,
    route: `${child.model}/${child.effort}`,
    evidence: child.evidence,
    suggestion: child.suggestion,
    risks: child.risks,
    infrastructureFailure: child.infrastructureFailure,
  }));
  const recordedChildren = children.map(({ evidence, suggestion, risks, ...child }) => child);
  const parentRequest = {
    role: 'parent',
    cwd: workspace,
    model: PARENT.model,
    effort: PARENT.effort,
    sandbox: 'workspace-write',
    timeoutMs: PARENT.timeoutMs,
    outputPath: outputPathFor(root, 'parent', task.id),
    packet: workerPacket(task, prompt.userPrompt, childEvidence),
  };
  const parentResult = await runWorker(parentRequest);
  const parentUsage = parseUsageEvents(parentResult.stdout || '');
  const parent = {
    model: PARENT.model,
    effort: PARENT.effort,
    sandbox: 'workspace-write',
    durationMs: Number(parentResult.durationMs || 0),
    inputTokens: parentUsage.inputTokens,
    cachedInputTokens: parentUsage.cachedInputTokens,
    outputTokens: parentUsage.outputTokens,
    infrastructureFailure: parentResult.infrastructureFailure || null,
  };
  const grade = gradeWorkspace(task.id, workspace);
  const infrastructureFailure = parent.infrastructureFailure || recordedChildren.find((child) => child.infrastructureFailure)?.infrastructureFailure || null;
  const endedAt = now().getTime();
  return {
    taskId: task.id,
    promptMode: prompt.promptMode,
    condition,
    parent,
    children: recordedChildren,
    totalTokens: tokenTotal(parent) + recordedChildren.reduce((sum, child) => sum + tokenTotal(child), 0),
    elapsedMs: Math.max(0, endedAt - startedAt),
    grade,
    infrastructureFailure,
    workspace,
  };
}

function summarizeRuns(runs) {
  const summary = {};
  for (const condition of ['mother-only', 'routed-subagents']) {
    const conditionRuns = runs.filter((run) => run.condition === condition);
    const valid = conditionRuns.filter((run) => !run.infrastructureFailure);
    summary[condition] = {
      runs: conditionRuns.length,
      validRuns: valid.length,
      infrastructureBlocks: conditionRuns.length - valid.length,
      verifiedPassRate: valid.length ? valid.filter((run) => run.grade.passed).length / valid.length : null,
      medianTokens: median(valid.map((run) => run.totalTokens)),
      medianElapsedMs: median(valid.map((run) => run.elapsedMs)),
    };
  }
  return summary;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderReport(result) {
  const rows = [`# Mother Agent vs Routed Subagent Pilot (${result.promptMode || 'clear'})`, '', '| Condition | Valid runs | Infra blocks | Verified pass rate | Median tokens | Median elapsed ms |', '|---|---:|---:|---:|---:|---:|'];
  for (const condition of ['mother-only', 'routed-subagents']) {
    const value = result.summary[condition];
    rows.push(`| ${condition} | ${value.validRuns} | ${value.infrastructureBlocks} | ${value.verifiedPassRate === null ? '—' : `${(value.verifiedPassRate * 100).toFixed(1)}%`} | ${value.medianTokens ?? '—'} | ${value.medianElapsedMs ?? '—'} |`);
  }
  rows.push('', 'This is an exploratory paired sample. Infrastructure blocks are excluded from capability comparisons.', '');
  return rows.join('\n');
}

function resolvePilotRoot(options = {}) {
  return path.resolve(options.root || options.output || path.join(process.cwd(), 'reports', 'subagent-ab-2026-07-12'));
}

async function runPilot(options = {}, dependencies = {}) {
  const root = resolvePilotRoot(options);
  const promptMode = options.promptMode || 'clear';
  promptSpec(TASKS[0], promptMode);
  const runs = [];
  let consecutiveInfrastructureBlocks = 0;
  for (let index = 0; index < TASKS.length; index += 1) {
    const order = index % 2 === 0 ? ['mother-only', 'routed-subagents'] : ['routed-subagents', 'mother-only'];
    for (const condition of order) {
      const run = await runCondition({ taskId: TASKS[index].id, condition, promptMode, root }, dependencies);
      runs.push(run);
      consecutiveInfrastructureBlocks = run.infrastructureFailure ? consecutiveInfrastructureBlocks + 1 : 0;
      if (consecutiveInfrastructureBlocks >= 2) {
        const result = { promptMode, runs: sanitizeRuns(runs), summary: summarizeRuns(runs), stoppedEarly: true };
        writePilotResult(options.output || root, result);
        return result;
      }
    }
  }
  const result = { promptMode, runs: sanitizeRuns(runs), summary: summarizeRuns(runs), stoppedEarly: false };
  writePilotResult(options.output || root, result);
  return result;
}

function sanitizeRuns(runs) {
  return runs.map(({ workspace, ...run }) => run);
}

function writePilotResult(outputDir, result) {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outputDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(outputDir, 'report.md'), renderReport(result), { encoding: 'utf8', mode: 0o600 });
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pilot') options.pilot = true;
    else if (arg === '--preflight') options.preflight = true;
    else if (arg === '--prompt-mode') options.promptMode = argv[++index];
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseCli(process.argv.slice(2));
      if (options.help || (!options.pilot && !options.preflight)) {
        process.stdout.write('Usage: node scripts/brain-lite-subagent-ab.js --preflight|--pilot [--prompt-mode clear|vague-user] [--output DIR]\n');
        return;
      }
      if (options.preflight) {
        const preflight = await runPreflight(options);
        process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
        if (!preflight.available || !preflight.telemetryAvailable) process.exitCode = 2;
        return;
      }
      const result = await runPilot(options);
      process.stdout.write(`${JSON.stringify({ summary: result.summary, stoppedEarly: result.stoppedEarly }, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  CODEX_PATH,
  PARENT,
  ROOT,
  TASKS,
  VAGUE_USER_PROMPT,
  gradeWorkspace,
  promptSpec,
  prepareWorkspace,
  resolvePilotRoot,
  runPreflight,
  runCondition,
  runPilot,
  summarizeRuns,
};
