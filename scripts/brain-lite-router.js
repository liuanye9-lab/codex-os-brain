'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../config/brain-lite-router.json');

function bool(value) {
  return value === true;
}

function dispatchScore(features = {}) {
  let score = 0;
  const signals = [];

  if (features.clarity === 'clear') {
    score += 1;
    signals.push('clear-output');
  }
  if (bool(features.verifiable)) {
    score += 2;
    signals.push('independent-verifier');
  }
  if (bool(features.batch)) {
    score += 2;
    signals.push('batch-or-repeated');
  }
  if (bool(features.independent)) {
    score += 1;
    signals.push('independent-subtask');
  }
  if (bool(features.coding) && bool(features.textOnly) && bool(features.sparkQuotaAvailable)) {
    score += 1;
    signals.push('spark-independent-quota');
  }
  if (Number(features.estimatedToolCalls || 0) > 3) {
    score += 1;
    signals.push('tool-heavy');
  }
  if (bool(features.parallelizable) || Number(features.parallelLanes || 0) >= 2) {
    score += 1;
    signals.push('parallel-investigation');
  }

  if (features.contextShare === 'high' || bool(features.requiresPrivateContext)) {
    score -= 2;
    signals.push('large-context-transfer');
  }
  if (bool(features.crossModuleWrite) || bool(features.mergeCostHigh)) {
    score -= 2;
    signals.push('expensive-merge');
  }
  if (bool(features.externalWrite) || bool(features.irreversible) || features.privacy === 'high') {
    score -= 3;
    signals.push('sensitive-side-effect');
  }
  if (bool(features.motherCanFinishQuickly)) {
    score -= 2;
    signals.push('mother-fast-path');
  }

  return { score, signals };
}

function isForcedDirect(features) {
  return bool(features.inseparable)
    || bool(features.requiresPrivateContext)
    || bool(features.externalWrite)
    || bool(features.irreversible)
    || bool(features.mergeCostHigh)
    || (bool(features.motherIsBestModel) && !bool(features.parallelizable));
}

function isStrongDispatchSignal(features) {
  return bool(features.strongDispatchSignal)
    || (bool(features.batch) && bool(features.verifiable))
    || (
      bool(features.coding)
      && bool(features.textOnly)
      && bool(features.boundedChange)
      && bool(features.sparkQuotaAvailable)
      && bool(features.verifiable)
    );
}

function ultraRoute(features, config) {
  const previous = features.previousRoute || {};
  const eligible = bool(features.previousVerifiedFailure)
    && previous.effort === 'max'
    && Number(features.parallelLanes || 0) >= 3
    && bool(features.mergeVerifier)
    && ['gpt-5.6-sol', 'gpt-5.6-terra'].includes(previous.model);

  if (!eligible) return null;
  return previous.model === config.models.terra.slug ? 'terra-ultra' : 'sol-ultra';
}

