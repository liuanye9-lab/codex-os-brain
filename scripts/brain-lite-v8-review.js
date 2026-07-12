'use strict';
function average(values) { const valid = values.filter((value) => Number.isFinite(value)); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null; }
function countByState(items, states) { return Object.fromEntries(states.map((state) => [state, items.filter((item) => item.state === state).length])); }
function buildV8Review(traceEvents = [], experiments = [], lifecycle = []) {
  return {
    schemaVersion: 1,
    context: { averagePrecision: average(traceEvents.map((event) => event.contextPrecision)), averageUtilization: average(traceEvents.map((event) => event.contextUtilization)) },
    harness: { tokens: traceEvents.reduce((sum, event) => sum + Number(event.harnessTokens || 0), 0), durationMs: traceEvents.reduce((sum, event) => sum + Number(event.harnessDurationMs || 0), 0) },
    verification: { coveredTasks: new Set(traceEvents.filter((event) => typeof event.verifierPassed === 'boolean').map((event) => event.taskId)).size, falseGreen: traceEvents.filter((event) => event.modelClaimedSuccess === true && event.verifierPassed === false).length },
    policies: countByState(experiments, ['insufficient-evidence','trial','stable','rejected','revoked']),
    skills: countByState(lifecycle, ['candidate','shadow','replay','canary','promoted','rejected','revoked']),
  };
}
module.exports = { average, buildV8Review, countByState };
