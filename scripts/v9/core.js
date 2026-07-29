'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveV9Paths, scopeV9Paths } = require('./paths');
const { atomicWriteJson, readJsonSafe } = require('./store');
const { createControlStore } = require('./control-store');
const { createControlGuard } = require('./control-guard');
const { captureGitBaseline } = require('./git-baseline');
const { createTaskContract, sealTaskContract } = require('./task-contract');
const { claimEvidence, evaluateCompletion, verifyActive, verifyCriterion } = require('./verification');
const { createEvidenceSealer } = require('./evidence-seal');
const { advanceCircuit, classifyFailure, resetCircuitForOperation } = require('./failure-controller');
const { evaluateAction } = require('./policy');
const { captureVerifierBaseline } = require('./verifiers');
const migration = require('./migration');
const { createEmbeddingService } = require('./embeddings');
const handoff = require('./handoff');
const { createSkillsService } = require('./skills');
const { createMemoryService } = require('./memory-service');
const { createMemoryHarness } = require('./memory-harness');
const { backupMemoryDatabase } = require('./memory-db');
const { createCognitiveAssetProvider } = require('./cognitive-assets');
const {
  compareEncryptedMemoryBackup,
  createEncryptedMemoryBackup,
  createMacKeychainStore,
  inspectEncryptedMemoryBackup,
  verifyEncryptedMemoryBackup,
} = require('./memory-encrypted-backup');
const {
  drillRecoveryKey,
  exportRecoveryKey,
  importRecoveryKey,
  recoverMemoryRuntime,
  restoreEncryptedMemoryBackup,
  rotateRecoveryKey,
} = require('./memory-recovery');
const { getHostAdapter, listHosts } = require('./hosts');
const { IDENTITY } = require('./identity');

const EVENT_FIELDS = ['eventId', 'kind', 'taskId', 'turnId', 'status', 'reasonCode', 'signature', 'evidenceId', 'durationMs', 'createdAt'];

function disabledFeature(name, extraStatus = {}) {
  return new Proxy({
    status: () => ({ enabled: false, reason: 'feature_disabled', feature: name, ...extraStatus }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'then') return undefined;
      return () => {
        const error = new Error(`feature_disabled:${name}`);
        error.code = 'feature_disabled';
        error.feature = name;
        throw error;
      };
    },
  });
}

