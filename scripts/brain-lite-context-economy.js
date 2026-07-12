'use strict';
const path = require('node:path');
const { contentHash, estimateTokens, redactSensitive } = require('./brain-lite-common');

function evidenceId(item) {
  return 'ev_' + contentHash([path.basename(String(item.source || 'unknown')), String(item.heading || ''), String(item.content || '')].join('\u0000')).slice(0, 20);
}

function contextMetrics(packet) {
  const injected = packet.injected || [];
  const used = injected.filter((item) => item.used === true);
  const injectedTokens = injected.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const usedTokens = used.reduce((sum, item) => sum + item.estimatedTokens, 0);
  return {
    retrievedItems: packet.retrievedItems, injectedItems: injected.length, usedItems: used.length,
    duplicateItems: packet.duplicateItems, sourceCappedItems: packet.sourceCappedItems,
    injectedTokens, usedTokens,
    precision: injected.length ? used.length / injected.length : null,
    utilization: injectedTokens ? usedTokens / injectedTokens : null,
    retrievalEfficiency: packet.retrievedItems ? used.length / packet.retrievedItems : null,
  };
}

function buildContextPacket(items = [], options = {}) {
  const tokenBudget = Math.min(900, Number(options.tokenBudget || 900));
  const maxItems = Number(options.maxItems || 4);
  const maxItemsPerSource = Number(options.maxItemsPerSource || 2);
  const seen = new Set();
  const sourceCounts = new Map();
  const injected = [];
  let estimatedTokens = 0;
  let duplicateItems = 0;
  let sourceCappedItems = 0;
  const ranked = [...items].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  for (const raw of ranked) {
    const content = redactSensitive(raw.content || '');
    const hash = contentHash(content);
    if (seen.has(hash)) { duplicateItems += 1; continue; }
    const sourceKey = path.basename(String(raw.source || 'unknown'));
    const sourceCount = sourceCounts.get(sourceKey) || 0;
    if (sourceCount >= maxItemsPerSource) { sourceCappedItems += 1; continue; }
    const item = {
      evidenceId: evidenceId({ ...raw, content }), source: sourceKey,
      heading: String(raw.heading || sourceKey), modifiedAt: raw.modifiedAt || null,
      score: Number(raw.score || 0), content, useType: null, used: false,
    };
    item.estimatedTokens = estimateTokens(JSON.stringify(item));
    if (injected.length >= maxItems || estimatedTokens + item.estimatedTokens > tokenBudget) continue;
    injected.push(item);
    estimatedTokens += item.estimatedTokens;
    seen.add(hash);
    sourceCounts.set(sourceKey, sourceCount + 1);
  }
  const packet = { schemaVersion: 1, tokenBudget, estimatedTokens, retrievedItems: items.length, duplicateItems, sourceCappedItems, injected };
  packet.metrics = contextMetrics(packet);
  return packet;
}

function markEvidenceUse(packet, uses = []) {
  const byId = new Map(uses.map((use) => [use.evidenceId, use.useType]));
  const output = { ...packet, injected: packet.injected.map((item) => ({ ...item, used: byId.has(item.evidenceId), useType: byId.get(item.evidenceId) || null })) };
  output.metrics = contextMetrics(output);
  return output;
}

module.exports = { buildContextPacket, contextMetrics, evidenceId, markEvidenceUse };
