#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildPlan } = require("./agentic-dispatch.cjs");
const { run: runBenchmark } = require("./benchmark-demo.cjs");
const { run: runMemoryRetrieval } = require("./memory-retrieval-pipeline.cjs");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");

function parseArgs(argv) {
  const args = {
    task: "refactor dashboard, update docs, run checks, prepare public release",
    json: false,
    write: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--task") args.task = argv[++i] || args.task;
    else if (item === "--json") args.json = true;
    else if (item === "--write") args.write = true;
  }
  return args;
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function compareBenchmark(benchmark) {
  const base = benchmark.aggregate.no_acob;
  const acob = benchmark.aggregate.acob_memory_lifecycle;
  const tokenReduction = base.token_estimate ? (base.token_estimate - acob.token_estimate) / base.token_estimate : 0;
  return {
    success_lift: Number((acob.success_rate - base.success_rate).toFixed(3)),
    rework_reduction: Number((base.rework_rate - acob.rework_rate).toFixed(3)),
    token_reduction: Number(tokenReduction.toFixed(3)),
    verification_lift: Number((acob.verification_pass_rate - base.verification_pass_rate).toFixed(3)),
    baseline: base.label,
    improved: acob.label,
  };
}

function buildReport(task) {
  const dispatch = buildPlan(task);
  const memory = runMemoryRetrieval(task);
  const benchmark = runBenchmark();
  const benchmarkSummary = compareBenchmark(benchmark);
  const included = memory.context_pack_injection.included;
  const dropped = memory.context_pack_injection.dropped;

  return {
    id: "acob-public-value-demo",
    generated_at: new Date().toISOString(),
    status: "public_sanitized_demo",
    task,
    what_user_should_feel: [
      "less repeated explanation because only bounded, relevant memory enters context",
      "less agent sprawl because dispatch opens only when the task is multi-step, verifiable, and low privacy risk",
      "less fake self-improvement because evolution stays candidate-only until human approval",
      "less unsupported completion because verification is part of the operating loop",
    ],
    dispatch_gate: {
      recommended: dispatch.recommended,
      privacy_risk: dispatch.gate.privacyRisk,
      selected_agents: dispatch.selected_agents.map((agent) => ({
        id: agent.agent_id,
        name: agent.name,
        tool_policy: agent.tool_policy,
        write_scope: agent.write_scope,
      })),
      reasons: dispatch.gate.reasons,
    },
    memory_context: {
      query_rewrite: memory.retrieval_query_rewrite,
      included_count: included.length,
      dropped_count: dropped.length,
      included: included.map((item) => ({
        id: item.id,
        source: item.source,
        privacy_label: item.privacy_label,
        freshness_score: item.freshness_score,
        reason: item.reason,
        text: item.text,
      })),
      dropped,
      policy: memory.memory_write_policy,
    },
    efficiency_profile: {
      note: "Deterministic public scaffold. Use live traces before making external performance claims.",
      success_lift: pct(benchmarkSummary.success_lift),
      rework_reduction: pct(benchmarkSummary.rework_reduction),
      token_reduction: pct(benchmarkSummary.token_reduction),
      verification_lift: pct(benchmarkSummary.verification_lift),
      baseline: benchmarkSummary.baseline,
      improved: benchmarkSummary.improved,
    },
    self_evolution_gate: {
      mode: "candidate_only",
      auto_apply: false,
      requires: ["human approval", "safe target scope", "rollback plan", "verification command"],
      example_result: "approval_required unless explicitly approved",
    },
    privacy_boundary: [
      "demo uses public sanitized examples only",
      "no private memory is read",
      "no raw prompt is written unless --write is used, and write stores only this local demo report",
      "private or unclear memory is blocked or represented as a placeholder",
    ],
    next_commands: [
      "acob init --skip-embedding",
      `acob demo --task ${JSON.stringify(task)}`,
      "acob dashboard",
      "acob doctor",
    ],
  };
}

function printHuman(report) {
  console.log("ACOB Value Demo");
  console.log(`task: ${report.task}`);
  console.log("");
  console.log("1. Memory context");
  console.log(`included: ${report.memory_context.included_count}`);
  console.log(`dropped: ${report.memory_context.dropped_count}`);
  for (const item of report.memory_context.included.slice(0, 3)) {
    console.log(`- ${item.id}: ${item.text}`);
  }
  console.log("");
  console.log("2. Agent dispatch");
  console.log(`recommended: ${report.dispatch_gate.recommended}`);
  console.log(`privacy: ${report.dispatch_gate.privacy_risk}`);
  for (const agent of report.dispatch_gate.selected_agents) {
    console.log(`- ${agent.name} (${agent.tool_policy})`);
  }
  console.log("");
  console.log("3. Efficiency profile");
  console.log(`success lift: ${report.efficiency_profile.success_lift}`);
  console.log(`rework reduction: ${report.efficiency_profile.rework_reduction}`);
  console.log(`token reduction: ${report.efficiency_profile.token_reduction}`);
  console.log(`verification lift: ${report.efficiency_profile.verification_lift}`);
  console.log(`note: ${report.efficiency_profile.note}`);
  console.log("");
  console.log("4. Self-evolution gate");
  console.log("mode: candidate_only");
  console.log("auto_apply: false");
  console.log("requires: human approval, rollback plan, verification");
  console.log("");
  console.log("Next:");
  for (const command of report.next_commands) console.log(`  ${command}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args.task);
  if (args.write) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "value-demo.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHuman(report);
}

if (require.main === module) main();
module.exports = { buildReport };
