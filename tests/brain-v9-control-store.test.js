'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createControlStore, sessionScopeId } = require('../scripts/v9/control-store');

function fixture(sessionId = 'session-a') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-control-'));
  return createControlStore({ dbPath: path.join(root, 'control.sqlite3'), sessionId });
}

test('task and active-session updates commit atomically', () => {
  const store = fixture();
  const contract = { taskId: 'task-a', revision: 1, objective: 'atomic' };
  store.createTask(contract);
  assert.deepEqual(store.activeTask(), contract);
  assert.equal(store.integrity().passed, true);
});

test('sessions in the same project keep independent active tasks and events', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-control-sessions-'));
  const dbPath = path.join(root, 'control.sqlite3');
  const a = createControlStore({ dbPath, sessionId: 'session-a' });
  const b = createControlStore({ dbPath, sessionId: 'session-b' });
  a.createTask({ taskId: 'task-a', revision: 1 });
  b.createTask({ taskId: 'task-b', revision: 1 });
  a.appendEvent({ eventId: 'event-a', taskId: 'task-a', kind: 'verify', status: 'passed', createdAt: '2026-07-26T00:00:00.000Z' });
  b.appendEvent({ eventId: 'event-b', taskId: 'task-b', kind: 'verify', status: 'failed', createdAt: '2026-07-26T00:00:01.000Z' });
  assert.equal(a.activeTask().taskId, 'task-a');
  assert.equal(b.activeTask().taskId, 'task-b');
  assert.deepEqual(a.listEvents().filter(item => item.kind === 'verify').map(item => item.eventId), ['event-a']);
  assert.deepEqual(b.listEvents().filter(item => item.kind === 'verify').map(item => item.eventId), ['event-b']);
});

test('duplicate event ids are idempotent under SQLite uniqueness', () => {
  const store = fixture();
  const event = { eventId: 'same', kind: 'checkpoint', createdAt: '2026-07-26T00:00:00.000Z' };
  store.appendEvent(event);
  store.appendEvent(event);
  assert.equal(store.listEvents().filter(item => item.eventId === 'same').length, 1);
  assert.throws(() => store.appendEvent({ ...event, status: 'different' }), /event_id_conflict/);
});

test('task revision and verify event commit in one transaction', () => {
  const store = fixture();
  store.createTask({ taskId: 'task-atomic', revision: 1 });
  const next = { taskId: 'task-atomic', revision: 2 };
  store.saveTaskAndEvent(next, {
    eventId: 'verify-atomic',
    taskId: 'task-atomic',
    kind: 'verify',
    status: 'passed',
    createdAt: '2026-07-26T00:00:00.000Z',
  });
  assert.equal(store.activeTask().revision, 2);
  assert.deepEqual(store.listEvents().filter(item => item.kind === 'verify').map(item => item.eventId), ['verify-atomic']);
});

test('raw session identifiers are converted to bounded pseudonymous scopes', () => {
  assert.match(sessionScopeId('private-session-id'), /^[a-f0-9]{24}$/);
  assert.notEqual(sessionScopeId('private-session-id'), 'private-session-id');
});

test('separate processes can create session-bound tasks concurrently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-control-concurrent-'));
  const dbPath = path.join(root, 'control.sqlite3');
  const modulePath = path.resolve(__dirname, '..', 'scripts', 'v9', 'control-store.js');
  const childSource = `
    const { createControlStore } = require(process.argv[1]);
    const store = createControlStore({ dbPath: process.argv[2], sessionId: process.argv[3] });
    store.createTask({ taskId: process.argv[4], revision: 1, executionMode: 'read_only' });
  `;
  const launch = (session, task) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', childSource, modulePath, dbPath, session, task], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `child_exit_${code}`)));
  });
  await Promise.all([launch('session-a', 'task-a'), launch('session-b', 'task-b')]);
  assert.equal(createControlStore({ dbPath, sessionId: 'session-a' }).activeTask().taskId, 'task-a');
  assert.equal(createControlStore({ dbPath, sessionId: 'session-b' }).activeTask().taskId, 'task-b');
});
