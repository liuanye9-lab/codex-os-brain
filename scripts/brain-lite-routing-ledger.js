'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EVENT_FIELDS = new Set([
  'schemaVersion',
  'eventId',
  'timestamp',
  'taskId',
  'taskFamily',
  'taskFingerprint',
  'traceId',
  'policyVersion',
  'phase',
  'routeId',
  'model',
  'effort',
  'taskRisk',
  'verifiable',
  'dispatchScore',
  'reason',
  'featureSummary',
  'relevantFiles',
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'estimatedCredits',
  'durationMs',
  'exitStatus',
  'verifierCommandHash',
  'verifierPassed',
  'modelClaimedSuccess',
  'escalated',
  'previousRoute',
  'infrastructureFailure',
  'infrastructureFailureType',
  'userCorrected',
  'criticalFailure',
  'finalDelivered',
  'attempt',
  'maxAttempts',
  'probe',
  'probeOutcome',
  'budgetExhausted',
  'cooldownUntil',
]);

const FEATURE_FIELDS = new Set([
  'clarity',
  'verifiable',
  'risk',
  'batch',
  'independent',
  'coding',
  'textOnly',
  'boundedChange',
  'estimatedToolCalls',
  'contextShare',
  'externalWrite',
  'failureCost',
  'constraintCount',
  'parallelLanes',
]);

