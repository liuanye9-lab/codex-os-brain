'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCognitiveAssetProvider, scopeHash, sanitizeHarnessTrajectory } = require('../scripts/v9/cognitive-assets');
const { openMemoryDatabase } = require('../scripts/v9/memory-db');
const { resolveV9Paths } = require('../scripts/v9/paths');

const CLOCK = new Date('2026-07-28T00:00:00.000Z');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cognitive-assets-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  const provider = createCognitiveAssetProvider({
    paths,
    authorityMode: 'protected',
    approvalVerifier: () => true,
    clock: () => CLOCK,
  });
  return { provider, paths };
}

let receiptSequence = 0;
function approval(objectId, objectVersion, action, scope) {
  receiptSequence += 1;
  return {
    receiptId: `approval-${receiptSequence}`,
    authorityMode: 'protected',
    actor: 'test-protected-ui',
    objectId,
    objectVersion,
    action,
    scopeHash: scopeHash(scope),
    issuedAt: '2026-07-27T23:59:00.000Z',
    expiresAt: '2026-07-28T00:04:00.000Z',
  };
}

function confirmedUnit(provider) {
  const imported = provider.ingestSource({
    documentId: 'source-1',
    sourceUri: 'local:test',
    content: '真实任务要先定义可观察的完成标准。',
    captureMode: 'guided_interview',
    privacyLevel: 'local_only',
  });
  assert.equal(imported.trustStatus, 'quarantined');
  const sourceScope = { trustStatus: 'trusted', allowedUses: ['evidence_extraction', 'recall', 'playbook_compile'] };
  provider.reviewSource('source-1', {
    ...sourceScope,
    approvalReceipt: approval('source-1', 1, 'review_source', sourceScope),
  });
  const evidence = provider.addEvidenceAssertion({
    evidenceId: 'evidence-1',
    sourceId: 'source-1',
    epistemicType: 'user_experience',
    anchorRef: { startChar: 0, endChar: 19 },
    anchorStatus: 'verified',
    attributionStatus: 'verified',
    entailmentStatus: 'verified',
    externalFactStatus: 'not_applicable',
    uncertainty: 0.1,
  });
  const unit = provider.proposeCognition({
    unitId: 'unit-1',
    claim: '行动前先定义可观察的完成标准',
    cognitionType: 'principle',
    context: { taskClass: 'delivery' },
    mechanism: { premise: '目标可能含糊', process: '定义可观察标准', outcome: '结果可独立验收' },
    boundary: '纯探索任务可以使用阶段性标准',
    falsifier: '标准不能被独立证据检查',
    counterexample: '开放式闲聊',
    transferScope: { domains: ['coding', 'research'] },
    evidenceDependencies: [evidence.evidenceId],
    privacyLevel: 'local_only',
  });
  const scope = { status: 'confirmed', evidenceDependencies: ['evidence-1'] };
  return provider.approveCognition(unit.unitId, {
    expectedVersion: unit.version,
    approvalReceipt: approval(unit.unitId, unit.version, 'approve_cognition', scope),
  });
}

function runnablePlaybook(provider) {
  confirmedUnit(provider);
  const dependencyScope = {
    dependencyType: 'policy',
    dependencyId: 'default-cognitive-policy',
    nextVersion: 1,
    digest: 'd'.repeat(64),
    status: 'current',
  };
  const policy = provider.registerDependency({
    dependencyType: dependencyScope.dependencyType,
    dependencyId: dependencyScope.dependencyId,
    digest: dependencyScope.digest,
    expectedVersion: 0,
    approvalReceipt: approval('dependency:policy:default-cognitive-policy', 0, 'register_dependency', dependencyScope),
  });
  const playbook = provider.compilePlaybook({
    playbookId: 'playbook-1',
    name: '可靠任务交付',
    targetProblem: '避免任务看似完成但没有证据',
    cognitionUnitIds: ['unit-1'],
    triggers: ['真实任务需要可靠交付'],
    steps: [
      { id: 'define', instruction: '定义完成标准', producerFields: ['criteria'] },
      { id: 'verify', instruction: '独立验证结果', dependsOn: ['define'], consumerFields: ['criteria'] },
    ],
    qualityChecks: ['所有完成标准都有证据'],
    rollback: ['无法验证时退回 candidate'],
    dependencyRefs: [policy],
  });
  const scope = {
    from: 'method_candidate',
    to: 'runnable_playbook',
    metrics: { realCases: 0, boundaryCases: 0, successRate: 0, criticalSafetyFailures: 0 },
  };
  return provider.promotePlaybook(playbook.playbookId, {
    expectedVersion: playbook.version,
    approvalReceipt: approval(playbook.playbookId, playbook.version, 'promote_playbook', scope),
  });
}

