'use strict';

const { buildV8Review } = require('./brain-lite-v8-review');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveRuntimePaths } = require('./brain-lite-common');
const { inspectIndexHealth } = require('./brain-lite-index-health');
const { readEvents } = require('./brain-lite-routing-ledger');
const { readTrace } = require('./brain-lite-trace-v2');

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dayNumber(value, timeZone) {
  const [year, month, day] = dateKey(value, timeZone).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function inDayRange(timestamp, nowDay, minimumAge, maximumAge, timeZone) {
  const age = nowDay - dayNumber(timestamp, timeZone);
  return age >= minimumAge && age <= maximumAge;
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function distinctCount(items, key) {
  return new Set(items.map(key).filter(Boolean)).size;
}

function groupByTask(events) {
  const groups = new Map();
  events.forEach((event, index) => {
    const taskId = event.taskId || `event-${index}-${event.timestamp || ''}`;
    if (!groups.has(taskId)) groups.set(taskId, []);
    groups.get(taskId).push(event);
  });
  for (const group of groups.values()) {
    group.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || Number(a.attempt || 0) - Number(b.attempt || 0));
  }
  return groups;
}

function routeBreakdown(events) {
  const routes = {};
  for (const event of events) {
    const routeId = event.routeId || 'unknown';
    if (!routes[routeId]) routes[routeId] = { attempts: 0, passes: 0, inputTokens: 0, outputTokens: 0 };
    routes[routeId].attempts += 1;
    if (event.infrastructureFailure !== true && event.verifierPassed === true && event.finalDelivered !== false) routes[routeId].passes += 1;
    routes[routeId].inputTokens += Number(event.inputTokens || 0);
    routes[routeId].outputTokens += Number(event.outputTokens || 0);
  }
  return routes;
}

function aggregate(events, directSignals) {
  const routedGroups = groupByTask(events);
  const capabilityEvents = events.filter((event) => event.infrastructureFailure !== true && !event.infrastructureFailureType);
  const capabilityGroups = groupByTask(capabilityEvents);
  let firstPasses = 0;
  let finalPasses = 0;
  let escalatedTasks = 0;
  let verifierCoveredTasks = 0;

  for (const group of capabilityGroups.values()) {
    const first = group[0];
    const last = group.at(-1);
    if (first.verifierPassed === true && first.finalDelivered !== false) firstPasses += 1;
    if (last.verifierPassed === true && last.finalDelivered !== false) finalPasses += 1;
    if (group.length > 1 || group.some((event) => event.escalated === true || Number(event.attempt || 0) > 1)) escalatedTasks += 1;
    if (group.some((event) => typeof event.verifierPassed === 'boolean')) verifierCoveredTasks += 1;
  }

  const infrastructureFailures = distinctCount(
    events.filter((event) => event.infrastructureFailure === true || event.infrastructureFailureType),
    (event) => event.taskId || `${event.timestamp}-${event.routeId}`,
  );
  const routedTasks = routedGroups.size;
  const capabilityTasks = capabilityGroups.size;
  const directTasks = directSignals.length;
  const directCompleted = directSignals.filter((signal) => signal.status === 'completed').length;
  const userCorrections = events.filter((event) => event.userCorrected === true).length
    + directSignals.filter((signal) => signal.userCorrected === true).length;

  return {
    totalTasks: routedTasks + directTasks,
    routedTasks,
    routedAttempts: events.length,
    directTasks,
    directCompleted,
    capabilityTasks,
    firstPasses,
    finalPasses,
    firstPassRate: divide(firstPasses, capabilityTasks),
    finalPassRate: divide(finalPasses, capabilityTasks),
    overallObservedCompletionRate: divide(finalPasses + directCompleted, routedTasks + directTasks),
    escalatedTasks,
    escalationRate: divide(escalatedTasks, capabilityTasks),
    infrastructureFailures,
    infrastructureFailureRate: divide(infrastructureFailures, routedTasks),
    verifierCoveredTasks,
    verifierCoverageRate: divide(verifierCoveredTasks, capabilityTasks),
    falseGreenCount: events.filter((event) => event.modelClaimedSuccess === true && event.verifierPassed === false).length,
    userCorrections,
    inputTokens: events.reduce((sum, event) => sum + Number(event.inputTokens || 0), 0),
    cachedInputTokens: events.reduce((sum, event) => sum + Number(event.cachedInputTokens || 0), 0),
    outputTokens: events.reduce((sum, event) => sum + Number(event.outputTokens || 0), 0),
    estimatedCredits: events.reduce((sum, event) => sum + Number(event.estimatedCredits || 0), 0),
    routes: routeBreakdown(events),
  };
}

function difference(current, previous, key) {
  if (current[key] === null || previous[key] === null) return null;
  return Number((current[key] - previous[key]).toFixed(6));
}

function derivePolicyCandidates(policyState = {}) {
  const candidates = [];
  for (const [routeId, availability] of Object.entries(policyState.infrastructureRoutes || {})) {
    if (availability.cooldownUntil) candidates.push({ type: 'unavailable', taskFamily: 'infrastructure', routeId, automatic: false, cooldownUntil: availability.cooldownUntil });
  }
  for (const [taskFamily, family] of Object.entries(policyState.taskFamilies || {})) {
    if (family.stableRoute) candidates.push({ type: 'stable', taskFamily, routeId: family.stableRoute.routeId, automatic: true });
    if (family.trialRoute) candidates.push({ type: 'trial', taskFamily, routeId: family.trialRoute.routeId, automatic: false });
    for (const routeId of family.blockedRoutes || []) candidates.push({ type: 'blocked', taskFamily, routeId, automatic: false });
    for (const route of Object.values(family.routes || {})) {
      if (route.stableRevoked) candidates.push({ type: 'revoked', taskFamily, routeId: route.routeId, automatic: false });
    }
  }
  return candidates.sort((a, b) => a.taskFamily.localeCompare(b.taskFamily) || a.type.localeCompare(b.type) || a.routeId.localeCompare(b.routeId));
}

function buildReview(events, now = new Date(), options = {}) {
  const timeZone = options.timeZone || 'Asia/Shanghai';
  const rollingDays = Number(options.rollingDays || 7);
  const comparisonDays = Number(options.comparisonDays || 7);
  const directSignals = options.directSignals || [];
  const nowDay = dayNumber(now, timeZone);
  const todayEvents = events.filter((event) => inDayRange(event.timestamp, nowDay, 0, 0, timeZone));
  const rollingEvents = events.filter((event) => inDayRange(event.timestamp, nowDay, 0, rollingDays - 1, timeZone));
  const previousEvents = events.filter((event) => inDayRange(event.timestamp, nowDay, rollingDays, rollingDays + comparisonDays - 1, timeZone));
  const todayDirect = directSignals.filter((signal) => inDayRange(signal.timestamp, nowDay, 0, 0, timeZone));
  const rollingDirect = directSignals.filter((signal) => inDayRange(signal.timestamp, nowDay, 0, rollingDays - 1, timeZone));
  const previousDirect = directSignals.filter((signal) => inDayRange(signal.timestamp, nowDay, rollingDays, rollingDays + comparisonDays - 1, timeZone));
  const today = aggregate(todayEvents, todayDirect);
  const rolling7 = aggregate(rollingEvents, rollingDirect);
  const previous7 = aggregate(previousEvents, previousDirect);
  const trends = {
    firstPassRateDelta: difference(rolling7, previous7, 'firstPassRate'),
    finalPassRateDelta: difference(rolling7, previous7, 'finalPassRate'),
    verifierCoverageRateDelta: difference(rolling7, previous7, 'verifierCoverageRate'),
    infrastructureFailureRateDelta: difference(rolling7, previous7, 'infrastructureFailureRate'),
    escalationRateDelta: difference(rolling7, previous7, 'escalationRate'),
  };
  const progress = [];
  const weaknesses = [];

  if (trends.firstPassRateDelta !== null && trends.firstPassRateDelta > 0.05) progress.push(`首次通过率提升 ${formatPercent(trends.firstPassRateDelta)}`);
  if (trends.finalPassRateDelta !== null && trends.finalPassRateDelta > 0.05) progress.push(`最终通过率提升 ${formatPercent(trends.finalPassRateDelta)}`);
  if (trends.verifierCoverageRateDelta !== null && trends.verifierCoverageRateDelta > 0.05) progress.push(`验证覆盖率提升 ${formatPercent(trends.verifierCoverageRateDelta)}`);
  if (trends.infrastructureFailureRateDelta !== null && trends.infrastructureFailureRateDelta < -0.05) progress.push(`基础设施失败率下降 ${formatPercent(-trends.infrastructureFailureRateDelta)}`);

  if (trends.firstPassRateDelta !== null && trends.firstPassRateDelta < -0.05) weaknesses.push(`首次通过率下降 ${formatPercent(-trends.firstPassRateDelta)}`);
  if (trends.finalPassRateDelta !== null && trends.finalPassRateDelta < -0.05) weaknesses.push(`最终通过率下降 ${formatPercent(-trends.finalPassRateDelta)}`);
  if (trends.infrastructureFailureRateDelta !== null && trends.infrastructureFailureRateDelta > 0.05) weaknesses.push(`基础设施失败率上升 ${formatPercent(trends.infrastructureFailureRateDelta)}`);
  if (rolling7.infrastructureFailures > 0) weaknesses.push(`最近 7 日出现 ${rolling7.infrastructureFailures} 次基础设施失败，需与模型能力失败分开处理`);
  if (rolling7.falseGreenCount > 0) weaknesses.push(`出现 ${rolling7.falseGreenCount} 次模型自报成功但 verifier 未通过`);
  if (rolling7.userCorrections > 0) weaknesses.push(`出现 ${rolling7.userCorrections} 次用户纠正信号`);
  if (rolling7.verifierCoverageRate !== null && rolling7.verifierCoverageRate < 0.8) weaknesses.push(`验证覆盖率仅 ${formatPercent(rolling7.verifierCoverageRate)}`);

  const baselineAccumulating = rolling7.totalTasks < 3 || previous7.totalTasks < 3;
  if (baselineAccumulating && progress.length === 0) progress.push('基线积累中，暂不宣称趋势改善');
  if (baselineAccumulating && weaknesses.length === 0) weaknesses.push('样本不足，暂不能稳定识别退化任务族');

  const review = {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    reportDate: dateKey(now, timeZone),
    timeZone,
    baselineAccumulating,
    today,
    rolling7,
    previous7,
    trends,
    progress,
    weaknesses,
    policyCandidates: derivePolicyCandidates(options.policyState),
    dataNotes: [
      '路由指标来自脱敏账本并由脚本重算。',
      '母 Agent 直做任务只使用紧凑 rollout/Chronicle 信号，不复制对话原文。',
      '基础设施失败不计入模型能力通过率。',
    ],
  };
  if (options.v8) {
    review.v8 = buildV8Review(options.v8.traceEvents || [], options.v8.experiments || [], options.v8.lifecycle || [], options.v8);
  }
  return review;
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function metricLine(label, metric) {
  return `| ${label} | ${metric.totalTasks} | ${metric.routedTasks} | ${metric.directTasks} | ${formatPercent(metric.firstPassRate)} | ${formatPercent(metric.finalPassRate)} | ${formatPercent(metric.verifierCoverageRate)} | ${formatPercent(metric.infrastructureFailureRate)} | ${metric.falseGreenCount} | ${metric.userCorrections} | ${metric.inputTokens + metric.outputTokens} |`;
}

function renderReview(review) {
  const lines = [
    `# Brain Lite 每日复盘 · ${review.reportDate}`,
    '',
    review.baselineAccumulating ? '> 基线积累中：样本不足时只呈现事实，不据此自动扩大降档范围。' : '> 已具备可比较的双七日窗口；策略仍只在低风险、可验证任务族内自动采用。',
    '',
    '## 核心指标',
    '',
    '| 窗口 | 总任务 | 委派 | 母 Agent直做 | 首次通过率 | 最终通过率 | verifier 覆盖 | 基础设施失败率 | false-green | 用户纠正 | 路由 token |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    metricLine('今日', review.today),
    metricLine('最近 7 日', review.rolling7),
    metricLine('此前 7 日', review.previous7),
    '',
    '## 进步',
    '',
    ...review.progress.map((item) => `- ${item}`),
    '',
    '## 不足',
    '',
    ...review.weaknesses.map((item) => `- ${item}`),
    '',
    '## 路由策略候选',
    '',
  ];

  if (review.policyCandidates.length === 0) lines.push('- 暂无；继续积累独立 verifier 结果。');
  else {
    for (const candidate of review.policyCandidates) {
      const action = candidate.type === 'stable' ? '可在低风险且可验证任务中自动采用' : '仅记录候选，不自动采用';
      lines.push(`- ${candidate.taskFamily}: ${candidate.routeId} · ${candidate.type} · ${action}`);
    }
  }
  if (review.v8) {
    const attribution = review.v8.attribution.summary;
    const health = review.v8.indexHealth;
    lines.push(
      '',
      '## V8 控制面',
      '',
      `- Evidence/Skill 归因：total=${attribution.total} · review-candidate=${attribution['review-candidate']} · insufficient=${attribution['insufficient-evidence'] + attribution['insufficient-verification']} · retain=${attribution.retain}`,
      `- 索引健康：${health.status} · stale=${health.stale === null || health.stale === undefined ? 'unknown' : health.stale} · dataless=${Number(health.warningCounts?.dataless || 0)} · unindexed=${Number(health.unindexedSources || 0)} · missing=${Number(health.missingIndexedSources || 0)} · temp=${Number(health.temporaryFiles || 0)}`,
      '- 归因结果只生成观察或 review candidate，不自动改变 Evidence、Skill 或长期记忆生命周期。',
    );
  }
  lines.push('', '## 数据边界', '', ...review.dataNotes.map((item) => `- ${item}`), '');
  return lines.join('\n');
}

function fileTimestamp(filePath, stat) {
  const match = path.basename(filePath).match(/(20\d{2}-\d{2}-\d{2})(?:T(\d{2})[-:](\d{2})[-:](\d{2}))?/);
  if (!match) return stat.mtime.toISOString();
  return `${match[1]}T${match[2] || '12'}:${match[3] || '00'}:${match[4] || '00'}.000Z`;
}

function collectFiles(root, output, options) {
  if (!fs.existsSync(root) || output.length >= options.maxFiles) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (output.length >= options.maxFiles) break;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'attachments') continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(target, output, options);
    else if (/\.(?:jsonl|md)$/i.test(entry.name)) output.push(target);
  }
}