function chooseStaticRoute(features, config, policyState) {
  const ultra = ultraRoute(features, config);
  if (ultra) {
    return { routeId: ultra, reason: 'verified max failure, three independent lanes, and a merge verifier make Ultra eligible' };
  }

  const previous = features.previousRoute || {};
  if (bool(features.previousVerifiedFailure) && previous.model === config.models.terra.slug && previous.effort === 'medium') {
    return { routeId: 'terra-max', reason: 'Terra medium representative failed; escalate directly to Terra max without mechanical intermediate efforts' };
  }

  const evidenceKey = features.taskFamily === 'constraint-satisfaction'
    ? 'gpt56-effort-eval-v2-constraint-satisfaction'
    : null;
  if (evidenceKey && bool(features.verifiable)) {
    const profile = config.evidenceProfiles[evidenceKey];
    return {
      routeId: profile.stableRoute,
      evidenceProfile: evidenceKey,
      reason: `local evidence recorded ${profile.stablePasses}/${profile.sampleCount} complete verified passes at ${profile.stableRoute}`,
    };
  }

  const learned = policyState.taskFamilies?.[features.taskFamily]?.stableRoute;
  if (learned && features.risk === 'low' && bool(features.verifiable) && !bool(features.externalWrite)) {
    return {
      routeId: learned.routeId || routeIdFor(learned.model, learned.effort, config),
      reason: 'learned stable route is allowed for low-risk work with an independent verifier',
    };
  }

  if (
    bool(features.coding)
    && bool(features.textOnly)
    && bool(features.boundedChange)
    && bool(features.sparkQuotaAvailable)
  ) {
    return { routeId: 'spark-high', reason: 'bounded text coding can use the independent Spark quota' };
  }

  if (
    features.risk === 'high'
    || features.failureCost === 'high'
    || features.novelty === 'high'
    || features.clarity === 'open'
    || features.verifiable === false
  ) {
    return { routeId: 'sol-max', reason: 'unfamiliar, open, hard-to-verify, or high-cost work needs the flagship quality floor' };
  }

  if (Number(features.constraintCount || 0) >= 8 || bool(features.crossDomain) || bool(features.crossTimeline)) {
    return { routeId: 'terra-max', reason: 'dense cross-domain constraints need Terra max' };
  }

  if (bool(features.batch) && features.clarity === 'clear' && bool(features.verifiable)) {
    return { routeId: 'luna-medium', reason: 'clear repeated work with a verifier can start on Luna medium' };
  }

  if (features.taskFamily === 'simple-extraction' && features.clarity === 'clear' && bool(features.verifiable)) {
    return { routeId: 'luna-low', reason: 'simple extraction has immediate mechanical verification' };
  }

  return { routeId: 'terra-medium', reason: 'ordinary multi-condition work starts at the balanced Terra medium route' };
}

function routeIdFor(model, effort, config) {
  return Object.entries(config.routes).find(([, value]) => value.model === model && value.effort === effort)?.[0] || null;
}

function routeTask(features = {}, config, policyState = {}) {
  if (!config || !config.routes) throw new TypeError('A valid Brain Lite router config is required');

  const normalized = {
    taskFamily: 'general',
    clarity: 'medium',
    risk: 'low',
    ...features,
  };
  const executionBudget = { ...(config.executionPolicy || {}) };
  const { score, signals } = dispatchScore(normalized);
  const forcedDirect = isForcedDirect(normalized);
  const dispatch = config.enabled !== false
    && !forcedDirect
    && (score >= Number(config.dispatchThreshold || 3) || isStrongDispatchSignal(normalized));

  if (!dispatch) {
    return {
      dispatch: false,
      score,
      signals,
      routeId: 'mother-direct',
      model: null,
      effort: null,
      reason: forcedDirect ? 'task stays with the mother agent because delegation would cross a safety or merge boundary' : 'delegation benefit did not cross the deterministic dispatch threshold',
      escalation: [],
      evidenceProfile: null,
      independentQuota: false,
      ultraEligible: false,
      policyVersion: config.policyVersion || `brain-lite-router-v${config.version || 1}`,
      executionBudget,
      probe: false,
      probeBudget: null,
      availabilityFallbackFrom: null,
    };
  }

  const selected = chooseStaticRoute(normalized, config, policyState);
  let selectedRouteId = selected.routeId;
  let availabilityFallbackFrom = null;
  const availability = policyState.infrastructureRoutes?.[selectedRouteId];
  const now = new Date(normalized.now || Date.now());
  if (
    availability?.cooldownUntil
    && new Date(availability.cooldownUntil).getTime() > now.getTime()
    && config.routes[selectedRouteId]?.infrastructureFallback
  ) {
    availabilityFallbackFrom = selectedRouteId;
    selectedRouteId = config.routes[selectedRouteId].infrastructureFallback;
    selected.reason = `${selected.reason}; ${availabilityFallbackFrom} is temporarily unavailable, so use its infrastructure fallback`;
  }
  const route = config.routes[selectedRouteId];
  if (!route) throw new Error(`Unknown route: ${selectedRouteId}`);
  const ultraEligible = route.effort === 'ultra';

  return {
    dispatch: true,
    score,
    signals,
    routeId: selectedRouteId,
    model: route.model,
    effort: route.effort,
    reason: selected.reason,
    escalation: [...(route.escalation || [])],
    evidenceProfile: selected.evidenceProfile || null,
    independentQuota: route.independentQuota === true,
    timeoutMs: route.timeoutMs,
    ultraEligible,
    policyVersion: config.policyVersion || `brain-lite-router-v${config.version || 1}`,
    executionBudget,
    probe: route.probe === true,
    probeBudget: route.probeBudget ? { ...route.probeBudget } : null,
    availabilityFallbackFrom,
  };
}

