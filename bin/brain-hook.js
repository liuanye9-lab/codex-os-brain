#!/usr/bin/env node
'use strict';

const { createV9Core, readV9Config } = require('../scripts/v9/core');
const { dispatchHook } = require('../scripts/v9/hook-dispatch');
const { handleSession } = require('../scripts/v9/hooks/session');
const { handleRisk } = require('../scripts/v9/hooks/risk');
const { handleObservation } = require('../scripts/v9/hooks/observer');
const { handleStop } = require('../scripts/v9/hooks/stop');
const { getHostAdapter } = require('../scripts/v9/hosts');

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { process.stderr.write('invalid hook JSON\n'); process.exitCode = 2; return; }

  const config = readV9Config(process.env.BRAIN_V9_CONFIG);
  const enabled = process.env.BRAIN_V9_HOOKS === '1' || config.hooks?.enabled === true;
  if (!enabled) {
    process.stdout.write('{}\n');
    return;
  }
  const projectRoot = input.project_root || input.projectRoot || input.cwd || process.cwd();
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
    SessionEnd: bind(handleObservation),
    PostCompact: bind(handleSession),
    PreCompact: bind(handleSession),
    PreToolUse: bind(handleRisk),
    PostToolUse: bind(handleObservation),
    PermissionRequest: bind(handleRisk),
    SubagentStart: bind(handleObservation),
    SubagentStop: bind(handleObservation),
    Stop: bind(handleStop),
    UserPromptSubmit: async () => ({}),
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