function collectDirectTaskSignals(roots, options = {}) {
  const files = [];
  const settings = { maxFiles: Number(options.maxFiles || 1000), maxBytes: Number(options.maxBytes || 262144) };
  for (const root of roots || []) collectFiles(path.resolve(root), files, settings);
  return files.map((filePath) => {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, settings.maxBytes);
    const descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(size);
    try {
      fs.readSync(descriptor, buffer, 0, size, Math.max(0, stat.size - size));
    } finally {
      fs.closeSync(descriptor);
    }
    const compact = buffer.toString('utf8');
    let status = 'observed';
    if (/"status"\s*:\s*"(?:complete|completed)"|\bstatus:\s*(?:complete|completed)\b/i.test(compact)) status = 'completed';
    else if (/"status"\s*:\s*"blocked"|\bstatus:\s*blocked\b/i.test(compact)) status = 'blocked';
    else if (/"status"\s*:\s*"failed"|\bstatus:\s*failed\b/i.test(compact)) status = 'failed';
    return {
      timestamp: fileTimestamp(filePath, stat),
      taskId: `direct-${crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)}`,
      status,
      userCorrected: /"userCorrected"\s*:\s*true/.test(compact),
      source: 'local-rollout-signal',
    };
  });
}

function loadJsonIfPresent(filePath, fallback) {
  return filePath && fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

function listFrom(value, key) {
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value[key]) ? value[key] : [];
}

