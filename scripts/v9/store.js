'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJsonSafe(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return { value: fallback, missing: true, corrupt: false };
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), missing: false, corrupt: false };
  } catch (error) {
    return { value: fallback, missing: false, corrupt: true, errorCode: 'invalid_json' };
  }
}

function atomicWriteJson(filePath, value) {
  ensureParent(filePath);
  const temporary = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return value;
}

function eventIds(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record.eventId) ids.add(record.eventId);
    } catch {
      // Preserve corrupt lines. Repair is an explicit offline operation.
    }
  }
  return ids;
}

function appendJsonl(filePath, event) {
  if (!event || !event.eventId) throw new Error('event_id_required');
  ensureParent(filePath);
  if (eventIds(filePath).has(event.eventId)) return event;
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return event;
}

function withFileLock(lockPath, fn, options = {}) {
  ensureParent(lockPath);
  const staleMs = Number(options.staleMs || 30_000);
  // Every filesystem call here races another process doing exactly the same thing, so each one
  // tolerates the file vanishing underneath it rather than assuming its own check still holds.
  if (fs.existsSync(lockPath)) {
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > staleMs) fs.unlinkSync(lockPath);
    } catch (error) {
      // Another holder cleared it between our check and our stat/unlink. That is the outcome we
      // wanted anyway; only a genuinely unexpected error is worth reporting.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let handle;
  try {
    handle = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('lock_busy');
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return fn();
  } finally {
    fs.closeSync(handle);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = { appendJsonl, atomicWriteJson, readJsonSafe, sha256File, withFileLock };
