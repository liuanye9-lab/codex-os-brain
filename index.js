import taskContract from './scripts/brain-lite-task-contract.js';
import contextEconomy from './scripts/brain-lite-context-economy.js';
import traceV2 from './scripts/brain-lite-trace-v2.js';
import policyLab from './scripts/brain-lite-policy-lab.js';
import outcomeAttribution from './scripts/brain-lite-outcome-attribution.js';
import indexHealth from './scripts/brain-lite-index-health.js';
import v8Review from './scripts/brain-lite-v8-review.js';
import behavioralMemory from './scripts/brain-lite-behavioral-memory.js';
import behavioralPolicy from './scripts/brain-lite-behavioral-policy.js';
import v9Core from './scripts/v9/core.js';
import v9CognitiveAssets from './scripts/v9/cognitive-assets.js';
import v9Doctor from './scripts/v9/doctor.js';
import v9EvidenceSeal from './scripts/v9/evidence-seal.js';
import v9HookConfig from './scripts/v9/hook-config.js';
import v9Policy from './scripts/v9/policy.js';
import v9TaskContract from './scripts/v9/task-contract.js';
import v9TrustBoundary from './scripts/v9/trust-boundary.js';
import v9Verification from './scripts/v9/verification.js';
import v9Verifiers from './scripts/v9/verifiers/index.js';

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
  v9Core,
  v9CognitiveAssets,
  v9Doctor,
  v9EvidenceSeal,
  v9HookConfig,
  v9Policy,
  v9TaskContract,
  v9TrustBoundary,
  v9Verification,
  v9Verifiers,
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
  v9: Object.freeze({
    core: v9Core,
    cognitiveAssets: v9CognitiveAssets,
    doctor: v9Doctor,
    evidenceSeal: v9EvidenceSeal,
    hookConfig: v9HookConfig,
    policy: v9Policy,
    taskContract: v9TaskContract,
    trustBoundary: v9TrustBoundary,
    verification: v9Verification,
    verifiers: v9Verifiers,
  }),
});