test('Cognitive Asset Protocol is candidate-first, evidence-gated and approval-bound', () => {
  const { provider, paths } = setup();
  const unit = confirmedUnit(provider);
  assert.equal(unit.status, 'confirmed');
  assert.throws(() => provider.approveCognition('unit-1', {
    expectedVersion: 2,
    approvalReceipt: approval('unit-1', 2, 'approve_cognition', {}),
  }), /cognition_version_conflict/);
  const digest = provider.dailyDigest();
  assert.equal(digest.pending, 0);
  assert.equal(provider.status().counts.confirmedCognition, 1);
  const db = openMemoryDatabase({ paths });
  assert.deepEqual(db.prepare("SELECT version FROM cognitive_asset_versions WHERE asset_type='cognition' AND asset_id='unit-1' ORDER BY version").all().map(row => row.version), [1, 2]);
  db.close();
});

test('playbooks stale-block on dependency drift before another run', () => {
  const { provider, paths } = setup();
  const playbook = runnablePlaybook(provider);
  assert.equal(provider.requestRun(playbook.playbookId, { input: { task: '交付报告' } }).sourceContentIncluded, false);
  const db = openMemoryDatabase({ paths });
  db.prepare("UPDATE cognitive_evidence_assertions SET entailment_status='failed',updated_at='2026-07-29T00:00:00.000Z' WHERE evidence_id='evidence-1'").run();
  db.close();
  assert.throws(() => provider.requestRun(playbook.playbookId, { input: { task: '继续交付' } }), /playbook_stale_blocked/);
  const verifyDb = openMemoryDatabase({ paths });
  assert.equal(verifyDb.prepare("SELECT validation_status FROM cognitive_playbooks WHERE playbook_id='playbook-1'").get().validation_status, 'stale_blocked');
  verifyDb.close();
});

test('policy and tool-contract registry drift stale-blocks pinned playbooks', () => {
  const { provider, paths } = setup();
  const playbook = runnablePlaybook(provider);
  const dependencyScope = {
    dependencyType: 'policy',
    dependencyId: 'default-cognitive-policy',
    nextVersion: 2,
    digest: 'e'.repeat(64),
    status: 'current',
  };
  provider.registerDependency({
    dependencyType: dependencyScope.dependencyType,
    dependencyId: dependencyScope.dependencyId,
    digest: dependencyScope.digest,
    expectedVersion: 1,
    approvalReceipt: approval('dependency:policy:default-cognitive-policy', 1, 'register_dependency', dependencyScope),
  });
  assert.throws(() => provider.requestRun(playbook.playbookId, { input: { task: '策略已变化' } }), /playbook_stale_blocked/);
  const db = openMemoryDatabase({ paths });
  assert.equal(db.prepare("SELECT validation_status FROM cognitive_playbooks WHERE playbook_id='playbook-1'").get().validation_status, 'stale_blocked');
  db.close();
});

