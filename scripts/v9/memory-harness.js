'use strict';

const crypto = require('node:crypto');
const { openMemoryDatabase, transaction } = require('./memory-db');
const { resolveV9Paths } = require('./paths');
const { ftsQuery } = require('./memory-service');

function id(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function now() { return new Date().toISOString(); }

function createMemoryHarness({ paths = resolveV9Paths(), dbPath = paths.memoryDbPath, minSamples = 5 } = {}) {
  function evaluateRetrieval(db, limit = 10) {
    const cases = db.prepare('SELECT * FROM retrieval_eval_cases WHERE active=1 ORDER BY case_id').all();
    if (!cases.length) return { cases: 0, recallAtK: null, mrr: null, limit };
    let hits = 0; let reciprocalRank = 0;
    for (const item of cases) {
      const expected = new Set(JSON.parse(item.expected_json));
      let rows = [];
      try {
        rows = db.prepare('SELECT owner_id FROM search_index WHERE search_index MATCH ? ORDER BY bm25(search_index) LIMIT ?')
          .all(ftsQuery(item.query), limit);
      } catch { rows = []; }
      const rank = rows.findIndex(row => expected.has(row.owner_id));
      if (rank >= 0) { hits += 1; reciprocalRank += 1 / (rank + 1); }
    }
    return { cases: cases.length, recallAtK: Number((hits / cases.length).toFixed(4)), mrr: Number((reciprocalRank / cases.length).toFixed(4)), limit };
  }

  function cycle() {
    const db = openMemoryDatabase({ paths, dbPath });
    const startedAt = now();
    try {
      return transaction(db, () => {
        const feedback = db.prepare(`SELECT signal,COUNT(*) AS count FROM retrieval_feedback
          WHERE created_at >= datetime('now','-30 days') GROUP BY signal ORDER BY count DESC`).all();
        const metrics = {
          memoriesByStatus: db.prepare('SELECT status,COUNT(*) AS count FROM memory_items GROUP BY status').all(),
          documents: Number(db.prepare('SELECT COUNT(*) AS count FROM source_documents').get().count),
          vectors: Number(db.prepare('SELECT COUNT(*) AS count FROM embeddings').get().count),
          feedback30d: feedback,
          pendingEvolution: Number(db.prepare("SELECT COUNT(*) AS count FROM evolution_candidates WHERE status='pending'").get().count),
          retrievalEval: evaluateRetrieval(db),
        };
        const findings = [];
        const negative = feedback.filter(row => ['harmful','missed','stale','conflict'].includes(row.signal));
        for (const row of negative) {
          const count = Number(row.count);
          if (count < minSamples) continue;
          const family = `retrieval_${row.signal}`;
          const exists = db.prepare("SELECT candidate_id FROM evolution_candidates WHERE family=? AND status IN ('pending','approved','applied')").get(family);
          if (exists) continue;
          const candidateId = id('evo');
          const proposal = { action: 'investigate_and_run_bounded_experiment', target: family, automaticApply: false };
          const rollback = { signal: 'retrieval_quality_regression', action: 'restore_previous_policy_and_mark_reverted', observationWindow: 'next_5_comparable_cases' };
          db.prepare(`INSERT INTO evolution_candidates(candidate_id,family,problem,proposal_json,baseline_json,evidence_json,rollback_json,sample_count,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(candidateId, family, `${count} ${row.signal} signals in 30 days`, JSON.stringify(proposal), JSON.stringify(metrics), JSON.stringify({ signal: row.signal, count }), JSON.stringify(rollback), count, 'pending', startedAt, startedAt);
          findings.push({ level: 'candidate', candidateId, family, sampleCount: count, automaticApply: false });
        }
        if (!metrics.documents) findings.push({ level: 'degraded', code: 'no_source_documents' });
        if (!metrics.vectors) findings.push({ level: 'advisory', code: 'no_vectors_lexical_only' });
        const status = findings.some(item => item.level === 'degraded') ? 'degraded' : 'passed';
        const runId = id('hrun'); const completedAt = now();
        db.prepare('INSERT INTO harness_runs(run_id,status,metrics_json,findings_json,started_at,completed_at) VALUES(?,?,?,?,?,?)')
          .run(runId, status, JSON.stringify(metrics), JSON.stringify(findings), startedAt, completedAt);
        return { runId, status, metrics, findings, candidateOnly: true, completedAt };
      });
    } finally { db.close(); }
  }

  function candidates() {
    const db = openMemoryDatabase({ paths, dbPath });
    try { return db.prepare('SELECT * FROM evolution_candidates ORDER BY created_at DESC').all(); } finally { db.close(); }
  }

  return { candidates, cycle };
}

module.exports = { createMemoryHarness };
