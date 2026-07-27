'use strict';

const crypto = require('node:crypto');
const { openMemoryDatabase, transaction } = require('./memory-db');
const { createMemoryService } = require('./memory-service');
const { resolveV9Paths } = require('./paths');

const PROTOCOL_VERSION = 'cognitive-asset-v1';
const SENSITIVE_TYPES = new Set(['personality','emotion','health','relationship','values']);
const EPISTEMIC_TYPES = new Set(['source_fact','speaker_claim','user_experience','synthesis_inference','project_application']);
const ALLOWED_USES = new Set(['evidence_extraction','recall','playbook_compile','projection']);

function id(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function now() { return new Date().toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function json(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function clean(value, max = 4000) { return String(value || '').trim().slice(0, max); }
function uniqueStrings(value, maxItems = 100, maxChars = 500) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => clean(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}
function coded(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function scopeHash(value) { return hash(stableJson(value || {})); }

function recordAssetVersion(db, assetType, asset, action, payload = {}) {
  const assetId = assetType === 'cognition' ? asset.unitId : asset.playbookId;
  db.prepare(`INSERT INTO cognitive_asset_versions(asset_type,asset_id,version,snapshot_json,created_at)
    VALUES(?,?,?,?,?)`).run(assetType, assetId, asset.version, stableJson(asset), now());
  db.prepare(`INSERT INTO cognitive_asset_events(event_id,asset_type,asset_id,asset_version,action,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(id('asset_event'), assetType, assetId, asset.version, action, stableJson(payload), now());
  return asset;
}

function normalizeInstant(value, field) {
  const instant = new Date(String(value || ''));
  if (!value || !Number.isFinite(instant.getTime())) throw coded(`invalid_${field}`);
  return instant.toISOString();
}

function mapSource(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sourceId: row.document_id,
    captureMode: row.capture_mode,
    sourceHash: row.content_hash,
    sourceRef: row.source_uri ? `source:${hash(row.source_uri).slice(0, 16)}` : null,
    title: row.title,
    trustStatus: row.trust_status,
    privacyLevel: row.privacy_level,
    subjects: json(row.subjects_json, []),
    allowedUses: json(row.allowed_uses_json, []),
    retentionPolicy: json(row.retention_policy_json, {}),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    evidenceId: row.evidence_id,
    sourceId: row.document_id,
    sourceVersion: row.source_version,
    epistemicType: row.epistemic_type,
    anchorRef: json(row.anchor_ref_json, {}),
    anchorStatus: row.anchor_status,
    attributionStatus: row.attribution_status,
    entailmentStatus: row.entailment_status,
    externalFactStatus: row.external_fact_status,
    uncertainty: row.uncertainty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUnit(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    unitId: row.unit_id,
    claim: row.claim,
    cognitionType: row.cognition_type,
    context: json(row.context_json, {}),
    mechanism: json(row.mechanism_json, {}),
    boundary: row.boundary,
    falsifier: row.falsifier,
    counterexample: row.counterexample,
    transferScope: json(row.transfer_scope_json, {}),
    evidenceDependencies: json(row.evidence_dependencies_json, []),
    status: row.status,
    privacyLevel: row.privacy_level,
    sensitiveInference: row.sensitive_inference === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlaybook(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    playbookId: row.playbook_id,
    name: row.name,
    targetProblem: row.target_problem,
    manifest: json(row.manifest_json, {}),
    evidenceDependencies: json(row.evidence_dependencies_json, []),
    dependencyDigest: row.dependency_digest,
    semanticMaturity: row.semantic_maturity,
    deploymentState: row.deployment_state,
    validationStatus: row.validation_status,
    privacyLevel: row.privacy_level,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createCognitiveAssetProvider({
  paths = resolveV9Paths(),
  dbPath = paths.memoryDbPath,
  authorityMode = 'operator_guardrail_only',
  approvalVerifier = null,
  clock = () => new Date(),
} = {}) {
  const memory = createMemoryService({ paths, dbPath });
  function using(fn) {
    const db = openMemoryDatabase({ paths, dbPath });
    try { return fn(db); } finally { db.close(); }
  }

  function consumeApproval(db, receipt, expected) {
    if (authorityMode !== 'protected') throw coded('protected_approval_authority_unavailable');
    if (!receipt || receipt.authorityMode !== 'protected' || typeof approvalVerifier !== 'function') throw coded('protected_approval_required');
    if (approvalVerifier(receipt, expected) !== true) throw coded('approval_signature_invalid');
    const issuedAt = normalizeInstant(receipt.issuedAt, 'approval_issued_at');
    const expiresAt = normalizeInstant(receipt.expiresAt, 'approval_expires_at');
    const observed = clock().getTime();
    if (Date.parse(issuedAt) > observed + 10_000 || Date.parse(expiresAt) <= observed || Date.parse(expiresAt) - Date.parse(issuedAt) > 300_000) {
      throw coded('approval_expired');
    }
    if (receipt.objectId !== expected.objectId
      || Number(receipt.objectVersion) !== Number(expected.objectVersion)
      || receipt.action !== expected.action
      || receipt.scopeHash !== scopeHash(expected.scope)) throw coded('approval_binding_mismatch');
    const receiptId = clean(receipt.receiptId, 160);
    if (!receiptId) throw coded('approval_receipt_id_required');
    try {
      db.prepare(`INSERT INTO cognitive_approval_receipts(
        receipt_id,authority_mode,object_id,object_version,action,scope_hash,issued_at,expires_at,consumed_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(receiptId, 'protected', expected.objectId, Number(expected.objectVersion), expected.action,
        receipt.scopeHash, issuedAt, expiresAt, now());
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw coded('approval_replayed');
      throw error;
    }
    return { receiptId, actor: clean(receipt.actor, 120) || 'protected_operator' };
  }

  function ingestSource(input = {}) {
    const allowedUses = uniqueStrings(input.allowedUses).filter(use => ALLOWED_USES.has(use));
    return memory.importDocument({
      ...input,
      captureMode: clean(input.captureMode, 80) || 'daily',
      trustStatus: input.trustStatus || 'quarantined',
      privacyLevel: input.privacyLevel || 'local_only',
      allowedUses,
    });
  }

  function reviewSource(sourceId, input = {}) {
    return using(db => transaction(db, () => {
      const row = db.prepare('SELECT * FROM source_documents WHERE document_id=?').get(sourceId);
      if (!row) throw coded('cognitive_source_not_found');
      const trustStatus = ['trusted','untrusted','quarantined','revoked'].includes(input.trustStatus) ? input.trustStatus : row.trust_status;
      const allowedUses = uniqueStrings(input.allowedUses).filter(use => ALLOWED_USES.has(use));
      if (trustStatus !== 'trusted' && allowedUses.some(use => use !== 'evidence_extraction')) throw coded('untrusted_source_use_forbidden');
      const scope = { trustStatus, allowedUses };
      consumeApproval(db, input.approvalReceipt, { objectId: sourceId, objectVersion: row.version, action: 'review_source', scope });
      const at = now();
      db.prepare(`UPDATE source_documents SET trust_status=?,allowed_uses_json=?,version=version+1,updated_at=?
        WHERE document_id=? AND version=?`).run(trustStatus, stableJson(allowedUses), at, sourceId, row.version);
      db.prepare("DELETE FROM search_index WHERE owner_type='document' AND owner_id=?").run(sourceId);
      db.prepare("DELETE FROM embeddings WHERE owner_type='document' AND owner_id=?").run(sourceId);
      if (trustStatus === 'trusted' && allowedUses.includes('recall')) {
        db.prepare('INSERT INTO search_index(owner_type,owner_id,title,content) VALUES(?,?,?,?)')
          .run('document', sourceId, row.title || '', row.content);
      }
      return mapSource(db.prepare('SELECT * FROM source_documents WHERE document_id=?').get(sourceId));
    }));
  }

  function addEvidenceAssertion(input = {}) {
    return using(db => transaction(db, () => {
      const source = db.prepare('SELECT * FROM source_documents WHERE document_id=?').get(input.sourceId);
      if (!source) throw coded('cognitive_source_not_found');
      if (!EPISTEMIC_TYPES.has(input.epistemicType)) throw coded('invalid_epistemic_type');
      const evidenceId = input.evidenceId || id('evidence');
      const at = now();
      const anchor = input.anchorRef && typeof input.anchorRef === 'object' ? input.anchorRef : {};
      const statuses = {
        anchor: ['unverified','verified','failed'].includes(input.anchorStatus) ? input.anchorStatus : 'unverified',
        attribution: ['not_applicable','unverified','verified','failed'].includes(input.attributionStatus) ? input.attributionStatus : 'unverified',
        entailment: ['unverified','verified','failed'].includes(input.entailmentStatus) ? input.entailmentStatus : 'unverified',
        external: ['not_applicable','unverified','verified','failed'].includes(input.externalFactStatus)
          ? input.externalFactStatus : input.epistemicType === 'source_fact' ? 'unverified' : 'not_applicable',
      };
      db.prepare(`INSERT INTO cognitive_evidence_assertions(
        evidence_id,document_id,source_version,epistemic_type,anchor_ref_json,anchor_status,attribution_status,
        entailment_status,external_fact_status,uncertainty,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(evidenceId, source.document_id, String(source.version), input.epistemicType,
        stableJson(anchor), statuses.anchor, statuses.attribution, statuses.entailment, statuses.external,
        Math.max(0, Math.min(1, Number(input.uncertainty ?? 1))), at, at);
      return mapEvidence(db.prepare('SELECT * FROM cognitive_evidence_assertions WHERE evidence_id=?').get(evidenceId));
    }));
  }

  function proposeCognition(input = {}) {
    return using(db => transaction(db, () => {
      const claim = clean(input.claim, 2000);
      const cognitionType = clean(input.cognitionType, 80) || 'insight';
      const dependencies = uniqueStrings(input.evidenceDependencies, 50, 160);
      if (!claim || !dependencies.length) throw coded('cognition_claim_and_evidence_required');
      const found = db.prepare(`SELECT evidence_id FROM cognitive_evidence_assertions
        WHERE evidence_id IN (${dependencies.map(() => '?').join(',')})`).all(...dependencies);
      if (found.length !== dependencies.length) throw coded('cognition_evidence_not_found');
      const unitId = input.unitId || id('cognition');
      const at = now();
      const sensitive = input.sensitiveInference === true || SENSITIVE_TYPES.has(cognitionType);
      db.prepare(`INSERT INTO cognition_units(
        unit_id,claim,cognition_type,context_json,mechanism_json,boundary,falsifier,counterexample,
        transfer_scope_json,evidence_dependencies_json,status,privacy_level,sensitive_inference,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'candidate',?,?,?,?)`).run(unitId, claim, cognitionType, stableJson(input.context),
        stableJson(input.mechanism), clean(input.boundary, 2000), clean(input.falsifier, 2000),
        clean(input.counterexample, 2000), stableJson(input.transferScope), stableJson(dependencies),
        ['local_only','private','restricted','public'].includes(input.privacyLevel) ? input.privacyLevel : 'local_only',
        sensitive ? 1 : 0, at, at);
      return recordAssetVersion(db, 'cognition',
        mapUnit(db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId)),
        'propose');
    }));
  }

  function approveCognition(unitId, input = {}) {
    return using(db => transaction(db, () => {
      const row = db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId);
      if (!row) throw coded('cognition_unit_not_found');
      if (row.status !== 'candidate' || Number(input.expectedVersion) !== row.version) throw coded('cognition_version_conflict');
      if (!row.boundary || !row.falsifier) throw coded('cognition_boundary_and_falsifier_required');
      const dependencies = json(row.evidence_dependencies_json, []);
      const evidence = db.prepare(`SELECT * FROM cognitive_evidence_assertions
        WHERE evidence_id IN (${dependencies.map(() => '?').join(',')})`).all(...dependencies);
      const invalid = evidence.filter(item => item.anchor_status !== 'verified'
        || item.entailment_status !== 'verified'
        || (['speaker_claim','user_experience'].includes(item.epistemic_type) && item.attribution_status !== 'verified')
        || (item.epistemic_type === 'source_fact' && item.external_fact_status !== 'verified'));
      if (invalid.length) throw coded('cognition_evidence_gate_failed', { evidenceIds: invalid.map(item => item.evidence_id) });
      const scope = { status: 'confirmed', evidenceDependencies: dependencies };
      consumeApproval(db, input.approvalReceipt, { objectId: unitId, objectVersion: row.version, action: 'approve_cognition', scope });
      db.prepare("UPDATE cognition_units SET status='confirmed',version=version+1,updated_at=? WHERE unit_id=? AND version=?")
        .run(now(), unitId, row.version);
      return recordAssetVersion(db, 'cognition',
        mapUnit(db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId)),
        'approve',
        { approvalReceiptId: input.approvalReceipt?.receiptId || null });
    }));
  }

  function dependencyRegistryState(db, dependencyRefs = []) {
    const refs = dependencyRefs.map(ref => ({
      dependencyType: clean(ref?.dependencyType, 80),
      dependencyId: clean(ref?.dependencyId, 200),
      version: Number(ref?.version),
      digest: clean(ref?.digest, 64),
    }));
    for (const ref of refs) {
      const current = db.prepare(`SELECT * FROM cognitive_dependency_registry
        WHERE dependency_type=? AND dependency_id=?`).get(ref.dependencyType, ref.dependencyId);
      if (!current || current.status !== 'current' || current.version !== ref.version || current.digest !== ref.digest) {
        throw coded('external_dependency_stale', { dependencyType: ref.dependencyType, dependencyId: ref.dependencyId });
      }
    }
    return refs.sort((left, right) => `${left.dependencyType}:${left.dependencyId}`.localeCompare(`${right.dependencyType}:${right.dependencyId}`));
  }

  function playbookDependencyState(db, unitIds, dependencyRefs = []) {
    const units = unitIds.map(unitId => db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId));
    if (units.some(unit => !unit || unit.status !== 'confirmed' || unit.sensitive_inference === 1)) throw coded('confirmed_non_sensitive_cognition_required');
    const evidence = [];
    const sources = [];
    for (const unit of units) {
      for (const evidenceId of json(unit.evidence_dependencies_json, [])) {
        const item = db.prepare('SELECT * FROM cognitive_evidence_assertions WHERE evidence_id=?').get(evidenceId);
        if (!item) throw coded('cognition_evidence_not_found');
        const source = db.prepare('SELECT * FROM source_documents WHERE document_id=?').get(item.document_id);
        const allowedUses = source ? json(source.allowed_uses_json, []) : [];
        if (!source || source.version !== Number(item.source_version) || source.trust_status !== 'trusted'
          || !allowedUses.includes('playbook_compile')) throw coded('source_dependency_stale', { sourceId: item.document_id });
        evidence.push([item.evidence_id, item.updated_at, item.entailment_status, item.external_fact_status]);
        sources.push([source.document_id, source.version, source.content_hash, source.trust_status, allowedUses.sort()]);
      }
    }
    const external = dependencyRegistryState(db, dependencyRefs);
    const state = {
      units: units.map(unit => [unit.unit_id, unit.version, unit.status]),
      evidence: evidence.sort((left, right) => left[0].localeCompare(right[0])),
      sources: sources.sort((left, right) => left[0].localeCompare(right[0])),
      external,
    };
    return { units, digest: hash(stableJson(state)) };
  }

  function registerDependency(input = {}) {
    return using(db => transaction(db, () => {
      const dependencyType = clean(input.dependencyType, 80);
      const dependencyId = clean(input.dependencyId, 200);
      const digest = clean(input.digest, 64);
      const status = input.status === 'revoked' ? 'revoked' : 'current';
      if (!['policy','tool_contract','asset_contract'].includes(dependencyType) || !dependencyId || !/^[a-f0-9]{64}$/.test(digest)) {
        throw coded('dependency_contract_required');
      }
      const current = db.prepare(`SELECT * FROM cognitive_dependency_registry
        WHERE dependency_type=? AND dependency_id=?`).get(dependencyType, dependencyId);
      const expectedVersion = current ? current.version : 0;
      if (Number(input.expectedVersion ?? expectedVersion) !== expectedVersion) throw coded('dependency_version_conflict');
      const nextVersion = expectedVersion + 1;
      const scope = { dependencyType, dependencyId, nextVersion, digest, status };
      consumeApproval(db, input.approvalReceipt, {
        objectId: `dependency:${dependencyType}:${dependencyId}`,
        objectVersion: expectedVersion,
        action: 'register_dependency',
        scope,
      });
      db.prepare(`INSERT INTO cognitive_dependency_registry(
        dependency_type,dependency_id,version,digest,status,updated_at
      ) VALUES(?,?,?,?,?,?) ON CONFLICT(dependency_type,dependency_id) DO UPDATE SET
        version=excluded.version,digest=excluded.digest,status=excluded.status,updated_at=excluded.updated_at`)
        .run(dependencyType, dependencyId, nextVersion, digest, status, now());
      return { protocolVersion: PROTOCOL_VERSION, dependencyType, dependencyId, version: nextVersion, digest, status };
    }));
  }

  function compilePlaybook(input = {}) {
    return using(db => transaction(db, () => {
      const unitIds = uniqueStrings(input.cognitionUnitIds, 30, 160);
      const name = clean(input.name, 240);
      const targetProblem = clean(input.targetProblem, 1000);
      if (!unitIds.length || !name || !targetProblem) throw coded('playbook_identity_required');
      const dependencyRefs = (Array.isArray(input.dependencyRefs) ? input.dependencyRefs : []).map(ref => ({
        dependencyType: clean(ref?.dependencyType, 80),
        dependencyId: clean(ref?.dependencyId, 200),
        version: Number(ref?.version),
        digest: clean(ref?.digest, 64),
      }));
      const dependency = playbookDependencyState(db, unitIds, dependencyRefs);
      const steps = (Array.isArray(input.steps) ? input.steps : []).map((step, index) => ({
        id: clean(step?.id, 80) || `step-${index + 1}`,
        instruction: clean(step?.instruction || step, 1000),
        dependsOn: uniqueStrings(step?.dependsOn, 20, 80),
        toolRefs: uniqueStrings(step?.toolRefs, 20, 160),
        assetRefs: uniqueStrings(step?.assetRefs, 20, 160),
        producerFields: uniqueStrings(step?.producerFields, 30, 160),
        consumerFields: uniqueStrings(step?.consumerFields, 30, 160),
        condition: clean(step?.condition, 500) || null,
        timeoutMs: Math.max(1, Math.min(3_600_000, Number(step?.timeoutMs || 180_000))),
        retry: Math.max(0, Math.min(3, Number(step?.retry || 0))),
        idempotency: clean(step?.idempotency, 200) || 'required',
      })).filter(step => step.instruction);
      if (!steps.length) throw coded('playbook_steps_required');
      const manifest = {
        protocolVersion: PROTOCOL_VERSION,
        inputSchema: input.inputSchema && typeof input.inputSchema === 'object' ? input.inputSchema : { type: 'object' },
        outputSchema: input.outputSchema && typeof input.outputSchema === 'object' ? input.outputSchema : { type: 'object' },
        triggers: uniqueStrings(input.triggers, 20, 500),
        steps,
        approvalPolicy: input.approvalPolicy || { externalWrite: 'protected_user_presence' },
        failurePolicy: input.failurePolicy || { failClosed: true, preserveReceipt: true },
        qualityChecks: uniqueStrings(input.qualityChecks, 30, 1000),
        rollback: uniqueStrings(input.rollback, 20, 1000),
        dependencyRefs,
      };
      if (!manifest.triggers.length || !manifest.qualityChecks.length || !manifest.rollback.length) throw coded('playbook_controls_required');
      const privacyOrder = new Map([['public',0],['private',1],['restricted',2],['local_only',3]]);
      const privacyLevel = dependency.units.reduce((value, unit) =>
        (privacyOrder.get(unit.privacy_level) ?? 3) > (privacyOrder.get(value) ?? 3) ? unit.privacy_level : value, 'public');
      const playbookId = input.playbookId || id('playbook');
      const at = now();
      db.prepare(`INSERT INTO cognitive_playbooks(
        playbook_id,name,target_problem,manifest_json,evidence_dependencies_json,dependency_digest,
        semantic_maturity,deployment_state,validation_status,privacy_level,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'method_candidate','candidate','current',?,?,?)`).run(playbookId, name, targetProblem,
        stableJson(manifest), stableJson(unitIds), dependency.digest, privacyLevel, at, at);
      const insertDependency = db.prepare(`INSERT INTO cognitive_playbook_dependencies(
        playbook_id,dependency_type,dependency_id,dependency_version,dependency_digest
      ) VALUES(?,?,?,?,?)`);
      for (const ref of dependencyRefs) {
        insertDependency.run(playbookId, ref.dependencyType, ref.dependencyId, ref.version, ref.digest);
      }
      return recordAssetVersion(db, 'playbook',
        mapPlaybook(db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId)),
        'compile');
    }));
  }

  function validatePlaybookDependencies(db, row) {
    const unitIds = json(row.evidence_dependencies_json, []);
    const dependencyRefs = db.prepare(`SELECT dependency_type AS dependencyType,dependency_id AS dependencyId,
      dependency_version AS version,dependency_digest AS digest
      FROM cognitive_playbook_dependencies WHERE playbook_id=?`).all(row.playbook_id);
    let dependency;
    try { dependency = playbookDependencyState(db, unitIds, dependencyRefs); }
    catch (error) {
      db.prepare("UPDATE cognitive_playbooks SET validation_status='stale_blocked',updated_at=? WHERE playbook_id=?").run(now(), row.playbook_id);
      throw coded('playbook_stale_blocked', { playbookId: row.playbook_id, cause: error.code || error.message });
    }
    if (dependency.digest !== row.dependency_digest) {
      db.prepare("UPDATE cognitive_playbooks SET validation_status='stale_blocked',updated_at=? WHERE playbook_id=?").run(now(), row.playbook_id);
      throw coded('playbook_stale_blocked', { playbookId: row.playbook_id, cause: 'dependency_digest_changed' });
    }
    return dependency;
  }

  function withPersistedStaleBlock(db, fn) {
    try {
      return transaction(db, fn);
    } catch (error) {
      if (error.code === 'playbook_stale_blocked' && error.details?.playbookId) {
        db.prepare("UPDATE cognitive_playbooks SET validation_status='stale_blocked',updated_at=? WHERE playbook_id=?")
          .run(now(), error.details.playbookId);
      }
      throw error;
    }
  }

  function requestRun(playbookId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId);
      if (!row) throw coded('playbook_not_found');
      if (row.validation_status !== 'current' || !['runnable_playbook','verified_capability'].includes(row.semantic_maturity)) {
        throw coded('runnable_current_playbook_required');
      }
      validatePlaybookDependencies(db, row);
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: id('runreq'),
        playbook: mapPlaybook(row),
        input: input.input && typeof input.input === 'object' ? input.input : {},
        requiresApproval: true,
        sourceContentIncluded: false,
      };
    }));
  }

  function verifyRun(playbookId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId);
      if (!row) throw coded('playbook_not_found');
      validatePlaybookDependencies(db, row);
      const outcome = ['success','failure','not_applicable','infrastructure_failure'].includes(input.outcome) ? input.outcome : null;
      const caseKind = ['ordinary','boundary','adversarial'].includes(input.caseKind) ? input.caseKind : 'ordinary';
      const executorIdentity = clean(input.executorIdentity, 160);
      const verifierIdentity = clean(input.verifierIdentity, 160);
      if (!outcome || !executorIdentity || !verifierIdentity || executorIdentity === verifierIdentity) throw coded('independent_verifier_required');
      if (input.productionPath !== true) throw coded('production_path_receipt_required');
      const contextHash = clean(input.contextHash, 64);
      const semanticCaseHash = clean(input.semanticCaseHash, 64);
      if (!/^[a-f0-9]{64}$/.test(contextHash) || !/^[a-f0-9]{64}$/.test(semanticCaseHash)) throw coded('case_hash_required');
      const receiptId = input.receiptId || id('reuse');
      db.prepare(`INSERT INTO cognitive_reuse_receipts(
        receipt_id,playbook_id,playbook_version,context_hash,semantic_case_hash,outcome,case_kind,
        verifier_identity,executor_identity,critical_safety_failure,production_path,payload_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, playbookId, row.version, contextHash, semanticCaseHash, outcome,
        caseKind, verifierIdentity, executorIdentity, input.criticalSafetyFailure === true ? 1 : 0, 1,
        stableJson({ triggerMatches: input.triggerMatches || [], deviations: input.deviations || [], corrections: input.corrections || [], transferDimensions: input.transferDimensions || [] }), now());
      return { protocolVersion: PROTOCOL_VERSION, receiptId, recorded: true };
    }));
  }

  function promotionMetrics(db, row) {
    const samples = db.prepare(`SELECT * FROM cognitive_reuse_receipts
      WHERE playbook_id=? AND playbook_version=? AND outcome<>'infrastructure_failure'`).all(row.playbook_id, row.version);
    const applicable = samples.filter(sample => sample.outcome !== 'not_applicable');
    const success = applicable.filter(sample => sample.outcome === 'success').length;
    return {
      realCases: new Set(applicable.map(sample => sample.semantic_case_hash)).size,
      boundaryCases: new Set(applicable.filter(sample => ['boundary','adversarial'].includes(sample.case_kind)).map(sample => sample.semantic_case_hash)).size,
      successRate: applicable.length ? success / applicable.length : 0,
      criticalSafetyFailures: applicable.filter(sample => sample.critical_safety_failure === 1).length,
    };
  }

  function promotePlaybook(playbookId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId);
      if (!row) throw coded('playbook_not_found');
      if (Number(input.expectedVersion) !== row.version) throw coded('playbook_version_conflict');
      validatePlaybookDependencies(db, row);
      const next = row.semantic_maturity === 'method_candidate' ? 'runnable_playbook'
        : row.semantic_maturity === 'runnable_playbook' ? 'verified_capability' : null;
      if (!next) throw coded('playbook_already_verified');
      const metrics = promotionMetrics(db, row);
      if (next === 'verified_capability' && (metrics.realCases < 10 || metrics.boundaryCases < 3
        || metrics.successRate < 0.8 || metrics.criticalSafetyFailures > 0)) throw coded('verified_capability_gate_failed', metrics);
      const scope = { from: row.semantic_maturity, to: next, metrics };
      consumeApproval(db, input.approvalReceipt, { objectId: playbookId, objectVersion: row.version, action: 'promote_playbook', scope });
      db.prepare('UPDATE cognitive_playbooks SET semantic_maturity=?,version=version+1,updated_at=? WHERE playbook_id=? AND version=?')
        .run(next, now(), playbookId, row.version);
      return recordAssetVersion(db, 'playbook',
        mapPlaybook(db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId)),
        'promote',
        { from: row.semantic_maturity, to: next, approvalReceiptId: input.approvalReceipt?.receiptId || null });
    }));
  }

  function createProjection(input = {}) {
    return using(db => transaction(db, () => {
      const recipientAgent = clean(input.recipientAgent, 200);
      const purpose = clean(input.purpose, 500);
      const expiresAt = normalizeInstant(input.expiresAt, 'projection_expiry');
      const assetIds = uniqueStrings(input.assetIds, 100, 160);
      if (!recipientAgent || !purpose || !assetIds.length || Date.parse(expiresAt) <= clock().getTime()) throw coded('projection_contract_required');
      const assets = assetIds.map(assetId => db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(assetId));
      if (assets.some(asset => !asset || asset.semantic_maturity !== 'verified_capability' || asset.validation_status !== 'current')) {
        throw coded('verified_current_assets_required');
      }
      if (assets.some(asset => asset.privacy_level === 'local_only') && input.transport !== 'local') throw coded('local_only_projection_transport_required');
      const policyDigest = clean(input.policyDigest, 64);
      if (!/^[a-f0-9]{64}$/.test(policyDigest)) throw coded('projection_policy_digest_required');
      const contentVersion = hash(stableJson(assets.map(asset => [asset.playbook_id, asset.version])));
      const scope = { recipientAgent, purpose, assetIds, expiresAt, contentVersion, policyDigest, noOnwardSharing: true };
      consumeApproval(db, input.approvalReceipt, { objectId: `projection:${recipientAgent}`, objectVersion: 1, action: 'create_projection', scope });
      const grantId = input.grantId || id('grant');
      db.prepare(`INSERT INTO cognitive_projection_grants(
        grant_id,recipient_agent,purpose,scope_json,expires_at,content_version,policy_digest,no_onward_sharing,status,created_at
      ) VALUES(?,?,?,?,?,?,?,1,'active',?)`).run(grantId, recipientAgent, purpose, stableJson({ assetIds, transport: input.transport }),
        expiresAt, contentVersion, policyDigest, now());
      const insert = db.prepare("INSERT INTO cognitive_projection_items(grant_id,asset_type,asset_id,asset_version) VALUES(?,'playbook',?,?)");
      for (const asset of assets) insert.run(grantId, asset.playbook_id, asset.version);
      return { protocolVersion: PROTOCOL_VERSION, grantId, recipientAgent, purpose, expiresAt, contentVersion, policyDigest, noOnwardSharing: true };
    }));
  }

  function readProjection(input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare(`SELECT * FROM cognitive_projection_grants
        WHERE grant_id=? AND recipient_agent=? AND purpose=? AND status='active'`).get(input.grantId, input.recipientAgent, input.purpose);
      if (!row || row.expires_at <= now() || row.policy_digest !== input.policyDigest) throw coded('projection_grant_invalid');
      const items = db.prepare("SELECT * FROM cognitive_projection_items WHERE grant_id=? AND asset_type='playbook'").all(row.grant_id);
      const assets = items.map(item => {
        const asset = db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=? AND version=?').get(item.asset_id, item.asset_version);
        if (!asset || asset.validation_status !== 'current') return null;
        validatePlaybookDependencies(db, asset);
        const mapped = mapPlaybook(asset);
        return {
          playbookId: mapped.playbookId,
          version: mapped.version,
          name: mapped.name,
          targetProblem: mapped.targetProblem,
          manifest: mapped.manifest,
          semanticMaturity: mapped.semanticMaturity,
        };
      }).filter(Boolean);
      return { protocolVersion: PROTOCOL_VERSION, grantId: row.grant_id, noOnwardSharing: true, count: assets.length, assets };
    }));
  }

  function revoke(assetType, assetId, input = {}) {
    return using(db => transaction(db, () => {
      if (!['cognition','playbook'].includes(assetType)) throw coded('invalid_asset_type');
      const table = assetType === 'cognition' ? 'cognition_units' : 'cognitive_playbooks';
      const key = assetType === 'cognition' ? 'unit_id' : 'playbook_id';
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(assetId);
      if (!row) throw coded('cognitive_asset_not_found');
      const version = row.version;
      const scope = { assetType, assetId, cascade: true };
      consumeApproval(db, input.approvalReceipt, { objectId: assetId, objectVersion: version, action: 'revoke_asset', scope });
      if (assetType === 'cognition') db.prepare("UPDATE cognition_units SET status='retired',version=version+1,updated_at=? WHERE unit_id=?").run(now(), assetId);
      else db.prepare("UPDATE cognitive_playbooks SET validation_status='revoked',deployment_state='revoked',version=version+1,updated_at=? WHERE playbook_id=?").run(now(), assetId);
      const updated = assetType === 'cognition'
        ? mapUnit(db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(assetId))
        : mapPlaybook(db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(assetId));
      recordAssetVersion(db, assetType, updated, 'revoke', { approvalReceiptId: input.approvalReceipt?.receiptId || null });
      const affectedGrants = db.prepare('SELECT DISTINCT grant_id FROM cognitive_projection_items WHERE asset_type=? AND asset_id=?').all(assetType, assetId).map(item => item.grant_id);
      for (const grantId of affectedGrants) db.prepare("UPDATE cognitive_projection_grants SET status='revoked',revoked_at=? WHERE grant_id=?").run(now(), grantId);
      db.prepare("DELETE FROM search_index WHERE owner_type IN ('cognition','playbook') AND owner_id=?").run(assetId);
      db.prepare("DELETE FROM embeddings WHERE owner_type IN ('memory','document','entity') AND owner_id=?").run(assetId);
      const receiptId = id('withdrawal');
      const cascaded = ['normal_recall','active_projection','embedding_reference','playbook_execution'];
      const residues = ['append_only_audit','external_backups_if_any','git_history_if_exported'];
      db.prepare('INSERT INTO cognitive_withdrawal_receipts(receipt_id,asset_type,asset_id,cascaded_json,residues_json,created_at) VALUES(?,?,?,?,?,?)')
        .run(receiptId, assetType, assetId, stableJson(cascaded), stableJson(residues), now());
      return { protocolVersion: PROTOCOL_VERSION, receiptId, assetType, assetId, cascaded, residues };
    }));
  }

  function dailyDigest(input = {}) {
    return using(db => {
      const limit = Math.max(1, Math.min(5, Number(input.limit || 5)));
      const rows = db.prepare("SELECT * FROM cognition_units WHERE status='candidate' ORDER BY updated_at DESC").all();
      const oldestAt = rows.length ? rows.reduce((value, row) => row.updated_at < value ? row.updated_at : value, rows[0].updated_at) : null;
      const backlogDays = oldestAt ? Math.floor((clock().getTime() - Date.parse(oldestAt)) / 86_400_000) : 0;
      return {
        protocolVersion: PROTOCOL_VERSION,
        pending: rows.length,
        backlogDays,
        candidateGenerationThrottled: backlogDays > 7,
        items: rows.slice(0, limit).map(mapUnit),
      };
    });
  }

  function status() {
    return using(db => ({
      protocolVersion: PROTOCOL_VERSION,
      authorityMode,
      singleWriterRequired: true,
      counts: {
        sources: Number(db.prepare('SELECT COUNT(*) AS count FROM source_documents').get().count),
        quarantinedSources: Number(db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE trust_status='quarantined'").get().count),
        cognitionCandidates: Number(db.prepare("SELECT COUNT(*) AS count FROM cognition_units WHERE status='candidate'").get().count),
        confirmedCognition: Number(db.prepare("SELECT COUNT(*) AS count FROM cognition_units WHERE status='confirmed'").get().count),
        playbooks: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_playbooks').get().count),
        activeProjections: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_projection_grants WHERE status='active' AND expires_at>?").get(now()).count),
      },
    }));
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    authorityMode,
    ingestSource,
    reviewSource,
    addEvidenceAssertion,
    proposeCognition,
    approveCognition,
    registerDependency,
    compilePlaybook,
    requestRun,
    verifyRun,
    promotePlaybook,
    revoke,
    createProjection,
    readProjection,
    dailyDigest,
    status,
  };
}

