#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const DEFAULT_ROOT = path.join(HOME, ".acob");
const LEGACY_ROOT = path.join(HOME, ".codex-os-brain");

function safeRuntimeName(root) {
  if (root === DEFAULT_ROOT) return ".acob";
  if (root === LEGACY_ROOT) return ".codex-os-brain";
  return "custom";
}

function countLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function runtimeScore(root) {
  const data = path.join(root, "data");
  return [
    "prompt-events.jsonl",
    "agentic-dispatch.jsonl",
    "engineering-audit.jsonl",
    "memory-candidates.jsonl",
    "memory-approved.jsonl",
    "memory-reviews.jsonl",
  ].reduce((sum, name) => sum + countLines(path.join(data, name)), 0);
}

function resolveRoot() {
  if (process.env.ACOB_HOME) return process.env.ACOB_HOME;
  if (process.env.CODEX_OS_BRAIN_HOME) return process.env.CODEX_OS_BRAIN_HOME;

  const candidates = [DEFAULT_ROOT, LEGACY_ROOT];
  return candidates
    .map((root) => ({ root, score: runtimeScore(root), exists: fs.existsSync(root) }))
    .sort((a, b) => b.score - a.score || Number(b.exists) - Number(a.exists))[0].root;
}

const ROOT = resolveRoot();
const DATA_DIR = path.join(ROOT, "data");
const REPORT_DIR = path.join(ROOT, "reports");

function localDateString(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseArgs(argv) {
  const args = { effect: false, json: false, write: false, date: localDateString() };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--date") args.date = argv[++i] || args.date;
    else if (item === "--effect") args.effect = true;
    else if (item === "--json") args.json = true;
    else if (item === "--write") args.write = true;
  }
  return args;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sanitizeMetricString(value) {
  const text = String(value || "");
  if (!text) return "";
  return text
    .replace(/[A-Z]:\\Users\\[^\\\s"]+(?:\\[^"\n\r]*)?/gi, "[home]")
    .replace(/\/Users\/[^/\s"]+(?:\/[^"\n\r]*)?/g, "[home]")
    .replace(/\/home\/[^/\s"]+(?:\/[^"\n\r]*)?/g, "[home]")
    .replace(/\/private\/[^"\n\r]*/g, "[private-path]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(api[_-]?key|token|password|secret|credential)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
    .replace(/\b(prompt|raw_prompt|task_text|memory)\s*[:=]\s*.+$/gi, "$1=[redacted]")
    .slice(0, 180);
}

function readJsonlRecords(name) {
  const file = path.join(DATA_DIR, name);
  try {
    const items = [];
    let invalidLines = 0;
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        items.push(JSON.parse(line));
      } catch {
        invalidLines += 1;
      }
    }
    return { items, invalid_lines: invalidLines };
  } catch {
    return { items: [], invalid_lines: 0 };
  }
}

function readJsonl(name) {
  return readJsonlRecords(name).items;
}

function eventDate(item) {
  const raw = item.ts || item.generated_at || item.created_at || item.approved_at || item.reviewed_at || item.applied_at || "";
  return localDateString(raw) || String(raw).slice(0, 10);
}

function sameDay(items, date) {
  return items.filter((item) => eventDate(item) === date);
}

