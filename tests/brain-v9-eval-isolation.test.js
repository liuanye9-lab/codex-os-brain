'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('reliability eval runs under a temporary projectRoot and never changes the caller .brain', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-eval-caller-'));
  const brain = path.join(projectRoot, '.brain');
  fs.mkdirSync(brain);
  const backlog = path.join(brain, 'feature-backlog.json');
  fs.writeFileSync(backlog, '{"objective":"must-survive","features":[]}\n');
  const before = sha256(backlog);

  const result = spawnSync(process.execPath, [path.join(root, 'evals', 'v9-reliability', 'runner.cjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(sha256(backlog), before);
  assert.equal(fs.readFileSync(backlog, 'utf8'), '{"objective":"must-survive","features":[]}\n');
});
