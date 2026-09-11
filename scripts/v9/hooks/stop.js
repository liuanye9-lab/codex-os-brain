'use strict';
const { blockDecision } = require('./input');
const { clearStopGate, evaluateStopGate } = require('../stop-gate');
const { projectScopeId } = require('../paths');

async function handleStop(input, core) {
  if (!input.completionClaim) return {};
  const taskState = core.contracts?.state?.();
  if (taskState?.expected && (!taskState.contract || taskState.missing || taskState.corrupt)) {
    return blockDecision(
      'active_contract_missing',
      'Completion paused because an active task guard exists but its signed contract is missing or corrupt.',
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

  const projectRoot = input.projectRoot || process.cwd();
  const activeContract = (() => {
    try { return core.contracts.active(); } catch { return null; }
  })();
  const gateScope = {
    paths: core.paths,
    projectScope: projectScopeId(projectRoot),
    taskId: activeContract?.taskId,
    blockCap: core.config?.stopGate?.blockCap,
    stallLimit: core.config?.stopGate?.stallLimit,
  };

  if (result.status === 'complete') {
    // Genuine pass: return the full block budget to the next task.
    try { clearStopGate(gateScope); } catch { /* optional */ }
    try {
      if (activeContract && core.handoff?.writeProgress) {
        core.handoff.writeProgress({
          projectRoot,
          taskId: activeContract.taskId,
          objective: activeContract.objective,
          sessionSummary: 'Stop accepted: all required criteria harness-verified.',
        });
      }
    } catch { /* optional */ }
    return {};
  }

  const remaining = [...(result.missing || []), ...(result.failed || []), ...(result.unverified || [])];

  // The gate may hold a session only while it is still making a difference. The escape valve
  // depends on a readable ledger; when the ledger itself is unavailable we cannot know whether the
  // cap was reached, and Stop is a declared fail-closed event, so we keep blocking rather than
  // let an unwritable state directory become a way to switch the gate off.
  let gate = { allowBlock: true };
  if (core.paths?.stopGateRoot) {
    try {
      gate = evaluateStopGate({ ...gateScope, remaining });
    } catch {
      gate = { allowBlock: true, ledgerUnavailable: true };
    }
  }

  if (!gate.allowBlock) {
    // Released, not passed. Say so plainly: the work is still unverified.
    try {
      if (activeContract && core.handoff?.writeProgress) {
        core.handoff.writeProgress({
          projectRoot,
          taskId: activeContract.taskId,
          objective: activeContract.objective,
          sessionSummary: `Stop released WITHOUT verification (${gate.releaseReason}); unverified: ${remaining.join(', ') || 'unknown'}.`,
        });
      }
    } catch { /* optional */ }
    return {};
  }

  const budget = typeof gate.remainingBlocks === 'number'
    ? ` Gate attempt ${gate.blocks}/${gate.blockCap}; it will stop blocking after ${gate.remainingBlocks} more.`
    : '';
  return blockDecision(
    'completion_unverified',
    `Required criteria remain unverified by harness re-run: ${remaining.join(', ') || 'unknown'}. Agent self-claims do not count.${budget}`,
  );
}

module.exports = { handleStop };
