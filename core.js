import v9Core from './scripts/v9/core.js';
import v9Doctor from './scripts/v9/doctor.js';
import v9EvidenceSeal from './scripts/v9/evidence-seal.js';
import v9HookConfig from './scripts/v9/hook-config.js';
import v9Policy from './scripts/v9/policy.js';
import v9TaskContract from './scripts/v9/task-contract.js';
import v9TrustBoundary from './scripts/v9/trust-boundary.js';
import v9Verification from './scripts/v9/verification.js';
import v9Verifiers from './scripts/v9/verifiers/index.js';

export {
  v9Core,
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
  core: v9Core,
  doctor: v9Doctor,
  evidenceSeal: v9EvidenceSeal,
  hookConfig: v9HookConfig,
  policy: v9Policy,
  taskContract: v9TaskContract,
  trustBoundary: v9TrustBoundary,
  verification: v9Verification,
  verifiers: v9Verifiers,
});
