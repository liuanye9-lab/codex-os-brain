'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveV9Paths } = require('./paths');
const { appendJsonl, atomicWriteJson, readJsonSafe } = require('./store');
const { createTaskContract } = require('./task-contract');
const { attachEvidence, claimEvidence, evaluateCompletion, verifyActive, verifyCriterion } = require('./verification');
const { advanceCircuit, classifyFailure } = require('./failure-controller');
const { evaluateAction } = require('./policy');
const migration = require('./migration');
const { createEmbeddingService } = require('./embeddings');
const handoff = require('./handoff');
const { createSkillsService } = require('./skills');
const { createMemoryService } = require('./memory');
const { getHostAdapter, listHosts } = require('./hosts');

const EVENT_FIELDS = ['eventId', 'kind', 'taskId', 'turnId', 'status', 'reasonCode', 'signature', 'evidenceId', 'durationMs', 'createdAt'];

function readV9Config(configPath) {
  const file = configPath || path.resolve(__dirname, '..', '..', 'config', 'brain-lite-v9.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createV9Core({ paths = resolveV9Paths(), config = readV9Config() } = {}) {
  const enabled = config.enabled === true;
  const activeTaskFile = path.join(paths.tasksRoot, 'active.json');
  const eventsFile = path.join(paths.eventsRoot, 'events.jsonl');
  const failuresFile = path.join(paths.failuresRoot, 'circuit.json');
  const embeddings = createEmbeddingService({ paths });
  const skills = createSkillsService({ paths });
  const memory = createMemoryService({ paths });
  const projectRoot = () => process.env.BRAIN_PROJECT_ROOT || process.cwd();

  function activeTask() {
    if (!enabled) return null;
    return readJsonSafe(activeTaskFile, null).value;
  }

  function saveTask(contract) {
    if (!enabled) return contract;
    atomicWriteJson(activeTaskFile, contract);
    return contract;
  }

  const contracts = {
    active: activeTask,
    create(input) {
      const contract = saveTask(createTaskContract(input));
      try {
        handoff.initHandoff({ projectRoot: projectRoot(), objective: contract.objective });
      } catch {
        // handoff is best-effort on create
      }
      return contract;
    },
    save: saveTask,
    evaluateAction(toolName, toolInput = {}) {
      return evaluateAction({
        toolName,
        toolInput,
        contract: activeTask(),
        cwd: projectRoot(),
        riskTable: config.riskTable,
      });
    },
  };

  const events = {
    sanitize(input = {}) {
      const output = { schemaVersion: 9 };
      for (const key of EVENT_FIELDS) if (input[key] !== undefined) output[key] = input[key];
      if (!output.eventId) output.eventId = `evt_${crypto.randomBytes(12).toString('hex')}`;
      if (!output.kind) output.kind = 'checkpoint';
      if (!output.createdAt) output.createdAt = new Date().toISOString();
      return output;
    },
    append(input) {
      const event = this.sanitize(input);
      if (enabled) appendJsonl(eventsFile, event);
      return event;
    },
    list() {
      if (!enabled || !fs.existsSync(eventsFile)) return [];
      return fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    },
  };

  const verification = {
    /** Agent claim: never harness-verified. */
    claim(criterionId, evidenceRef) {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      return saveTask(claimEvidence(contract, criterionId, evidenceRef));
    },
    /**
     * Attach evidence. Unless harnessVerified:true, treated as claim.
     * Kept for MCP/CLI compatibility; cannot forge harness pass without flag.
     */
    attach(criterionId, evidenceRef) {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      if (evidenceRef?.harnessVerified === true && evidenceRef?.allowHarnessAttach !== true) {
        // External callers cannot self-certify harness verification.
        return saveTask(claimEvidence(contract, criterionId, evidenceRef));
      }
      return saveTask(attachEvidence(contract, criterionId, evidenceRef));
    },
    evaluateActive(options = {}) {
      const contract = activeTask();
      return contract
        ? evaluateCompletion(contract, { requireHarness: options.requireHarness !== false })
        : { status: 'partial', missing: ['active_task'], failed: [], unverified: [], requireHarness: true };
    },
    /** Re-run executable verifiers; only path that can pass criteria. */
    run(options = {}) {
      const contract = activeTask();
      if (!contract) return { status: 'partial', missing: ['active_task'], failed: [], unverified: [], results: [] };
      const outcome = verifyActive(contract, { ...options, cwd: options.cwd || projectRoot() });
      saveTask(outcome.contract);
      events.append({
        kind: 'verify',
        taskId: outcome.contract.taskId,
        status: outcome.evaluation.status,
      });
      if (outcome.evaluation.status === 'complete') {
        try {
          memory.promoteFromVerified({
            text: `Task ${outcome.contract.taskId} verified complete: ${outcome.contract.objective}`,
            taskId: outcome.contract.taskId,
            evidenceId: outcome.results.map(item => item.evidenceId).join(','),
            tags: ['verified_completion'],
          });
        } catch { /* optional */ }
      }
      return { ...outcome.evaluation, results: outcome.results, lastVerifiedAt: outcome.contract.lastVerifiedAt };
    },
    runOne(criterionId, spec = {}, options = {}) {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      const { contract: next, result } = verifyCriterion(contract, criterionId, spec, {
        cwd: options.cwd || projectRoot(),
        allowedPaths: contract.scope?.allowed || [],
        forbiddenPaths: contract.scope?.forbidden || [],
        attestationToken: options.attestationToken,
        providedToken: options.providedToken,
      });
      saveTask(next);
      events.append({ kind: 'verify', taskId: next.taskId, status: result.status, evidenceId: result.evidenceId });
      return result;
    },
  };

  const failures = {
    record(input) {
      const failure = classifyFailure(input);
      const state = readJsonSafe(failuresFile, { signature: null, consecutive: 0, status: 'closed' }).value;
      const next = advanceCircuit(state, failure, config.failureCircuit);
      if (enabled) atomicWriteJson(failuresFile, next);
      return { failure, state: next };
    },
    status() { return readJsonSafe(failuresFile, { signature: null, consecutive: 0, status: 'closed' }).value; },
  };

  return {
    status: () => ({ version: 9, enabled, runtimeRoot: paths.runtimeRoot }),
    contracts,
    events,
    verification,
    failures,
    embeddings,
    migration,
    handoff,
    skills,
    memory,
    hosts: { get: getHostAdapter, list: listHosts },
    paths,
    config,
    projectRoot,
  };
}

module.exports = { createV9Core, readV9Config };
