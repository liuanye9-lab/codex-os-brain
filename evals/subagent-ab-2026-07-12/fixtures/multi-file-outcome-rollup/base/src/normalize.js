'use strict';

function normalizeEvent(event) {
  return {
    taskId: String(event.taskId),
    timestamp: String(event.timestamp),
    phase: event.phase || 'child',
    verifierPassed: event.verifierPassed === true,
    finalDelivered: event.finalDelivered === true,
    infrastructureFailure: event.infrastructureFailure === true,
  };
}

module.exports = { normalizeEvent };
