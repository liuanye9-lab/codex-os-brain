#!/usr/bin/env node
'use strict';

async function main() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65_536) {
      process.stderr.write('hook input exceeds 65536 bytes\n');
      process.exitCode = 2;
      return;
    }
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { process.stderr.write('invalid hook JSON\n'); process.exitCode = 2; return; }

  const event = String(input.hook_event_name || input.hookEventName || input.event || '');
  if (event === 'UserPromptSubmit') {
    process.stdout.write('{}\n');
    return;
  }

  const fs = require('node:fs');
  const { readV9Config } = require('../scripts/v9/config');
  const config = readV9Config(process.env.BRAIN_V9_CONFIG);
  const enabled = process.env.BRAIN_V9_HOOKS === '1' || config.hooks?.enabled === true;
  if (!enabled) {
    process.stdout.write('{}\n');
    return;
  }
  const projectRoot = input.project_root || input.projectRoot || input.cwd || process.cwd();
  if (['PreToolUse', 'PermissionRequest', 'Stop'].includes(event)) {
    const { resolveV9Paths, scopeV9Paths } = require('../scripts/v9/paths');
    const basePaths = resolveV9Paths();
    const runtimePaths = config.hooks?.projectScoped === false ? basePaths : scopeV9Paths(basePaths, projectRoot);
    if (!fs.existsSync(runtimePaths.controlGuardPath)) {
      let activeTaskMayExist = fs.existsSync(runtimePaths.controlDbPath);
      if (activeTaskMayExist) {
        try {
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(runtimePaths.controlDbPath, { readOnly: true });
          try {
            const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_contracts'").get();
            activeTaskMayExist = Boolean(table && db.prepare('SELECT 1 FROM task_contracts WHERE active=1 LIMIT 1').get());
          } finally { db.close(); }
        } catch {
          activeTaskMayExist = true;
        }
      }
      if (!activeTaskMayExist) {
        process.stdout.write('{}\n');
        return;
      }
    }
  }

  const { createV9Core } = require('../scripts/v9/core');
  const { dispatchHook } = require('../scripts/v9/hook-dispatch');
  const { handleSession } = require('../scripts/v9/hooks/session');
  const { handleRisk } = require('../scripts/v9/hooks/risk');
  const { handleLifecycle } = require('../scripts/v9/hooks/lifecycle');
  const { handleObservation } = require('../scripts/v9/hooks/observer');
  const { handleStop } = require('../scripts/v9/hooks/stop');
  const { getHostAdapter } = require('../scripts/v9/hosts');

  const core = createV9Core({
    config,
    projectRoot,
    sessionId: input.session_id || input.sessionId || input.thread_id || input.threadId,
    taskId: input.task_id || input.taskId,
  });
  const hostName = process.env.BRAIN_HOST || input.host || 'codex';
  const adapter = getHostAdapter(hostName);

  const bind = handler => value => handler(value, core);
  const handlers = {
    SessionStart: bind(handleSession),
    SessionEnd: bind(handleLifecycle),
    PostCompact: bind(handleSession),
    PreCompact: bind(handleSession),
    PreToolUse: bind(handleRisk),
    PostToolUse: bind(handleObservation),
    PermissionRequest: bind(handleRisk),
    SubagentStart: bind(handleLifecycle),
    SubagentStop: bind(handleLifecycle),
    Stop: bind(handleStop),
  };

  const output = await adapter.handle(input, async normalized => dispatchHook(normalized, {
    enabled,
    handlers,
    failClosedEvents: new Set(['PreToolUse', 'PermissionRequest', 'Stop']),
    auditInternalError(event, error) {
      const reasonCode = String(error?.code || 'hook_internal_error').slice(0, 80);
      try {
        core.events.append({
          kind: 'checkpoint',
          status: 'failed',
          reasonCode,
        });
      } catch {
        process.stderr.write(`brain_hook_degraded:${event}:${reasonCode}\n`);
      }
    },
  }));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
