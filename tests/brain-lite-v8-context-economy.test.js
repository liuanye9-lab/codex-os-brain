'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextPacket, markEvidenceUse } = require('../scripts/brain-lite-context-economy');

test('context packet redacts, deduplicates, caps sources, and stays under budget', () => {
  const packet = buildContextPacket([
    { source: '/private/a.md', heading: 'A', content: 'API_KEY=secret-value alpha decision', score: 0.9 },
    { source: '/private/a.md', heading: 'A duplicate', content: 'API_KEY=secret-value alpha decision', score: 0.8 },
    { source: '/private/a.md', heading: 'A second', content: 'beta constraint', score: 0.7 },
    { source: '/private/a.md', heading: 'A third', content: 'gamma overflow', score: 0.6 },
    { source: '/private/b.md', heading: 'B', content: 'delta verifier', score: 0.95 },
  ], { tokenBudget: 300, maxItems: 4, maxItemsPerSource: 2 });
  assert.ok(packet.estimatedTokens <= 300);
  assert.equal(packet.injected.length, 3);
  assert.equal(new Set(packet.injected.map((item) => item.evidenceId)).size, 3);
  assert.doesNotMatch(JSON.stringify(packet), /secret-value/);
  assert.equal(packet.metrics.duplicateItems, 1);
  assert.equal(packet.metrics.sourceCappedItems, 1);
});

test('evidence use produces precision and utilization metrics', () => {
  const packet = buildContextPacket([
    { source: 'a.md', heading: 'A', content: 'alpha decision', score: 0.9 },
    { source: 'b.md', heading: 'B', content: 'beta verifier', score: 0.8 },
  ], { tokenBudget: 900, maxItems: 4, maxItemsPerSource: 2 });
  const used = markEvidenceUse(packet, [{ evidenceId: packet.injected[0].evidenceId, useType: 'decision' }]);
  assert.equal(used.metrics.injectedItems, 2);
  assert.equal(used.metrics.usedItems, 1);
  assert.equal(used.metrics.precision, 0.5);
  assert.ok(used.metrics.utilization > 0 && used.metrics.utilization < 1);
});