function criticalDecisionInterview() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    method: 'critical-decision-method',
    questions: [
      '请选一次真实、具体、已经发生的关键事件。当时的目标和完成标准是什么？',
      '按时间线说：你最先看到了什么？第一个异常或关键线索是什么？',
      '在哪个节点必须做决定？当时预期接下来会发生什么？',
      '你考虑过哪些方案？分别因为什么被保留或排除？',
      '你实际采取了哪些动作？哪些步骤与原计划不同？',
      '新手最容易漏掉什么线索、边界或停止条件？',
      '如果关键线索不存在，或约束发生变化，你会怎样调整？',
      '结果怎样？什么独立证据能说明有效、无效或仍无法判断？',
      '这次经验的反例是什么？下一次出现什么证据会推翻当前结论？',
    ],
  };
}

function sanitizeHarnessTrajectory(input = {}) {
  const allowedOutcome = ['success','failure','partial','not_applicable','infrastructure_failure'];
  return {
    protocolVersion: PROTOCOL_VERSION,
    captureMode: 'harness_trajectory',
    taskClass: clean(input.taskClass, 120),
    constraints: uniqueStrings(input.constraints, 30, 500),
    actionSummary: uniqueStrings(input.actionSummary, 50, 500),
    outcome: allowedOutcome.includes(input.outcome) ? input.outcome : 'partial',
    evidenceRefs: uniqueStrings(input.evidenceRefs, 50, 200).map(ref => `evidence:${hash(ref).slice(0, 24)}`),
    failureAttribution: clean(input.failureAttribution, 160) || null,
    correctionSummary: uniqueStrings(input.correctionSummary, 20, 500),
    hiddenReasoningIncluded: false,
    rawOutputIncluded: false,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  createCognitiveAssetProvider,
  criticalDecisionInterview,
  sanitizeHarnessTrajectory,
  scopeHash,
};
