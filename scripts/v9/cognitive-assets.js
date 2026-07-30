'use strict';

const crypto = require('node:crypto');
const { openMemoryDatabase, transaction } = require('./memory-db');
const { createMemoryService } = require('./memory-service');
const { resolveV9Paths } = require('./paths');

const PROTOCOL_VERSION = 'cognitive-asset-v1';
const SENSITIVE_TYPES = new Set([
  'personality', 'personality_profile', 'emotion', 'emotional_state', 'health', 'mental_health',
  'medical', 'psychiatric', 'psychological', 'relationship', 'values', 'biometric', 'sexuality',
  'religion', 'political_affiliation',
]);
const EPISTEMIC_TYPES = new Set(['source_fact','speaker_claim','user_experience','synthesis_inference','project_application']);
const ALLOWED_USES = new Set(['evidence_extraction','recall','playbook_compile','knowledge_compile','projection']);

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
function normalizedCognitionType(value) {
  return clean(value, 80).toLowerCase().replace(/[\s-]+/g, '_') || 'insight';
}
function isSensitiveCognition(input, cognitionType) {
  if (input.sensitiveInference === true || input.inferenceScope === 'personal') return true;
  if (SENSITIVE_TYPES.has(cognitionType)) return true;
  return ['medical', 'health', 'mental', 'psycho', 'personality', 'emotion', 'relationship', 'biometric', 'sexual', 'religion', 'political']
    .some(token => cognitionType.includes(token));
}

function normalizeRetentionPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw coded('invalid_retention_policy');
  const output = {};
  if (value.expiresAt !== undefined) output.expiresAt = normalizeInstant(value.expiresAt, 'retention_expiry');
  if (value.retentionDays !== undefined) {
    const days = Number(value.retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw coded('invalid_retention_days');
    output.retentionDays = days;
  }
  if (!output.expiresAt && !output.retentionDays) return {};
  return output;
}

function retentionDeadline(row) {
  const policy = json(row.retention_policy_json, {});
  if (policy.expiresAt && Number.isFinite(Date.parse(policy.expiresAt))) return new Date(policy.expiresAt).toISOString();
  if (Number.isInteger(policy.retentionDays) && policy.retentionDays > 0) {
    return new Date(Date.parse(row.created_at) + policy.retentionDays * 86_400_000).toISOString();
  }
  return null;
}

