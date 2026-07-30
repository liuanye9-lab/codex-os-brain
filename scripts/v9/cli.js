'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createV9Core, readV9Config } = require('./core');
const { resolveV9Paths } = require('./paths');
const { doctorHooks, setProjectHooks } = require('./hook-config');
const { applyMigration, createMigrationBackup, inventoryLegacy, planMigration } = require('./migration');
const { runEvidenceSigningLoop } = require('./doctor');
const { inspectTrustBoundary } = require('./trust-boundary');

const EXIT = Object.freeze({ ok: 0, usage: 2, blocked: 3, failed: 4 });

function commandGuide() {
  return {
    name: 'Codex Brain V10',
    usage: 'brain <command> [action] [--flags] [--json]',
    startHere: [
      'brain doctor --json',
      'brain task create --task-id demo --objective "ship safely" --criterion tests --json',
      'brain verify --json',
      'brain hooks enable --project "$PWD" --confirm --json',
    ],
    commands: {
      status: 'Read runtime status.',
      doctor: 'Check environment, hooks, and a temporary signed-evidence round trip. May initialize an OS-local evidence key.',
      task: 'create | show | checkpoint',
      verify: 'Re-run executable acceptance criteria.',
      evidence: 'claim | attach',
      handoff: 'init | status | progress',
      memory: 'status | create | get | update | transition | delete | query | aggregate | entity | link | traverse | recover',
      cognition: 'status | digest | product-map | agent-readiness | agent-context | retention-status | retention-enforce',
      embeddings: 'status | recommend | configure | doctor | probe | pull | prompt',
      hooks: 'doctor | enable | disable',
      mcp: 'serve',
    },
    docs: 'docs/v9/quickstart.md',
  };
}

function flags(argv) {
  const values = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) values._.push(arg);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) values[arg.slice(2)] = argv[++i];
    else values[arg.slice(2)] = true;
  }
  return values;
}

function defaultIo() {
  return {
    json(value, code = EXIT.ok) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return code; },
    error(message, code = EXIT.failed) { process.stderr.write(`${message}\n`); return code; },
  };
}

function readTaskContractFile(inputPath, projectRoot) {
  const target = path.resolve(projectRoot, inputPath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('task_contract_file_invalid');
  if (stat.size > 1024 * 1024) throw new Error('task_contract_file_too_large');
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('task_contract_file_invalid');
  const objective = String(value.objective || '').trim();
  if (!objective) throw new Error('task_contract_objective_required');
  if (objective.length > 4000) throw new Error('task_contract_objective_too_long');
  if (value.taskId !== undefined && (!String(value.taskId).trim() || String(value.taskId).length > 160)) throw new Error('task_contract_id_invalid');
  if (value.criteria !== undefined && (!Array.isArray(value.criteria) || value.criteria.length > 50)) throw new Error('task_contract_criteria_invalid');
  const allowedVerifiers = new Set(['command_exit_0', 'command', 'test_runner', 'tests', 'git_diff_bounded', 'scope', 'human_attestation', 'human', 'file_exists']);
  const criteria = (value.criteria || []).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('task_contract_criterion_invalid');
    const id = String(item.id || '').trim();
    const verifier = String(item.verifier || (id === 'tests' ? 'test_runner' : id === 'scope' ? 'git_diff_bounded' : 'command_exit_0'));
    if (!id || id.length > 160 || !allowedVerifiers.has(verifier)) throw new Error('task_contract_criterion_invalid');
    if (item.verifierSpec !== undefined && (!item.verifierSpec || typeof item.verifierSpec !== 'object' || Array.isArray(item.verifierSpec))) {
      throw new Error('task_contract_verifier_spec_invalid');
    }
    const verifierSpec = item.verifierSpec ? structuredClone(item.verifierSpec) : undefined;
    if (verifierSpec) delete verifierSpec.humanApproved;
    return { id, required: item.required !== false, verifier, verifierSpec };
  });
  const scope = value.scope && typeof value.scope === 'object' && !Array.isArray(value.scope) ? value.scope : {};
  for (const key of ['allowed', 'forbidden']) {
    if (scope[key] !== undefined && (!Array.isArray(scope[key]) || scope[key].length > 100 || scope[key].some(item => typeof item !== 'string' || item.length > 4096))) {
      throw new Error('task_contract_scope_invalid');
    }
  }
  return {
    taskId: value.taskId === undefined ? undefined : String(value.taskId),
    objective,
    criteria,
    constraints: Array.isArray(value.constraints) ? value.constraints.slice(0, 50) : [],
    unresolved: Array.isArray(value.unresolved) ? value.unresolved.map(String).slice(0, 50) : [],
    scope: { allowed: scope.allowed || [], forbidden: scope.forbidden || [] },
    risk: value.risk,
    executionMode: value.executionMode,
    externalWrite: value.externalWrite === true,
  };
}

