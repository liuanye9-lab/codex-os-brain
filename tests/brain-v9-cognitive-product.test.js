'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCognitiveAssetProvider, scopeHash } = require('../scripts/v9/cognitive-assets');
const { openMemoryDatabase } = require('../scripts/v9/memory-db');
const { resolveV9Paths } = require('../scripts/v9/paths');

const CLOCK = new Date('2026-07-31T00:00:00.000Z');
let sequence = 0;

function approval(objectId, objectVersion, action, scope) {
  sequence += 1;
  return {
    receiptId: `product-approval-${sequence}`,
    authorityMode: 'protected',
    actor: 'test-protected-ui',
    objectId,
    objectVersion,
    action,
    scopeHash: scopeHash(scope),
    issuedAt: '2026-07-30T23:59:00.000Z',
    expiresAt: '2026-07-31T00:04:00.000Z',
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-cognitive-product-'));
  const paths = resolveV9Paths({ CODEX_BRAIN_HOME: path.join(root, 'brain'), CODEX_BRAIN_STATE_HOME: path.join(root, 'state') });
  const provider = createCognitiveAssetProvider({
    paths,
    authorityMode: 'protected',
    approvalVerifier: () => true,
    clock: () => CLOCK,
  });
  return { paths, provider };
}

function seedRunnablePlaybook(provider) {
  provider.ingestSource({ documentId: 'source-product', sourceUri: 'local:product', content: '完成前必须独立验证关键结果。' });
  const sourceScope = {
    trustStatus: 'trusted',
    allowedUses: ['evidence_extraction', 'recall', 'playbook_compile', 'knowledge_compile'],
  };
  provider.reviewSource('source-product', {
    ...sourceScope,
    approvalReceipt: approval('source-product', 1, 'review_source', sourceScope),
  });
  const evidence = provider.addEvidenceAssertion({
    evidenceId: 'evidence-product',
    sourceId: 'source-product',
    epistemicType: 'user_experience',
    anchorRef: { startChar: 0, endChar: 14 },
    anchorStatus: 'verified',
    attributionStatus: 'verified',
    entailmentStatus: 'verified',
    externalFactStatus: 'not_applicable',
    uncertainty: 0.1,
  });
  const unit = provider.proposeCognition({
    unitId: 'unit-product',
    claim: '关键结果在交付前需要独立验证',
    cognitionType: 'delivery_principle',
    context: { taskClass: 'engineering' },
    mechanism: { action: 'run verifier', result: 'observable evidence' },
    boundary: '纯探索任务允许阶段性证据',
    falsifier: '验证器无法观察结果',
    counterexample: '无需交付的闲聊',
    transferScope: { domains: ['coding', 'research'] },
    evidenceDependencies: [evidence.evidenceId],
    privacyLevel: 'local_only',
  });
  const cognitionScope = { status: 'confirmed', evidenceDependencies: [evidence.evidenceId] };
  provider.approveCognition(unit.unitId, {
    expectedVersion: unit.version,
    approvalReceipt: approval(unit.unitId, unit.version, 'approve_cognition', cognitionScope),
  });
  const playbook = provider.compilePlaybook({
    playbookId: 'playbook-product',
    name: '证据化交付',
    targetProblem: '避免没有验证的完成声明',
    cognitionUnitIds: [unit.unitId],
    triggers: ['任务准备交付'],
    steps: [{ id: 'verify', instruction: '执行独立验证并保留证据' }],
    qualityChecks: ['所有必需标准均有验证证据'],
    rollback: ['验证失败时保持 partial'],
  });
  const playbookScope = {
    from: 'method_candidate',
    to: 'runnable_playbook',
    metrics: { realCases: 0, boundaryCases: 0, successRate: 0, criticalSafetyFailures: 0 },
  };
  return provider.promotePlaybook(playbook.playbookId, {
    expectedVersion: playbook.version,
    approvalReceipt: approval(playbook.playbookId, playbook.version, 'promote_playbook', playbookScope),
  });
}

test('Playbook -> Knowledge Base -> Agent is versioned, gated, budgeted, and stale-blocked', () => {
  const { paths, provider } = setup();
  const playbook = seedRunnablePlaybook(provider);
  const knowledgeBase = provider.compileKnowledgeBase({
    knowledgeBaseId: 'kb-product',
    name: '可靠交付知识库',
    domain: 'software-delivery',
    description: '只包含有证据的认知与可运行 Playbook。',
    cognitionUnitIds: ['unit-product'],
    playbookIds: [playbook.playbookId],
    retrievalPolicy: { modes: ['lexical', 'temporal'], maxClaims: 10, maxPlaybooks: 3, requireCitations: true },
  });
  assert.equal(knowledgeBase.status, 'draft');
  const publishScope = { from: 'draft', to: 'published', dependencyDigest: knowledgeBase.dependencyDigest };
  const published = provider.publishKnowledgeBase(knowledgeBase.knowledgeBaseId, {
    expectedVersion: knowledgeBase.version,
    approvalReceipt: approval(knowledgeBase.knowledgeBaseId, knowledgeBase.version, 'publish_knowledge_base', publishScope),
  });
  assert.equal(published.status, 'published');

  const toolScope = { dependencyType: 'tool_contract', dependencyId: 'read-only-shell', nextVersion: 1, digest: 'e'.repeat(64), status: 'current' };
  const toolContract = provider.registerDependency({
    dependencyType: 'tool_contract',
    dependencyId: 'read-only-shell',
    digest: toolScope.digest,
    expectedVersion: 0,
    approvalReceipt: approval('dependency:tool_contract:read-only-shell', 0, 'register_dependency', toolScope),
  });
  const agent = provider.compileAgentProfile({
    agentId: 'agent-product',
    name: '可靠交付 Agent',
    purpose: '在本地项目中执行证据化交付',
    knowledgeBaseIds: [published.knowledgeBaseId],
    toolRefs: ['read-only-shell'],
    dependencyRefs: [toolContract],
    contextBudgetTokens: 1200,
  });
  assert.equal(provider.assessAgent(agent.agentId, { targetState: 'shadow' }).ready, true);
  assert.equal(provider.assessAgent(agent.agentId, { targetState: 'active' }).ready, false);
  const deployScope = { from: 'draft', to: 'shadow', dependencyDigest: agent.dependencyDigest };
  const deployed = provider.deployAgent(agent.agentId, {
    expectedVersion: agent.version,
    targetState: 'shadow',
    approvalReceipt: approval(agent.agentId, agent.version, 'deploy_agent', deployScope),
  });
  assert.equal(deployed.deploymentState, 'shadow');
  const context = provider.prepareAgentContext(agent.agentId, { purpose: agent.purpose, tokenBudget: 800 });
  assert.equal(context.executionPerformed, false);
  assert.equal(context.sourceContentIncluded, false);
  assert.ok(context.estimatedTokens <= context.tokenBudget);
  assert.ok(Math.ceil(JSON.stringify(context).length / 4) <= context.tokenBudget);
  assert.ok(context.knowledge.some(item => item.unitId === 'unit-product'));
  assert.deepEqual(context.knowledge[0].evidenceDependencies, ['evidence-product']);
  assert.equal(context.citationsRequired, true);
  assert.equal(context.contextDigest.length, 64);
  assert.throws(() => provider.prepareAgentContext(agent.agentId, { tokenBudget: 100 }), error => {
    assert.equal(error.code, 'agent_context_budget_too_small');
    assert.ok(error.details.minimumTokens > 100);
    return true;
  });
  assert.deepEqual(provider.productMap().stages.map(stage => stage.id), ['evidence', 'cognition', 'playbook', 'knowledge_base', 'agent']);

  const db = openMemoryDatabase({ paths });
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 4);
  assert.deepEqual(db.prepare("SELECT version FROM cognitive_product_versions WHERE asset_type='agent' AND asset_id='agent-product' ORDER BY version").all().map(row => row.version), [1, 2]);
  db.prepare("UPDATE cognition_units SET status='retired' WHERE unit_id='unit-product'").run();
  db.close();
  assert.throws(() => provider.prepareAgentContext(agent.agentId), /agent_profile_stale_blocked/);
  const check = openMemoryDatabase({ paths });
  assert.equal(check.prepare("SELECT status FROM cognitive_knowledge_bases WHERE knowledge_base_id='kb-product'").get().status, 'stale_blocked');
  assert.equal(check.prepare("SELECT readiness_status FROM cognitive_agent_profiles WHERE agent_id='agent-product'").get().readiness_status, 'stale_blocked');
  check.close();
});
