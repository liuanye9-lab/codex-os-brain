#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");
const CANDIDATES = path.join(DATA_DIR, "memory-candidates.jsonl");
const APPROVED = path.join(DATA_DIR, "memory-approved.jsonl");
const REVIEWS = path.join(DATA_DIR, "memory-reviews.jsonl");

function parseArgs(argv) {
  const args = { tags: [], json: false, write: false, public: false, approved: false, report: false, example: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--candidate" || item === "--text") args.text = argv[++i] || "";
    else if (item === "--source") args.source = argv[++i] || "manual";
    else if (item === "--tag") args.tags.push(argv[++i] || "");
    else if (item === "--ttl-days") args.ttlDays = Number(argv[++i] || "30");
    else if (item === "--apply") args.apply = argv[++i] || "";
    else if (item === "--reject") args.reject = argv[++i] || "";
    else if (item === "--reason") args.reason = argv[++i] || "";
    else if (item === "--public") args.public = true;
    else if (item === "--approved") args.approved = true;
    else if (item === "--write") args.write = true;
    else if (item === "--json") args.json = true;
    else if (item === "--report") args.report = true;
    else if (item === "--example") args.example = true;
  }
  return args;
}

function sha(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function isoAfterDays(days, base = new Date()) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Number(days || 30)));
  return date.toISOString();
}

function buildCandidate(args, baseDate = new Date()) {
  const text = String(args.text || "").trim();
  if (!text) throw new Error("missing --candidate text");
  const privacyScope = args.public ? "public" : "review_required";
  return {
    id: `mem-candidate-${sha(`${privacyScope}:${text}`)}`,
    created_at: baseDate.toISOString(),
    source: args.source || "manual",
    tags: args.tags.filter(Boolean).slice(0, 8),
    text_hash: sha(text),
    text: privacyScope === "public" ? text : "[redacted_until_public_approval]",
    privacy_scope: privacyScope,
    status: "candidate",
    auto_promote: false,
    evidence_count: 1,
    expires_at: isoAfterDays(args.ttlDays || 30, baseDate),
    required_gate: ["human approval", "privacy scope", "rollback/delete plan"],
    rollback_plan: "delete this candidate or append a rejection review record",
  };
}

function summarize(now = new Date()) {
  const candidates = readJsonl(CANDIDATES);
  const approved = readJsonl(APPROVED);
  const reviews = readJsonl(REVIEWS);
  const approvedIds = new Set(approved.map((item) => item.candidate_id));
  const rejectedIds = new Set(reviews.filter((item) => item.status === "rejected").map((item) => item.candidate_id));
  const expired = candidates.filter((item) => Date.parse(item.expires_at || "") <= now.getTime());
  const pending = candidates.filter((item) => !approvedIds.has(item.id) && !rejectedIds.has(item.id) && !expired.some((expiredItem) => expiredItem.id === item.id));
  return {
    id: "acob-memory-loop-report",
    generated_at: now.toISOString(),
    data_quality: candidates.length || approved.length || reviews.length ? "observed_local_files" : "no_observed_memory_loop_yet",
    candidates: candidates.length,
    approved: approved.length,
    rejected: rejectedIds.size,
    expired: expired.length,
    pending_review: pending.length,
    auto_promote: false,
    next_action: pending.length ? "review pending candidates with acob memory-loop --apply <id> --approved or --reject <id>" : "no pending candidates",
  };
}

function applyCandidate(id, args) {
  if (!args.approved) {
    return { id, status: "blocked", reason: "memory apply requires --approved" };
  }
  const candidate = readJsonl(CANDIDATES).find((item) => item.id === id);
  if (!candidate) return { id, status: "not_found" };
  if (candidate.privacy_scope !== "public") {
    return { id, status: "blocked", reason: "candidate is not public-safe; keep it in private review" };
  }
  const record = {
    id: `mem-approved-${sha(`${id}:${candidate.text_hash}`)}`,
    candidate_id: id,
    approved_at: new Date().toISOString(),
    text: candidate.text,
    tags: candidate.tags,
    source: candidate.source,
    rollback_plan: "delete this approved record from local memory-approved.jsonl",
    status: "applied",
  };
  appendJsonl(APPROVED, record);
  return record;
}

function rejectCandidate(id, args) {
  const record = {
    id: `mem-review-${sha(`${id}:${Date.now()}`)}`,
    candidate_id: id,
    reviewed_at: new Date().toISOString(),
    status: "rejected",
    reason: args.reason || "not useful enough for memory",
  };
  appendJsonl(REVIEWS, record);
  return record;
}

function example() {
  const candidate = buildCandidate({
    text: "Public package releases require privacy scan, smoke test, package gate, and explicit boundary docs.",
    source: "example",
    tags: ["release", "privacy", "verification"],
    public: true,
    ttlDays: 45,
  }, new Date("2026-06-30T00:00:00.000Z"));
  return {
    id: "acob-memory-loop-example",
    generated_at: new Date().toISOString(),
    steps: ["capture candidate", "block auto-promotion", "require approval", "apply or reject", "expire stale candidates", "report daily"],
    candidate,
    apply_command: `acob memory-loop --apply ${candidate.id} --approved`,
    reject_command: `acob memory-loop --reject ${candidate.id} --reason "too broad"`,
    report_command: "acob memory-loop --report --json",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let out;
  if (args.example) out = example();
  else if (args.apply) out = applyCandidate(args.apply, args);
  else if (args.reject) out = rejectCandidate(args.reject, args);
  else if (args.text) {
    out = buildCandidate(args);
    if (args.write) appendJsonl(CANDIDATES, out);
  } else {
    out = summarize();
  }
  if (!args.json && !args.example && !args.text && !args.apply && !args.reject) {
    console.log(`memory candidates: ${out.candidates}`);
    console.log(`approved: ${out.approved}`);
    console.log(`pending review: ${out.pending_review}`);
    console.log(`expired: ${out.expired}`);
    console.log(`next: ${out.next_action}`);
    return;
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { buildCandidate, summarize, example };
