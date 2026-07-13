'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../scripts/brain-lite-behavioral-memory-cli.js');

function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
  });
  return result;
}

test('detect command returns structured false-success evidence', () => {
  const result = run(['detect', '--host', 'codex', '--text', 'You said it was fixed, but it still fails.']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.event.host, 'codex');
  assert.equal(output.detection.matched, true);
  assert.equal(output.detection.trigger, 'false_success');
});

test('capture command writes a candidate while recall excludes it before promotion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-cli-'));
  const store = path.join(dir, 'candidates.json');
  const capture = run(['capture', '--store', store], {
    host: 'codex',
    conversation_id: 'private-conversation',
    input_text: '不对，你又在没有验证时说完成了。',
    proposedRule: 'Run the declared verifier before claiming completion.',
    scopeKey: 'verification.delivery',
  });
  assert.equal(capture.status, 0, capture.stderr);
  const captured = JSON.parse(capture.stdout);
  assert.equal(captured.disposition, 'inserted');
  assert.ok(fs.existsSync(store));

  const recall = run(['recall', '--store', store]);
  assert.equal(recall.status, 0, recall.stderr);
  assert.equal(JSON.parse(recall.stdout).injected.length, 0);
});

test('recall includes a manually approved promoted rule and export remains text-free', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-cli-promoted-'));
  const store = path.join(dir, 'candidates.json');
  const secretRule = 'SECRET RULE run verifier before delivery';
  const payload = {
    schemaVersion: 1,
    candidates: [{
      schemaVersion: 1,
      candidateId: 'bm_aaaaaaaaaaaaaaaaaaaa',
      state: 'promoted',
      scopeKey: 'verification.delivery',
      rule: secretRule,
      ruleHash: 'a'.repeat(64),
      risk: 'read-only',
      occurrences: 4,
      firstSeenDate: '2026-07-01',
      lastSeenDate: '2026-07-13',
      evidenceHashes: ['b'.repeat(64)],
      triggers: ['explicit_correction'],
      hosts: ['codex'],
      confidenceMax: 0.9,
      reviewRequired: false,
      conflictsWith: [],
      replays: [{ passed: true }, { passed: true }, { passed: true }],
      experiment: { state: 'stable', benefit: 'tokens' }
    }]
  };
  fs.writeFileSync(store, JSON.stringify(payload));

  const recall = run(['recall', '--store', store]);
  assert.equal(recall.status, 0, recall.stderr);
  assert.equal(JSON.parse(recall.stdout).injected[0].content, secretRule);

  const exported = run(['export', '--store', store, '--salt', 'participant-salt-123456']);
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(!exported.stdout.includes('SECRET RULE'));
  assert.ok(!exported.stdout.includes('verification.delivery'));
});

test('unknown command exits non-zero with a stable usage error', () => {
  const result = run(['unknown']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /commands: detect, capture, evaluate, recall, export/i);
});
