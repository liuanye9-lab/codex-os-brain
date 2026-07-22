'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createV9Core } = require('./core');
const { resolveV9Paths } = require('./paths');
const { doctorHooks, setProjectHooks } = require('./hook-config');
const { inventoryLegacy, planMigration, applyMigration } = require('./migration');

const EXIT = Object.freeze({ ok: 0, usage: 2, blocked: 3, failed: 4 });

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

async function runCli(argv, io = defaultIo(), services = {}) {
  const args = flags(argv);
  const [group, action] = args._;
  const paths = services.paths || resolveV9Paths();
  const core = services.core || createV9Core({ paths });
  const pluginRoot = services.pluginRoot || path.resolve(__dirname, '..', '..');
  const projectRoot = args.project || process.cwd();

  if (group === 'status') return io.json(core.status());
  if (group === 'doctor') return io.json({
    v8: { selectable: core.config.fallbackVersion === 8 },
    v9: core.status(),
    hooks: doctorHooks({ projectRoot }),
    cli: { binaries: ['brain', 'codex-brain'] },
    mcp: { probeCommand: 'brain:v9:mcp:probe' },
    hosts: core.hosts.list(),
    handoff: core.handoff.statusHandoff({ projectRoot }),
  });
  if (group === 'task' && action === 'create') {
    if (!args.objective) return io.error('objective is required', EXIT.usage);
    const criteria = args.criterion ? String(args.criterion).split(',').map(id => ({
      id,
      required: true,
      verifier: id === 'tests' ? 'test_runner' : id === 'scope' ? 'git_diff_bounded' : 'command_exit_0',
      verifierSpec: id === 'tests' ? { command: args.command || 'npm test' } : undefined,
    })) : [];
    return io.json(core.contracts.create({
      taskId: args['task-id'],
      objective: args.objective,
      criteria,
      risk: args.risk,
      externalWrite: args['external-write'] === true,
      scope: {
        allowed: args.allowed ? String(args.allowed).split(',') : [],
        forbidden: args.forbidden ? String(args.forbidden).split(',') : [],
      },
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
    return io.json(core.memory.createMemory({ content: args.content, kind: args.kind, confidence: args.confidence, privacy: args.privacy, sourceUri: args.source, idempotencyKey: args['idempotency-key'], actor: args.actor }));
  }
  if (group === 'memory' && action === 'get') {
    if (!args.id) return io.error('id is required', EXIT.usage);
    const item = core.memory.getMemory(args.id);
    return item ? io.json(item) : io.error('memory not found', EXIT.failed);
  }
  if (group === 'memory' && action === 'update') {
    if (!args.id || !args['expected-version']) return io.error('id and expected-version are required', EXIT.usage);
    return io.json(core.memory.updateMemory(args.id, { content: args.content, expectedVersion: Number(args['expected-version']), approvedBy: args['approved-by'], idempotencyKey: args['idempotency-key'] }));
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
    return io.json({ ...core.memory.search({ query: args.query, queryVector, limit: args.limit, includeCandidates: args['include-candidates'] === true }), embedding });
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
  if (group === 'hooks' && (!action || action === 'doctor')) return io.json(doctorHooks({ projectRoot }));
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
    if (!args.manifest || !args['backup-root']) return io.error('manifest and backup-root are required', EXIT.usage);
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    return io.json(applyMigration(planMigration(manifest), { confirm: true, backupRoot: args['backup-root'] }));
  }
  if (group === 'config' && (!action || action === 'show')) return io.json(core.config);
  if (group === 'mcp' && action === 'serve') {
    if (!services.serveMcp) return io.error('MCP server unavailable', EXIT.failed);
    await services.serveMcp();
    return EXIT.ok;
  }
  return io.error('unknown command', EXIT.usage);
}

module.exports = { EXIT, flags, runCli };
