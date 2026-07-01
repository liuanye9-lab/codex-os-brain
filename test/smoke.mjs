import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acob-smoke-"));
const codexHome = path.join(temp, ".codex");
const brainHome = path.join(temp, ".acob");
const cli = path.join(root, "bin", "codex-os-brain.mjs");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      ACOB_HOME: brainHome,
    },
    timeout: 15000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstatus: ${result.status}\nerror: ${result.error?.message || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
  }
  return result;
}

function runAny(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      ACOB_HOME: brainHome,
    },
    timeout: 15000,
    ...options,
  });
}

try {
  run(["install", "--global-agentic", "--skip-embedding"]);
  const status = run(["status", "--summary"]);
  if (!status.stdout.includes("status: global_active")) {
    throw new Error(`status did not become global_active:\n${status.stdout}`);
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  const promptGroups = hooks.hooks.UserPromptSubmit || [];
  if (!promptGroups.some((group) => group.matcher === "")) {
    throw new Error("missing global UserPromptSubmit matcher");
  }
  const agentsFile = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  if (!agentsFile.includes("ACOB_AGENTIC_START") || !agentsFile.includes("上下文侦察员")) {
    throw new Error("missing global AGENTS.md agentic managed block");
  }
  const config = JSON.parse(fs.readFileSync(path.join(brainHome, "config.json"), "utf8"));
  if (config.dispatch_policy !== "gated_agentic_preflight") {
    throw new Error("missing gated global agentic install config");
  }
  const agents = run(["agents", "--json"]);
  const parsedAgents = JSON.parse(agents.stdout);
  if (!parsedAgents.agents.some((agent) => agent.name === "上下文侦察员")) {
    throw new Error("missing Chinese sub-agent names");
  }
  const demo = run(["demo", "--task", "fix dashboard, update docs, run checks", "--json"]);
  const parsedDemo = JSON.parse(demo.stdout);
  if (parsedDemo.id !== "acob-public-value-demo") {
    throw new Error("value demo did not return the public demo report");
  }
  if (!parsedDemo.memory_context?.included_count || !parsedDemo.efficiency_profile?.token_reduction) {
    throw new Error("value demo did not show memory and efficiency signals");
  }
  const proof = run(["prove", "--task", "fix dashboard, update docs, run checks", "--json"]);
  const parsedProof = JSON.parse(proof.stdout);
  if (parsedProof.id !== "acob-proof" || parsedProof.status !== "ready") {
    throw new Error("prove did not return the one-command proof report");
  }
  if (parsedProof.runtime.install_status !== "global_active" || !parsedProof.runtime.injection_smoke) {
    throw new Error("prove did not expose working install status");
  }
  if (!parsedProof.value_demo.memory_included || !parsedProof.value_demo.token_reduction) {
    throw new Error("prove did not expose memory and efficiency value signals");
  }
  if (!parsedProof.boundaries.some((item) => item.includes("does not read private memory"))) {
    throw new Error("prove did not expose public/private safety boundary");
  }
  const proofHuman = run(["prove"]);
  if (!proofHuman.stdout.includes("ACOB Proof") || !proofHuman.stdout.includes("Value demo") || !proofHuman.stdout.includes("Effect")) {
    throw new Error("prove human output is not a one-screen proof");
  }
  const memoryExample = run(["memory-loop", "--example", "--json"]);
  const parsedMemoryExample = JSON.parse(memoryExample.stdout);
  if (parsedMemoryExample.id !== "acob-memory-loop-example" || !parsedMemoryExample.candidate?.required_gate?.includes("human approval")) {
    throw new Error("memory-loop example did not expose the gated memory lifecycle");
  }
  const doctor = run(["doctor"]);
  if (!doctor.stdout.includes("status: global_active")) {
    throw new Error("doctor alias did not run status summary");
  }
  const originalHooksText = fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8");
  const originalAgentsText = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  try {
    const hooks = JSON.parse(originalHooksText);
    hooks.hooks.PostToolUse = [{
      matcher: "",
      hooks: [{
        type: "command",
        command: `"${process.execPath}" "${path.join(root, "runtime", "scripts", "engineering-harness.cjs")}"`,
        timeout: 5,
      }],
    }];
    fs.writeFileSync(path.join(codexHome, "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(codexHome, "AGENTS.md"), [
      "<!-- CODEX_OS_BRAIN_AGENTIC_START -->",
      "## Codex OS Brain Agentic Coding",
      "",
      "Every user prompt should enter the Codex OS Brain agentic preflight before execution.",
      "<!-- CODEX_OS_BRAIN_AGENTIC_END -->",
      "",
    ].join("\n"), "utf8");
    const hybridStatus = run(["status", "--summary"]);
    if (!hybridStatus.stdout.includes("status: hybrid_active")) {
      throw new Error(`compatible external harness and legacy AGENTS block were not accepted:\n${hybridStatus.stdout}`);
    }
  } finally {
    fs.writeFileSync(path.join(codexHome, "hooks.json"), originalHooksText, "utf8");
    fs.writeFileSync(path.join(codexHome, "AGENTS.md"), originalAgentsText, "utf8");
  }
  const lowRiskTask = "实现 dashboard 功能，更新文档，运行测试，准备发布";
  const lowRisk = run(["dispatch", "--task", lowRiskTask, "--json", "--write"]);
  const lowRiskPlan = JSON.parse(lowRisk.stdout);
  if (!lowRiskPlan.recommended || !lowRiskPlan.selected_agents.some((agent) => agent.name === "安全审查员")) {
    throw new Error("low-risk release task did not open gate with security reviewer");
  }
  if (!lowRiskPlan.selected_agents.some((agent) => agent.name === "发布检查员")) {
    throw new Error("low-risk release task did not include release operator");
  }
  const highRisk = runAny(["dispatch", "--task", "修改 persona 和私密 memory 并发布", "--json", "--write"]);
  if (highRisk.status === 0) {
    throw new Error("high-privacy task should not auto-open dispatch gate");
  }
  const records = fs.readFileSync(path.join(brainHome, "data", "agentic-dispatch.jsonl"), "utf8");
  if (records.includes(lowRiskTask)) {
    throw new Error("dispatch log leaked raw task text");
  }
  const injected = spawnSync(process.execPath, [path.join(brainHome, "runtime", "scripts", "inject-context.cjs")], {
    input: JSON.stringify({ prompt: lowRiskTask }),
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, ACOB_HOME: brainHome },
  });
  if (!injected.stdout.includes("Agentic Coding Preflight")) {
    throw new Error("hook injection did not include agentic preflight");
  }
  const promptEvents = fs.readFileSync(path.join(brainHome, "data", "prompt-events.jsonl"), "utf8");
  const latestPrompt = JSON.parse(promptEvents.trim().split("\n").at(-1));
  if (!latestPrompt.context_chars || !latestPrompt.context_budget_status) {
    throw new Error("prompt event did not record context budget metrics");
  }
  fs.appendFileSync(path.join(brainHome, "data", "prompt-events.jsonl"), "{bad jsonl line\n", "utf8");
  const metrics = run(["metrics", "--json"]);
  const parsedMetrics = JSON.parse(metrics.stdout);
  if (parsedMetrics.id !== "acob-daily-effect-metrics" || parsedMetrics.system_slimming.prompt_events < 1) {
    throw new Error("metrics report did not include observed prompt events");
  }
  if (parsedMetrics.memory_loop.auto_promote !== false) {
    throw new Error("metrics report must preserve candidate-only memory policy");
  }
  if (parsedMetrics.invalid_event_lines?.["prompt-events.jsonl"] !== 1) {
    throw new Error("metrics report did not preserve valid events while counting invalid JSONL lines");
  }
  if (!parsedMetrics.self_evolution || parsedMetrics.self_evolution.auto_apply !== false) {
    throw new Error("metrics report did not expose gated self-evolution counters");
  }
  if (parsedMetrics.agentic_dispatch.high_privacy_blocked_events < 1 || parsedMetrics.agentic_dispatch.high_privacy_unsafe_open_events !== 0) {
    throw new Error("metrics report did not distinguish blocked high-privacy dispatches from unsafe open dispatches");
  }
  const effect = run(["effect", "--json"]);
  const parsedEffect = JSON.parse(effect.stdout);
  if (parsedEffect.id !== "acob-effect-status" || !["green", "yellow", "red"].includes(parsedEffect.health)) {
    throw new Error("effect status did not return a valid public scorecard");
  }
  if (parsedEffect.health === "red") {
    throw new Error("blocked high-privacy dispatches should not make public effect status red");
  }
  if (parsedEffect.evidence.high_privacy_blocked_events < 1 || parsedEffect.evidence.high_privacy_unsafe_open_events !== 0) {
    throw new Error("effect status did not expose high-privacy blocked/unsafe-open split");
  }
  if (!parsedEffect.kano_snapshot?.basic_needs?.length || parsedEffect.evidence.prompt_events < 1) {
    throw new Error("effect status did not expose Kano framing and observed evidence");
  }
  if (!parsedEffect.boundaries?.some((item) => item.includes("sanitized events only"))) {
    throw new Error("effect status must preserve public-safe reporting boundaries");
  }
  const redFlagFile = path.join(brainHome, "data", "red-flag.json");
  const syntheticHomePath = ["", "Users", "lay", "private-memory.md"].join("/");
  const syntheticTokenText = `${["to", "ken"].join("")}=abc123`;
  fs.writeFileSync(redFlagFile, `${JSON.stringify({
    raised_at: "2026-06-30T00:00:00.000Z",
    reason: "sensitive_boundary",
    required_action: `prompt: do not leak ${syntheticHomePath} or ${syntheticTokenText}`,
  })}\n`, "utf8");
  const metricsWithSensitiveFlag = run(["metrics", "--json"]);
  if (metricsWithSensitiveFlag.stdout.includes(syntheticHomePath) || metricsWithSensitiveFlag.stdout.includes("private-memory.md") || metricsWithSensitiveFlag.stdout.includes("abc123")) {
    throw new Error("metrics report leaked sensitive red-flag path or token text");
  }
  const redFlagStatus = run(["red-flag", "status", "--json"]);
  const parsedRedFlagStatus = JSON.parse(redFlagStatus.stdout);
  if (!parsedRedFlagStatus.active || parsedRedFlagStatus.active_flag?.reason !== "sensitive_boundary") {
    throw new Error("red flag status did not report active sensitive boundary");
  }
  const redFlagClear = run(["red-flag", "clear", "--reason", "verified in smoke", "--verification", "node test/smoke.mjs", "--json"]);
  const parsedRedFlagClear = JSON.parse(redFlagClear.stdout);
  if (!parsedRedFlagClear.cleared || fs.existsSync(redFlagFile)) {
    throw new Error("red flag clear did not archive and remove the active flag");
  }
  const metricsAfterClear = run(["metrics", "--json"]);
  const parsedMetricsAfterClear = JSON.parse(metricsAfterClear.stdout);
  if (parsedMetricsAfterClear.verification_pressure.red_flag_present || parsedMetricsAfterClear.verification_pressure.red_flag.archived_count < 1) {
    throw new Error("metrics report did not reflect cleared red flag archive");
  }
  run(["uninstall"]);
  const afterUninstallAgents = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  if (afterUninstallAgents.includes("ACOB_AGENTIC_START")) {
    throw new Error("uninstall did not remove global AGENTS.md agentic block");
  }
  console.log("Smoke test: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
