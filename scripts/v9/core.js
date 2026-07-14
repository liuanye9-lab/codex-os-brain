'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveV9Paths } = require('./paths');
const { appendJsonl, atomicWriteJson, readJsonSafe } = require('./store');
const { createTaskContract } = require('./task-contract');
const { attachEvidence, evaluateCompletion } = require('./verification');
const { advanceCircuit, classifyFailure } = require('./failure-controller');
const migration = require('./migration');

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
    create(input) { return saveTask(createTaskContract(input)); },
    save: saveTask,
    evaluateAction(toolName, toolInput = {}) {
      const contract = activeTask();
      if (!contract) return { level: 0, reasonCode: 'no_active_task' };
      const serialized = JSON.stringify(toolInput);
      const forbidden = (contract.scope?.forbidden || []).find(item => serialized.includes(item));
      if (forbidden) return { level: 4, reasonCode: 'scope_forbidden', message: 'Action targets an explicitly forbidden scope.' };
      if (contract.externalWrite || contract.risk === 'high' || contract.risk === 'critical') return { level: 3, reasonCode: 'confirmation_required' };
      if (/rm|delete|publish|push|deploy/i.test(String(toolName))) return { level: 2, reasonCode: 'high_risk_write', message: 'High-risk write requires verification.' };
      return { level: 0, reasonCode: 'allowed' };
    },
  };

  const events = {
    sanitize(input = {}) {
      const output = { schemaVersion: 9 };
      for (const key of EVENT_FIELDS) if (input[key] !== undefined) output[key] = input[key];
      if (!output.eventId) output.eventId = `evt_${crypto.randomBytes(12).toString('hex')}`;
      if (!output.kind) output.kind = 'checkpoint';
      return output;
    },
    append(input) {
      const event = this.sanitize(input);
      if (enabled) appendJsonl(eventsFile, event);
      return event;
    },
    list() {
      if (!enabled || !fs.existsSync(eventsFile)) return [];
      return fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    },
  };

  const verification = {
    attach(criterionId, evidenceRef) {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      return saveTask(attachEvidence(contract, criterionId, evidenceRef));
    },
    evaluateActive() {
      const contract = activeTask();
      return contract ? evaluateCompletion(contract) : { status: 'partial', missing: ['active_task'], failed: [], unverified: [] };
    },
  };

  const failures = {
    record(input) {
      const failure = classifyFailure(input);
      const state = readJsonSafe(failuresFile, { signature: null, consecutive: 0, status: 'closed' }).value;
      const next = advanceCircuit(state, failure);
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
    migration,
    paths,
    config,
  };
}

module.exports = { createV9Core, readV9Config };
