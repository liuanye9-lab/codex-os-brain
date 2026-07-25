import taskContract from './scripts/brain-lite-task-contract.js';
import contextEconomy from './scripts/brain-lite-context-economy.js';
import traceV2 from './scripts/brain-lite-trace-v2.js';
import policyLab from './scripts/brain-lite-policy-lab.js';
import outcomeAttribution from './scripts/brain-lite-outcome-attribution.js';
import indexHealth from './scripts/brain-lite-index-health.js';
import v8Review from './scripts/brain-lite-v8-review.js';
import behavioralMemory from './scripts/brain-lite-behavioral-memory.js';
import behavioralPolicy from './scripts/brain-lite-behavioral-policy.js';

export {
  behavioralMemory,
  behavioralPolicy,
  contextEconomy,
  indexHealth,
  outcomeAttribution,
  policyLab,
  taskContract,
  traceV2,
  v8Review,
};

export default Object.freeze({
  taskContract,
  contextEconomy,
  traceV2,
  policyLab,
  outcomeAttribution,
  indexHealth,
  v8Review,
  behavioralMemory,
  behavioralPolicy,
});
