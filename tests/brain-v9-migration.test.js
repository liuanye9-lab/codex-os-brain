'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256File } = require('../scripts/v9/store');
const { inventoryLegacy, planMigration, applyMigration, verifyMigration, writeRollbackMarker } = require('../scripts/v9/migration');

const fixtureRoot = path.join(__dirname, 'fixtures', 'v9-legacy');

function hashes(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(root, full)] = sha256File(full);
    }
  }
  visit(root);
  return result;
}

test('inventory covers root-era and versioned assets without changing source hashes', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-inventory-'));
  const before = hashes(fixtureRoot);
  const manifest = inventoryLegacy({ brainRoot: fixtureRoot, outputRoot });
  assert.ok(manifest.records.some(record => record.detectedVersion === 2));
  assert.ok(manifest.records.some(record => record.detectedVersion === 8));
  assert.deepEqual(hashes(fixtureRoot), before);
});

test('apply requires confirmation and a verified backup', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-migration-'));
  const plan = planMigration(inventoryLegacy({ brainRoot: fixtureRoot, outputRoot }));
  assert.throws(() => applyMigration(plan, { confirm: false, backupRoot: path.join(outputRoot, 'backup') }), /explicit_confirmation_required/);
  assert.throws(() => applyMigration(plan, { confirm: true, backupRoot: path.join(outputRoot, 'missing') }), /verified_backup_required/);
});

test('migration is idempotent, provenance-preserving, and rollback-selectable', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-apply-'));
  const manifest = inventoryLegacy({ brainRoot: fixtureRoot, outputRoot });
  const plan = planMigration(manifest);
  const backupRoot = path.join(outputRoot, 'backup');
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.writeFileSync(path.join(backupRoot, 'backup-manifest.json'), JSON.stringify({ manifestHash: plan.manifestHash }));
  const first = applyMigration(plan, { confirm: true, backupRoot });
  const second = applyMigration(plan, { confirm: true, backupRoot });
  assert.equal(first.created, first.total);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, first.total);
  assert.ok(first.records.every(record => record.sourceHash && record.adapterVersion));
  assert.equal(verifyMigration(manifest, first).passed, true);
  assert.equal(writeRollbackMarker(outputRoot, 8).targetVersion, 8);
});
