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

function parseArgs(argv) {
  const args = { json: false, write: false, date: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--date") args.date = argv[++i] || args.date;
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

function readJsonl(name) {
  const file = path.join(DATA_DIR, name);
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function eventDate(item) {
  const raw = item.ts || item.generated_at || item.created_at || item.approved_at || item.reviewed_at || "";
  return String(raw).slice(0, 10);
}

function sameDay(items, date) {
  return items.filter((item) => eventDate(item) === date);
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

function percent(part, total) {
  return total ? Number((part / total).toFixed(3)) : 0;
}

function buildReport(date) {
  const config = readJson(path.join(ROOT, "config.json"), {});
  const budget = config.context_budget || {};
  const prompts = sameDay(readJsonl("prompt-events.jsonl"), date);
  const dispatch = sameDay(readJsonl("agentic-dispatch.jsonl"), date);
  const audits = sameDay(readJsonl("engineering-audit.jsonl"), date);
  const candidates = sameDay(readJsonl("memory-candidates.jsonl"), date);
  const approved = sameDay(readJsonl("memory-approved.jsonl"), date);
  const reviews = sameDay(readJsonl("memory-reviews.jsonl"), date);
  const contextBudget = Number(budget.max_additional_context_chars || 2800);
  const contextChars = prompts.map((item) => Number(item.context_chars || 0)).filter((num) => num > 0);
  const maxContextChars = contextChars.length ? Math.max(...contextChars) : 0;
  const overBudget = prompts.filter((item) => Number(item.context_chars || 0) > contextBudget).length;
  const highPrivacyDispatch = dispatch.filter((item) => item.gate?.privacyRisk === "high").length;
  const recommendedDispatch = dispatch.filter((item) => item.recommended).length;
  const observedEvents = prompts.length + dispatch.length + audits.length + candidates.length + approved.length + reviews.length;
  return {
    id: "acob-daily-effect-metrics",
    date,
    generated_at: new Date().toISOString(),
    data_quality: observedEvents ? "observed_local_runtime_events" : "no_observed_events_yet",
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
    agentic_dispatch: {
      events: dispatch.length,
      recommended: recommendedDispatch,
      gate_open_rate: percent(recommendedDispatch, dispatch.length),
      high_privacy_events: highPrivacyDispatch,
      avg_selected_agents: Math.round((dispatch.reduce((sum, item) => sum + (item.selected_agent_ids || []).length, 0) / Math.max(1, dispatch.length)) * 10) / 10,
    },
    verification_pressure: {
      post_tool_audits: audits.length,
      risk_counts: riskCounts(audits),
      red_flag_present: fs.existsSync(path.join(DATA_DIR, "red-flag.json")),
    },
    intent_mix: countBy(prompts, "intent"),
    next_actions: [
      overBudget ? "reduce injected context or tighten recall for high-volume prompts" : "keep context budget stable",
      candidates.length ? "review memory candidates before promotion" : "capture useful repeated lessons as candidates",
      audits.some((item) => (item.risks || []).length) ? "clear verification or privacy red flags before claiming done" : "continue normal verification-before-completion",
    ],
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
    "## Agentic Dispatch",
    `- events: ${report.agentic_dispatch.events}`,
    `- gate open rate: ${report.agentic_dispatch.gate_open_rate}`,
    `- high privacy events: ${report.agentic_dispatch.high_privacy_events}`,
    "",
    "## Verification Pressure",
    `- post tool audits: ${report.verification_pressure.post_tool_audits}`,
    `- red flag present: ${report.verification_pressure.red_flag_present}`,
    "",
    "## Next Actions",
    ...report.next_actions.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args.date);
  if (args.write) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `${args.date}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(REPORT_DIR, `${args.date}.md`), toMarkdown(report), "utf8");
  }
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(toMarkdown(report));
}

if (require.main === module) main();
module.exports = { buildReport };
