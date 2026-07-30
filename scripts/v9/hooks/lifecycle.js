'use strict';

async function handleLifecycle(input, core) {
  const kind = input.event === 'SessionEnd' ? 'session' : 'subagent';
  core.events.append({
    kind,
    taskId: input.taskId,
    turnId: input.turnId,
    status: 'observed',
    reasonCode: String(input.event || 'lifecycle').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
  });
  return {};
}

module.exports = { handleLifecycle };
