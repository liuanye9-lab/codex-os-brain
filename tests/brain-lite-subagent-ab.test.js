'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TASKS,
  VAGUE_USER_PROMPT,
  gradeWorkspace,
  promptSpec,
  prepareWorkspace,
  resolvePilotRoot,
  runPreflight,
  runCondition,
  summarizeRuns,
} = require('../scripts/brain-lite-subagent-ab');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lite-subagent-ab-'));
}

function patchFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) content = content.replace(from, to);
  fs.writeFileSync(filePath, content);
}

test('each benchmark fixture starts failing and its known-good repair passes public and hidden grading', () => {
  const root = tempRoot();
  for (const task of TASKS) {
    const workspace = prepareWorkspace(task.id, { root, runId: `fixture-${task.id}` });
    const initial = gradeWorkspace(task.id, workspace);
    assert.equal(initial.passed, false, `${task.id} should begin with a real defect`);

    if (task.id === 'focused-boundary-repair') {
      patchFile(path.join(workspace, 'src', 'parse-limit.js'), [
        ['return Number(value) || fallback;', 'return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;'],
      ]);
    } else if (task.id === 'multi-file-outcome-rollup') {
      patchFile(path.join(workspace, 'src', 'rollup.js'), [
        ['return events.filter((event) => event.infrastructureFailure !== true);', 'return events.filter((event) => event.infrastructureFailure !== true && event.phase === \'verified\');'],
        ['const latestByTask = new Map();\n  for (const event of events) latestByTask.set(event.taskId, event);', 'const latestByTask = new Map();\n  for (const event of events) {\n    const current = latestByTask.get(event.taskId);\n    if (!current || String(event.timestamp) > String(current.timestamp)) latestByTask.set(event.taskId, event);\n  }'],
      ]);
    } else if (task.id === 'constraint-assignment') {
      patchFile(path.join(workspace, 'src', 'assign.js'), [
        ['if (usedSeats + guest.size <= table.capacity) {', 'if (usedSeats + guest.size <= table.capacity && !guest.avoid.includes(table.id)) {'],
        ['return assignments;', 'if (assignments.length !== guests.length) throw new Error(\'unassigned guest\');\n  return assignments;'],
      ]);
    }

    const repaired = gradeWorkspace(task.id, workspace);
    assert.equal(repaired.passed, true, `${task.id} known-good repair should pass`);
    assert.equal(repaired.immutableFilesPassed, true);
  }
});

test('evaluation checkers are explicitly CommonJS so the benchmark is portable into module-based repositories', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'subagent-ab-2026-07-12', 'package.json'), 'utf8'));
  assert.equal(metadata.type, 'commonjs');
});

test('vague-user mode preserves the user wording while withholding task-specific semantics', () => {
  const spec = promptSpec(TASKS[1], 'vague-user');
  assert.equal(spec.userPrompt, VAGUE_USER_PROMPT);
  assert.equal(spec.userPrompt, '修复我前面出现的问题并测试我。');
  assert.equal(spec.childGoals.length, 2);
  assert.doesNotMatch(JSON.stringify(spec).toLowerCase(), /rollup|normalize|verified|infrastructure|timestamp/);
});

