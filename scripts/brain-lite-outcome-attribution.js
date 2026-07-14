'use strict';

function divide(numerator, denominator) { return denominator > 0 ? numerator / denominator : null; }

function traceOutcome(events) {
  const verifierEvents = events.filter((event) => typeof event.verifierPassed === 'boolean');
  const verifier = verifierEvents.at(-1);
  return {
    verified: Boolean(verifier),
    passed: Boolean(verifier && verifier.verifierPassed === true && verifier.finalDelivered !== false),
    corrected: events.some((event) => event.userCorrected === true),
    falseGreen: events.some((event) => event.modelClaimedSuccess === true && event.verifierPassed === false),
  };
}

function decisionFor(item, policy) {
  if (item.distinctTasks < Number(policy.minimumDistinctTasks || 5)) return 'insufficient-evidence';
  if (item.verifierCoverage < Number(policy.minimumVerifierCoverage || 0.8)) return 'insufficient-verification';
  if (item.passRate < Number(policy.qualityFloor || 0.8) || item.correctionRate > Number(policy.correctionRateCeiling || 0.2) || item.falseGreenTasks > 0) return 'review-candidate';
  return 'retain';
}

function attributeOutcomes(events = [], policy = {}) {
  const traces = new Map();
  for (const [index, event] of events.entries()) {
    const traceId = event.traceId || `trace-missing-${index}`;
    if (!traces.has(traceId)) traces.set(traceId, []);
    traces.get(traceId).push(event);
  }

  const subjects = new Map();
  const remember = (subjectType, subjectId, taskId, outcome) => {
    const key = `${subjectType}:${subjectId}`;
    if (!subjects.has(key)) subjects.set(key, { subjectType, subjectId, tasks: new Map() });
    subjects.get(key).tasks.set(taskId, outcome);
  };

  for (const [traceId, traceEvents] of traces) {
    const taskId = traceEvents.find((event) => event.taskId)?.taskId || traceId;
    const outcome = traceOutcome(traceEvents);
    const evidenceIds = new Set(traceEvents.flatMap((event) => Array.isArray(event.evidenceIds) ? event.evidenceIds : []).filter((id) => /^ev_[a-f0-9]{20}$/.test(id)));
    const skillIds = new Set(traceEvents.flatMap((event) => Array.isArray(event.skillIds) ? event.skillIds : []).filter((id) => /^sk_[a-f0-9]{20}$/.test(id)));
    for (const id of evidenceIds) remember('evidence', id, taskId, outcome);
    for (const id of skillIds) remember('skill', id, taskId, outcome);
  }

  const automaticLifecycleChange = policy.automaticLifecycleChanges === true;
  const items = [...subjects.values()].map((subject) => {
    const outcomes = [...subject.tasks.values()];
    const distinctTasks = outcomes.length;
    const verifiedTasks = outcomes.filter((outcome) => outcome.verified).length;
    const passedTasks = outcomes.filter((outcome) => outcome.passed).length;
    const correctedTasks = outcomes.filter((outcome) => outcome.corrected).length;
    const falseGreenTasks = outcomes.filter((outcome) => outcome.falseGreen).length;
    const item = {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      distinctTasks,
      verifiedTasks,
      passedTasks,
      correctedTasks,
      falseGreenTasks,
      verifierCoverage: divide(verifiedTasks, distinctTasks),
      passRate: divide(passedTasks, verifiedTasks),
      correctionRate: divide(correctedTasks, distinctTasks),
      automaticLifecycleChange,
    };
    item.decision = decisionFor(item, policy);
    return item;
  }).sort((left, right) => left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId));

  const decisions = ['insufficient-evidence', 'insufficient-verification', 'review-candidate', 'retain'];
  const summary = { total: items.length };
  for (const decision of decisions) summary[decision] = items.filter((item) => item.decision === decision).length;
  return { schemaVersion: 1, automaticLifecycleChanges: automaticLifecycleChange, items, summary };
}

module.exports = { attributeOutcomes, decisionFor, traceOutcome };
