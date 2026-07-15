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
  if (group === 'memory' && (!action || action === 'list')) return io.json({ entries: core.memory.list() });
  if (group === 'memory' && action === 'add') {
    if (!args.text) return io.error('text is required', EXIT.usage);
    return io.json(core.memory.add({
      text: args.text,
      source: args.source || 'cli',
      confidence: args.confidence ? Number(args.confidence) : 0.5,
      tags: args.tags ? String(args.tags).split(',') : [],
    }));
  }
  if (group === 'memory' && action === 'recall') {
    const entries = core.memory.recall({ query: args.query || '', limit: args.limit ? Number(args.limit) : 5 });
    return io.json({ entries, injection: core.memory.formatForInjection(entries) });
  }
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