function redFlagStatus() {
  const active = readJson(path.join(DATA_DIR, "red-flag.json"), null);
  const archived = readJsonl("red-flag-archive.jsonl");
  return {
    active: Boolean(active),
    reason: active ? sanitizeMetricString(active.reason || "red_flag_active") : null,
    raised_at: active?.raised_at || null,
    required_action: active ? sanitizeMetricString(active.required_action || "verify before completion") : null,
    archived_count: archived.length,
    last_archived_at: archived.length ? archived.at(-1).archived_at || null : null,
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function avg(items, key) {
  const nums = items.map((item) => Number(item[key] || 0)).filter((num) => Number.isFinite(num) && num > 0);
  if (!nums.length) return 0;
  return Math.round(nums.reduce((sum, num) => sum + num, 0) / nums.length);
}

function riskCounts(audits) {
  const counts = {};
  for (const audit of audits) {
    for (const risk of audit.risks || []) {
      counts[risk.severity || "unknown"] = (counts[risk.severity || "unknown"] || 0) + 1;
    }
  }
  return counts;
}

function invalidEventLines(recordsByName) {
  return Object.fromEntries(Object.entries(recordsByName)
    .filter(([, record]) => record.invalid_lines > 0)
    .map(([name, record]) => [name, record.invalid_lines]));
}

function percent(part, total) {
  return total ? Number((part / total).toFixed(3)) : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreSystemSlimming(report) {
  const data = report.system_slimming;
  if (!data.prompt_events) return 55;
  const overBudgetRate = percent(data.over_budget_events, data.prompt_events);
  const avgContextRatio = data.context_budget_chars
    ? data.avg_context_chars / data.context_budget_chars
    : 0;
  const contextPenalty = Math.max(0, avgContextRatio - 0.7) * 40;
  return clampScore(94 - (overBudgetRate * 100) - contextPenalty);
}

function scoreMemoryLoop(report) {
  const data = report.memory_loop;
  const total = data.candidates + data.approved + data.rejected;
  if (!total) return 55;
  const pendingPenalty = Math.min(35, data.pending_signal * 12);
  const approvalSignal = Math.min(15, data.approved * 5);
  const autoPromotePenalty = data.auto_promote ? 60 : 0;
  return clampScore(78 + approvalSignal - pendingPenalty - autoPromotePenalty);
}

function scoreDispatch(report) {
  const data = report.agentic_dispatch;
  if (!data.events) return 55;
  const privacyPenalty = Math.min(80, (data.high_privacy_unsafe_open_events || 0) * 35);
  const fanoutPenalty = data.gate_open_rate > 0.8 ? 10 : 0;
  return clampScore(90 - privacyPenalty - fanoutPenalty);
}

function scoreVerification(report) {
  const data = report.verification_pressure;
  if (data.red_flag_present) return 20;
  if (!data.post_tool_audits) return 55;
  const risks = data.risk_counts || {};
  const highRiskPenalty = Number(risks.high || 0) * 15;
  const mediumRiskPenalty = Number(risks.medium || 0) * 6;
  return clampScore(88 - highRiskPenalty - mediumRiskPenalty);
}

function scoreSelfEvolution(report) {
  const data = report.self_evolution;
  if (data.auto_apply) return 10;
  const total = data.candidates + data.applied_with_verification + data.rejected;
  if (!total) return 60;
  const verifiedSignal = Math.min(18, data.applied_with_verification * 6);
  const rollbackPenalty = data.rollback_available ? 0 : 25;
  return clampScore(76 + verifiedSignal - rollbackPenalty);
}

function scorePrivacyBoundary(report) {
  const highPrivacyUnsafeOpen = report.agentic_dispatch.high_privacy_unsafe_open_events || 0;
  const activeRedFlag = report.verification_pressure.red_flag_present;
  const autoPromote = report.memory_loop.auto_promote;
  const autoApply = report.self_evolution.auto_apply;
  return clampScore(96 - (highPrivacyUnsafeOpen * 35) - (activeRedFlag ? 45 : 0) - (autoPromote ? 55 : 0) - (autoApply ? 55 : 0));
}

function buildReport(date) {
  const config = readJson(path.join(ROOT, "config.json"), {});
  const budget = config.context_budget || {};
  const records = {
    "prompt-events.jsonl": readJsonlRecords("prompt-events.jsonl"),
    "agentic-dispatch.jsonl": readJsonlRecords("agentic-dispatch.jsonl"),
    "engineering-audit.jsonl": readJsonlRecords("engineering-audit.jsonl"),
    "memory-candidates.jsonl": readJsonlRecords("memory-candidates.jsonl"),
    "memory-approved.jsonl": readJsonlRecords("memory-approved.jsonl"),
    "memory-reviews.jsonl": readJsonlRecords("memory-reviews.jsonl"),
    "evolution-candidates.jsonl": readJsonlRecords("evolution-candidates.jsonl"),
    "evolution-applied.jsonl": readJsonlRecords("evolution-applied.jsonl"),
    "evolution-reviews.jsonl": readJsonlRecords("evolution-reviews.jsonl"),
  };
  const prompts = sameDay(records["prompt-events.jsonl"].items, date);
  const dispatch = sameDay(records["agentic-dispatch.jsonl"].items, date);
  const audits = sameDay(records["engineering-audit.jsonl"].items, date);
  const candidates = sameDay(records["memory-candidates.jsonl"].items, date);
  const approved = sameDay(records["memory-approved.jsonl"].items, date);
  const reviews = sameDay(records["memory-reviews.jsonl"].items, date);
  const evolutionCandidates = sameDay(records["evolution-candidates.jsonl"].items, date);
  const evolutionApplied = sameDay(records["evolution-applied.jsonl"].items, date);
  const evolutionReviews = sameDay(records["evolution-reviews.jsonl"].items, date);
  const contextBudget = Number(budget.max_additional_context_chars || 2800);
  const contextChars = prompts.map((item) => Number(item.context_chars || 0)).filter((num) => num > 0);
  const maxContextChars = contextChars.length ? Math.max(...contextChars) : 0;
  const overBudget = prompts.filter((item) => Number(item.context_chars || 0) > contextBudget).length;
  const highPrivacyItems = dispatch.filter((item) => item.gate?.privacyRisk === "high");
  const highPrivacyDispatch = highPrivacyItems.length;
  const highPrivacyUnsafeOpen = highPrivacyItems.filter((item) => item.recommended).length;
  const highPrivacyBlocked = highPrivacyDispatch - highPrivacyUnsafeOpen;
  const recommendedDispatch = dispatch.filter((item) => item.recommended).length;
  const observedEvents = prompts.length + dispatch.length + audits.length + candidates.length + approved.length + reviews.length
    + evolutionCandidates.length + evolutionApplied.length + evolutionReviews.length;
  const redFlag = redFlagStatus();
  return {
    id: "acob-daily-effect-metrics",
    date,
    date_basis: "local_calendar_date",
    generated_at: new Date().toISOString(),
    data_quality: observedEvents ? "observed_local_runtime_events" : "no_observed_events_yet",
    invalid_event_lines: invalidEventLines(records),
    runtime: {
      selected_home: safeRuntimeName(ROOT),
      selection_policy: process.env.ACOB_METRICS_ROOT_SELECTION
        || (process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME ? "explicit_env" : "observed_event_count"),
    },
    boundaries: [
      "counts local sanitized events only",
      "does not infer model intelligence from dashboard state",
      "does not claim performance lift without observed traces",
      "private memory should stay in the private repository or local runtime",
    ],
    system_slimming: {
      context_budget_chars: contextBudget,
      prompt_events: prompts.length,
      avg_prompt_chars: avg(prompts, "prompt_chars"),
      avg_context_chars: avg(prompts, "context_chars"),
      max_context_chars: maxContextChars,
      over_budget_events: overBudget,
      status: overBudget ? "needs_slimming" : prompts.length ? "within_budget" : "no_prompt_data",
    },
    memory_loop: {
      candidates: candidates.length,
      approved: approved.length,
      rejected: reviews.filter((item) => item.status === "rejected").length,
      pending_signal: Math.max(0, candidates.length - approved.length - reviews.length),
      auto_promote: false,
    },
    self_evolution: {
      candidates: evolutionCandidates.length,
      applied_with_verification: evolutionApplied.filter((item) => Array.isArray(item.verification) && item.verification.length).length,
      rejected: evolutionReviews.filter((item) => item.status === "rejected").length,
      rollback_available: evolutionApplied.every((item) => Boolean(item.rollback_plan)),
      auto_apply: false,
    },
    agentic_dispatch: {
      events: dispatch.length,
      recommended: recommendedDispatch,
      gate_open_rate: percent(recommendedDispatch, dispatch.length),
      high_privacy_events: highPrivacyDispatch,
      high_privacy_blocked_events: highPrivacyBlocked,
      high_privacy_unsafe_open_events: highPrivacyUnsafeOpen,
      avg_selected_agents: Math.round((dispatch.reduce((sum, item) => sum + (item.selected_agent_ids || []).length, 0) / Math.max(1, dispatch.length)) * 10) / 10,
    },
    verification_pressure: {
      post_tool_audits: audits.length,
      risk_counts: riskCounts(audits),
      red_flag_present: redFlag.active,
      red_flag: redFlag,
    },
    intent_mix: countBy(prompts, "intent"),
    next_actions: [
      overBudget ? "reduce injected context or tighten recall for high-volume prompts" : "keep context budget stable",
      candidates.length ? "review memory candidates before promotion" : "capture useful repeated lessons as candidates",
      evolutionCandidates.length ? "review self-evolution candidates before adoption" : "record self-evolution as candidate-only evidence before applying",
      redFlag.active ? "clear or archive active red flags with acob red-flag clear before claiming done" : "continue normal verification-before-completion",
    ],
  };
}

function buildEffectStatus(date) {
  const report = buildReport(date);
  const scorecard = {
    system_slimming: scoreSystemSlimming(report),
    memory_loop: scoreMemoryLoop(report),
    dispatch_gate: scoreDispatch(report),
    verification_pressure: scoreVerification(report),
    self_evolution: scoreSelfEvolution(report),
    privacy_boundary: scorePrivacyBoundary(report),
  };
  const overall = clampScore(
    (scorecard.system_slimming * 0.22)
    + (scorecard.memory_loop * 0.18)
    + (scorecard.dispatch_gate * 0.18)
    + (scorecard.verification_pressure * 0.18)
    + (scorecard.self_evolution * 0.12)
    + (scorecard.privacy_boundary * 0.12),
  );
  const red = report.verification_pressure.red_flag_present
    || report.agentic_dispatch.high_privacy_unsafe_open_events > 0
    || report.memory_loop.auto_promote
    || report.self_evolution.auto_apply;
  const yellow = report.data_quality === "no_observed_events_yet"
    || report.system_slimming.status === "needs_slimming"
    || report.memory_loop.pending_signal > 0
    || report.verification_pressure.post_tool_audits === 0;
  const health = red ? "red" : yellow ? "yellow" : "green";
  const nextActions = [
    ...(report.verification_pressure.red_flag_present
      ? ["clear the active red flag with evidence before claiming completion"]
      : []),
    ...(report.system_slimming.status === "needs_slimming"
      ? ["reduce injected context or tighten recall rules"]
      : []),
    ...(report.verification_pressure.post_tool_audits === 0
      ? ["run one real post-tool verification path so audit pressure is observable"]
      : []),
    ...(report.memory_loop.pending_signal > 0
      ? ["review pending memory candidates before promotion"]
      : []),
    ...(report.self_evolution.candidates > 0 && report.self_evolution.applied_with_verification === 0
      ? ["adopt self-evolution only after approval, rollback plan, and verification"]
      : []),
    ...(report.memory_loop.candidates === 0
      ? ["capture only repeated, reusable lessons as memory candidates"]
      : []),
    ...report.next_actions,
  ].filter((item, index, items) => items.indexOf(item) === index).slice(0, 5);

  return {
    id: "acob-effect-status",
    date: report.date,
    date_basis: report.date_basis,
    generated_at: report.generated_at,
    health,
    overall_score: overall,
    data_quality: report.data_quality,
    runtime: report.runtime,
    scorecard,
    evidence: {
      prompt_events: report.system_slimming.prompt_events,
      avg_context_chars: report.system_slimming.avg_context_chars,
      over_budget_events: report.system_slimming.over_budget_events,
      memory_candidates: report.memory_loop.candidates,
      pending_memory_candidates: report.memory_loop.pending_signal,
      dispatch_events: report.agentic_dispatch.events,
      high_privacy_events: report.agentic_dispatch.high_privacy_events,
      high_privacy_blocked_events: report.agentic_dispatch.high_privacy_blocked_events,
      high_privacy_unsafe_open_events: report.agentic_dispatch.high_privacy_unsafe_open_events,
      post_tool_audits: report.verification_pressure.post_tool_audits,
      red_flag_present: report.verification_pressure.red_flag_present,
      self_evolution_candidates: report.self_evolution.candidates,
      self_evolution_applied_with_verification: report.self_evolution.applied_with_verification,
      invalid_event_lines: report.invalid_event_lines,
    },
    kano_snapshot: {
      basic_needs: [
        "no raw prompts or private memory in public reports",
        "human approval required before memory promotion",
        "red flags must be cleared with verification evidence",
      ],
      performance_needs: [
        "context budget stays under the configured limit",
        "agent dispatch opens only for low-risk multi-step work",
        "post-tool audits create observable verification pressure",
      ],
      delight_needs: [
        "one command shows daily effect instead of requiring log reading",
        "memory candidates explain how the system learns without auto-promoting",
      ],
      reverse_needs_avoided: [
        "no forced multi-agent fanout",
        "no personal-memory publishing",
        "no model-confidence vanity score",
      ],
    },
    boundaries: report.boundaries,
    next_actions: nextActions,
  };
}

function toMarkdown(report) {
  return [
    `# ACOB Daily Effect Metrics - ${report.date}`,
    "",
    `data_quality: ${report.data_quality}`,
    "",
    "## System Slimming",
    `- prompt events: ${report.system_slimming.prompt_events}`,
    `- avg context chars: ${report.system_slimming.avg_context_chars}`,
    `- max context chars: ${report.system_slimming.max_context_chars}`,
    `- over budget events: ${report.system_slimming.over_budget_events}`,
    `- status: ${report.system_slimming.status}`,
    "",
    "## Memory Loop",
    `- candidates: ${report.memory_loop.candidates}`,
    `- approved: ${report.memory_loop.approved}`,
    `- rejected: ${report.memory_loop.rejected}`,
    `- auto promote: ${report.memory_loop.auto_promote}`,
    "",
    "## Self Evolution",
    `- candidates: ${report.self_evolution.candidates}`,
    `- applied with verification: ${report.self_evolution.applied_with_verification}`,
    `- rejected: ${report.self_evolution.rejected}`,
    `- rollback available: ${report.self_evolution.rollback_available}`,
    `- auto apply: ${report.self_evolution.auto_apply}`,
    "",
    "## Agentic Dispatch",
    `- events: ${report.agentic_dispatch.events}`,
    `- gate open rate: ${report.agentic_dispatch.gate_open_rate}`,
    `- high privacy events: ${report.agentic_dispatch.high_privacy_events}`,
    `- high privacy blocked events: ${report.agentic_dispatch.high_privacy_blocked_events}`,
    `- high privacy unsafe open events: ${report.agentic_dispatch.high_privacy_unsafe_open_events}`,
    "",
    "## Verification Pressure",
    `- post tool audits: ${report.verification_pressure.post_tool_audits}`,
    `- red flag present: ${report.verification_pressure.red_flag_present}`,
    `- archived red flags: ${report.verification_pressure.red_flag.archived_count}`,
    "",
    "## Next Actions",
    ...report.next_actions.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function toEffectMarkdown(status) {
  return [
    `# ACOB Effect Status - ${status.date}`,
    "",
    `health: ${status.health}`,
    `overall_score: ${status.overall_score}/100`,
    `data_quality: ${status.data_quality}`,
    "",
    "## Scorecard",
    `- system slimming: ${status.scorecard.system_slimming}/100 (${status.evidence.over_budget_events} over-budget events)`,
    `- memory loop: ${status.scorecard.memory_loop}/100 (${status.evidence.memory_candidates} candidates, ${status.evidence.pending_memory_candidates} pending)`,
    `- dispatch gate: ${status.scorecard.dispatch_gate}/100 (${status.evidence.high_privacy_blocked_events} high-privacy blocked, ${status.evidence.high_privacy_unsafe_open_events} unsafe open)`,
    `- verification pressure: ${status.scorecard.verification_pressure}/100 (${status.evidence.post_tool_audits} post-tool audits)`,
    `- self-evolution: ${status.scorecard.self_evolution}/100 (${status.evidence.self_evolution_candidates} candidates, ${status.evidence.self_evolution_applied_with_verification} applied with verification)`,
    `- privacy boundary: ${status.scorecard.privacy_boundary}/100`,
    "",
    "## Kano Snapshot",
    `- basic: ${status.kano_snapshot.basic_needs.join("; ")}`,
    `- performance: ${status.kano_snapshot.performance_needs.join("; ")}`,
    `- delight: ${status.kano_snapshot.delight_needs.join("; ")}`,
    `- reverse avoided: ${status.kano_snapshot.reverse_needs_avoided.join("; ")}`,
    "",
    "## Next Actions",
    ...status.next_actions.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.effect ? buildEffectStatus(args.date) : buildReport(args.date);
  if (args.write) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const suffix = args.effect ? ".effect" : "";
    fs.writeFileSync(path.join(REPORT_DIR, `${args.date}${suffix}.json`), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(REPORT_DIR, `${args.date}${suffix}.md`), args.effect ? toEffectMarkdown(output) : toMarkdown(output), "utf8");
  }
  if (args.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(args.effect ? toEffectMarkdown(output) : toMarkdown(output));
}

if (require.main === module) main();
module.exports = { buildEffectStatus, buildReport };