test('mother-only and routed conditions preserve a common parent model and isolate each workspace', async () => {
  const root = tempRoot();
  const invocations = [];
  const dependencies = {
    now: (() => {
      let value = 0;
      return () => new Date(1_700_000_000_000 + (value += 1000));
    })(),
    runWorker: async (request) => {
      invocations.push(request);
      if (request.role === 'parent') {
        fs.writeFileSync(path.join(request.cwd, 'src', 'parse-limit.js'), "'use strict';\n\nfunction parseLimit(value, fallback) {\n  const numeric = Number(value);\n  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;\n}\n\nmodule.exports = { parseLimit };\n");
      }
      return {
        exitCode: 0,
        durationMs: request.role === 'parent' ? 40 : 10,
        stdout: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: request.role === 'parent' ? 100 : 20, cached_input_tokens: 0, output_tokens: request.role === 'parent' ? 30 : 8 } }),
        stderr: '',
        output: {
          summary: `${request.role} completed`,
          evidence: [],
          proposedPatch: null,
          verification: [],
          risks: [],
          needsEscalation: false,
          escalationReason: null,
        },
      };
    },
  };

  const solo = await runCondition({ taskId: 'focused-boundary-repair', condition: 'mother-only', promptMode: 'vague-user', root }, dependencies);
  const routed = await runCondition({ taskId: 'focused-boundary-repair', condition: 'routed-subagents', promptMode: 'vague-user', root }, dependencies);

  assert.equal(solo.parent.model, 'gpt-5.6-terra');
  assert.equal(routed.parent.model, 'gpt-5.6-terra');
  assert.equal(solo.promptMode, 'vague-user');
  assert.equal(routed.promptMode, 'vague-user');
  assert.notEqual(solo.workspace, routed.workspace);
  assert.equal(solo.children.length, 0);
  assert.equal(routed.children.length, 2);
  assert.equal(routed.children.every((child) => child.sandbox === 'read-only'), true);
  assert.equal(Object.hasOwn(routed.children[0], 'evidence'), false, 'result records must not retain child model prose');
  assert.equal(Object.hasOwn(routed.children[0], 'suggestion'), false, 'result records must not retain child model prose');
  assert.equal(Object.hasOwn(routed.children[0], 'risks'), false, 'result records must not retain child model prose');
  assert.equal(routed.parent.sandbox, 'workspace-write');
  assert.equal(solo.totalTokens, 130);
  assert.equal(routed.totalTokens, 186);
  assert.equal(routed.grade.passed, true);
  assert.equal(routed.infrastructureFailure, null);
  assert.ok(invocations.some((item) => item.role === 'child'));
  for (const invocation of invocations.filter((item) => item.role === 'parent')) {
    assert.equal(invocation.packet.goal, VAGUE_USER_PROMPT);
  }
  for (const invocation of invocations.filter((item) => item.role === 'child')) {
    assert.doesNotMatch(invocation.packet.goal.toLowerCase(), /parse-limit|finite|fallback|edge case/);
  }
});

test('summary separates verified capability outcomes from infrastructure blocks', () => {
  const summary = summarizeRuns([
    { taskId: 'a', condition: 'mother-only', totalTokens: 100, elapsedMs: 1000, grade: { passed: true }, infrastructureFailure: null },
    { taskId: 'a', condition: 'routed-subagents', totalTokens: 80, elapsedMs: 800, grade: { passed: true }, infrastructureFailure: null },
    { taskId: 'b', condition: 'mother-only', totalTokens: 0, elapsedMs: 500, grade: { passed: false }, infrastructureFailure: 'network' },
    { taskId: 'b', condition: 'routed-subagents', totalTokens: 120, elapsedMs: 1500, grade: { passed: false }, infrastructureFailure: null },
  ]);

  assert.equal(summary['mother-only'].validRuns, 1);
  assert.equal(summary['mother-only'].infrastructureBlocks, 1);
  assert.equal(summary['mother-only'].verifiedPassRate, 1);
  assert.equal(summary['routed-subagents'].validRuns, 2);
  assert.equal(summary['routed-subagents'].verifiedPassRate, 0.5);
});

test('preflight requires structured token telemetry before the paired pilot can spend its budget', async () => {
  const root = tempRoot();
  const result = await runPreflight({ root }, {
    runWorker: async () => ({
      exitCode: 0,
      durationMs: 15,
      stdout: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 } }),
      stderr: '',
      infrastructureFailure: null,
      output: {
        summary: 'OK',
        evidence: [],
        proposedPatch: null,
        verification: [],
        risks: [],
        needsEscalation: false,
        escalationReason: null,
      },
    }),
  });

  assert.equal(result.available, true);
  assert.equal(result.telemetryAvailable, true);
  assert.equal(result.usage.inputTokens, 7);
  assert.equal(result.usage.outputTokens, 3);
});

test('an explicit report output also becomes the isolated pilot workspace root', () => {
  const output = path.join(tempRoot(), 'attempt-2');
  assert.equal(resolvePilotRoot({ output }), path.resolve(output));
});