function loadV8Inputs(options = {}) {
  const runtime = resolveRuntimePaths();
  const v8ConfigPath = path.resolve(options.v8ConfigPath || runtime.v8ConfigPath);
  const recallConfigPath = path.resolve(options.recallConfigPath || runtime.configPath);
  if (!fs.existsSync(v8ConfigPath)) return null;
  const config = JSON.parse(fs.readFileSync(v8ConfigPath, 'utf8'));
  if (config.enabled === false) return null;
  const brainRoot = path.resolve(path.dirname(v8ConfigPath), '..');
  const storedPath = (value) => value ? path.resolve(brainRoot, value) : null;
  const experimentsRaw = loadJsonIfPresent(storedPath(config.paths?.experiments), []);
  const lifecycleRaw = loadJsonIfPresent(storedPath(config.paths?.skillLifecycle), []);
  const tracePath = storedPath(config.paths?.trace);
  const traceEvents = tracePath && fs.existsSync(tracePath) ? readTrace(tracePath) : [];
  let indexHealth = { status: 'disabled', stale: null, warningCounts: {}, unindexedSources: 0, missingIndexedSources: 0, temporaryFiles: 0, fullPathsExposed: false, autoRepairApplied: false };
  if (config.indexHealth?.enabled !== false && fs.existsSync(recallConfigPath)) {
    const recallConfig = JSON.parse(fs.readFileSync(recallConfigPath, 'utf8'));
    indexHealth = inspectIndexHealth({
      indexPath: recallConfig.recall?.indexPath,
      sources: recallConfig.recall?.sources || [],
      now: options.now || new Date(),
      staleAfterHours: Number(config.indexHealth?.staleAfterHours || 48),
    });
  }
  return {
    traceEvents,
    experiments: listFrom(experimentsRaw, 'experiments'),
    lifecycle: listFrom(lifecycleRaw, 'skills'),
    outcomeAttribution: config.outcomeAttribution || {},
    indexHealth,
  };
}

