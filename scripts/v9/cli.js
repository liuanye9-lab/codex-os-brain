'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createV9Core, readV9Config } = require('./core');
const { resolveV9Paths } = require('./paths');
const { doctorHooks, setProjectHooks } = require('./hook-config');
const { inventoryLegacy, planMigration, applyMigration } = require('./migration');
const { runEvidenceSigningLoop } = require('./doctor');
const { inspectTrustBoundary } = require('./trust-boundary');
const { IDENTITY } = require('./identity');
const { collectProjectScopes } = require('./scope-gc');

const EXIT = Object.freeze({ ok: 0, usage: 2, blocked: 3, failed: 4 });

function commandGuide() {
  return {
    name: `Codex Brain V${IDENTITY.productMajor}`,
    usage: 'brain <command> [action] [--flags] [--json]',
    startHere: [
      'brain doctor --json',
      'brain adopt --json',
      'brain task create --task-id demo --objective "ship safely" --criterion tests --json',
      'brain verify --json',
      'brain hooks enable --project "$PWD" --confirm --json',
    ],
    commands: {
      status: 'Read runtime status.',
      adopt: 'Put the current directory under the harness so the gates apply here.',
      gc: 'Report project state folders; --confirm reclaims only those whose project is gone.',
      doctor: 'Check environment, hooks, and a temporary signed-evidence round trip. May initialize an OS-local evidence key.',
      task: 'create | show | checkpoint',
      verify: 'Re-run executable acceptance criteria.',
      failures: 'Show operations that keep failing in this project.',
      evidence: 'claim | attach',
      handoff: 'init | status | progress',
      fanout: 'assess | register | claim | complete | reclaim | status',
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
  if (!String(value.objective || '').trim()) throw new Error('task_contract_objective_required');
  if (value.criteria !== undefined && !Array.isArray(value.criteria)) throw new Error('task_contract_criteria_invalid');
  return value;
}

async function runCli(argv, io = defaultIo(), services = {}) {
  const args = flags(argv);
  const [group, action] = args._;
  const paths = services.paths || resolveV9Paths();
  const projectRoot = args.project || process.cwd();
  const config = structuredClone(readV9Config());
  if (args['enable-memory'] === true || args['enable-cognitive-assets'] === true) {
    return io.error('memory and cognitive-asset layers were removed in V11; Codex native memories own recall', EXIT.usage);
  }
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
  if (group === 'adopt') {
    // Measured on this machine: five real Codex sessions, none of them in a managed
    // directory, so every gate was installed and inert. The cause is policy.evaluateAction
    // returning level 0 when there is no contract -- "managed" means a contract exists, and
    // creating one took a task id, an objective and a criterion nobody types before starting
    // work. This makes the common case one word.
    const existing = core.contracts.active();
    if (existing && args.force !== true) {
      return io.json({
        adopted: false,
        reason: 'already_managed',
        projectRoot,
        taskId: existing.taskId,
        objective: existing.objective,
        hint: 'This directory already has an active contract. Use --force to replace it.',
      });
    }
    const hasTests = (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        return Boolean(pkg?.scripts?.test);
      } catch { return false; }
    })();
    // Only claim a criterion the project can actually satisfy. Adopting a directory with no
    // test script onto a `tests` criterion would block every completion on a verifier that
    // can never pass, which teaches you to bypass the harness.
    const criteria = hasTests
      ? [{ id: 'tests', required: true, verifier: 'test_runner', verifierSpec: { executable: 'npm', args: ['test'] } }]
      : [{ id: 'scope', required: true, verifier: 'git_diff_bounded' }];
    const created = core.contracts.create({
      taskId: args['task-id'] || `adopt-${Date.now().toString(36)}`,
      objective: args.objective || `Ongoing work in ${path.basename(projectRoot)}`,
      criteria,
      scope: { allowed: [], forbidden: [] },
    });
    return io.json({
      adopted: true,
      projectRoot,
      taskId: created.taskId,
      criterion: criteria[0].id,
      criterionReason: hasTests
        ? 'package.json declares a test script'
        : 'no test script found; scope containment is the only criterion that can pass here',
      gatesNowActive: ['PreToolUse destructive-write denial', 'Stop completion verification'],
    });
  }
  if (group === 'gc') {
    // Scope folders are named by a one-way hash of the project path, so state from deleted
    // projects used to be unattributable and unreclaimable. Only folders whose recorded
    // project is provably gone are removed; folders with no marker are reported, never
    // deleted, because guessing wrong destroys a contract that is currently guarding work.
    const report = collectProjectScopes({
      runtimeRoot: resolveV9Paths().runtimeRoot,
      confirm: args.confirm === true,
    });
    return io.json(report);
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
      v8: { selectable: core.config.fallbackVersion === 8 },
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
    } else {
      if (!args.objective) return io.error('objective is required', EXIT.usage);
      const criterionIds = args.criterion ? String(args.criterion).split(',') : [];
      // Built-in verifiers are harness code, not caller-supplied shell, so they need no approval.
      // Only a criterion that runs an arbitrary command is "custom".
      const customIds = criterionIds.filter(id => !['tests', 'scope', 'governance'].includes(id));
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
        if (id === 'governance') {
          return {
            id, required: true, verifier: 'manifest_gate',
            verifierSpec: args.manifest ? { manifest: args.manifest } : {},
          };
        }
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
  if (group === 'failures') {
    // Session-scoped status answers "is this session stuck in a retry loop", which is
    // rarely what someone typing this command wants. The useful question is what keeps
    // failing in this project, so the default is project-wide; --session narrows it.
    if (args.session === true) return io.json(core.failures.status());
    return io.json(core.failures.projectHistory({ minConsecutive: 1, limit: 20 }));
  }
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
  if (group === 'fanout' && (!action || action === 'status')) {
    return io.json(core.fanout.status({
      planId: args.plan || 'default',
      ...(args['lease-ms'] === undefined ? {} : { leaseMs: Number(args['lease-ms']) }),
    }));
  }
  if (group === 'fanout' && action === 'reclaim') {
    // Units held by a worker that never came back. Reclaiming is deliberate rather than automatic
    // on read, so an operator decides when a slow worker is treated as dead.
    return io.json(core.fanout.reclaim({
      planId: args.plan || 'default',
      ...(args['lease-ms'] === undefined ? {} : { leaseMs: Number(args['lease-ms']) }),
    }));
  }
  if (group === 'fanout' && action === 'assess') {
    // Decide by task shape, never by preference for more agents.
    //
    // Shared context is two different situations wearing one name. A style guide or schema every
    // unit reads can be copied into each dispatch for free; an index every unit writes to is real
    // coupling. `--shared-readonly` says the shared thing is not written to, which is why a
    // thousand independent units are not dragged back onto one agent by a constant.
    const isolated = args['isolated-context'] === true;
    const sharedReadonly = args['shared-readonly'] === true;
    return io.json(core.fanout.assessSplit({
      units: Number(args.units || 0),
      crossUnitDependency: args['independent-units'] !== true,
      sharedContextRequired: !(isolated || sharedReadonly),
      sharedContextMutable: sharedReadonly ? false : null,
      orderDependent: args['order-dependent'] === true,
      exceedsSingleContext: args['exceeds-context'] === true,
      perUnitVerifiable: args['per-unit-verifiable'] === true,
    }));
  }
  if (group === 'fanout' && action === 'register') {
    const units = String(args.units || args._[2] || '').split(',').map(value => value.trim()).filter(Boolean);
    if (units.length === 0) return io.error('units is required (comma separated)', EXIT.usage);
    return io.json(core.fanout.register({ planId: args.plan || 'default', units: units.map(id => ({ id, label: id })) }));
  }
  if (group === 'fanout' && action === 'claim') {
    if (!args.worker) return io.error('worker is required', EXIT.usage);
    return io.json(core.fanout.claim({ planId: args.plan || 'default', worker: args.worker, limit: Number(args.limit || 1) }));
  }
  if (group === 'fanout' && action === 'complete') {
    if (!args.unit) return io.error('unit is required', EXIT.usage);
    // Verified status is a harness fact; the CLI may only pass through a verifier reference.
    if (args.verified === true && !args['verifier-ref']) {
      return io.error('--verified requires --verifier-ref from a harness check', EXIT.usage);
    }
    return io.json(core.fanout.complete({
      planId: args.plan || 'default',
      unitId: args.unit,
      worker: args.worker,
      verified: args.verified === true,
      verifierRef: args['verifier-ref'] || null,
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
  if (group === 'hosts' && (!action || action === 'list')) return io.json({ hosts: core.hosts.list() });
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
    if (!args.manifest || !args['backup-root']) return io.error('manifest and backup-root are required', EXIT.usage);
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    return io.json(applyMigration(planMigration(manifest), { confirm: true, backupRoot: args['backup-root'] }));
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
