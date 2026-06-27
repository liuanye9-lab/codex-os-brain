#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");

const exampleMemory = [
  {
    id: "mem-001",
    source: "trace",
    text: "Dashboard fixes must be verified through localhost status plus a browser-visible panel check.",
    tags: ["dashboard", "verification", "localhost"],
    privacy_scope: "public",
    created_at: "2026-06-20T10:00:00.000Z",
    expires_at: "2026-07-20T10:00:00.000Z",
    evidence_count: 3,
    conflict_count: 0,
  },
  {
    id: "mem-002",
    source: "eval",
    text: "Public package releases require privacy scan, npm pack dry-run, and check before publish.",
    tags: ["release", "privacy", "npm", "check"],
    privacy_scope: "public",
    created_at: "2026-06-22T10:00:00.000Z",
    expires_at: "2026-08-01T10:00:00.000Z",
    evidence_count: 5,
    conflict_count: 0,
  },
  {
    id: "mem-003",
    source: "candidate",
    text: "Local embedding should use qwen3-embedding:0.6b through Ollama for low-cost memory recall.",
    tags: ["embedding", "memory", "token", "ollama"],
    privacy_scope: "public",
    created_at: "2026-06-27T07:00:00.000Z",
    expires_at: "2026-08-27T07:00:00.000Z",
    evidence_count: 2,
    conflict_count: 0,
  },
  {
    id: "mem-004",
    source: "candidate",
    text: "Private persona and live user memory must not be injected into public packages.",
    tags: ["privacy", "persona", "memory", "public"],
    privacy_scope: "private_placeholder",
    created_at: "2026-06-18T10:00:00.000Z",
    expires_at: "2026-07-01T10:00:00.000Z",
    evidence_count: 4,
    conflict_count: 0,
  },
  {
    id: "mem-005",
    source: "trace",
    text: "Long context alone increases token use and can hide missing verification.",
    tags: ["context", "token", "verification"],
    privacy_scope: "public",
    created_at: "2026-06-12T10:00:00.000Z",
    expires_at: "2026-07-12T10:00:00.000Z",
    evidence_count: 2,
    conflict_count: 1,
  },
];

function parseArgs(argv) {
  const args = { query: "memory token reduction dashboard verification", json: false, write: false, example: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--query") args.query = argv[++i] || args.query;
    else if (item === "--json") args.json = true;
    else if (item === "--write") args.write = true;
    else if (item === "--example") args.example = true;
  }
  return args;
}

function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff:.-]+/g, " ").split(/\s+/).filter(Boolean);
}

function rewriteQuery(query) {
  const tokens = tokenize(query);
  const expansions = [];
  if (tokens.includes("token")) expansions.push("context", "compression", "embedding");
  if (tokens.includes("memory")) expansions.push("recall", "candidate", "lifecycle");
  if (tokens.includes("dashboard")) expansions.push("observable", "localhost", "status");
  if (tokens.includes("publish") || tokens.includes("release")) expansions.push("npm", "privacy", "pack");
  return Array.from(new Set([...tokens, ...expansions])).slice(0, 18);
}

function freshness(item, now = new Date("2026-06-27T00:00:00.000Z")) {
  const created = Date.parse(item.created_at || "");
  const expires = Date.parse(item.expires_at || "");
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return 0.3;
  if (expires <= now.getTime()) return 0;
  const total = Math.max(1, expires - created);
  const remaining = Math.max(0, expires - now.getTime());
  return Math.min(1, remaining / total);
}

function privacyLabel(item) {
  if (item.privacy_scope === "public") return "public";
  if (item.privacy_scope === "private_placeholder") return "blocked_placeholder";
  return "review_required";
}

function scoreItem(item, rewritten) {
  const haystack = new Set([...tokenize(item.text), ...(item.tags || []).map((tag) => String(tag).toLowerCase())]);
  const keywordHits = rewritten.filter((token) => haystack.has(token)).length;
  const keywordScore = keywordHits / Math.max(1, rewritten.length);
  const fresh = freshness(item);
  const evidence = Math.min(1, (item.evidence_count || 0) / 5);
  const conflictPenalty = Math.min(0.4, (item.conflict_count || 0) * 0.15);
  const privacyPenalty = privacyLabel(item) === "public" ? 0 : 0.35;
  const rerankScore = Math.max(0, keywordScore * 0.45 + fresh * 0.25 + evidence * 0.25 - conflictPenalty - privacyPenalty);
  return {
    ...item,
    privacy_label: privacyLabel(item),
    freshness_score: Number(fresh.toFixed(3)),
    keyword_hits: keywordHits,
    vector_recall: "optional_ollama_embedding_path",
    rerank_score: Number(rerankScore.toFixed(3)),
    include: rerankScore >= 0.22 && privacyLabel(item) === "public" && fresh > 0,
    drop_reason: rerankScore < 0.22 ? "low_score" : privacyLabel(item) !== "public" ? "privacy_blocked" : fresh <= 0 ? "expired" : "",
  };
}

function detectConflicts(scored) {
  const conflicts = [];
  for (const item of scored) {
    if ((item.conflict_count || 0) > 0) {
      conflicts.push({
        memory_id: item.id,
        conflict_count: item.conflict_count,
        action: "read_source_before_injection",
      });
    }
  }
  return conflicts;
}

function run(query) {
  const rewritten = rewriteQuery(query);
  const scored = exampleMemory.map((item) => scoreItem(item, rewritten)).sort((a, b) => b.rerank_score - a.rerank_score);
  const included = scored.filter((item) => item.include).slice(0, 4);
  const dropped = scored.filter((item) => !included.some((picked) => picked.id === item.id));
  return {
    id: "acob-memory-retrieval-example",
    generated_at: new Date().toISOString(),
    query,
    memory_write_policy: {
      default: "candidate_only",
      auto_promote: false,
      requires: ["evidence_count", "privacy_scope", "rollback_or_delete_plan", "expiry"],
    },
    retrieval_query_rewrite: rewritten,
    vector_recall: {
      provider: "ollama",
      model: process.env.ACOB_EMBEDDING_MODEL || "qwen3-embedding:0.6b",
      mode: "optional_local_embedding",
      fallback: "keyword_metadata_rerank",
    },
    candidates: scored,
    rerank: {
      formula: "keyword*0.45 + freshness*0.25 + evidence*0.25 - conflictPenalty - privacyPenalty",
      top_k: included.map((item) => item.id),
    },
    conflict_detection: detectConflicts(scored),
    expiry_forget: dropped.filter((item) => item.drop_reason === "expired").map((item) => item.id),
    context_pack_injection: {
      max_items: 4,
      included: included.map((item) => ({
        id: item.id,
        source: item.source,
        privacy_label: item.privacy_label,
        freshness_score: item.freshness_score,
        reason: "high_score_public_not_expired",
        text: item.text,
      })),
      dropped: dropped.map((item) => ({ id: item.id, reason: item.drop_reason || "lower_rank" })),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = run(args.query);
  if (args.write) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "memory-retrieval-pipeline.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { run, rewriteQuery };
