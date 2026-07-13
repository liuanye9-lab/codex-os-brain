'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCandidate, mergeCandidate } = require('../scripts/brain-lite-behavioral-memory');
const {
  CandidateStoreCorruptError,
  CandidateStoreRevisionError,
  readCandidateStore,
  replaceFileAtomic,
  upsertCandidate,
  writeCandidateStore,
} = require('../scripts/brain-lite-candidate-store');

function correctionEvent(text = '不对，你又直接提交了。') {
  return {
    schemaVersion: 1,
    host: 'codex',
    eventType: 'user_prompt',
    sessionRef: 'sess_1234567890abcdef',
    timestamp: '2026-07-13T03:00:00.000Z',
    text,
    taskFamily: 'coding',
  };
}

function detection(trigger = 'explicit_correction') {
  return { matched: true, trigger, severity: 'mid', confidence: 0.85, signals: ['signal'] };
}

test('creates needs-synthesis candidate when no explicit behavioral rule is supplied', () => {
  const candidate = createCandidate({ event: correctionEvent(), detection: detection(), scopeKey: 'git.delivery' });
  assert.equal(candidate.state, 'needs-synthesis');
  assert.equal(candidate.rule, null);
  assert.equal(candidate.occurrences, 1);
  assert.match(candidate.candidateId, /^bm_[a-f0-9]{20}$/);
  assert.equal(candidate.evidenceHashes.length, 1);
});

test('creates a rule candidate without storing raw correction text or session reference', () => {
  const event = correctionEvent('RAW_CORRECTION_MARKER /workspace/internal/project');
  const candidate = createCandidate({
    event,
    detection: detection(),
    scopeKey: 'git.delivery',
    proposedRule: 'Before claiming delivery, run the declared verifier and report its result.',
  });
  const serialized = JSON.stringify(candidate);
  assert.equal(candidate.state, 'candidate');
  assert.equal(candidate.rule, 'Before claiming delivery, run the declared verifier and report its result.');
  assert.ok(!serialized.includes('RAW_CORRECTION_MARKER'));
  assert.ok(!serialized.includes('/workspace/internal/project'));
  assert.ok(!serialized.includes(event.sessionRef));
});

test('redacts credentials and private paths before persisting synthesized rules or scopes', () => {
  const candidate = createCandidate({
    event: correctionEvent('请记住这个规则'),
    detection: detection(),
    scopeKey: '/home/example/internal/project',
    proposedRule: 'Read /home/example/internal/project and use access_token=DO_NOT_STORE before verification.',
  });
  const serialized = JSON.stringify(candidate);
  assert.ok(!serialized.includes('/home/example'));
  assert.ok(!serialized.includes('DO_NOT_STORE'));
  assert.match(candidate.rule, /\[PRIVATE_PATH\]/);
  assert.match(candidate.rule, /\[REDACTED\]/);
  assert.equal(candidate.scopeKey, '[PRIVATE_PATH]');
});

test('merges only distinct correction evidence into occurrence count', () => {
  const first = createCandidate({ event: correctionEvent('纠正一'), detection: detection(), scopeKey: 'verification', proposedRule: 'Run independent verification before acceptance.' });
  const duplicate = createCandidate({ event: correctionEvent('纠正一'), detection: detection(), scopeKey: 'verification', proposedRule: 'Run independent verification before acceptance.' });
  const second = createCandidate({ event: correctionEvent('纠正二'), detection: detection(), scopeKey: 'verification', proposedRule: 'Run independent verification before acceptance.' });
  const unchanged = mergeCandidate(first, duplicate);
  const merged = mergeCandidate(unchanged, second);
  assert.equal(unchanged.occurrences, 1);
  assert.equal(merged.occurrences, 2);
  assert.equal(merged.evidenceHashes.length, 2);
});

test('atomically upserts deduplicated candidates into a private local store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-store-'));
  const file = path.join(dir, 'candidates.json');
  const first = createCandidate({ event: correctionEvent('纠正一'), detection: detection(), scopeKey: 'verification', proposedRule: 'Run independent verification before acceptance.' });
  const second = createCandidate({ event: correctionEvent('纠正二'), detection: detection(), scopeKey: 'verification', proposedRule: 'Run independent verification before acceptance.' });
  assert.equal(upsertCandidate(file, first).disposition, 'inserted');
  assert.equal(upsertCandidate(file, second).disposition, 'merged');
  const stored = readCandidateStore(file);
  assert.equal(stored.revision, 2);
  assert.equal(stored.candidates.length, 1);
  assert.equal(stored.candidates[0].occurrences, 2);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('flags same-scope divergent rules for review instead of silently merging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-conflict-'));
  const file = path.join(dir, 'candidates.json');
  const first = createCandidate({ event: correctionEvent('纠正一'), detection: detection(), scopeKey: 'git.delivery', proposedRule: 'Never push without explicit user approval.' });
  const second = createCandidate({ event: correctionEvent('纠正二'), detection: detection(), scopeKey: 'git.delivery', proposedRule: 'Push automatically after all checks pass.' });
  upsertCandidate(file, first);
  const result = upsertCandidate(file, second);
  const stored = readCandidateStore(file);
  assert.equal(result.disposition, 'conflict-review');
  assert.equal(stored.candidates.length, 2);
  assert.ok(stored.candidates.every((candidate) => candidate.reviewRequired === true));
  assert.ok(stored.candidates[0].conflictsWith.includes(stored.candidates[1].candidateId));
  assert.ok(stored.candidates[1].conflictsWith.includes(stored.candidates[0].candidateId));
});

test('preserves a corrupted store and refuses to overwrite it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-corrupt-'));
  const file = path.join(dir, 'candidates.json');
  const original = '{"schemaVersion":1,"candidates":[';
  fs.writeFileSync(file, original, 'utf8');
  assert.throws(() => readCandidateStore(file), CandidateStoreCorruptError);
  assert.throws(() => writeCandidateStore(file, { schemaVersion: 1, revision: 0, candidates: [] }), CandidateStoreCorruptError);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('rejects stale revisions instead of silently losing a concurrent update', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-revision-'));
  const file = path.join(dir, 'candidates.json');
  writeCandidateStore(file, { schemaVersion: 1, revision: 0, candidates: [] }, { expectedRevision: 0 });
  const stale = readCandidateStore(file);
  writeCandidateStore(file, stale, { expectedRevision: 1 });
  assert.throws(
    () => writeCandidateStore(file, stale, { expectedRevision: 1 }),
    CandidateStoreRevisionError,
  );
  assert.equal(readCandidateStore(file).revision, 2);
});

test('uses a recoverable replacement fallback for Windows rename errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-windows-'));
  const target = path.join(dir, 'candidates.json');
  const temporary = path.join(dir, 'candidates.tmp');
  fs.writeFileSync(target, 'old', 'utf8');
  fs.writeFileSync(temporary, 'new', 'utf8');
  let first = true;
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = (from, to) => {
    if (first) {
      first = false;
      const error = new Error('simulated Windows sharing violation');
      error.code = 'EPERM';
      throw error;
    }
    return fs.renameSync(from, to);
  };
  replaceFileAtomic(temporary, target, { fsImpl });
  assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  assert.equal(fs.readdirSync(dir).some((name) => name.includes('.bak.')), false);
});
