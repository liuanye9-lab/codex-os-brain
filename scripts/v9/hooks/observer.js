'use strict';
const { additionalContext } = require('./input');

async function handleObservation(input, core) {
  const failed = input.toolResult?.ok === false || input.toolResult?.success === false || Boolean(input.errorType);
  if (!failed) {
    core.events.append({ kind: 'tool', taskId: input.taskId, turnId: input.turnId, status: 'passed' });
    return {};
  }
  const result = core.failures.record({ errorType: input.errorType, operation: input.toolName });
  core.events.append({ kind: 'failure', taskId: input.taskId, turnId: input.turnId, status: 'failed', signature: result.failure?.signature });
  if (result.state.status !== 'open') return {};
  return { ...additionalContext('Repeated identical failure detected. Stop retrying; verify assumptions or change strategy.', input.event), reason_code: 'repeated_failure_circuit_open' };
}

module.exports = { handleObservation };
