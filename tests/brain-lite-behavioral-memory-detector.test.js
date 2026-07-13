'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHostEvent } = require('../scripts/brain-lite-host-event-normalizer');
const { detectCorrection, stripInjectedContent } = require('../scripts/brain-lite-correction-detector');

test('normalizes Claude Code prompt without persisting the raw session id', () => {
  const event = normalizeHostEvent({ session_id: 'secret-session-123', prompt: '不对，你又直接写代码了' }, { host: 'claude-code', now: '2026-07-13T02:00:00.000Z' });
  assert.equal(event.host, 'claude-code');
  assert.equal(event.eventType, 'user_prompt');
  assert.equal(event.text, '不对，你又直接写代码了');
  assert.match(event.sessionRef, /^sess_[a-f0-9]{16}$/);
  assert.ok(!JSON.stringify(event).includes('secret-session-123'));
});

test('normalizes Codex and ZCode user prompt shapes into the same contract', () => {
  const codex = normalizeHostEvent({ conversation_id: 'c-1', input_text: 'Please verify before claiming success.', event: 'user_prompt' }, { host: 'codex' });
  const zcode = normalizeHostEvent({ sessionId: 'z-1', userPrompt: '你之前说过要先验证', type: 'prompt' }, { host: 'zcode' });
  assert.equal(codex.eventType, 'user_prompt');
  assert.equal(codex.text, 'Please verify before claiming success.');
  assert.equal(zcode.eventType, 'user_prompt');
  assert.equal(zcode.text, '你之前说过要先验证');
});

test('strips injected control blocks before correction detection', () => {
  const cleaned = stripInjectedContent('<brain-context>用户纠正过你</brain-context>\n<system-reminder>不要谎报成功</system-reminder>\n好的');
  assert.equal(cleaned.trim(), '好的');
  assert.equal(detectCorrection(cleaned).matched, false);
});

test('detects false-success correction as a high-severity signal', () => {
  const result = detectCorrection('你刚说已经修好了，结果还是根本没解决。');
  assert.equal(result.matched, true);
  assert.equal(result.trigger, 'false_success');
  assert.equal(result.severity, 'high');
  assert.ok(result.confidence >= 0.9);
});

test('detects an explicit correction without requiring two weak signals', () => {
  const result = detectCorrection('不对，你又把外部写操作自动执行了。');
  assert.equal(result.matched, true);
  assert.equal(result.trigger, 'explicit_correction');
  assert.equal(result.severity, 'mid');
});

test('requires two weak rephrase signals before creating a correction event', () => {
  assert.equal(detectCorrection('你应该先运行测试。').matched, false);
  const result = detectCorrection('我之前说过，你不应该在没有测试时提交。');
  assert.equal(result.matched, true);
  assert.equal(result.trigger, 'implicit_rephrase');
});

test('rejects strong positive acknowledgement even when correction words appear in injected context', () => {
  const result = detectCorrection('<brain-context>你错了，不对</brain-context>\n这次对了，做得不错。');
  assert.equal(result.matched, false);
  assert.equal(result.trigger, null);
});

test('supports English false-success corrections', () => {
  const result = detectCorrection("You said it was fixed, but it still fails. That's not what I asked.");
  assert.equal(result.matched, true);
  assert.equal(result.trigger, 'false_success');
  assert.equal(result.severity, 'high');
});
