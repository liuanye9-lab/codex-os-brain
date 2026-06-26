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
  run(["install", "--global-agentic"]);
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
  const lowRiskTask = "实现 dashboard 功能，更新文档，运行测试，准备发布";
  const lowRisk = run(["dispatch", "--task", lowRiskTask, "--json", "--write"]);
  const lowRiskPlan = JSON.parse(lowRisk.stdout);
  if (!lowRiskPlan.recommended || !lowRiskPlan.selected_agents.some((agent) => agent.name === "安全审查员")) {
    throw new Error("low-risk release task did not open gate with security reviewer");
  }
  if (!lowRiskPlan.selected_agents.some((agent) => agent.name === "发布检查员")) {
    throw new Error("low-risk release task did not include release operator");
  }
  const highRisk = runAny(["dispatch", "--task", "修改 persona 和私密 memory 并发布", "--json"]);
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
  run(["uninstall"]);
  const afterUninstallAgents = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  if (afterUninstallAgents.includes("ACOB_AGENTIC_START")) {
    throw new Error("uninstall did not remove global AGENTS.md agentic block");
  }
  console.log("Smoke test: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
