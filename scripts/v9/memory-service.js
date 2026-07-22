'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { integrity, openMemoryDatabase, transaction } = require('./memory-db');
const { resolveV9Paths } = require('./paths');

const TRANSITIONS = Object.freeze({ candidate: ['confirmed', 'rejected'], confirmed: ['retired'], rejected: ['candidate'], retired: [] });

function id(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function now() { return new Date().toISOString(); }
function json(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function stableJson(value) { return JSON.stringify(value || {}); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function coded(code) { const error = new Error(code); error.code = code; return error; }
function sourceRef(value) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? value : `source:${hash(value).slice(0, 16)}`; }
  catch { return `local:${hash(value).slice(0, 16)}`; }
}

function vectorBlob(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(Number(value)))) throw coded('invalid_vector');
  return Buffer.from(new Float32Array(vector.map(Number)).buffer);
}

function blobVector(blob) {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}

function cosine(a, b) {
  if (!a.length || a.length !== b.length) return null;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function mapMemory(row) {
  if (!row) return null;
  return { ...row, metadata: json(row.metadata_json, {}), metadata_json: undefined };
}

function ftsQuery(query) {
  const text = String(query).trim();
  const terms = [];
  for (const part of text.split(/\s+/).filter(Boolean)) {
    const chars = Array.from(part);
    if (chars.length <= 3) terms.push(part);
    else for (let index = 0; index <= chars.length - 3; index += 1) terms.push(chars.slice(index, index + 3).join(''));
  }
  return [...new Set(terms)].map(term => `\"${term.replaceAll('"', '""')}\"`).join(' OR ');
}

function createMemoryService({ paths = resolveV9Paths(), dbPath = paths.memoryDbPath } = {}) {
  function using(fn, options) { const db = openMemoryDatabase({ paths, dbPath, ...options }); try { return fn(db); } finally { db.close(); } }

  function addEvent(db, { memoryId = null, action, actor, idempotencyKey = null, fromVersion = null, toVersion = null, payload = {} }) {
    if (idempotencyKey) {
      const existing = db.prepare('SELECT * FROM memory_events WHERE idempotency_key = ?').get(idempotencyKey);
      if (existing) return { duplicate: true, eventId: existing.event_id };
    }
    const eventId = id('mevt');
    db.prepare(`INSERT INTO memory_events(event_id,memory_id,action,actor,idempotency_key,from_version,to_version,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(eventId, memoryId, action, actor, idempotencyKey, fromVersion, toVersion, stableJson(payload), now());
    return { duplicate: false, eventId };
  }

  function priorIdempotentMemory(db, idempotencyKey) {
    if (!idempotencyKey) return null;
    const event = db.prepare('SELECT memory_id FROM memory_events WHERE idempotency_key=?').get(idempotencyKey);
    return event?.memory_id ? getMemoryFrom(db, event.memory_id) : null;
  }

  function indexOwner(db, ownerType, ownerId, title, content) {
    db.prepare('DELETE FROM search_index WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
    db.prepare('INSERT INTO search_index(owner_type,owner_id,title,content) VALUES(?,?,?,?)').run(ownerType, ownerId, title || '', content);
  }

  function createMemory(input = {}) {
    return using(db => transaction(db, () => {
      const prior = priorIdempotentMemory(db, input.idempotencyKey);
      if (prior) return prior;
      const content = String(input.content || '').trim();
      if (!content) throw coded('content_required');
      const approved = Boolean(input.approvedBy);
      const status = input.status || 'candidate';
      if (status !== 'candidate' && !approved) throw coded('approval_required');
      const memoryId = input.memoryId || id('mem');
      const at = now();
      db.prepare(`INSERT INTO memory_items(memory_id,kind,content,status,confidence,privacy,source_uri,valid_from,valid_to,metadata_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(memoryId, input.kind || 'fact', content, status, Number(input.confidence ?? 0.5), input.privacy || 'private', input.sourceUri || null, input.validFrom || null, input.validTo || null, stableJson(input.metadata), at, at);
      indexOwner(db, 'memory', memoryId, input.kind || 'fact', content);
      addEvent(db, { memoryId, action: 'create', actor: input.approvedBy || input.actor || 'agent', idempotencyKey: input.idempotencyKey, toVersion: 1, payload: { status, sourceUri: input.sourceUri || null } });
      return getMemoryFrom(db, memoryId);
    }));
  }

  function getMemoryFrom(db, memoryId) { return mapMemory(db.prepare('SELECT * FROM memory_items WHERE memory_id = ?').get(memoryId)); }
  function getMemory(memoryId) { return using(db => getMemoryFrom(db, memoryId)); }

  function updateMemory(memoryId, patch = {}) {
    return using(db => transaction(db, () => {
      const prior = priorIdempotentMemory(db, patch.idempotencyKey);
      if (prior) return prior;
      const current = getMemoryFrom(db, memoryId);
      if (!current) throw coded('memory_not_found');
      if (!Number.isInteger(Number(patch.expectedVersion))) throw coded('expected_version_required');
      if (Number(patch.expectedVersion) !== current.version) throw coded('version_conflict');
      if (current.status === 'confirmed' && patch.content !== undefined && !patch.approvedBy) throw coded('approval_required');
      const content = patch.content === undefined ? current.content : String(patch.content).trim();
      if (!content) throw coded('content_required');
      const nextVersion = current.version + 1;
      const result = db.prepare(`UPDATE memory_items SET content=?, confidence=?, privacy=?, source_uri=?, valid_from=?, valid_to=?, metadata_json=?, version=?, updated_at=?
        WHERE memory_id=? AND version=?`).run(content, Number(patch.confidence ?? current.confidence), patch.privacy || current.privacy, patch.sourceUri === undefined ? current.source_uri : patch.sourceUri, patch.validFrom === undefined ? current.valid_from : patch.validFrom, patch.validTo === undefined ? current.valid_to : patch.validTo, stableJson(patch.metadata === undefined ? current.metadata : patch.metadata), nextVersion, now(), memoryId, current.version);
      if (result.changes !== 1) throw coded('version_conflict');
      indexOwner(db, 'memory', memoryId, current.kind, content);
      addEvent(db, { memoryId, action: 'update', actor: patch.approvedBy || patch.actor || 'agent', idempotencyKey: patch.idempotencyKey, fromVersion: current.version, toVersion: nextVersion, payload: { fields: Object.keys(patch).filter(key => !['approvedBy','actor'].includes(key)) } });
      return getMemoryFrom(db, memoryId);
    }));
  }

  function transitionMemory(memoryId, targetStatus, input = {}) {
    return using(db => transaction(db, () => {
      const prior = priorIdempotentMemory(db, input.idempotencyKey);
      if (prior) return prior;
      const current = getMemoryFrom(db, memoryId);
      if (!current) throw coded('memory_not_found');
      if (!input.approvedBy) throw coded('approval_required');
      if (!Number.isInteger(Number(input.expectedVersion)) || Number(input.expectedVersion) !== current.version) throw coded('version_conflict');
      if (!TRANSITIONS[current.status]?.includes(targetStatus)) throw coded('invalid_lifecycle_transition');
      const nextVersion = current.version + 1;
      const result = db.prepare('UPDATE memory_items SET status=?, version=?, updated_at=? WHERE memory_id=? AND version=?').run(targetStatus, nextVersion, now(), memoryId, current.version);
      if (result.changes !== 1) throw coded('version_conflict');
      addEvent(db, { memoryId, action: 'transition', actor: input.approvedBy, idempotencyKey: input.idempotencyKey, fromVersion: current.version, toVersion: nextVersion, payload: { from: current.status, to: targetStatus, reason: input.reason || null } });
      return getMemoryFrom(db, memoryId);
    }));
  }

  function deleteMemory(memoryId, input = {}) {
    return using(db => transaction(db, () => {
      const prior = priorIdempotentMemory(db, input.idempotencyKey);
      if (prior) return prior;
      const current = getMemoryFrom(db, memoryId);
      if (!current) throw coded('memory_not_found');
      if (!input.approvedBy) throw coded('approval_required');
      if (Number(input.expectedVersion) !== current.version) throw coded('version_conflict');
      if (['retired','rejected'].includes(current.status)) return current;
      const targetStatus = current.status === 'confirmed' ? 'retired' : 'rejected';
      const nextVersion = current.version + 1;
      const result = db.prepare('UPDATE memory_items SET status=?,version=?,updated_at=? WHERE memory_id=? AND version=?')
        .run(targetStatus, nextVersion, now(), memoryId, current.version);
      if (result.changes !== 1) throw coded('version_conflict');
      db.prepare('DELETE FROM search_index WHERE owner_type=? AND owner_id=?').run('memory', memoryId);
      addEvent(db, { memoryId, action: 'delete', actor: input.approvedBy, idempotencyKey: input.idempotencyKey, fromVersion: current.version, toVersion: nextVersion, payload: { tombstone: true, status: targetStatus, reason: input.reason || null } });
      return getMemoryFrom(db, memoryId);
    }));
  }

  function importDocument(input = {}) {
    return using(db => transaction(db, () => {
      const content = String(input.content || '').trim();
      if (!content || !input.sourceUri) throw coded('source_document_required');
      const contentHash = input.contentHash || hash(content);
      const existing = db.prepare('SELECT * FROM source_documents WHERE content_hash=?').get(contentHash);
      if (existing) return { imported: false, documentId: existing.document_id, contentHash };
      const documentId = input.documentId || id('doc');
      const at = now();
      db.prepare('INSERT INTO source_documents(document_id,source_uri,title,content,content_hash,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(documentId, input.sourceUri, input.title || null, content, contentHash, stableJson(input.metadata), at, at);
      indexOwner(db, 'document', documentId, input.title, content);
      if (input.embedding) putEmbeddingFrom(db, { ownerType: 'document', ownerId: documentId, vector: input.embedding, model: input.model || 'unknown', fingerprint: input.fingerprint || 'unknown' });
      return { imported: true, documentId, contentHash };
    }));
  }

  function importFlatIndex(filePath) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
    const report = { source: path.resolve(filePath), scanned: chunks.length, imported: 0, duplicates: 0, vectors: 0, failed: 0 };
    for (const chunk of chunks) {
      try {
        const result = importDocument({
          sourceUri: chunk.source || chunk.path || payload.source || 'legacy-index', title: chunk.heading || chunk.title || null,
          content: chunk.content || chunk.text, contentHash: chunk.contentHash || chunk.hash,
          metadata: { legacyChunkId: chunk.id || chunk.chunkId || null, modifiedAt: chunk.modifiedAt || null },
          embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null, model: payload.model || payload.embeddingModel || 'legacy',
          fingerprint: payload.embeddingFingerprint || payload.fingerprint || 'legacy',
        });
        if (result.imported) report.imported += 1; else report.duplicates += 1;
        if (Array.isArray(chunk.embedding) && chunk.embedding.length) report.vectors += 1;
      } catch { report.failed += 1; }
    }
    return report;
  }

  function putEmbeddingFrom(db, input) {
    const blob = vectorBlob(input.vector);
    db.prepare(`INSERT INTO embeddings(owner_type,owner_id,model,fingerprint,dimensions,vector,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(owner_type,owner_id,fingerprint) DO UPDATE SET model=excluded.model,dimensions=excluded.dimensions,vector=excluded.vector,created_at=excluded.created_at`)
      .run(input.ownerType, input.ownerId, input.model, input.fingerprint, input.vector.length, blob, now());
  }
  function putEmbedding(input) { return using(db => transaction(db, () => { putEmbeddingFrom(db, input); return { stored: true, ownerType: input.ownerType, ownerId: input.ownerId, dimensions: input.vector.length }; })); }

  function search(input = {}) {
    return using(db => {
      const limit = Math.max(1, Math.min(100, Number(input.limit || 10)));
      const query = String(input.query || '').trim();
      if (!query && !input.queryVector) throw coded('query_required');
      const includeCandidates = input.includeCandidates === true;
      let lexical = [];
      if (query) {
        const shortQuery = Array.from(query).length < 3;
        lexical = shortQuery
          ? db.prepare(`SELECT search_index.owner_type,search_index.owner_id,search_index.title,search_index.content,0 AS bm25
              FROM search_index LEFT JOIN memory_items ON search_index.owner_type='memory' AND memory_items.memory_id=search_index.owner_id
              WHERE search_index.content LIKE ? ESCAPE '\\' AND (search_index.owner_type='document' OR (?=1 OR memory_items.status='confirmed')) LIMIT ?`)
            .all(`%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, includeCandidates ? 1 : 0, limit * 4)
          : db.prepare(`SELECT search_index.owner_type,search_index.owner_id,search_index.title,search_index.content,bm25(search_index) AS bm25
              FROM search_index LEFT JOIN memory_items ON search_index.owner_type='memory' AND memory_items.memory_id=search_index.owner_id
              WHERE search_index MATCH ? AND (search_index.owner_type='document' OR (?=1 OR memory_items.status='confirmed'))
              ORDER BY bm25(search_index) LIMIT ?`)
            .all(ftsQuery(query), includeCandidates ? 1 : 0, limit * 4);
      }
      const candidates = new Map();
      lexical.forEach((row, index) => candidates.set(`${row.owner_type}:${row.owner_id}`, { ...row, lexicalScore: 1 / (1 + index), vectorScore: null }));
      if (Array.isArray(input.queryVector)) {
        const rows = db.prepare('SELECT owner_type,owner_id,model,fingerprint,dimensions,vector FROM embeddings WHERE dimensions=?').all(input.queryVector.length);
        for (const row of rows) {
          const score = cosine(input.queryVector.map(Number), blobVector(row.vector));
          const key = `${row.owner_type}:${row.owner_id}`;
          const item = candidates.get(key) || { owner_type: row.owner_type, owner_id: row.owner_id, title: null, content: null, lexicalScore: 0 };
          item.vectorScore = score;
          candidates.set(key, item);
        }
      }
      const results = [];
      for (const item of candidates.values()) {
        let record;
        if (item.owner_type === 'memory') {
          record = db.prepare('SELECT kind AS title,content,status,source_uri,updated_at FROM memory_items WHERE memory_id=?').get(item.owner_id);
          if (!record || (!includeCandidates && record.status !== 'confirmed')) continue;
        } else if (item.owner_type === 'document') {
          record = db.prepare(`SELECT title,content,'source' AS status,source_uri,updated_at FROM source_documents WHERE document_id=?`).get(item.owner_id);
        } else continue;
        const lexicalScore = Number(item.lexicalScore || 0);
        const vectorScore = item.vectorScore === null || item.vectorScore === undefined ? 0 : Math.max(0, Number(item.vectorScore));
        const { source_uri: privateSource, ...safeRecord } = record;
        results.push({ ownerType: item.owner_type, ownerId: item.owner_id, ...safeRecord, sourceRef: sourceRef(privateSource), lexicalScore, vectorScore, score: Number((0.45 * lexicalScore + 0.55 * vectorScore).toFixed(6)) });
      }
      results.sort((a, b) => b.score - a.score || b.lexicalScore - a.lexicalScore);
      return { mode: input.queryVector ? 'hybrid-exact' : 'fts5', query, count: Math.min(limit, results.length), results: results.slice(0, limit) };
    });
  }

  function aggregate(input = {}) {
    return using(db => {
      const by = ['status','kind','privacy'].includes(input.by) ? input.by : 'status';
      return { by, rows: db.prepare(`SELECT ${by} AS key, COUNT(*) AS count FROM memory_items GROUP BY ${by} ORDER BY count DESC`).all() };
    });
  }

  function upsertEntity(input = {}) {
    return using(db => transaction(db, () => {
      if (!input.name || !input.entityType) throw coded('entity_required');
      const existing = db.prepare('SELECT * FROM entities WHERE entity_type=? AND name=?').get(input.entityType, input.name);
      if (existing) return existing;
      const entityId = input.entityId || id('ent'); const at = now();
      db.prepare('INSERT INTO entities(entity_id,entity_type,name,aliases_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(entityId, input.entityType, input.name, stableJson(input.aliases || []), stableJson(input.metadata), at, at);
      return db.prepare('SELECT * FROM entities WHERE entity_id=?').get(entityId);
    }));
  }

  function link(input = {}) {
    return using(db => transaction(db, () => {
      if (!input.fromEntityId || !input.toEntityId || !input.relation) throw coded('edge_required');
      const status = input.status || 'candidate';
      if (status === 'active' && !input.approvedBy) throw coded('approval_required');
      const edgeId = input.edgeId || id('edge'); const at = now();
      db.prepare(`INSERT INTO edges(edge_id,from_entity_id,to_entity_id,relation,status,weight,valid_from,valid_to,provenance_uri,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(edgeId, input.fromEntityId, input.toEntityId, input.relation, status, Number(input.weight ?? 1), input.validFrom || null, input.validTo || null, input.provenanceUri || null, at, at);
      return db.prepare('SELECT * FROM edges WHERE edge_id=?').get(edgeId);
    }));
  }

  function traverse(input = {}) {
    return using(db => {
      const depth = Math.max(1, Math.min(10, Number(input.depth || 3)));
      const at = input.at || now();
      return db.prepare(`WITH RECURSIVE walk(entity_id,depth,path) AS (
        SELECT ?,0,? UNION ALL
        SELECT CASE WHEN e.from_entity_id=w.entity_id THEN e.to_entity_id ELSE e.from_entity_id END,w.depth+1,
          w.path || '>' || CASE WHEN e.from_entity_id=w.entity_id THEN e.to_entity_id ELSE e.from_entity_id END
        FROM walk w JOIN edges e ON (e.from_entity_id=w.entity_id OR e.to_entity_id=w.entity_id)
        WHERE w.depth < ? AND e.status='active' AND (e.valid_from IS NULL OR e.valid_from<=?) AND (e.valid_to IS NULL OR e.valid_to>?)
          AND instr(w.path, CASE WHEN e.from_entity_id=w.entity_id THEN e.to_entity_id ELSE e.from_entity_id END)=0
      ) SELECT w.entity_id,w.depth,w.path,en.entity_type,en.name FROM walk w JOIN entities en ON en.entity_id=w.entity_id ORDER BY w.depth,en.name`).all(input.entityId, input.entityId, depth, at, at);
    });
  }

  function putStateBlock(input = {}) {
    return using(db => transaction(db, () => {
      if (!input.blockId || !input.agentId || !input.scope) throw coded('state_block_required');
      const existing = db.prepare('SELECT * FROM agent_state_blocks WHERE block_id=?').get(input.blockId);
      const at = now();
      if (!existing) {
        db.prepare('INSERT INTO agent_state_blocks(block_id,agent_id,scope,content,access_mode,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(input.blockId, input.agentId, input.scope, String(input.content || ''), input.accessMode || 'read_write', stableJson(input.metadata), at, at);
      } else {
        if (existing.access_mode === 'read_only' && !input.approvedBy) throw coded('approval_required');
        if (Number(input.expectedVersion) !== existing.version) throw coded('version_conflict');
        db.prepare('UPDATE agent_state_blocks SET content=?,metadata_json=?,version=version+1,updated_at=? WHERE block_id=? AND version=?')
          .run(String(input.content || ''), stableJson(input.metadata || json(existing.metadata_json, {})), at, input.blockId, existing.version);
      }
      return db.prepare('SELECT * FROM agent_state_blocks WHERE block_id=?').get(input.blockId);
    }));
  }

  function listStateBlocks(agentId, scope) {
    return using(db => db.prepare(`SELECT * FROM agent_state_blocks WHERE agent_id=? AND (? IS NULL OR scope=?) ORDER BY scope,block_id`).all(agentId, scope || null, scope || null));
  }

  function feedback(input = {}) {
    return using(db => transaction(db, () => {
      const feedbackId = input.feedbackId || id('fb');
      db.prepare('INSERT INTO retrieval_feedback(feedback_id,query_hash,owner_type,owner_id,rank,signal,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(feedbackId, hash(input.query || input.queryHash || ''), input.ownerType || null, input.ownerId || null, input.rank || null, input.signal, stableJson(input.metadata), now());
      return { feedbackId, recorded: true };
    }));
  }

  function addEvalCase(input = {}) {
    return using(db => transaction(db, () => {
      if (!input.query || !Array.isArray(input.expectedOwnerIds) || !input.expectedOwnerIds.length) throw coded('eval_case_required');
      const caseId = input.caseId || id('eval'); const at = now();
      db.prepare(`INSERT INTO retrieval_eval_cases(case_id,query,expected_json,tags_json,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)
        ON CONFLICT(case_id) DO UPDATE SET query=excluded.query,expected_json=excluded.expected_json,tags_json=excluded.tags_json,active=1,updated_at=excluded.updated_at`)
        .run(caseId, input.query, stableJson(input.expectedOwnerIds), stableJson(input.tags || []), at, at);
      return { caseId, query: input.query, expectedOwnerIds: input.expectedOwnerIds, tags: input.tags || [] };
    }));
  }

  function listEvalCases() {
    return using(db => db.prepare('SELECT * FROM retrieval_eval_cases WHERE active=1 ORDER BY case_id').all().map(row => ({ caseId: row.case_id, query: row.query, expectedOwnerIds: json(row.expected_json, []), tags: json(row.tags_json, []) })));
  }

  function status() {
    if (!fs.existsSync(dbPath)) return { initialized: false, schemaVersion: 0, dbPath, counts: { memories: 0, confirmed: 0, documents: 0, vectors: 0, entities: 0, edges: 0, feedback: 0 } };
    return using(db => ({
      initialized: true,
      schemaVersion: Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version),
      dbPath, journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
      integrity: integrity(db),
      counts: {
        memories: Number(db.prepare('SELECT COUNT(*) AS count FROM memory_items').get().count),
        confirmed: Number(db.prepare("SELECT COUNT(*) AS count FROM memory_items WHERE status='confirmed'").get().count),
        documents: Number(db.prepare('SELECT COUNT(*) AS count FROM source_documents').get().count),
        vectors: Number(db.prepare('SELECT COUNT(*) AS count FROM embeddings').get().count),
        entities: Number(db.prepare('SELECT COUNT(*) AS count FROM entities').get().count),
        edges: Number(db.prepare('SELECT COUNT(*) AS count FROM edges').get().count),
        feedback: Number(db.prepare('SELECT COUNT(*) AS count FROM retrieval_feedback').get().count),
      },
    }));
  }

  return { addEvalCase, aggregate, createMemory, deleteMemory, feedback, getMemory, importDocument, importFlatIndex, link, listEvalCases, listStateBlocks, putEmbedding, putStateBlock, search, status, transitionMemory, traverse, updateMemory, upsertEntity };
}

module.exports = { blobVector, cosine, createMemoryService, ftsQuery, sourceRef, vectorBlob };