test('verified capability needs ten distinct real cases, three boundaries and an independent verifier', () => {
  const { provider } = setup();
  const playbook = runnablePlaybook(provider);
  assert.throws(() => provider.verifyRun(playbook.playbookId, {
    outcome: 'success',
    contextHash: 'a'.repeat(64),
    semanticCaseHash: 'b'.repeat(64),
    executorIdentity: 'same',
    verifierIdentity: 'same',
    productionPath: true,
  }), /independent_verifier_required/);
  for (let index = 0; index < 10; index += 1) {
    provider.verifyRun(playbook.playbookId, {
      receiptId: `reuse-${index}`,
      outcome: index < 8 ? 'success' : 'failure',
      caseKind: index < 3 ? 'boundary' : 'ordinary',
      contextHash: crypto.createHash('sha256').update(`context-${index}`).digest('hex'),
      semanticCaseHash: crypto.createHash('sha256').update(`case-${index}`).digest('hex'),
      executorIdentity: 'codex-executor',
      verifierIdentity: 'independent-test-runner',
      productionPath: true,
    });
  }
  const metrics = { realCases: 10, boundaryCases: 3, successRate: 0.8, criticalSafetyFailures: 0 };
  const verified = provider.promotePlaybook(playbook.playbookId, {
    expectedVersion: playbook.version,
    approvalReceipt: approval(playbook.playbookId, playbook.version, 'promote_playbook', {
      from: 'runnable_playbook',
      to: 'verified_capability',
      metrics,
    }),
  });
  assert.equal(verified.semanticMaturity, 'verified_capability');
});

test('projection grants are local, purpose-bound, expiring and read-only', () => {
  const { provider } = setup();
  const runnable = runnablePlaybook(provider);
  for (let index = 0; index < 10; index += 1) {
    provider.verifyRun(runnable.playbookId, {
      receiptId: `projection-reuse-${index}`,
      outcome: index < 8 ? 'success' : 'failure',
      caseKind: index < 3 ? 'adversarial' : 'ordinary',
      contextHash: crypto.createHash('sha256').update(`projection-context-${index}`).digest('hex'),
      semanticCaseHash: crypto.createHash('sha256').update(`projection-case-${index}`).digest('hex'),
      executorIdentity: 'executor',
      verifierIdentity: 'verifier',
      productionPath: true,
    });
  }
  const verified = provider.promotePlaybook(runnable.playbookId, {
    expectedVersion: runnable.version,
    approvalReceipt: approval(runnable.playbookId, runnable.version, 'promote_playbook', {
      from: 'runnable_playbook',
      to: 'verified_capability',
      metrics: { realCases: 10, boundaryCases: 3, successRate: 0.8, criticalSafetyFailures: 0 },
    }),
  });
  const policyDigest = 'c'.repeat(64);
  const expiresAt = '2026-07-29T00:00:00.000Z';
  const contentVersion = crypto.createHash('sha256').update(JSON.stringify([[verified.playbookId, verified.version]])).digest('hex');
  const projectionScope = {
    recipientAgent: 'agent-a',
    purpose: 'reliable-delivery',
    assetIds: [verified.playbookId],
    expiresAt,
    contentVersion,
    policyDigest,
    noOnwardSharing: true,
  };
  const grant = provider.createProjection({
    recipientAgent: 'agent-a',
    purpose: 'reliable-delivery',
    assetIds: [verified.playbookId],
    expiresAt,
    policyDigest,
    transport: 'local',
    approvalReceipt: approval('projection:agent-a', 1, 'create_projection', projectionScope),
  });
  const read = provider.readProjection({
    grantId: grant.grantId,
    recipientAgent: 'agent-a',
    purpose: 'reliable-delivery',
    policyDigest,
  });
  assert.equal(read.count, 1);
  assert.equal(read.noOnwardSharing, true);
  assert.equal('sourceContent' in read.assets[0], false);
  assert.throws(() => provider.readProjection({
    grantId: grant.grantId,
    recipientAgent: 'agent-b',
    purpose: 'reliable-delivery',
    policyDigest,
  }), /projection_grant_invalid/);
});

test('sanitized Harness trajectories contain no raw output or hidden reasoning', () => {
  const trajectory = sanitizeHarnessTrajectory({
    taskClass: 'coding',
    constraints: ['read-only verifier'],
    actionSummary: ['ran tests'],
    outcome: 'success',
    evidenceRefs: ['/private/example/output.txt'],
    hiddenReasoning: 'never persist this',
    rawOutput: 'secret output',
  });
  assert.equal(trajectory.hiddenReasoningIncluded, false);
  assert.equal(trajectory.rawOutputIncluded, false);
  assert.equal(JSON.stringify(trajectory).includes('secret output'), false);
  assert.equal(JSON.stringify(trajectory).includes('/private/example/'), false);
});
