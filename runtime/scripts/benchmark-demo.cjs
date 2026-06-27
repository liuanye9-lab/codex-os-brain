#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");

const variants = [
  {
    id: "no_acob",
    label: "No ACOB",
    successLift: -0.18,
    reworkDelta: 0.24,
    tokenMultiplier: 1.0,
    verificationLift: -0.22,
  },
  {
    id: "long_context_only",
    label: "Long Context Only",
    successLift: -0.08,
    reworkDelta: 0.16,
    tokenMultiplier: 1.65,
    verificationLift: -0.12,
  },
  {
    id: "acob_wm_replay_reward",
    label: "ACOB Working Memory + Replay + Reward",
    successLift: 0.12,
    reworkDelta: -0.12,
    tokenMultiplier: 0.78,
    verificationLift: 0.16,
  },
  {
    id: "acob_memory_lifecycle",
    label: "ACOB + Memory Lifecycle",
    successLift: 0.19,
    reworkDelta: -0.18,
    tokenMultiplier: 0.62,
    verificationLift: 0.22,
  },
];

const tasks = [
  ["task-01", "Fix dashboard route that returns 404", 0.45, 0.9],
  ["task-02", "Add CLI flag and update README usage", 0.35, 0.85],
  ["task-03", "Refactor hook install while preserving backups", 0.62, 0.92],
  ["task-04", "Add privacy scan case for local paths", 0.55, 0.95],
  ["task-05", "Create npm pack release checklist", 0.38, 0.9],
  ["task-06", "Add Windows PowerShell install instructions", 0.32, 0.75],
  ["task-07", "Implement dispatch gate regression case", 0.52, 0.9],
  ["task-08", "Fix tool parsing failure in smoke suite", 0.58, 0.95],
  ["task-09", "Update dashboard status cards from sanitized data", 0.64, 0.85],
  ["task-10", "Add memory candidate schema validation", 0.68, 0.9],
  ["task-11", "Create context pack from repo evidence", 0.72, 0.88],
  ["task-12", "Detect stale working memory before final answer", 0.66, 0.92],
  ["task-13", "Add reward signal from eval and privacy result", 0.61, 0.9],
  ["task-14", "Create replay plan for failed tasks first", 0.57, 0.84],
  ["task-15", "Add rollback plan requirement for candidates", 0.48, 0.96],
  ["task-16", "Fix package files allowlist for public release", 0.44, 0.95],
  ["task-17", "Add local embedding setup status to config", 0.59, 0.85],
  ["task-18", "Rerank memory snippets by freshness and privacy", 0.73, 0.88],
  ["task-19", "Block high privacy sub-agent dispatch", 0.54, 0.97],
  ["task-20", "Generate public comparison page for memory systems", 0.42, 0.8],
].map(([id, title, complexity, verifiability]) => ({ id, title, complexity, verifiability }));

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function estimate(task, variant) {
  const baseSuccess = clamp(0.74 - task.complexity * 0.32 + task.verifiability * 0.12);
  const successRate = clamp(baseSuccess + variant.successLift);
  const reworkRate = clamp(0.18 + task.complexity * 0.26 + variant.reworkDelta);
  const tokenEstimate = Math.round((2600 + task.complexity * 6200) * variant.tokenMultiplier);
  const verificationPassRate = clamp(task.verifiability * 0.74 + 0.12 + variant.verificationLift);
  return {
    task_id: task.id,
    task: task.title,
    variant: variant.id,
    success_rate: Number(successRate.toFixed(3)),
    rework_rate: Number(reworkRate.toFixed(3)),
    token_estimate: tokenEstimate,
    verification_pass_rate: Number(verificationPassRate.toFixed(3)),
  };
}

function aggregate(rows) {
  const grouped = {};
  for (const row of rows) {
    grouped[row.variant] ||= [];
    grouped[row.variant].push(row);
  }
  return Object.fromEntries(Object.entries(grouped).map(([variant, items]) => {
    const avg = (key) => items.reduce((sum, item) => sum + item[key], 0) / items.length;
    return [variant, {
      label: variants.find((item) => item.id === variant)?.label || variant,
      tasks: items.length,
      success_rate: Number(avg("success_rate").toFixed(3)),
      rework_rate: Number(avg("rework_rate").toFixed(3)),
      token_estimate: Math.round(avg("token_estimate")),
      verification_pass_rate: Number(avg("verification_pass_rate").toFixed(3)),
    }];
  }));
}

function run() {
  const rows = tasks.flatMap((task) => variants.map((variant) => estimate(task, variant)));
  return {
    id: "acob-public-benchmark-demo",
    generated_at: new Date().toISOString(),
    status: "demo_not_claimed_as_live_model_benchmark",
    note: "Deterministic public benchmark scaffold. Replace estimates with live model runs before making performance claims.",
    compared_variants: variants.map(({ id, label }) => ({ id, label })),
    metrics: ["success_rate", "rework_rate", "token_estimate", "verification_pass_rate"],
    tasks,
    aggregate: aggregate(rows),
    rows,
    next_step: "Run the same 20 tasks through real Codex sessions and replace estimates with observed traces, evals, token counts, and check results.",
  };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const report = run();
  if (write) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "benchmark-demo.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { run };
