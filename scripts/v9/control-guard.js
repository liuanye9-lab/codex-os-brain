'use strict';

const fs = require('node:fs');
const { atomicWriteJson, readJsonSafe } = require('./store');

const NAMESPACE = 'codex-brain-v9-active-control-guard';

function unsignedGuard(tasks = {}) {
  return { version: 1, tasks };
}

function createControlGuard({ guardPath, evidenceSealer } = {}) {
  if (!guardPath || !evidenceSealer?.sealValue || !evidenceSealer?.verifyValue) {
    throw new Error('control_guard_configuration_required');
  }

  function read() {
    const parsed = readJsonSafe(guardPath, null);
    if (parsed.missing) return { valid: true, present: false, tasks: {} };
    if (parsed.corrupt || !parsed.value || parsed.value.version !== 1 || typeof parsed.value.tasks !== 'object') {
      return { valid: false, present: true, tasks: {}, reason: 'control_guard_corrupt' };
    }
    const payload = unsignedGuard(parsed.value.tasks);
    const valid = evidenceSealer.verifyValue(NAMESPACE, payload, parsed.value.seal);
    return { valid, present: true, tasks: payload.tasks, reason: valid ? null : 'control_guard_signature_invalid' };
  }

  function write(tasks) {
    const payload = unsignedGuard(tasks);
    atomicWriteJson(guardPath, { ...payload, seal: evidenceSealer.sealValue(NAMESPACE, payload) });
    return tasks;
  }

  return {
    read,
    add(contract) {
      const current = read();
      if (!current.valid) throw new Error(current.reason);
      return write({
        ...current.tasks,
        [contract.taskId]: {
          specHash: contract.trust?.specHash || null,
          revision: Number(contract.revision || 1),
          updatedAt: new Date().toISOString(),
        },
      });
    },
    remove(taskId) {
      const current = read();
      if (!current.valid) throw new Error(current.reason);
      const tasks = { ...current.tasks };
      delete tasks[taskId];
      if (Object.keys(tasks).length === 0) {
        if (fs.existsSync(guardPath)) fs.unlinkSync(guardPath);
        return tasks;
      }
      return write(tasks);
    },
  };
}

module.exports = { NAMESPACE, createControlGuard, unsignedGuard };
