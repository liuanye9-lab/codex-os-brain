#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, resolveRuntimePaths } = require('./brain-lite-common');
const { normalizeHostEvent } = require('./brain-lite-host-event-normalizer');
const { detectCorrection } = require('./brain-lite-correction-detector');
const { createCandidate } = require('./brain-lite-behavioral-memory');
const { readCandidateStore, upsertCandidate, writeCandidateStore } = require('./brain-lite-candidate-store');
const { evaluateBehavioralCandidate } = require('./brain-lite-behavioral-policy');
const { buildBehavioralContextPacket } = require('./brain-lite-behavioral-context');
const { buildPrivacyExport } = require('./brain-lite-behavioral-privacy-export');

const USAGE = 'commands: detect, capture, evaluate, recall, export';

function readStdinJson() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8').trim(); } catch {}
  return raw ? JSON.parse(raw) : {};
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function defaultStore() {
  return path.join(resolveRuntimePaths().dataRoot, 'behavioral-memory-candidates.json');
}

function readPolicy(configPath) {
  if (!configPath) return {};
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { ...(config.policyLab || {}), ...(config.skillLifecycle || {}) };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!['detect', 'capture', 'evaluate', 'recall', 'export'].includes(command)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  if (command === 'detect') {
    const payload = readStdinJson();
    const raw = args.text ? { ...payload, text: String(args.text) } : payload;
    const event = normalizeHostEvent(raw, { host: args.host || raw.host || 'generic' });
    output({ event, detection: detectCorrection(event.text) });
    return 0;
  }

  const storePath = path.resolve(String(args.store || defaultStore()));

  if (command === 'capture') {
    const payload = readStdinJson();
    const eventSource = payload.event || payload;
    const event = normalizeHostEvent(eventSource, { host: payload.host || eventSource.host || args.host || 'generic' });
    const detection = detectCorrection(event.text);
    if (!detection.matched) {
      output({ disposition: 'ignored', reason: 'no-correction-signal', detection });
      return 0;
    }
    const candidate = createCandidate({
      event,
      detection,
      proposedRule: payload.proposedRule,
      scopeKey: payload.scopeKey,
      risk: payload.risk,
    });
    const result = upsertCandidate(storePath, candidate);
    output({ disposition: result.disposition, candidate: result.candidate });
    return 0;
  }

  if (command === 'recall') {
    const store = readCandidateStore(storePath);
    output(buildBehavioralContextPacket(store.candidates, {
      tokenBudget: args['token-budget'] ? Number(args['token-budget']) : undefined,
      maxItems: args['max-items'] ? Number(args['max-items']) : undefined,
    }));
    return 0;
  }

  if (command === 'export') {
    const store = readCandidateStore(storePath);
    output(buildPrivacyExport(store.candidates, String(args.salt || '')));
    return 0;
  }

  const payload = readStdinJson();
  const store = readCandidateStore(storePath);
  const candidateId = String(payload.candidateId || args.candidate || '');
  const index = store.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
  if (index < 0) throw new Error(`candidate not found: ${candidateId}`);
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const policy = { ...readPolicy(args.config), ...(payload.policy || {}) };
  const evaluated = evaluateBehavioralCandidate(store.candidates[index], samples, policy);
  store.candidates[index] = evaluated;
  writeCandidateStore(storePath, store);
  output(evaluated);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, readPolicy, readStdinJson };
