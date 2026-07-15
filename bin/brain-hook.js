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
  const core = createV9Core({ config });
  const hostName = process.env.BRAIN_HOST || input.host || 'codex';
  const adapter = getHostAdapter(hostName);

  const bind = handler => value => handler(value, core);
  const handlers = {
    SessionStart: bind(handleSession),
    PostCompact: bind(handleSession),
    PreCompact: bind(handleSession),
    PreToolUse: bind(handleRisk),
    PostToolUse: bind(handleObservation),
    Stop: bind(handleStop),
    UserPromptSubmit: async () => ({}),
  };

  const enabled = process.env.BRAIN_V9_HOOKS === '1' || config.hooks?.enabled === true;
  const output = await adapter.handle(input, async normalized => dispatchHook(normalized, {
    enabled,
    handlers,
    failClosedEvents: new Set(['PreToolUse', 'Stop']),
    auditInternalError() {},
  }));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