async function runCli(argv, io = defaultIo(), services = {}) {
  const args = flags(argv);
  const [group, action] = args._;
  const paths = services.paths || resolveV9Paths();
  const projectRoot = args.project || process.cwd();
  const configuredPath = args.config || (paths.configPath && fs.existsSync(paths.configPath) ? paths.configPath : undefined);
  const config = structuredClone(readV9Config(configuredPath));
  const labsRequested = args['enable-memory'] === true || args['enable-cognitive-assets'] === true;
  if (labsRequested && args['confirm-labs'] !== true) {
    return io.error('enabling Memory or Cognitive Labs requires --confirm-labs', EXIT.blocked);
  }
  if (args['enable-memory'] === true || args['enable-cognitive-assets'] === true) config.memory.enabled = true;
  if (args['enable-cognitive-assets'] === true) config.cognitiveAssets.enabled = true;
  const core = services.core || createV9Core({
    config,
    paths,
    projectRoot,
    sessionId: args.session,
    taskId: group === 'task' && action === 'create' ? undefined : args['task-id'],
  });
  const pluginRoot = services.pluginRoot || path.resolve(__dirname, '..', '..');

  if (!group || group === 'help' || args.help === true) return io.json(commandGuide());
  if (group === 'status') return io.json(core.status());
  if (group === 'cognition' && (!action || action === 'status')) return io.json(core.cognitiveAssets.status());
  if (group === 'cognition' && action === 'digest') return io.json(core.cognitiveAssets.dailyDigest({ limit: args.limit }));
  if (group === 'cognition' && action === 'product-map') return io.json(core.cognitiveAssets.productMap());
  if (group === 'cognition' && action === 'agent-readiness') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    return io.json(core.cognitiveAssets.assessAgent(args.id, { targetState: args.target }));
  }
  if (group === 'cognition' && action === 'agent-context') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    return io.json(core.cognitiveAssets.prepareAgentContext(args.id, {
      purpose: args.purpose,
      tokenBudget: args['token-budget'] ? Number(args['token-budget']) : undefined,
    }));
  }
  if (group === 'cognition' && action === 'retention-status') return io.json(core.cognitiveAssets.retentionStatus());
  if (group === 'cognition' && action === 'retention-enforce') {
    if (args['confirm-retention'] !== true) return io.error('retention enforcement requires --confirm-retention', EXIT.blocked);
    return io.json(core.cognitiveAssets.enforceRetention({ confirm: true, actor: 'cli_operator' }));
  }
  if (group === 'doctor') {
    const v9 = core.status();
    const hooks = doctorHooks({ projectRoot, pluginRoot, runtimePaths: core.paths });
    const trustBoundary = inspectTrustBoundary({ pluginRoot, paths: core.paths, hookPath: hooks.path });
    let signingLoop;
    try { signingLoop = runEvidenceSigningLoop(services.doctorOptions); }
    catch (error) { signingLoop = { passed: false, reason: error.code || error.message }; }
    const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
    const nodeSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);
    const checks = [
      { id: 'node-runtime', status: nodeSupported ? 'passed' : 'blocked', observed: process.versions.node, required: '>=22.5', remediation: nodeSupported ? null : 'Install Node.js 22.5 or newer.' },
      { id: 'v9-core', status: v9.enabled ? 'passed' : 'blocked', observed: { version: v9.version, enabled: v9.enabled }, remediation: v9.enabled ? null : 'Set config/brain-lite-v9.json enabled=true.' },
      { id: 'project-hooks', status: hooks.valid ? (hooks.enabled ? 'passed' : 'optional') : 'blocked', observed: { enabled: hooks.enabled, valid: hooks.valid, owner: hooks.owner, eventsComplete: hooks.eventsComplete, fingerprintMatch: hooks.fingerprintMatch, packageVersionMatch: hooks.packageVersionMatch, runtimeDigestMatch: hooks.runtimeDigestMatch, runtimeHealthy: hooks.runtimeHealthy, runtimeStorageWritable: hooks.runtimeStorageWritable, foreignHookCount: hooks.foreignHookCount, path: hooks.path }, remediation: hooks.valid ? (hooks.enabled ? null : 'Optional: run brain hooks enable --project "$PWD" --confirm --json.') : 'Repair the manifest, runtime storage permissions, or re-enable Codex Brain hooks to restore owned events, package version, and runtime fingerprint.' },
      { id: 'evidence-signing-loop', status: signingLoop.passed ? 'passed' : 'blocked', observed: signingLoop, remediation: signingLoop.passed ? null : 'Make the platform credential provider available, then rerun doctor.' },
      { id: 'trust-boundary', status: trustBoundary.localIntegrityChecksPassed ? 'passed' : 'warning', observed: trustBoundary, remediation: trustBoundary.localIntegrityChecksPassed ? null : 'Remove symlinks and group/world write permissions from installed runtime and state paths.' },
      { id: 'mcp-probe', status: 'available', command: 'npm run mcp:probe', remediation: 'Run from the installed package checkout to exercise the stdio MCP boundary.' },
    ];
    return io.json({
      ok: checks.every(check => !['blocked','failed'].includes(check.status)),
      checks,
      v8: {
        selectable: false,
        configuredFallback: core.config.fallbackVersion === 8,
        reason: 'v8_runtime_not_bundled',
      },
      v9,
      hooks,
      trustBoundary,
      cli: { binaries: ['brain', 'codex-brain'], helpCommand: 'brain --help' },
      mcp: { probeCommand: 'npm run mcp:probe', serveCommand: 'brain mcp serve' },
      hosts: core.hosts.list(),
      handoff: core.handoff.statusHandoff({ projectRoot }),
    });
  }
  if (group === 'task' && action === 'create') {
    let input;
    if (args.from) {
      try { input = readTaskContractFile(String(args.from), projectRoot); }
      catch (error) { return io.error(error.code || error.message, EXIT.usage); }
      input.criteria = input.criteria.map(criterion => ({
        ...criterion,
        verifierSpec: ['command_exit_0', 'command'].includes(criterion.verifier)
          ? { ...(criterion.verifierSpec || {}), humanApproved: args['approve-custom-verifier'] === true }
          : criterion.verifierSpec,
      }));
    } else {
      if (!args.objective) return io.error('objective is required', EXIT.usage);
      const criterionIds = args.criterion ? String(args.criterion).split(',') : [];
      const customIds = criterionIds.filter(id => !['tests', 'scope'].includes(id));
      if (customIds.length && (!args.command || args['approve-custom-verifier'] !== true)) {
        return io.error('custom criteria require --command and --approve-custom-verifier', EXIT.usage);
      }
      const criteria = criterionIds.map(id => {
        if (id === 'tests') {
          return {
            id, required: true, verifier: 'test_runner',
            verifierSpec: args.command ? { command: args.command } : { executable: 'npm', args: ['test'] },
          };
        }
        if (id === 'scope') return { id, required: true, verifier: 'git_diff_bounded' };
        return {
          id, required: true, verifier: 'command_exit_0',
          verifierSpec: {
            command: args.command,
            humanApproved: args['approve-custom-verifier'] === true,
          },
        };
      });
      input = {
        taskId: args['task-id'],
        objective: args.objective,
        criteria,
        risk: args.risk,
        externalWrite: args['external-write'] === true,
        scope: {
          allowed: args.allowed ? String(args.allowed).split(',') : [],
          forbidden: args.forbidden ? String(args.forbidden).split(',') : [],
        },
      };
    }
    return io.json(core.contracts.create({
      ...input,
      taskId: args['task-id'] || input.taskId,
      objective: input.objective,
    }));
  }
  if (group === 'task' && (!action || action === 'show')) {
    const task = core.contracts.active();
    return task ? io.json(task) : io.error('active task not found', EXIT.failed);
  }
  if (group === 'task' && action === 'checkpoint') {
    const task = core.contracts.active();
    if (!task) return io.error('active task not found', EXIT.failed);
    core.events.append({ kind: 'checkpoint', taskId: task.taskId, status: 'observed' });
    core.handoff.writeProgress({
      projectRoot,
      taskId: task.taskId,
      objective: task.objective,
      sessionSummary: args.summary || 'Manual checkpoint',
    });
    return io.json({ taskId: task.taskId, checkpointed: true });
  }
  if (group === 'verify') {
    // Default: re-run executable verifiers (P0). Use --status-only for stored evaluation.
    if (args['status-only']) return io.json(core.verification.evaluateActive());
    return io.json(core.verification.run({
      cwd: projectRoot,
      attestationToken: args['attest-token'],
      providedToken: args['provided-token'],
    }));
  }
  if (group === 'evidence' && action === 'claim') {
    if (!args.criterion || !args.id) return io.error('criterion and id are required', EXIT.usage);
    return io.json(core.verification.claim(args.criterion, {
      id: args.id,
      provenance: { kind: args.kind || 'claim', ref: args.ref || args.id },
    }));
  }
  if (group === 'evidence' && action === 'attach') {
    // Compat: treat attach as claim unless internal harness path.
    if (!args.criterion || !args.id || !args.status) return io.error('criterion, id, and status are required', EXIT.usage);
    return io.json(core.verification.attach(args.criterion, {
      id: args.id,
      status: args.status,
      provenance: { kind: args.kind || 'command', ref: args.ref || args.id },
    }));
  }
  if (group === 'failures') return io.json(core.failures.status());
  if (group === 'handoff' && (!action || action === 'status')) return io.json(core.handoff.statusHandoff({ projectRoot }));
  if (group === 'handoff' && action === 'init') {
    return io.json(core.handoff.initHandoff({
      projectRoot,
      objective: args.objective || core.contracts.active()?.objective || '',
      force: args.force === true,
    }));
  }
  if (group === 'handoff' && action === 'progress') {
    const task = core.contracts.active();
    return io.json(core.handoff.writeProgress({
      projectRoot,
      taskId: task?.taskId,
      objective: task?.objective || args.objective,
      sessionSummary: args.summary || args._[2] || 'Progress update',
    }));
  }
  if (group === 'skill' && (!action || action === 'list')) return io.json(core.skills.list());
  if (group === 'skill' && action === 'activate') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    const criteria = args.criterion ? String(args.criterion).split(',') : [];
    return io.json(core.skills.activate({
      skillId: args.id,
      expectedCriteria: criteria,
      costBudgetTokens: args.budget ? Number(args.budget) : 2000,
      reason: args.reason || '',
    }));
  }
  if (group === 'skill' && action === 'deactivate') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    return io.json(core.skills.deactivate(args.id));
  }
  if (group === 'memory' && (!action || action === 'status')) return io.json(core.memory.status());
  if (group === 'memory' && action === 'create') {
    if (!args.content) return io.error('content is required', EXIT.usage);
    return io.json(core.memory.createMemory({ content: args.content, kind: args.kind, confidence: args.confidence, privacy: args.privacy, sourceUri: args.source, validFrom: args['valid-from'], validTo: args['valid-to'], idempotencyKey: args['idempotency-key'], actor: args.actor }));
  }
  if (group === 'memory' && action === 'get') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    const item = core.memory.getMemory(args.id);
    return item ? io.json(item) : io.error('memory not found', EXIT.failed);
  }
  if (group === 'memory' && action === 'update') {
    if (!args.id || !args['expected-version']) return io.error('id and expected-version are required', EXIT.usage);
    return io.json(core.memory.updateMemory(args.id, { content: args.content, validFrom: args['valid-from'], validTo: args['valid-to'], expectedVersion: Number(args['expected-version']), approvedBy: args['approved-by'], idempotencyKey: args['idempotency-key'] }));
  }
  if (group === 'memory' && action === 'transition') {
    if (!args.id || !args.status || !args['expected-version'] || !args['approved-by']) return io.error('id, status, expected-version, and approved-by are required', EXIT.usage);
    return io.json(core.memory.transitionMemory(args.id, args.status, { expectedVersion: Number(args['expected-version']), approvedBy: args['approved-by'], reason: args.reason, idempotencyKey: args['idempotency-key'] }));
  }
  if (group === 'memory' && action === 'delete') {
    if (!args.id || !args['expected-version'] || !args['approved-by']) return io.error('id, expected-version, and approved-by are required', EXIT.usage);
    return io.json(core.memory.deleteMemory(args.id, { expectedVersion: Number(args['expected-version']), approvedBy: args['approved-by'], reason: args.reason, idempotencyKey: args['idempotency-key'] }));
  }
  if (group === 'memory' && action === 'query') {
    if (!args.query) return io.error('query is required', EXIT.usage);
    let queryVector = null; let embedding = { used: false, degraded: false };
    if (args.semantic) {
      try { const result = await core.embeddings.embed({ text: args.query }); queryVector = result.vector; embedding = { used: true, fingerprint: result.fingerprint, model: result.model }; }
      catch (error) { embedding = { used: false, degraded: true, reason: error.code || error.message }; }
    }
    return io.json({ ...core.memory.search({ query: args.query, queryVector, limit: args.limit, includeCandidates: args['include-candidates'] === true, at: args.at }), embedding });
  }
  if (group === 'memory' && action === 'aggregate') return io.json(core.memory.aggregate({ by: args.by }));
  if (group === 'memory' && action === 'import-index') {
    if (!args.input || !args.confirm) return io.error('input and confirm are required', EXIT.blocked);
    return io.json(core.memory.importFlatIndex(args.input));
  }
  if (group === 'memory' && action === 'entity') return io.json(core.memory.upsertEntity({ name: args.name, entityType: args.type }));
  if (group === 'memory' && action === 'link') return io.json(core.memory.link({ fromEntityId: args.from, toEntityId: args.to, relation: args.relation, status: args.status, approvedBy: args['approved-by'], validFrom: args['valid-from'], validTo: args['valid-to'], provenanceUri: args.source }));
  if (group === 'memory' && action === 'traverse') return io.json({ entityId: args.id, nodes: core.memory.traverse({ entityId: args.id, depth: args.depth, at: args.at }) });
  if (group === 'memory' && action === 'state-put') return io.json(core.memory.putStateBlock({ blockId: args.id, agentId: args.agent, scope: args.scope, content: args.content || '', accessMode: args.mode, expectedVersion: args['expected-version'] ? Number(args['expected-version']) : undefined, approvedBy: args['approved-by'] }));
  if (group === 'memory' && action === 'state-list') return io.json({ blocks: core.memory.listStateBlocks(args.agent, args.scope) });
  if (group === 'memory' && action === 'feedback') return io.json(core.memory.feedback({ query: args.query, queryHash: args['query-hash'], ownerType: args.type, ownerId: args.id, rank: args.rank ? Number(args.rank) : null, signal: args.signal }));
  if (group === 'memory' && action === 'eval-add') return io.json(core.memory.addEvalCase({ caseId: args.id, query: args.query, expectedOwnerIds: String(args.expected || '').split(',').filter(Boolean), tags: args.tags ? String(args.tags).split(',') : [] }));
  if (group === 'memory' && action === 'eval-list') return io.json({ cases: core.memory.listEvalCases() });
  if (group === 'memory' && action === 'backup') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    return io.json(await core.backupMemory());
  }
  if (group === 'memory' && action === 'backup-key-init') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    return io.json(core.encryptedMemoryBackup.initKey({ confirm: true }));
  }
  if (group === 'memory' && action === 'backup-encrypted') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    return io.json(await core.encryptedMemoryBackup.create());
  }
  if (group === 'memory' && action === 'backup-inspect') return args.input ? io.json(core.encryptedMemoryBackup.inspect(args.input)) : io.error('input is required', EXIT.usage);
  if (group === 'memory' && action === 'backup-verify') return args.input ? io.json(await core.encryptedMemoryBackup.verify(args.input)) : io.error('input is required', EXIT.usage);
  if (group === 'memory' && action === 'backup-compare') return args.input ? io.json(await core.encryptedMemoryBackup.compare(args.input)) : io.error('input is required', EXIT.usage);
  if (group === 'memory' && action === 'recover') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    return io.json(core.encryptedMemoryBackup.recover({ confirm: true }));
  }
  if (group === 'memory' && action === 'restore-encrypted') {
    if (!args.input) return io.error('input is required', EXIT.usage);
    if (!args['confirm-restore']) return io.error('confirm-restore is required', EXIT.blocked);
    return io.json(await core.encryptedMemoryBackup.restore({ input: args.input, confirm: true, allowUninitialized: args['allow-uninitialized'] === true }));
  }
  if (group === 'memory' && action === 'recovery-export') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    if (!args['output-a'] || !args['output-b'] || !args['passphrase-a-file'] || !args['passphrase-b-file']) return io.error('output-a, output-b, passphrase-a-file, and passphrase-b-file are required', EXIT.usage);
    return io.json(core.encryptedMemoryBackup.recoveryExport({ outputA: args['output-a'], outputB: args['output-b'], passphraseAFile: args['passphrase-a-file'], passphraseBFile: args['passphrase-b-file'], confirm: true }));
  }
  if (group === 'memory' && action === 'recovery-drill') {
    if (!args['share-a'] || !args['share-b'] || !args['passphrase-a-file'] || !args['passphrase-b-file']) return io.error('share-a, share-b, passphrase-a-file, and passphrase-b-file are required', EXIT.usage);
    return io.json(await core.encryptedMemoryBackup.recoveryDrill({ shareA: args['share-a'], shareB: args['share-b'], passphraseAFile: args['passphrase-a-file'], passphraseBFile: args['passphrase-b-file'], input: args.input }));
  }
  if (group === 'memory' && action === 'recovery-import') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    if (!args['share-a'] || !args['share-b'] || !args['passphrase-a-file'] || !args['passphrase-b-file']) return io.error('share-a, share-b, passphrase-a-file, and passphrase-b-file are required', EXIT.usage);
    return io.json(core.encryptedMemoryBackup.recoveryImport({ shareA: args['share-a'], shareB: args['share-b'], passphraseAFile: args['passphrase-a-file'], passphraseBFile: args['passphrase-b-file'], confirm: true, replace: args.replace === true }));
  }
  if (group === 'memory' && action === 'recovery-rotate') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    const required = ['current-share-a','current-share-b','current-passphrase-a-file','current-passphrase-b-file','new-output-a','new-output-b','new-passphrase-a-file','new-passphrase-b-file'];
    if (required.some(key => !args[key])) return io.error(`${required.join(', ')} are required`, EXIT.usage);
    return io.json(await core.encryptedMemoryBackup.recoveryRotate({ confirm: true, currentRecovery: { shareA: args['current-share-a'], shareB: args['current-share-b'], passphraseAFile: args['current-passphrase-a-file'], passphraseBFile: args['current-passphrase-b-file'] }, newRecovery: { outputA: args['new-output-a'], outputB: args['new-output-b'], passphraseAFile: args['new-passphrase-a-file'], passphraseBFile: args['new-passphrase-b-file'] } }));
  }
  if (group === 'harness' && action === 'cycle') return io.json(core.memoryHarness.cycle());
  if (group === 'harness' && action === 'candidates') return io.json({ candidates: core.memoryHarness.candidates() });
  if (group === 'hosts' && (!action || action === 'list')) return io.json({ hosts: core.hosts.list() });
  if (group === 'embeddings' && (!action || action === 'status')) return io.json(core.embeddings.status());
  if (group === 'embeddings' && action === 'recommend') return io.json(core.embeddings.recommend(args.profile || 'zh-light'));
  if (group === 'embeddings' && action === 'configure') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    if (!args.model) return io.error('model is required', EXIT.usage);
    return io.json(core.embeddings.configure({ model: args.model, endpoint: args.endpoint, dimensions: args.dimensions, batchSize: args['batch-size'], confirm: true }));
  }
  if (group === 'embeddings' && action === 'mark-indexed') {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    if (!args.manifest) return io.error('manifest is required', EXIT.usage);
    return io.json(core.embeddings.markIndexed({ manifestPath: args.manifest, confirm: true }));
  }
  if (group === 'embeddings' && action === 'doctor') return io.json(await core.embeddings.doctor());
  if (group === 'embeddings' && action === 'probe') return io.json(await core.embeddings.probe({ text: args.text }));
  if (group === 'embeddings' && action === 'pull') {
    if (!args['confirm-download']) return io.error('confirm-download is required', EXIT.blocked);
    return io.json(core.embeddings.pull({ model: args.model, confirm: true }));
  }
  if (group === 'embeddings' && action === 'prompt') return io.json({ prompt: core.embeddings.adaptationPrompt() });
  if (group === 'hooks' && (!action || action === 'doctor')) return io.json(doctorHooks({ projectRoot, pluginRoot }));
  if (group === 'hooks' && ['enable', 'disable'].includes(action)) {
    if (!args.confirm) return io.error('confirm is required', EXIT.blocked);
    return io.json(setProjectHooks({ projectRoot, pluginRoot, enabled: action === 'enable', confirm: true }));
  }
  if (group === 'migrate' && action === 'inventory') {
    if (!args['brain-root']) return io.error('brain-root is required', EXIT.usage);
    return io.json(inventoryLegacy({ brainRoot: args['brain-root'], outputRoot: args['output-root'] || paths.migrationRoot }));
  }
  if (group === 'migrate' && action === 'apply') {
    if (!args['confirm-migration']) return io.error('confirm-migration is required', EXIT.blocked);
    if (!args.manifest || !args['backup-root'] || !args['brain-root']) return io.error('manifest, backup-root, and brain-root are required', EXIT.usage);
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const plan = planMigration(manifest, {
      sourceRoot: args['brain-root'],
      outputRoot: args['output-root'] || paths.migrationRoot,
      rebuild: true,
    });
    return io.json(applyMigration(plan, { confirm: true, backupRoot: args['backup-root'] }));
  }
  if (group === 'migrate' && action === 'backup') {
    if (!args['confirm-backup']) return io.error('confirm-backup is required', EXIT.blocked);
    if (!args.manifest || !args['backup-root'] || !args['brain-root']) return io.error('manifest, backup-root, and brain-root are required', EXIT.usage);
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const plan = planMigration(manifest, {
      sourceRoot: args['brain-root'],
      outputRoot: args['output-root'] || paths.migrationRoot,
      rebuild: true,
    });
    return io.json(createMigrationBackup(plan, args['backup-root'], { confirm: true }));
  }
  if (group === 'config' && (!action || action === 'show')) return io.json(core.config);
  if (group === 'mcp' && action === 'serve') {
    if (!services.serveMcp) return io.error('MCP server unavailable', EXIT.failed);
    await services.serveMcp(core);
    return EXIT.ok;
  }
  return io.error('unknown command', EXIT.usage);
}

module.exports = { EXIT, commandGuide, flags, readTaskContractFile, runCli };