function recordAssetVersion(db, assetType, asset, action, payload = {}) {
  const assetId = assetType === 'cognition' ? asset.unitId : asset.playbookId;
  db.prepare(`INSERT INTO cognitive_asset_versions(asset_type,asset_id,version,snapshot_json,created_at)
    VALUES(?,?,?,?,?)`).run(assetType, assetId, asset.version, stableJson(asset), now());
  db.prepare(`INSERT INTO cognitive_asset_events(event_id,asset_type,asset_id,asset_version,action,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(id('asset_event'), assetType, assetId, asset.version, action, stableJson(payload), now());
  return asset;
}

function recordProductVersion(db, assetType, asset, action, observedAt) {
  const assetId = assetType === 'knowledge_base' ? asset.knowledgeBaseId : asset.agentId;
  db.prepare(`INSERT INTO cognitive_product_versions(asset_type,asset_id,version,snapshot_json,action,created_at)
    VALUES(?,?,?,?,?,?)`).run(assetType, assetId, asset.version, stableJson(asset), action, observedAt);
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

function mapKnowledgeBase(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    knowledgeBaseId: row.knowledge_base_id,
    name: row.name,
    domain: row.domain,
    description: row.description,
    cognitionUnitIds: json(row.cognition_unit_ids_json, []),
    playbookIds: json(row.playbook_ids_json, []),
    retrievalPolicy: json(row.retrieval_policy_json, {}),
    dependencyDigest: row.dependency_digest,
    status: row.status,
    privacyLevel: row.privacy_level,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentProfile(row) {
  if (!row) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentId: row.agent_id,
    name: row.name,
    purpose: row.purpose,
    knowledgeBaseIds: json(row.knowledge_base_ids_json, []),
    playbookIds: json(row.playbook_ids_json, []),
    toolRefs: json(row.tool_refs_json, []),
    dependencyRefs: json(row.dependency_refs_json, []),
    contextBudgetTokens: row.context_budget_tokens,
    dependencyDigest: row.dependency_digest,
    readinessStatus: row.readiness_status,
    deploymentState: row.deployment_state,
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
  reuseReceiptVerifier = null,
  sensitiveContentProtector = null,
  clock = () => new Date(),
} = {}) {
  const memory = createMemoryService({ paths, dbPath });
  const now = () => clock().toISOString();
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
    if (input.sensitive === true || input.containsSensitivePersonalData === true) {
      if (typeof sensitiveContentProtector !== 'function') throw coded('sensitive_store_unavailable');
      throw coded('sensitive_live_store_not_implemented');
    }
    const allowedUses = uniqueStrings(input.allowedUses).filter(use => ALLOWED_USES.has(use));
    const retentionPolicy = normalizeRetentionPolicy(input.retentionPolicy);
    return memory.importDocument({
      ...input,
      captureMode: clean(input.captureMode, 80) || 'daily',
      trustStatus: input.trustStatus || 'quarantined',
      privacyLevel: input.privacyLevel || 'local_only',
      allowedUses,
      retentionPolicy,
    });
  }

  function retentionStatus() {
    return using(db => {
      const observedAt = clock().toISOString();
      const due = db.prepare("SELECT * FROM source_documents WHERE trust_status<>'revoked'").all()
        .map(row => ({ row, deadline: retentionDeadline(row) }))
        .filter(item => item.deadline && item.deadline <= observedAt);
      return {
        protocolVersion: PROTOCOL_VERSION,
        observedAt,
        due: due.length,
        sources: due.map(item => ({ sourceId: item.row.document_id, deadline: item.deadline })),
      };
    });
  }

  function enforceRetention(input = {}) {
    if (input.confirm !== true) throw coded('retention_confirmation_required');
    return using(db => transaction(db, () => {
      const observedAt = clock().toISOString();
      const due = db.prepare("SELECT * FROM source_documents WHERE trust_status<>'revoked'").all()
        .map(row => ({ row, deadline: retentionDeadline(row) }))
        .filter(item => item.deadline && item.deadline <= observedAt);
      for (const item of due) {
        const documentId = item.row.document_id;
        const evidenceIds = new Set(db.prepare('SELECT evidence_id FROM cognitive_evidence_assertions WHERE document_id=?')
          .all(documentId).map(row => row.evidence_id));
        const affectedUnits = db.prepare('SELECT * FROM cognition_units').all()
          .filter(row => json(row.evidence_dependencies_json, []).some(evidenceId => evidenceIds.has(evidenceId)));
        db.prepare("DELETE FROM search_index WHERE owner_type='document' AND owner_id=?").run(documentId);
        db.prepare("DELETE FROM embeddings WHERE owner_type='document' AND owner_id=?").run(documentId);
        db.prepare(`UPDATE source_documents SET title=NULL,content='[retention-expired]',
          source_uri=?,metadata_json='{"retentionPurged":true}',trust_status='revoked',
          subjects_json='[]',allowed_uses_json='[]',valid_from=NULL,valid_to=NULL,
          version=version+1,updated_at=? WHERE document_id=?`).run(
          `retention:${hash(item.row.source_uri).slice(0, 16)}`, observedAt, documentId,
        );
        db.prepare(`UPDATE cognitive_evidence_assertions SET
          anchor_ref_json='{"retentionPurged":true}',anchor_status='failed',
          attribution_status=CASE WHEN attribution_status='not_applicable' THEN 'not_applicable' ELSE 'failed' END,
          entailment_status='failed',
          external_fact_status=CASE WHEN external_fact_status='not_applicable' THEN 'not_applicable' ELSE 'failed' END,
          uncertainty=1,updated_at=? WHERE document_id=?`).run(observedAt, documentId);
        const affectedUnitIds = new Set();
        for (const unit of affectedUnits) {
          affectedUnitIds.add(unit.unit_id);
          db.prepare(`UPDATE cognition_units SET claim='[retention-expired]',context_json='{}',
            mechanism_json='{}',boundary='',falsifier='',counterexample='',transfer_scope_json='{}',
            evidence_dependencies_json='[]',status='retired',sensitive_inference=0,
            version=version+1,updated_at=? WHERE unit_id=?`).run(observedAt, unit.unit_id);
          db.prepare("DELETE FROM cognitive_asset_versions WHERE asset_type='cognition' AND asset_id=?").run(unit.unit_id);
          db.prepare("DELETE FROM cognitive_asset_events WHERE asset_type='cognition' AND asset_id=?").run(unit.unit_id);
          recordAssetVersion(db, 'cognition',
            mapUnit(db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unit.unit_id)),
            'retention_tombstone',
            { sourceId: documentId });
        }
        const affectedPlaybooks = db.prepare('SELECT * FROM cognitive_playbooks').all()
          .filter(row => json(row.evidence_dependencies_json, []).some(unitId => affectedUnitIds.has(unitId)));
        for (const playbook of affectedPlaybooks) {
          db.prepare(`UPDATE cognitive_playbooks SET manifest_json='{"retentionBlocked":true,"steps":[]}',
            evidence_dependencies_json='[]',validation_status='stale_blocked',deployment_state='revoked',
            version=version+1,updated_at=? WHERE playbook_id=?`).run(observedAt, playbook.playbook_id);
          db.prepare("UPDATE cognitive_projection_grants SET status='revoked',revoked_at=? WHERE grant_id IN (SELECT grant_id FROM cognitive_projection_items WHERE asset_type='playbook' AND asset_id=?)")
            .run(observedAt, playbook.playbook_id);
          db.prepare("DELETE FROM cognitive_asset_versions WHERE asset_type='playbook' AND asset_id=?").run(playbook.playbook_id);
          db.prepare("DELETE FROM cognitive_asset_events WHERE asset_type='playbook' AND asset_id=?").run(playbook.playbook_id);
          recordAssetVersion(db, 'playbook',
            mapPlaybook(db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbook.playbook_id)),
            'retention_tombstone',
            { sourceId: documentId });
        }
        db.prepare(`INSERT INTO memory_events(event_id,memory_id,action,actor,payload_json,created_at)
          VALUES(?,NULL,'source_retention_purge',?,?,?)`).run(
          id('mevt'), clean(input.actor, 120) || 'retention_controller',
          stableJson({ sourceId: documentId, deadline: item.deadline }), observedAt,
        );
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        observedAt,
        tombstoned: due.length,
        sourceIds: due.map(item => item.row.document_id),
        logicalTombstone: true,
        forensicErasure: false,
        residues: ['source_id', 'content_hash', 'sqlite_free_pages', 'wal_history', 'external_backups_if_any'],
      };
    }));
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
      const cognitionType = normalizedCognitionType(input.cognitionType);
      const dependencies = uniqueStrings(input.evidenceDependencies, 50, 160);
      if (!claim || !dependencies.length) throw coded('cognition_claim_and_evidence_required');
      const sensitive = isSensitiveCognition(input, cognitionType);
      if (sensitive) {
        if (typeof sensitiveContentProtector !== 'function') throw coded('sensitive_store_unavailable');
        throw coded('sensitive_live_store_not_implemented');
      }
      const found = db.prepare(`SELECT evidence_id FROM cognitive_evidence_assertions
        WHERE evidence_id IN (${dependencies.map(() => '?').join(',')})`).all(...dependencies);
      if (found.length !== dependencies.length) throw coded('cognition_evidence_not_found');
      const unitId = input.unitId || id('cognition');
      const at = now();
      db.prepare(`INSERT INTO cognition_units(
        unit_id,claim,cognition_type,context_json,mechanism_json,boundary,falsifier,counterexample,
        transfer_scope_json,evidence_dependencies_json,status,privacy_level,sensitive_inference,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'candidate',?,?,?,?)`).run(unitId, claim, cognitionType, stableJson(input.context || {}),
        stableJson(input.mechanism || {}), clean(input.boundary, 2000), clean(input.falsifier, 2000),
        clean(input.counterexample, 2000), stableJson(input.transferScope || {}), stableJson(dependencies),
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
      if (error.details?.playbookId) {
        db.prepare("UPDATE cognitive_playbooks SET validation_status='stale_blocked',updated_at=? WHERE playbook_id=?")
          .run(now(), error.details.playbookId);
      }
      if (['knowledge_base_stale_blocked','agent_profile_stale_blocked'].includes(error.code)) {
        if (error.details?.knowledgeBaseId) {
          db.prepare("UPDATE cognitive_knowledge_bases SET status='stale_blocked',updated_at=? WHERE knowledge_base_id=?")
            .run(now(), error.details.knowledgeBaseId);
        }
        if (error.details?.agentId) {
          db.prepare("UPDATE cognitive_agent_profiles SET readiness_status='stale_blocked',updated_at=? WHERE agent_id=?")
            .run(now(), error.details.agentId);
        }
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
        executionMode: 'external_executor_required',
        executionPerformed: false,
        sourceContentIncluded: false,
      };
    }));
  }

  function verifyRun(playbookId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId);
      if (!row) throw coded('playbook_not_found');
      validatePlaybookDependencies(db, row);
      if (typeof reuseReceiptVerifier !== 'function') throw coded('trusted_reuse_receipt_verifier_required');
      const receipt = input.receipt && typeof input.receipt === 'object' ? input.receipt : {};
      const outcome = ['success','failure','not_applicable','infrastructure_failure'].includes(receipt.outcome) ? receipt.outcome : null;
      const caseKind = ['ordinary','boundary','adversarial'].includes(receipt.caseKind) ? receipt.caseKind : 'ordinary';
      const executorIdentity = clean(receipt.executor?.principal, 160);
      const verifierIdentity = clean(receipt.verifier?.principal, 160);
      const executorTrustDomain = clean(receipt.executor?.trustDomain, 160);
      const verifierTrustDomain = clean(receipt.verifier?.trustDomain, 160);
      if (!outcome || !executorIdentity || !verifierIdentity || executorIdentity === verifierIdentity
        || !executorTrustDomain || !verifierTrustDomain || executorTrustDomain === verifierTrustDomain) {
        throw coded('independent_verifier_required');
      }
      if (receipt.productionPath !== true) throw coded('production_path_receipt_required');
      const contextHash = clean(receipt.contextHash, 64);
      const semanticCaseHash = clean(receipt.semanticCaseHash, 64);
      const digests = ['inputDigest','outputDigest','artifactDigest','runnerDigest','policyDigest']
        .map(field => clean(receipt[field], 64));
      if (![contextHash, semanticCaseHash, ...digests].every(value => /^[a-f0-9]{64}$/.test(value))) {
        throw coded('receipt_digest_required');
      }
      const receiptId = clean(receipt.receiptId, 200);
      const nonce = clean(receipt.nonce, 200);
      const taskId = clean(receipt.taskId, 200);
      const signature = clean(receipt.signature, 2000);
      if (!receiptId || nonce.length < 16 || !taskId || !signature) throw coded('signed_receipt_identity_required');
      if (receipt.playbookId !== playbookId || Number(receipt.playbookVersion) !== row.version) {
        throw coded('reuse_receipt_playbook_mismatch');
      }
      const startedAt = normalizeInstant(receipt.startedAt, 'receipt_started_at');
      const finishedAt = normalizeInstant(receipt.finishedAt, 'receipt_finished_at');
      if (Date.parse(finishedAt) < Date.parse(startedAt)) throw coded('receipt_time_order_invalid');
      if (reuseReceiptVerifier(receipt) !== true) throw coded('reuse_receipt_signature_invalid');
      db.prepare(`INSERT INTO cognitive_reuse_receipts(
        receipt_id,playbook_id,playbook_version,context_hash,semantic_case_hash,outcome,case_kind,
        verifier_identity,executor_identity,critical_safety_failure,production_path,payload_json,created_at,
        receipt_nonce,task_id,input_digest,output_digest,artifact_digest,runner_digest,policy_digest,
        started_at,finished_at,signature,signature_verified
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
        receiptId, playbookId, row.version, contextHash, semanticCaseHash, outcome,
        caseKind, verifierIdentity, executorIdentity, receipt.criticalSafetyFailure === true ? 1 : 0, 1,
        stableJson({
          executorTrustDomain,
          verifierTrustDomain,
          triggerMatches: receipt.triggerMatches || [],
          deviations: receipt.deviations || [],
          corrections: receipt.corrections || [],
          transferDimensions: receipt.transferDimensions || [],
        }),
        now(), nonce, taskId, ...digests, startedAt, finishedAt, signature,
      );
      return { protocolVersion: PROTOCOL_VERSION, receiptId, recorded: true, signatureVerified: true };
    }));
  }

  function promotionMetrics(db, row) {
    const samples = db.prepare(`SELECT * FROM cognitive_reuse_receipts
      WHERE playbook_id=? AND playbook_version=? AND signature_verified=1
        AND outcome<>'infrastructure_failure'`).all(row.playbook_id, row.version);
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

  function strictestPrivacy(rows) {
    const order = new Map([['public',0],['private',1],['restricted',2],['local_only',3]]);
    return rows.reduce((value, row) => (order.get(row.privacy_level) ?? 3) > (order.get(value) ?? 3)
      ? row.privacy_level : value, 'public');
  }

  function knowledgeBaseDependencyState(db, unitIds, playbookIds) {
    const units = unitIds.map(unitId => db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId));
    if (units.some(unit => !unit || unit.status !== 'confirmed' || unit.sensitive_inference === 1)) {
      throw coded('confirmed_non_sensitive_cognition_required');
    }
    const evidence = [];
    const sources = [];
    for (const unit of units) {
      for (const evidenceId of json(unit.evidence_dependencies_json, [])) {
        const item = db.prepare('SELECT * FROM cognitive_evidence_assertions WHERE evidence_id=?').get(evidenceId);
        const source = item ? db.prepare('SELECT * FROM source_documents WHERE document_id=?').get(item.document_id) : null;
        const allowedUses = source ? json(source.allowed_uses_json, []) : [];
        const evidenceCurrent = item && item.anchor_status === 'verified' && item.entailment_status === 'verified'
          && ['verified','not_applicable'].includes(item.attribution_status)
          && (item.epistemic_type !== 'source_fact' || item.external_fact_status === 'verified');
        if (!source || source.version !== Number(item?.source_version) || source.trust_status !== 'trusted'
          || !allowedUses.includes('knowledge_compile') || !evidenceCurrent) {
          throw coded('knowledge_source_dependency_stale', { sourceId: item?.document_id || null });
        }
        evidence.push([item.evidence_id, item.updated_at, item.entailment_status, item.external_fact_status]);
        sources.push([source.document_id, source.version, source.content_hash, source.trust_status, allowedUses.sort()]);
      }
    }
    const playbooks = playbookIds.map(playbookId => db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId));
    if (playbooks.some(playbook => !playbook || playbook.validation_status !== 'current'
      || !['runnable_playbook','verified_capability'].includes(playbook.semantic_maturity))) {
      throw coded('runnable_current_playbook_required');
    }
    for (const playbook of playbooks) validatePlaybookDependencies(db, playbook);
    const state = {
      units: units.map(unit => [unit.unit_id, unit.version, unit.status]),
      evidence: evidence.sort((left, right) => left[0].localeCompare(right[0])),
      sources: sources.sort((left, right) => left[0].localeCompare(right[0])),
      playbooks: playbooks.map(playbook => [playbook.playbook_id, playbook.version, playbook.semantic_maturity,
        playbook.validation_status, playbook.dependency_digest]),
    };
    return { units, playbooks, digest: hash(stableJson(state)), privacyLevel: strictestPrivacy([...units, ...playbooks]) };
  }

  function compileKnowledgeBase(input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const knowledgeBaseId = clean(input.knowledgeBaseId || id('kb'), 160);
      const name = clean(input.name, 240);
      const domain = clean(input.domain, 240);
      const description = clean(input.description, 1000);
      const unitIds = uniqueStrings(input.cognitionUnitIds, 100, 160);
      const playbookIds = uniqueStrings(input.playbookIds, 50, 160);
      if (!knowledgeBaseId || !name || !domain || !unitIds.length || !playbookIds.length) {
        throw coded('knowledge_base_contract_required');
      }
      const dependency = knowledgeBaseDependencyState(db, unitIds, playbookIds);
      const modes = uniqueStrings(input.retrievalPolicy?.modes, 4, 40)
        .filter(mode => ['lexical','semantic','graph','temporal'].includes(mode));
      const retrievalPolicy = {
        modes: modes.length ? modes : ['lexical'],
        maxClaims: Math.max(1, Math.min(50, Number(input.retrievalPolicy?.maxClaims || 12))),
        maxPlaybooks: Math.max(1, Math.min(20, Number(input.retrievalPolicy?.maxPlaybooks || 5))),
        requireCitations: input.retrievalPolicy?.requireCitations !== false,
      };
      const at = now();
      db.prepare(`INSERT INTO cognitive_knowledge_bases(
        knowledge_base_id,name,domain,description,cognition_unit_ids_json,playbook_ids_json,
        retrieval_policy_json,dependency_digest,status,privacy_level,version,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,'draft',?,1,?,?)`).run(
        knowledgeBaseId, name, domain, description, stableJson(unitIds), stableJson(playbookIds),
        stableJson(retrievalPolicy), dependency.digest, dependency.privacyLevel, at, at,
      );
      return recordProductVersion(db, 'knowledge_base',
        mapKnowledgeBase(db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(knowledgeBaseId)),
        'compile', at);
    }));
  }

  function validateKnowledgeBaseDependencies(db, row) {
    let dependency;
    try {
      dependency = knowledgeBaseDependencyState(db, json(row.cognition_unit_ids_json, []), json(row.playbook_ids_json, []));
    } catch (error) {
      throw coded('knowledge_base_stale_blocked', {
        knowledgeBaseId: row.knowledge_base_id,
        playbookId: error.details?.playbookId,
        cause: error.code || error.message,
      });
    }
    if (dependency.digest !== row.dependency_digest) {
      throw coded('knowledge_base_stale_blocked', { knowledgeBaseId: row.knowledge_base_id, cause: 'dependency_digest_changed' });
    }
    return dependency;
  }

  function publishKnowledgeBase(knowledgeBaseId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(knowledgeBaseId);
      if (!row) throw coded('knowledge_base_not_found');
      if (row.status !== 'draft' || Number(input.expectedVersion) !== row.version) throw coded('knowledge_base_version_conflict');
      validateKnowledgeBaseDependencies(db, row);
      const scope = { from: 'draft', to: 'published', dependencyDigest: row.dependency_digest };
      consumeApproval(db, input.approvalReceipt, {
        objectId: knowledgeBaseId,
        objectVersion: row.version,
        action: 'publish_knowledge_base',
        scope,
      });
      const at = now();
      db.prepare("UPDATE cognitive_knowledge_bases SET status='published',version=version+1,updated_at=? WHERE knowledge_base_id=? AND version=?")
        .run(at, knowledgeBaseId, row.version);
      return recordProductVersion(db, 'knowledge_base',
        mapKnowledgeBase(db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(knowledgeBaseId)),
        'publish', at);
    }));
  }

  function normalizeDependencyRefs(value) {
    return (Array.isArray(value) ? value : []).map(ref => ({
      dependencyType: clean(ref?.dependencyType, 80),
      dependencyId: clean(ref?.dependencyId, 200),
      version: Number(ref?.version),
      digest: clean(ref?.digest, 64),
    }));
  }

  function agentDependencyState(db, knowledgeBaseIds, directPlaybookIds, dependencyRefs, toolRefs) {
    const knowledgeBases = knowledgeBaseIds.map(knowledgeBaseId =>
      db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(knowledgeBaseId));
    if (knowledgeBases.some(item => !item || item.status !== 'published')) throw coded('published_knowledge_base_required');
    for (const item of knowledgeBases) validateKnowledgeBaseDependencies(db, item);
    const allPlaybookIds = [...new Set([
      ...directPlaybookIds,
      ...knowledgeBases.flatMap(item => json(item.playbook_ids_json, [])),
    ])].sort();
    const playbooks = allPlaybookIds.map(playbookId => db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId));
    if (playbooks.some(playbook => !playbook || playbook.validation_status !== 'current'
      || !['runnable_playbook','verified_capability'].includes(playbook.semantic_maturity))) {
      throw coded('runnable_current_playbook_required');
    }
    for (const playbook of playbooks) validatePlaybookDependencies(db, playbook);
    const external = dependencyRegistryState(db, dependencyRefs);
    if (toolRefs.some(toolRef => !external.some(ref => ref.dependencyType === 'tool_contract' && ref.dependencyId === toolRef))) {
      throw coded('tool_contract_dependency_required');
    }
    const state = {
      knowledgeBases: knowledgeBases.map(item => [item.knowledge_base_id, item.version, item.status, item.dependency_digest]),
      playbooks: playbooks.map(item => [item.playbook_id, item.version, item.semantic_maturity, item.dependency_digest]),
      external,
      toolRefs,
    };
    return { knowledgeBases, playbooks, external, digest: hash(stableJson(state)) };
  }

  function compileAgentProfile(input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const agentId = clean(input.agentId || id('agent'), 160);
      const name = clean(input.name, 240);
      const purpose = clean(input.purpose, 1000);
      const knowledgeBaseIds = uniqueStrings(input.knowledgeBaseIds, 20, 160);
      const playbookIds = uniqueStrings(input.playbookIds, 30, 160);
      const toolRefs = uniqueStrings(input.toolRefs, 50, 200);
      const dependencyRefs = normalizeDependencyRefs(input.dependencyRefs);
      const contextBudgetTokens = Number(input.contextBudgetTokens || 2000);
      if (!agentId || !name || !purpose || !knowledgeBaseIds.length || !Number.isInteger(contextBudgetTokens)
        || contextBudgetTokens < 100 || contextBudgetTokens > 100_000) throw coded('agent_profile_contract_required');
      const dependency = agentDependencyState(db, knowledgeBaseIds, playbookIds, dependencyRefs, toolRefs);
      const at = now();
      db.prepare(`INSERT INTO cognitive_agent_profiles(
        agent_id,name,purpose,knowledge_base_ids_json,playbook_ids_json,tool_refs_json,dependency_refs_json,
        context_budget_tokens,dependency_digest,readiness_status,deployment_state,version,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'draft','draft',1,?,?)`).run(
        agentId, name, purpose, stableJson(knowledgeBaseIds), stableJson(playbookIds), stableJson(toolRefs),
        stableJson(dependencyRefs), contextBudgetTokens, dependency.digest, at, at,
      );
      return recordProductVersion(db, 'agent',
        mapAgentProfile(db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(agentId)),
        'compile', at);
    }));
  }

  function assessAgentRow(db, row, targetState = 'shadow') {
    let dependency;
    try {
      dependency = agentDependencyState(db, json(row.knowledge_base_ids_json, []), json(row.playbook_ids_json, []),
        json(row.dependency_refs_json, []), json(row.tool_refs_json, []));
    } catch (error) {
      throw coded('agent_profile_stale_blocked', {
        agentId: row.agent_id,
        knowledgeBaseId: error.details?.knowledgeBaseId,
        playbookId: error.details?.playbookId,
        cause: error.code || error.message,
      });
    }
    if (dependency.digest !== row.dependency_digest) {
      throw coded('agent_profile_stale_blocked', { agentId: row.agent_id, cause: 'dependency_digest_changed' });
    }
    const blockers = [];
    if (targetState === 'canary') {
      for (const playbook of dependency.playbooks) {
        const metrics = promotionMetrics(db, playbook);
        if (metrics.realCases < 1 || metrics.successRate < 1 || metrics.criticalSafetyFailures > 0) {
          blockers.push(`playbook:${playbook.playbook_id}:canary_evidence_required`);
        }
      }
    }
    if (targetState === 'active') {
      for (const playbook of dependency.playbooks) {
        if (playbook.semantic_maturity !== 'verified_capability') blockers.push(`playbook:${playbook.playbook_id}:verified_capability_required`);
      }
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentId: row.agent_id,
      targetState,
      ready: blockers.length === 0,
      blockers,
      dependencyDigest: dependency.digest,
      counts: { knowledgeBases: dependency.knowledgeBases.length, playbooks: dependency.playbooks.length, toolContracts: json(row.tool_refs_json, []).length },
    };
  }

  function assessAgent(agentId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(agentId);
      if (!row) throw coded('agent_profile_not_found');
      const targetState = input.targetState || (row.deployment_state === 'draft' ? 'shadow' : row.deployment_state);
      if (!['shadow','canary','active'].includes(targetState)) throw coded('invalid_agent_target_state');
      return assessAgentRow(db, row, targetState);
    }));
  }

  function deployAgent(agentId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(agentId);
      if (!row) throw coded('agent_profile_not_found');
      if (Number(input.expectedVersion) !== row.version) throw coded('agent_profile_version_conflict');
      const targetState = clean(input.targetState, 40);
      const allowed = { draft: ['shadow'], shadow: ['canary'], canary: ['active'] };
      if (!allowed[row.deployment_state]?.includes(targetState)) throw coded('invalid_agent_deployment_transition');
      const assessment = assessAgentRow(db, row, targetState);
      if (!assessment.ready) throw coded('agent_readiness_gate_failed', assessment);
      const scope = { from: row.deployment_state, to: targetState, dependencyDigest: assessment.dependencyDigest };
      consumeApproval(db, input.approvalReceipt, {
        objectId: agentId,
        objectVersion: row.version,
        action: 'deploy_agent',
        scope,
      });
      const at = now();
      db.prepare("UPDATE cognitive_agent_profiles SET readiness_status='ready',deployment_state=?,version=version+1,updated_at=? WHERE agent_id=? AND version=?")
        .run(targetState, at, agentId, row.version);
      return recordProductVersion(db, 'agent',
        mapAgentProfile(db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(agentId)),
        'deploy', at);
    }));
  }

  function prepareAgentContext(agentId, input = {}) {
    return using(db => withPersistedStaleBlock(db, () => {
      const row = db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(agentId);
      if (!row) throw coded('agent_profile_not_found');
      if (!['shadow','canary','active'].includes(row.deployment_state) || row.readiness_status !== 'ready') {
        throw coded('deployed_ready_agent_required');
      }
      const purpose = clean(input.purpose || row.purpose, 1000);
      if (purpose !== row.purpose) throw coded('agent_purpose_mismatch');
      const assessment = assessAgentRow(db, row, row.deployment_state);
      if (!assessment.ready) throw coded('agent_readiness_gate_failed', assessment);
      const requestedBudget = Number(input.tokenBudget || row.context_budget_tokens);
      const tokenBudget = Math.max(100, Math.min(row.context_budget_tokens, Number.isFinite(requestedBudget) ? requestedBudget : row.context_budget_tokens));
      const knowledgeBases = json(row.knowledge_base_ids_json, []).map(knowledgeBaseId =>
        db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(knowledgeBaseId));
      const claimIds = [...new Set(knowledgeBases.flatMap(item => json(item.cognition_unit_ids_json, [])))].sort();
      const playbookIds = [...new Set([
        ...json(row.playbook_ids_json, []),
        ...knowledgeBases.flatMap(item => json(item.playbook_ids_json, [])),
      ])].sort();
      const claims = claimIds.map(unitId => mapUnit(db.prepare('SELECT * FROM cognition_units WHERE unit_id=?').get(unitId)))
        .filter(Boolean).map(unit => ({ unitId: unit.unitId, version: unit.version, claim: unit.claim,
          cognitionType: unit.cognitionType, boundary: unit.boundary, falsifier: unit.falsifier,
          evidenceDependencies: unit.evidenceDependencies }));
      const playbooks = playbookIds.map(playbookId => mapPlaybook(db.prepare('SELECT * FROM cognitive_playbooks WHERE playbook_id=?').get(playbookId)))
        .filter(Boolean).map(playbook => ({ playbookId: playbook.playbookId, version: playbook.version, name: playbook.name,
          targetProblem: playbook.targetProblem, manifest: playbook.manifest, semanticMaturity: playbook.semanticMaturity }));
      const retrievalPolicies = knowledgeBases.map(item => json(item.retrieval_policy_json, {}));
      const maxClaims = Math.max(1, retrievalPolicies.reduce((total, policy) => total + Number(policy.maxClaims || 12), 0));
      const maxPlaybooks = Math.max(1, retrievalPolicies.reduce((total, policy) => total + Number(policy.maxPlaybooks || 5), 0));
      const eligibleClaims = claims.slice(0, maxClaims);
      const eligiblePlaybooks = playbooks.slice(0, maxPlaybooks);
      const selected = { playbooks: [], knowledge: [] };
      const buildContext = estimatedTokens => ({
        protocolVersion: PROTOCOL_VERSION,
        label: 'GOVERNED COGNITIVE CONTEXT',
        agentId,
        purpose,
        deploymentState: row.deployment_state,
        tokenBudget,
        estimatedTokens,
        omitted: { playbooks: playbooks.length - selected.playbooks.length, knowledge: claims.length - selected.knowledge.length },
        knowledge: selected.knowledge,
        playbooks: selected.playbooks,
        dependencyDigest: row.dependency_digest,
        citationsRequired: retrievalPolicies.some(policy => policy.requireCitations !== false),
        sourceContentIncluded: false,
        executionPerformed: false,
      });
      const estimateCompletePackage = () => Math.ceil(stableJson({
        ...buildContext(100000),
        contextDigest: 'f'.repeat(64),
      }).length / 4);
      let estimatedTokens = estimateCompletePackage();
      if (estimatedTokens > tokenBudget) {
        throw coded('agent_context_budget_too_small', { tokenBudget, minimumTokens: estimatedTokens });
      }
      const include = (bucket, item) => {
        selected[bucket].push(item);
        const nextEstimate = estimateCompletePackage();
        if (nextEstimate > tokenBudget) {
          selected[bucket].pop();
          return false;
        }
        estimatedTokens = nextEstimate;
        return true;
      };
      for (const playbook of eligiblePlaybooks) include('playbooks', playbook);
      for (const claim of eligibleClaims) include('knowledge', claim);
      const context = buildContext(estimatedTokens);
      return { ...context, contextDigest: hash(stableJson(context)) };
    }));
  }

  function revokeProduct(assetType, assetId, input = {}) {
    return using(db => transaction(db, () => {
      if (!['knowledge_base','agent'].includes(assetType)) throw coded('invalid_product_asset_type');
      const table = assetType === 'knowledge_base' ? 'cognitive_knowledge_bases' : 'cognitive_agent_profiles';
      const key = assetType === 'knowledge_base' ? 'knowledge_base_id' : 'agent_id';
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(assetId);
      if (!row) throw coded('cognitive_product_not_found');
      const scope = { assetType, assetId, cascade: true };
      consumeApproval(db, input.approvalReceipt, { objectId: assetId, objectVersion: row.version, action: 'revoke_product', scope });
      const at = now();
      if (assetType === 'knowledge_base') {
        db.prepare("UPDATE cognitive_knowledge_bases SET status='revoked',version=version+1,updated_at=? WHERE knowledge_base_id=?").run(at, assetId);
        for (const agent of db.prepare('SELECT * FROM cognitive_agent_profiles').all()) {
          if (json(agent.knowledge_base_ids_json, []).includes(assetId)) {
            db.prepare("UPDATE cognitive_agent_profiles SET readiness_status='stale_blocked',updated_at=? WHERE agent_id=?").run(at, agent.agent_id);
          }
        }
      } else {
        db.prepare("UPDATE cognitive_agent_profiles SET readiness_status='revoked',deployment_state='revoked',version=version+1,updated_at=? WHERE agent_id=?").run(at, assetId);
      }
      const mapped = assetType === 'knowledge_base'
        ? mapKnowledgeBase(db.prepare('SELECT * FROM cognitive_knowledge_bases WHERE knowledge_base_id=?').get(assetId))
        : mapAgentProfile(db.prepare('SELECT * FROM cognitive_agent_profiles WHERE agent_id=?').get(assetId));
      return recordProductVersion(db, assetType, mapped, 'revoke', at);
    }));
  }

  function productMap() {
    return using(db => ({
      protocolVersion: PROTOCOL_VERSION,
      model: 'Evidence -> Cognition -> Playbook -> Knowledge Base -> Agent',
      stages: [
        { id: 'evidence', total: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_evidence_assertions').get().count) },
        { id: 'cognition', total: Number(db.prepare('SELECT COUNT(*) AS count FROM cognition_units').get().count),
          ready: Number(db.prepare("SELECT COUNT(*) AS count FROM cognition_units WHERE status='confirmed'").get().count) },
        { id: 'playbook', total: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_playbooks').get().count),
          ready: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_playbooks WHERE validation_status='current' AND semantic_maturity IN ('runnable_playbook','verified_capability')").get().count) },
        { id: 'knowledge_base', total: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_knowledge_bases').get().count),
          ready: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_knowledge_bases WHERE status='published'").get().count),
          stale: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_knowledge_bases WHERE status='stale_blocked'").get().count) },
        { id: 'agent', total: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_agent_profiles').get().count),
          ready: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_agent_profiles WHERE readiness_status='ready'").get().count),
          active: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_agent_profiles WHERE deployment_state='active'").get().count),
          stale: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_agent_profiles WHERE readiness_status='stale_blocked'").get().count) },
      ],
      defaults: { automaticPromotion: false, automaticExecution: false, protectedPublication: true, protectedDeployment: true },
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
    return using(db => {
      const observedAt = clock().toISOString();
      const retentionDue = db.prepare("SELECT * FROM source_documents WHERE trust_status<>'revoked'").all()
        .filter(row => {
          const deadline = retentionDeadline(row);
          return deadline && deadline <= observedAt;
        }).length;
      return {
        protocolVersion: PROTOCOL_VERSION,
        authorityMode,
        singleWriterRequired: true,
        enabled: true,
        lab: true,
        playbookExecution: false,
        liveDatabaseEncrypted: false,
        sensitivePersistenceAllowed: false,
        counts: {
          sources: Number(db.prepare('SELECT COUNT(*) AS count FROM source_documents').get().count),
          quarantinedSources: Number(db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE trust_status='quarantined'").get().count),
          cognitionCandidates: Number(db.prepare("SELECT COUNT(*) AS count FROM cognition_units WHERE status='candidate'").get().count),
          confirmedCognition: Number(db.prepare("SELECT COUNT(*) AS count FROM cognition_units WHERE status='confirmed'").get().count),
          playbooks: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_playbooks').get().count),
          knowledgeBases: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_knowledge_bases').get().count),
          publishedKnowledgeBases: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_knowledge_bases WHERE status='published'").get().count),
          agentProfiles: Number(db.prepare('SELECT COUNT(*) AS count FROM cognitive_agent_profiles').get().count),
          readyAgents: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_agent_profiles WHERE readiness_status='ready'").get().count),
          activeProjections: Number(db.prepare("SELECT COUNT(*) AS count FROM cognitive_projection_grants WHERE status='active' AND expires_at>?").get(now()).count),
          retentionDue,
        },
      };
    });
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
    compileKnowledgeBase,
    publishKnowledgeBase,
    compileAgentProfile,
    assessAgent,
    deployAgent,
    prepareAgentContext,
    revokeProduct,
    productMap,
    prepareRun: requestRun,
    requestRun,
    verifyRun,
    promotePlaybook,
    revoke,
    createProjection,
    readProjection,
    retentionStatus,
    enforceRetention,
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
