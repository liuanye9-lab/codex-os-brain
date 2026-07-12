'use strict';

const { normalizeEvent } = require('./normalize');

function completedEvents(events) {
  return events.filter((event) => event.infrastructureFailure !== true);
}

function summarize(events) {
  events = completedEvents(events.map(normalizeEvent));
  const latestByTask = new Map();
  for (const event of events) latestByTask.set(event.taskId, event);
  const finals = [...latestByTask.values()];
  return {
    total: finals.length,
    passed: finals.filter((event) => event.verifierPassed && event.finalDelivered).length,
    failed: finals.filter((event) => !(event.verifierPassed && event.finalDelivered)).length,
  };
}

module.exports = { summarize };
