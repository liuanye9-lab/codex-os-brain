'use strict';

const crypto = require('node:crypto');

function taskId(input) {
  if (input.taskId) return String(input.taskId);
  return `task_${crypto.createHash('sha256').update(String(input.objective || '')).digest('hex').slice(0, 16)}`;
}

function createTaskContract(input = {}) {
  return {
    schemaVersion: 9,
    revision: Number(input.revision || 1),
    taskId: taskId(input),
    objective: String(input.objective || ''),
    lifecycle: input.lifecycle || 'active',
    constraints: (input.constraints || []).map(item => ({ ...item })),
    scope: { allowed: [], forbidden: [], ...(input.scope || {}) },
    criteria: (input.criteria || []).map(item => ({ status: 'pending', required: true, evidence: [], ...item })),
    unresolved: [...(input.unresolved || [])],
    risk: ['low', 'medium', 'high', 'critical'].includes(input.risk) ? input.risk : 'low',
    externalWrite: input.externalWrite === true,
    compactionGeneration: Number(input.compactionGeneration || 0),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function applyContractPatch(contract, patch = {}) {
  const explicit = new Map(contract.constraints.filter(item => item.explicit).map(item => [item.id, item]));
  for (const candidate of patch.constraints || []) {
    const current = explicit.get(candidate.id);
    if (current && (!candidate.explicit || candidate.text !== current.text)) {
      throw new Error('explicit_constraint_conflict');
    }
  }
  const mergedConstraints = new Map(contract.constraints.map(item => [item.id, { ...item }]));
  for (const item of patch.constraints || []) mergedConstraints.set(item.id, { ...item });
  return {
    ...contract,
    ...patch,
    taskId: contract.taskId,
    schemaVersion: 9,
    revision: Number(contract.revision || 1) + 1,
    constraints: [...mergedConstraints.values()],
    scope: { ...contract.scope, ...(patch.scope || {}) },
    criteria: patch.criteria ? patch.criteria.map(item => ({ ...item })) : contract.criteria.map(item => ({ ...item, evidence: [...(item.evidence || [])] })),
    unresolved: patch.unresolved ? [...patch.unresolved] : [...contract.unresolved],
    compactionGeneration: contract.compactionGeneration + (patch.compacted === true ? 1 : 0),
    updatedAt: new Date().toISOString(),
    compacted: undefined,
  };
}

module.exports = { applyContractPatch, createTaskContract };
