'use strict';
const crypto = require('node:crypto');

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value)) {
      const text = value.map((item) => typeof item === 'string' ? item : item?.text || '').join(' ').trim();
      if (text) return text;
    }
  }
  return '';
}

function sessionRef(value) {
  return 'sess_' + crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 16);
}

function normalizeEventType(input = {}) {
  const raw = String(input.eventType || input.event || input.type || input.hook_event_name || 'user_prompt').toLowerCase();
  if (raw.includes('prompt') || raw === 'user') return 'user_prompt';
  if (raw.includes('verification') || raw.includes('test')) return 'verification';
  if (raw.includes('tool')) return 'tool_result';
  if (raw.includes('stop') || raw.includes('deliver')) return 'delivery';
  return raw.replace(/[^a-z0-9_-]+/g, '_') || 'unknown';
}

function normalizeHostEvent(input = {}, options = {}) {
  const host = String(options.host || input.host || input.source || 'generic').toLowerCase();
  const rawSession = input.session_id || input.sessionId || input.conversation_id || input.conversationId || input.thread_id || 'unknown';
  const text = firstText(
    input.prompt,
    input.userPrompt,
    input.input_text,
    input.text,
    input.content,
    input.message?.content,
    input.message?.text
  );
  return {
    schemaVersion: 1,
    host,
    eventType: normalizeEventType(input),
    sessionRef: sessionRef(rawSession),
    timestamp: options.now || input.timestamp || new Date().toISOString(),
    text,
    taskFamily: String(input.taskFamily || input.task_family || 'general'),
  };
}

module.exports = { normalizeHostEvent, sessionRef };