function parseCli(argv) {
  const options = { rolloutRoots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ledger') options.ledger = path.resolve(argv[++index]);
    else if (arg === '--policy-state') options.policyState = path.resolve(argv[++index]);
    else if (arg === '--direct-signals') options.directSignals = path.resolve(argv[++index]);
    else if (arg === '--rollout-root') options.rolloutRoots.push(path.resolve(argv[++index]));
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else if (arg === '--date') options.date = new Date(argv[++index]);
    else if (arg === '--timezone') options.timeZone = argv[++index];
    else if (arg === '--v8-config') options.v8Config = path.resolve(argv[++index]);
    else if (arg === '--recall-config') options.recallConfig = path.resolve(argv[++index]);
    else if (arg === '--no-v8') options.noV8 = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return 'Usage: node scripts/brain-lite-daily-review.js --ledger FILE [--policy-state FILE] [--rollout-root DIR] [--output FILE] [--v8-config FILE] [--recall-config FILE] [--no-v8]';
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (!options.ledger) throw new Error('--ledger is required');
    const directSignals = [
      ...loadJsonIfPresent(options.directSignals, []),
      ...collectDirectTaskSignals(options.rolloutRoots),
    ];
    const review = buildReview(readEvents(options.ledger), options.date || new Date(), {
      timeZone: options.timeZone || 'Asia/Shanghai',
      directSignals,
      policyState: loadJsonIfPresent(options.policyState, {}),
      v8: options.noV8 ? null : loadV8Inputs({
        v8ConfigPath: options.v8Config,
        recallConfigPath: options.recallConfig,
        now: options.date || new Date(),
      }),
    });
    const rendered = options.json ? `${JSON.stringify(review, null, 2)}\n` : renderReview(review);
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true, mode: 0o700 });
      fs.writeFileSync(options.output, rendered, { encoding: 'utf8', mode: 0o600 });
    } else process.stdout.write(rendered);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  aggregate,
  buildReview,
  collectDirectTaskSignals,
  dateKey,
  derivePolicyCandidates,
  loadV8Inputs,
  renderReview,
};
