'use strict';
const { blockDecision } = require('./input');

async function handleStop(input, core) {
  if (!input.completionClaim) return {};
  const taskState = core.contracts?.state?.();
  if (taskState?.expected && (!taskState.contract || taskState.missing || taskState.corrupt)) {
    return blockDecision(
      'active_contract_missing',
      'Completion paused because an active task guard exists but its signed contract is missing or corrupt.',
      'Stop',
    );
  }
  if (core.contracts?.active && !core.contracts.active()) return {};

  // Prefer live re-verify when executable specs exist; fall back to stored harness evaluation.
  let result;
  try {
    if (typeof core.verification?.run === 'function' && input.forceVerify === true) {
      result = core.verification.run({ cwd: input.projectRoot || process.cwd() });
    } else {
      result = core.verification.evaluateActive({ requireHarness: true });
    }
  } catch {
    result = {
      status: 'partial',
      missing: [],
      failed: ['verifier_runtime'],
      unverified: [],
    };
  }

  if (result.status === 'complete') {
    try {
      const contract = core.contracts.active();
      if (contract && core.handoff?.writeProgress) {
        core.handoff.writeProgress({
          projectRoot: input.projectRoot || process.cwd(),
          taskId: contract.taskId,
          objective: contract.objective,
          sessionSummary: 'Stop accepted: all required criteria harness-verified.',
        });
      }
    } catch { /* optional */ }
    return {};
  }

  const remaining = [...(result.missing || []), ...(result.failed || []), ...(result.unverified || [])];
  return blockDecision(
    'completion_unverified',
    `Required criteria remain unverified by harness re-run: ${remaining.join(', ') || 'unknown'}. Agent self-claims do not count.`,
    'Stop',
  );
}

module.exports = { handleStop };
