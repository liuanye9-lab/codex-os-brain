#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG, collectSourceFiles, parseArgs, readConfig } = require('./brain-lite-common');

function sourceRef(value) {
  return 'src_' + crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function countWarnings(warnings) {
  const counts = {};
  for (const warning of warnings) {
    const reason = String(warning.reason || 'unknown');
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function terminal(status, reason) {
  return {
    schemaVersion: 1,
    status,
    reason,
    stale: null,
    indexedSources: 0,
    discoveredSources: 0,
    unindexedSources: 0,
    missingIndexedSources: 0,
    temporaryFiles: 0,
    warningCounts: {},
    sourceRefs: [],
    fullPathsExposed: false,
    autoRepairApplied: false,
  };
}

function inspectIndexHealth({ indexPath, sources = [], now = new Date(), staleAfterHours = 48 } = {}) {
  if (!indexPath || !fs.existsSync(indexPath)) return terminal('unhealthy', 'missing-index');
  let index;
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
  catch { return terminal('unhealthy', 'corrupt-index'); }

  const discovered = collectSourceFiles(sources);
  const indexedPaths = new Set((index.sourceFiles || []).map((item) => path.resolve(String(item.path || ''))));
  const discoveredPaths = new Set(discovered.files.map((item) => path.resolve(item)));
  const unindexed = [...discoveredPaths].filter((item) => !indexedPaths.has(item));
  const missingIndexed = [...indexedPaths].filter((item) => !fs.existsSync(item));
  const temporary = fs.readdirSync(path.dirname(indexPath), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${path.basename(indexPath)}.tmp.`))
    .map((entry) => path.join(path.dirname(indexPath), entry.name));
  const warningMap = new Map();
  for (const warning of [...(Array.isArray(index.warnings) ? index.warnings : []), ...discovered.warnings]) {
    const key = `${String(warning.source || '')}\u0000${String(warning.reason || 'unknown')}`;
    if (!warningMap.has(key)) warningMap.set(key, warning);
  }
  const warnings = [...warningMap.values()];
  const builtAtMs = new Date(index.builtAt).getTime();
  const ageMs = Number.isFinite(builtAtMs) ? Math.max(0, new Date(now).getTime() - builtAtMs) : null;
  const stale = ageMs === null || ageMs > Number(staleAfterHours || 48) * 60 * 60 * 1000;
  const sourceRefs = [...new Set([
    ...unindexed,
    ...missingIndexed,
    ...warnings.map((warning) => warning.source),
  ].filter(Boolean).map(sourceRef))].sort();
  const degraded = stale || warnings.length > 0 || unindexed.length > 0 || missingIndexed.length > 0 || temporary.length > 0;

  return {
    schemaVersion: 1,
    status: degraded ? 'degraded' : 'healthy',
    reason: degraded ? 'index-health-findings' : null,
    builtAt: Number.isFinite(builtAtMs) ? new Date(builtAtMs).toISOString() : null,
    ageHours: ageMs === null ? null : Number((ageMs / 3_600_000).toFixed(3)),
    stale,
    indexedSources: indexedPaths.size,
    discoveredSources: discoveredPaths.size,
    unindexedSources: unindexed.length,
    missingIndexedSources: missingIndexed.length,
    temporaryFiles: temporary.length,
    warningCounts: countWarnings(warnings),
    sourceRefs,
    fullPathsExposed: false,
    autoRepairApplied: false,
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const config = readConfig(args.config || DEFAULT_CONFIG);
    const result = inspectIndexHealth({
      indexPath: config.recall.indexPath,
      sources: config.recall.sources,
      staleAfterHours: Number(args['stale-after-hours'] || 48),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { countWarnings, inspectIndexHealth, sourceRef };
