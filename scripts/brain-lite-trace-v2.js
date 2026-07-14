'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const FIELDS = new Set(['traceId','parentEventId','taskId','taskFingerprint','kind','policyVersion','timestamp','privacyClass','routeId','model','effort','attempt','inputTokens','cachedInputTokens','outputTokens','durationMs','toolCalls','verifierCommandHash','verifierPassed','finalDelivered','modelClaimedSuccess','failureClass','evidenceIds','artifactHash','contextPrecision','contextUtilization','harnessTokens','harnessDurationMs','candidateRef','behavioralAction','behavioralState']);

function eventId(event) {
  const identity = [event.traceId, event.parentEventId || '', event.taskId, event.kind, Number(event.attempt || 1), String(event.verifierPassed), String(event.finalDelivered)].join('\u0000');
  return 'evt2_' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}
function sanitizeTraceEvent(event = {}) {
  const output = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(event)) {
    if (!FIELDS.has(key)) continue;
    if (key === 'evidenceIds') { output[key] = Array.isArray(value) ? value.filter((item) => /^ev_[a-f0-9]{20}$/.test(item)) : []; continue; }
    if (key === 'candidateRef') { if (/^bmc_[a-f0-9]{20}$/.test(String(value))) output[key] = value; continue; }
    if (typeof value === 'string' || typeof value === 'boolean' || value === null) output[key] = value;
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  output.traceId = output.traceId || 'trace_unknown';
  output.taskId = output.taskId || 'task_unknown';
  output.kind = output.kind || 'delivery';
  output.policyVersion = output.policyVersion || 'brain-lite-v8';
  output.timestamp = output.timestamp || new Date().toISOString();
  output.privacyClass = ['public','private','sensitive'].includes(output.privacyClass) ? output.privacyClass : 'private';
  output.eventId = event.eventId || eventId(output);
  return output;
}
function readTrace(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
function appendTraceEvent(filePath, event) {
  const sanitized = sanitizeTraceEvent(event);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (readTrace(filePath).some((item) => item.eventId === sanitized.eventId)) return sanitized;
  fs.appendFileSync(filePath, JSON.stringify(sanitized) + '\n', { encoding: 'utf8', mode: 0o600 });
  return sanitized;
}
module.exports = { appendTraceEvent, eventId, readTrace, sanitizeTraceEvent };