const DEFAULT_ROUTE_RANK = [
  'luna-low',
  'luna-medium',
  'spark-high',
  'luna-max',
  'terra-medium',
  'terra-max',
  'sol-max',
  'terra-ultra',
  'sol-ultra',
];

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function minimizePath(value) {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(/[),.;:'"]+$/g, '');
  return path.basename(cleaned) || '[private-path]';
}

function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:ghp|github_pat|sk-proj|sk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted-token]')
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, '[redacted-token]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '$1 [redacted-token]')
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*[^\s,;]+/g, '$1=[redacted]')
    .replace(/\/Users\/[^/\s]+\/[^\s,;)'"\]]+/g, (match) => `[private-path:${minimizePath(match)}]`)
    .replace(/\b(?:\/private)?\/tmp\/[^\s,;)'"\]]+/g, (match) => `[temp-path:${minimizePath(match)}]`);
}

function sanitizePrimitive(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function sanitizeEvent(event = {}) {
  const output = { schemaVersion: 1 };

  for (const [key, value] of Object.entries(event)) {
    if (!EVENT_FIELDS.has(key) || key === 'schemaVersion') continue;
    if (key === 'relevantFiles' && Array.isArray(value)) {
      output[key] = value.filter((item) => typeof item === 'string').map(minimizePath);
      continue;
    }
    if (key === 'featureSummary' && value && typeof value === 'object' && !Array.isArray(value)) {
      const features = {};
      for (const [featureKey, featureValue] of Object.entries(value)) {
        if (!FEATURE_FIELDS.has(featureKey)) continue;
        const sanitized = sanitizePrimitive(featureValue);
        if (sanitized !== undefined) features[featureKey] = sanitized;
      }
      output[key] = features;
      continue;
    }
    if (key === 'previousRoute' && value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = {
        routeId: sanitizeText(value.routeId || ''),
        model: sanitizeText(value.model || ''),
        effort: sanitizeText(value.effort || ''),
      };
      continue;
    }
    const sanitized = sanitizePrimitive(value);
    if (sanitized !== undefined) output[key] = sanitized;
  }

  if (!output.timestamp) output.timestamp = new Date().toISOString();
  if (!output.eventId) output.eventId = computeEventId(output);
  return output;
}

function computeEventId(event = {}) {
  const identity = {
    traceId: event.traceId || null,
    taskId: event.taskId || null,
    taskFingerprint: event.taskFingerprint || null,
    phase: event.phase || 'event',
    routeId: event.routeId || null,
    attempt: Number(event.attempt || 1),
    exitStatus: event.exitStatus ?? null,
    verifierPassed: event.verifierPassed ?? null,
    finalDelivered: event.finalDelivered ?? null,
    infrastructureFailureType: event.infrastructureFailureType || null,
  };
  return `evt_${hashText(JSON.stringify(identity)).slice(0, 24)}`;
}

function appendEvent(filePath, event) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const sanitized = sanitizeEvent(event);
  if (fs.existsSync(target)) {
    const existing = readEvents(target).find((item) => item.eventId === sanitized.eventId);
    if (existing) return existing;
  }
  fs.appendFileSync(target, `${JSON.stringify(sanitized)}\n`, { encoding: 'utf8', mode: 0o600 });
  return sanitized;
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid ledger JSON on line ${index + 1}: ${error.message}`);
      }
    });
}

function routeDescriptor(routeId, sample) {
  return {
    routeId,
    model: sample?.model || null,
    effort: sample?.effort || null,
  };
}

function everHadStableWindow(events, windowSize) {
  if (events.length < windowSize) return false;
  for (let start = 0; start <= events.length - windowSize; start += 1) {
    const window = events.slice(start, start + windowSize);
    if (window.every((event) => event.verifierPassed === true && event.finalDelivered !== false && event.criticalFailure !== true)) {
      return true;
    }
  }
  return false;
}

function collapseDistinctSamples(events) {
  const latestBySample = new Map();
  for (const event of events) {
    const key = event.taskFingerprint || event.taskId || event.eventId || `${event.timestamp}-${latestBySample.size}`;
    latestBySample.set(key, event);
  }
  return [...latestBySample.values()].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function chooseLowest(routes, routeRank) {
  if (!routes.length) return null;
  const ranks = new Map(routeRank.map((routeId, index) => [routeId, index]));
  return [...routes].sort((a, b) => {
    const rankA = ranks.has(a.routeId) ? ranks.get(a.routeId) : Number.MAX_SAFE_INTEGER;
    const rankB = ranks.has(b.routeId) ? ranks.get(b.routeId) : Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.routeId.localeCompare(b.routeId);
  })[0];
}

function derivePolicyState(events, options = {}) {
  const windowSize = Number(options.windowSize || 3);
  const stablePasses = Number(options.stablePasses || windowSize);
  const trialPasses = Number(options.trialPasses || Math.max(1, windowSize - 1));
  const routeRank = options.routeRank || DEFAULT_ROUTE_RANK;
  const grouped = new Map();
  const infrastructureByRoute = new Map();

  for (const event of events) {
    if (!event?.taskFamily || !event?.routeId || event.routeId === 'mother-direct') continue;
    const key = `${event.taskFamily}\u0000${event.routeId}`;
    if (!grouped.has(key)) grouped.set(key, { taskFamily: event.taskFamily, routeId: event.routeId, all: [], capability: [], infra: 0 });
    const group = grouped.get(key);
    group.all.push(event);
    if (event.infrastructureFailure === true || event.infrastructureFailureType) {
      group.infra += 1;
      if (!infrastructureByRoute.has(event.routeId)) infrastructureByRoute.set(event.routeId, []);
      infrastructureByRoute.get(event.routeId).push(event);
    } else if (typeof event.verifierPassed === 'boolean' && typeof event.finalDelivered === 'boolean') {
      group.capability.push(event);
    }
  }

  const state = {
    schemaVersion: 1,
    generatedAt: options.now ? new Date(options.now).toISOString() : new Date().toISOString(),
    rule: `${stablePasses}/${windowSize} stable, ${trialPasses}/${windowSize} trial, lower blocked; infrastructure failures excluded`,
    taskFamilies: {},
    infrastructureRoutes: {},
  };

  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const infrastructureWindowMs = Number(options.infrastructureWindowMs || 60 * 60 * 1000);
  const infrastructureFailureThreshold = Number(options.infrastructureFailureThreshold || 2);
  const cooldownMs = Number(options.cooldownMs || 30 * 60 * 1000);
  for (const [routeId, routeEvents] of infrastructureByRoute.entries()) {
    const recent = routeEvents.filter((event) => {
      const timestamp = new Date(event.timestamp).getTime();
      return timestamp <= nowMs && timestamp >= nowMs - infrastructureWindowMs;
    });
    state.infrastructureRoutes[routeId] = {
      recentFailures: recent.length,
      lastFailureType: recent.at(-1)?.infrastructureFailureType || null,
      cooldownUntil: recent.length >= infrastructureFailureThreshold ? new Date(nowMs + cooldownMs).toISOString() : null,
    };
  }

  for (const group of grouped.values()) {
    group.capability.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const distinctCapability = collapseDistinctSamples(group.capability);
    const sample = distinctCapability.slice(-windowSize);
    const passes = sample.filter((event) => event.verifierPassed === true && event.finalDelivered !== false && event.criticalFailure !== true).length;
    const completeWindow = sample.length >= windowSize;
    const recentCriticalFailure = sample.some((event) => event.criticalFailure === true);
    const hadStableWindow = everHadStableWindow(distinctCapability, windowSize);
    let status = 'accumulating';
    if (completeWindow && passes >= stablePasses && !recentCriticalFailure) status = 'stable';
    else if (completeWindow && passes >= trialPasses) status = 'trial';
    else if (completeWindow) status = 'blocked';

    if (!state.taskFamilies[group.taskFamily]) {
      state.taskFamilies[group.taskFamily] = {
        routes: {},
        stableRoute: null,
        trialRoute: null,
        blockedRoutes: [],
      };
    }
    const latest = sample.at(-1) || group.capability.at(-1) || group.all.at(-1);
    state.taskFamilies[group.taskFamily].routes[group.routeId] = {
      routeId: group.routeId,
      model: latest?.model || null,
      effort: latest?.effort || null,
      attempts: sample.length,
      distinctSamples: sample.length,
      passes,
      status,
      excludedInfrastructureFailures: group.infra,
      stableRevoked: hadStableWindow && status !== 'stable',
    };
  }

  for (const family of Object.values(state.taskFamilies)) {
    const routes = Object.values(family.routes);
    const stable = routes.filter((route) => route.status === 'stable').map((route) => routeDescriptor(route.routeId, route));
    const trials = routes.filter((route) => route.status === 'trial').map((route) => routeDescriptor(route.routeId, route));
    family.stableRoute = chooseLowest(stable, routeRank);
    family.trialRoute = chooseLowest(trials, routeRank);
    family.blockedRoutes = routes.filter((route) => route.status === 'blocked').map((route) => route.routeId).sort();
  }

  return state;
}

function writePolicyState(filePath, state) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true, mode: 0o700 });
  const temporary = `${path.resolve(filePath)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, path.resolve(filePath));
}

function parseCli(argv) {
  const options = { command: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && !options.command) options.command = arg;
    else if (arg === '--ledger') options.ledger = path.resolve(argv[++index]);
    else if (arg === '--event-file') options.eventFile = path.resolve(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else if (arg === '--window-size') options.windowSize = Number(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/brain-lite-routing-ledger.js append --ledger FILE --event-file FILE',
    '  node scripts/brain-lite-routing-ledger.js derive --ledger FILE --output FILE [--window-size 3]',
    '  node scripts/brain-lite-routing-ledger.js show --ledger FILE',
  ].join('\n');
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (!options.command || !options.ledger) throw new Error('A command and --ledger are required');
    if (options.command === 'append') {
      if (!options.eventFile) throw new Error('--event-file is required for append');
      const saved = appendEvent(options.ledger, JSON.parse(fs.readFileSync(options.eventFile, 'utf8')));
      process.stdout.write(`${JSON.stringify(saved, null, 2)}\n`);
    } else if (options.command === 'derive') {
      if (!options.output) throw new Error('--output is required for derive');
      const state = derivePolicyState(readEvents(options.ledger), { windowSize: options.windowSize || 3 });
      writePolicyState(options.output, state);
      process.stdout.write(`${JSON.stringify({ output: options.output, taskFamilies: Object.keys(state.taskFamilies).length })}\n`);
    } else if (options.command === 'show') {
      process.stdout.write(`${JSON.stringify(readEvents(options.ledger), null, 2)}\n`);
    } else throw new Error(`Unknown command: ${options.command}`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_ROUTE_RANK,
  appendEvent,
  computeEventId,
  derivePolicyState,
  hashText,
  minimizePath,
  readEvents,
  sanitizeEvent,
  sanitizeText,
  usage,
  writePolicyState,
};
