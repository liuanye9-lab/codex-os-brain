'use strict';
const crypto = require('node:crypto');

const MAX_TEXT_CHARS = 32_768;
const MAX_CONTENT_ITEMS = 256;
const TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text', 'user_text']);

function boundedText(value) {
  return String(value || '').slice(0, MAX_TEXT_CHARS);
}

function contentArrayText(value) {
  if (!Array.isArray(value)) return '';
  const parts = [];
  let remaining = MAX_TEXT_CHARS;
  for (const item of value.slice(0, MAX_CONTENT_ITEMS)) {
    let candidate = '';
    if (typeof item === 'string') candidate = item;
    else if (item && typeof item === 'object'
      && TEXT_BLOCK_TYPES.has(String(item.type || '').toLowerCase())
      && typeof item.text === 'string') candidate = item.text;
    if (!candidate || remaining <= 0) continue;
    const chunk = candidate.slice(0, remaining);
    parts.push(chunk);
    remaining -= chunk.length;
  }
  return parts.join(' ').trim();
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return boundedText(value);
    if (Array.isArray(value)) {
      const text = contentArrayText(value);
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
    taskFamily: boundedText(input.taskFamily || input.task_family || 'general').slice(0, 128),
  };
}

module.exports = { MAX_TEXT_CHARS, normalizeHostEvent, sessionRef };