function readV9Config(configPath) {
  const file = configPath || path.resolve(__dirname, '..', '..', 'config', 'brain-lite-v9.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createV9Core({
  paths = resolveV9Paths(),
  config = readV9Config(),
  projectRoot: configuredProjectRoot,
  sessionId: configuredSessionId,
  taskId: configuredTaskId,
  cognitiveAssetAuthorityMode = 'operator_guardrail_only',
  cognitiveAssetApprovalVerifier = null,
} = {}) {
  const basePaths = paths;
  const enabled = config.enabled === true;
  const memoryEnabled = enabled && config.memory?.enabled === true;
  const cognitiveAssetsEnabled = enabled && config.cognitiveAssets?.enabled === true;
  const projectRoot = () => path.resolve(configuredProjectRoot || process.env.BRAIN_PROJECT_ROOT || process.cwd());
  const rawSessionId = String(configuredSessionId || process.env.BRAIN_SESSION_ID || process.env.CODEX_THREAD_ID || 'default');
  const runtimePaths = config.hooks?.projectScoped === false ? paths : scopeV9Paths(paths, projectRoot());
  paths = runtimePaths;
  const legacyActiveTaskFile = path.join(paths.tasksRoot, 'active.json');
  const legacyEventsFile = path.join(paths.eventsRoot, 'events.jsonl');
  const controlStore = createControlStore({
    dbPath: paths.controlDbPath,
    sessionId: rawSessionId,
    taskId: configuredTaskId,
  });
  const embeddings = createEmbeddingService({ paths });
  const skills = createSkillsService({ paths });
  const memory = memoryEnabled
    ? createMemoryService({ paths })
    : disabledFeature('memory', { liveDatabaseEncrypted: false });
  const memoryHarness = memoryEnabled ? createMemoryHarness({ paths }) : disabledFeature('memory_harness');
  const cognitiveAssets = cognitiveAssetsEnabled
    ? createCognitiveAssetProvider({
      paths,
      authorityMode: cognitiveAssetAuthorityMode,
      approvalVerifier: cognitiveAssetApprovalVerifier,
    })
    : disabledFeature('cognitive_assets', {
      lab: true,
      playbookExecution: false,
      liveDatabaseEncrypted: false,
      sensitivePersistenceAllowed: false,
    });
  const memoryBackupKeyStore = createMacKeychainStore();
  const evidenceSealer = createEvidenceSealer({ paths });
  const controlGuard = createControlGuard({ guardPath: paths.controlGuardPath, evidenceSealer });
  if (enabled) {
    const legacy = readJsonSafe(legacyActiveTaskFile, null);
    const legacyGuard = readJsonSafe(path.join(paths.tasksRoot, 'active.guard.json'), null);
    const legacyEvents = [];
    if (fs.existsSync(legacyEventsFile)) {
      for (const line of fs.readFileSync(legacyEventsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
        try { legacyEvents.push(JSON.parse(line)); } catch {}
      }
    }
    controlStore.importLegacy({
      contract: legacy.value,
      guardExpected: legacyGuard.missing === false,
      events: legacyEvents,
    });
  }
  function activeTask() {
    if (!enabled) return null;
    return activeTaskState().contract;
  }

  function activeTaskState() {
    if (!enabled) return { expected: false, contract: null, missing: false, corrupt: false };
    const state = controlStore.activeState();
    const guard = controlGuard.read();
    if (!guard.valid) return { expected: true, contract: null, missing: false, corrupt: true, guard };
    const guardedTaskIds = Object.keys(guard.tasks);
    if (!state.contract) {
      return guardedTaskIds.length > 0
        ? { ...state, expected: true, missing: true, guard }
        : { ...state, guard };
    }
    const guarded = guard.tasks[state.contract.taskId];
    if (!guard.present || !guarded || guarded.specHash !== state.contract.trust?.specHash) {
      return { expected: true, contract: null, missing: false, corrupt: true, guard };
    }
    return { ...state, guard };
  }

  function saveTask(contract) {
    if (!enabled) return contract;
    if (contract.lifecycle !== 'complete') controlGuard.add(contract);
    const saved = controlStore.saveTask(contract);
    if (contract.lifecycle === 'complete') controlGuard.remove(contract.taskId);
    return saved;
  }

  function saveTaskWithEvent(contract, eventInput) {
    if (!enabled) return contract;
    if (contract.lifecycle !== 'complete') controlGuard.add(contract);
    const event = events.sanitize(eventInput);
    const saved = controlStore.saveTaskAndEvent(contract, event);
    if (contract.lifecycle === 'complete') controlGuard.remove(contract.taskId);
    return saved;
  }

  const contracts = {
    active: activeTask,
    state: activeTaskState,
    create(input) {
      const criteria = (input.criteria || []).map(criterion => {
        const verifier = criterion.verifier || (criterion.id === 'scope' ? 'git_diff_bounded' : null);
        if (verifier === 'test_runner' || (!criterion.verifier && criterion.id === 'tests')) {
          return {
            ...criterion,
            verifier: 'test_runner',
            verifierSpec: {
              ...(criterion.verifierSpec || {}),
              baseline: criterion.verifierSpec?.baseline || captureVerifierBaseline(
                projectRoot(),
                criterion.verifierSpec?.baselinePaths,
              ),
            },
          };
        }
        if (verifier !== 'git_diff_bounded' && criterion.id !== 'scope') return criterion;
        return {
          ...criterion,
          verifier: 'git_diff_bounded',
          verifierSpec: {
            ...(criterion.verifierSpec || {}),
            baseline: captureGitBaseline(projectRoot(), {
              watchPaths: input.scope?.forbidden || [],
            }),
          },
        };
      });
      const contract = sealTaskContract(createTaskContract({ ...input, criteria }), evidenceSealer);
      controlStore.createTask(contract);
      try {
        controlGuard.add(contract);
      } catch (error) {
        controlStore.rollbackCreate(contract.taskId, contract.trust?.specHash);
        throw error;
      }
      try {
        handoff.initHandoff({ projectRoot: projectRoot(), objective: contract.objective });
      } catch {
        // handoff is best-effort on create
      }
      return contract;
    },
    save: saveTask,
    evaluateAction(toolName, toolInput = {}) {
      const state = activeTaskState();
      if (state.expected && (!state.contract || state.missing || state.corrupt || state.ambiguous)) {
        return {
          level: 4,
          reasonCode: state.ambiguous ? 'task_selector_ambiguous' : 'active_contract_missing',
          risk: 'critical',
          message: 'Action paused because the active task selector is missing, corrupt, or ambiguous.',
        };
      }
      return evaluateAction({
        toolName,
        toolInput,
        contract: state.contract,
        cwd: projectRoot(),
        riskTable: config.riskTable,
      });
    },
    close() {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      const evaluation = verification.evaluateActive();
      if (evaluation.status !== 'complete') throw new Error('completion_unverified');
      const closed = sealTaskContract({
        ...contract,
        revision: Number(contract.revision || 1) + 1,
        lifecycle: 'complete',
        updatedAt: new Date().toISOString(),
        trust: undefined,
      }, evidenceSealer);
      return saveTaskWithEvent(closed, {
        kind: 'checkpoint',
        taskId: closed.taskId,
        status: 'complete',
        reasonCode: 'task_closed',
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
      if (enabled) controlStore.appendEvent(event);
      return event;
    },
    list() {
      return enabled ? controlStore.listEvents() : [];
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
     * Compatibility API: external evidence is always a claim. Only executable
     * verifier results receive a local authenticity seal.
     */
    attach(criterionId, evidenceRef) {
      const contract = activeTask();
      if (!contract) throw new Error('active_task_required');
      return saveTask(claimEvidence(contract, criterionId, evidenceRef));
    },
    evaluateActive(options = {}) {
      const contract = activeTask();
      return contract
        ? evaluateCompletion(contract, {
          verifyEvidence: evidenceSealer.verify,
          verifyContract: evidenceSealer.verifyContract,
        })
        : { status: 'partial', missing: ['active_task'], failed: [], unverified: [], requireHarness: true };
    },
    /** Re-run executable verifiers; only path that can pass criteria. */
    run(options = {}) {
      const contract = activeTask();
      if (!contract) return { status: 'partial', missing: ['active_task'], failed: [], unverified: [], results: [] };
      const outcome = verifyActive(contract, {
        ...options,
        cwd: options.cwd || projectRoot(),
        evidenceSealer,
      });
      saveTaskWithEvent(outcome.contract, {
        kind: 'verify',
        taskId: outcome.contract.taskId,
        status: outcome.evaluation.status,
      });
      if (memoryEnabled && outcome.evaluation.status === 'complete') {
        try {
          memory.createMemory({
            content: `Task ${outcome.contract.taskId} verified complete: ${outcome.contract.objective}`,
            kind: 'verified_outcome',
            sourceUri: `task:${outcome.contract.taskId}`,
            actor: 'verification_harness',
            metadata: { evidenceIds: outcome.results.map(item => item.evidenceId) },
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
        evidenceSealer,
      });
      saveTaskWithEvent(next, { kind: 'verify', taskId: next.taskId, status: result.status, evidenceId: result.evidenceId });
      return result;
    },
  };

  const failures = {
    record(input) {
      const failure = classifyFailure(input);
      const next = enabled
        ? controlStore.updateCircuit(failure.operation, state => advanceCircuit(state, failure, config.failureCircuit))
        : advanceCircuit({ signature: null, consecutive: 0, status: 'closed' }, failure, config.failureCircuit);
      return { failure, state: next };
    },
    succeed({ operation } = {}) {
      return enabled
        ? controlStore.updateCircuit(operation, state => resetCircuitForOperation(state, operation))
        : resetCircuitForOperation({ signature: null, operation, consecutive: 0, status: 'closed' }, operation);
    },
    status(operation) { return enabled ? controlStore.circuitStatus(operation) : []; },
  };

  return {
    status: () => ({
      version: IDENTITY.runtimeContract,
      identity: IDENTITY,
      enabled,
      features: {
        stableCore: enabled,
        memory: memoryEnabled,
        cognitiveAssets: cognitiveAssetsEnabled,
        playbookExecution: false,
      },
      runtimeRoot: paths.runtimeRoot,
      controlStore: enabled ? { kind: 'sqlite', sessionId: controlStore.sessionId, integrity: controlStore.integrity() } : { enabled: false },
      memory: memory.status(),
      cognitiveAssets: cognitiveAssets.status(),
    }),
    contracts,
    events,
    verification,
    failures,
    embeddings,
    migration,
    handoff,
    skills,
    memory,
    memoryHarness,
    cognitiveAssets,
    backupMemory: () => backupMemoryDatabase({ paths }),
    encryptedMemoryBackup: {
      initKey: options => memoryBackupKeyStore.init(options),
      create: () => createEncryptedMemoryBackup({ paths, keyStore: memoryBackupKeyStore }),
      inspect: input => inspectEncryptedMemoryBackup(input),
      verify: input => verifyEncryptedMemoryBackup({ input, paths, keyStore: memoryBackupKeyStore }),
      compare: input => compareEncryptedMemoryBackup({ input, paths, keyStore: memoryBackupKeyStore }),
      restore: options => restoreEncryptedMemoryBackup({ ...options, paths, keyStore: memoryBackupKeyStore }),
      recoveryExport: options => exportRecoveryKey({ ...options, paths, keyStore: memoryBackupKeyStore }),
      recoveryDrill: options => drillRecoveryKey({ ...options, paths }),
      recoveryImport: options => importRecoveryKey({ ...options, keyStore: memoryBackupKeyStore }),
      recoveryRotate: options => rotateRecoveryKey({ ...options, paths, keyStore: memoryBackupKeyStore }),
      recover: options => recoverMemoryRuntime({ ...options, paths }),
    },
    hosts: { get: getHostAdapter, list: listHosts },
    paths,
    sessionId: controlStore.sessionId,
    config,
    features: {
      stableCore: enabled,
      memory: memoryEnabled,
      cognitiveAssets: cognitiveAssetsEnabled,
      playbookExecution: false,
    },
    projectRoot,
    forTask: taskId => createV9Core({
      paths: basePaths,
      config,
      projectRoot: projectRoot(),
      sessionId: rawSessionId,
      taskId,
    }),
  };
}

module.exports = { createV9Core, readV9Config };