function nextRouteAfterOutcome(decision, outcome = {}, config) {
  if (!decision?.routeId || !config?.routes) throw new TypeError('A routing decision and config are required');
  const budget = decision.executionBudget || config.executionPolicy || {};
  const attemptsUsed = Number(outcome.attemptsUsed || 0);
  const elapsedWallTimeMs = Number(outcome.elapsedWallTimeMs || 0);
  if (attemptsUsed >= Number(budget.maxAttempts || 1)) {
    return { action: 'stop', routeId: null, reason: 'hard attempt budget exhausted' };
  }
  if (elapsedWallTimeMs >= Number(budget.totalWallTimeMs || Number.MAX_SAFE_INTEGER)) {
    return { action: 'stop', routeId: null, reason: 'hard wall-time budget exhausted' };
  }
  if (outcome.failureType === 'infrastructure') {
    if (Number(outcome.infrastructureRetriesUsed || 0) < Number(budget.maxInfrastructureRetries || 0)) {
      return { action: 'retry', routeId: decision.routeId, reason: 'bounded infrastructure retry' };
    }
    const fallback = config.routes[decision.routeId]?.infrastructureFallback;
    return fallback
      ? { action: 'fallback', routeId: fallback, reason: 'infrastructure retry exhausted; use availability fallback without changing capability evidence' }
      : { action: 'stop', routeId: null, reason: 'infrastructure retry exhausted and no safe fallback exists' };
  }
  if (outcome.failureType === 'capability') {
    if (Number(outcome.capabilityEscalationsUsed || 0) >= Number(budget.maxCapabilityEscalations || 0)) {
      return { action: 'stop', routeId: null, reason: 'capability escalation budget exhausted' };
    }
    const escalation = decision.escalation?.[0];
    return escalation
      ? { action: 'escalate', routeId: escalation, reason: 'independent verifier failed; follow the non-mechanical escalation path' }
      : { action: 'stop', routeId: null, reason: 'no measured capability escalation remains' };
  }
  if (outcome.failureType === null || outcome.failureType === 'success') {
    return { action: 'accept', routeId: decision.routeId, reason: 'independent verifier passed' };
  }
  return { action: 'stop', routeId: null, reason: 'unknown outcome cannot be routed safely' };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCli(argv) {
  const options = { config: DEFAULT_CONFIG_PATH, policyState: null, features: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') options.config = path.resolve(argv[++i]);
    else if (arg === '--policy-state') options.policyState = path.resolve(argv[++i]);
    else if (arg === '--features') options.features = JSON.parse(argv[++i]);
    else if (arg === '--features-file') options.features = loadJson(path.resolve(argv[++i]));
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/brain-lite-router.js --features JSON [--policy-state FILE]',
    'Returns a deterministic routing decision as JSON. It never launches a model.',
  ].join('\n');
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (!options.features) throw new Error('--features or --features-file is required');
    const config = loadJson(options.config);
    const policyState = options.policyState && fs.existsSync(options.policyState) ? loadJson(options.policyState) : {};
    process.stdout.write(`${JSON.stringify(routeTask(options.features, config, policyState), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  dispatchScore,
  nextRouteAfterOutcome,
  routeTask,
  routeIdFor,
};
