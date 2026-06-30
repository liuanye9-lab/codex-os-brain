#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceRuntime = path.join(packageRoot, "runtime");
const home = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
const installRoot = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(home, ".acob");
const runtimeRoot = path.join(installRoot, "runtime");
const hooksFile = path.join(codexHome, "hooks.json");
const agentsFile = path.join(codexHome, "AGENTS.md");
const agentsBlockStart = "<!-- ACOB_AGENTIC_START -->";
const agentsBlockEnd = "<!-- ACOB_AGENTIC_END -->";
const legacyAgentsBlockStart = "<!-- CODEX_OS_BRAIN_AGENTIC_START -->";
const legacyAgentsBlockEnd = "<!-- CODEX_OS_BRAIN_AGENTIC_END -->";
const defaultEmbeddingModel = process.env.ACOB_EMBEDDING_MODEL || "qwen3-embedding:0.6b";
const defaultEmbeddingEndpoint = process.env.ACOB_EMBEDDING_ENDPOINT || "http://127.0.0.1:11434/api/embed";

function usage() {
  console.log(`Agentic Coding OS Brain (ACOB)

Usage:
  acob init [--skip-embedding]
  acob quickstart [--skip-embedding]
  acob install [--global-agentic] [--skip-embedding]
  acob demo [--task "..."] [--json] [--write]
  acob memory-loop [--report] [--candidate "..."] [--public] [--write] [--json]
  acob metrics [--date YYYY-MM-DD] [--json] [--write]
  acob embedding [--setup] [--status]
  acob benchmark --example
  acob memory-retrieval --example
  acob status [--json]
  acob agents [--json]
  acob dispatch --task "..." [--json] [--write]
  acob agent-execution [--example]
  acob agent-lock [--example]
  acob budget [--example]
  acob tool-eval
  acob control [--list]
  acob evolution-apply [--example]
  acob dashboard [--port 8791]
  acob doctor
  acob check
  acob uninstall [--keep-runtime]

Legacy alias:
  codex-os-brain still works as a compatibility command.

Environment:
  CODEX_HOME            Defaults to ~/.codex
  ACOB_HOME             Defaults to ~/.acob
  CODEX_OS_BRAIN_HOME   Backward-compatible alias
  ACOB_EMBEDDING_MODEL  Defaults to qwen3-embedding:0.6b
`);
}

function shellQuote(value) {
  const text = String(value);
  if (process.platform === "win32") return `"${text.replaceAll('"', '\\"')}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function backupFile(file) {
  if (!fs.existsSync(file)) return "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.acob-${stamp}.bak`;
  fs.copyFileSync(file, backup);
  return backup;
}

function nodeCommand(script) {
  return `${shellQuote(process.execPath)} ${shellQuote(path.join(runtimeRoot, script))}`;
}

function hookGroup(command, timeout = 5) {
  return {
    matcher: "",
    hooks: [{ type: "command", command, timeout }],
  };
}

function stripManagedHooks(hooks) {
  const events = hooks.hooks || {};
  for (const event of Object.keys(events)) {
    const groups = Array.isArray(events[event]) ? events[event] : [];
    events[event] = groups.filter((group) => {
      const entries = Array.isArray(group.hooks) ? group.hooks : [];
      return !entries.some((hook) => {
        const command = String(hook.command || "");
        return command.includes(".acob") || command.includes(".codex-os-brain");
      });
    });
  }
  hooks.hooks = events;
  return hooks;
}

function stripManagedAgentsBlock(text) {
  const patterns = [
    new RegExp(`\\n?${agentsBlockStart}[\\s\\S]*?${agentsBlockEnd}\\n?`, "g"),
    new RegExp(`\\n?${legacyAgentsBlockStart}[\\s\\S]*?${legacyAgentsBlockEnd}\\n?`, "g"),
  ];
  return patterns.reduce((textValue, pattern) => textValue.replace(pattern, "\n"), String(text || "")).replace(/\n{3,}/g, "\n\n").trimEnd();
}

function managedAgentsBlock() {
  return [
    agentsBlockStart,
    "## Agentic Coding OS Brain (ACOB) Agentic Coding",
    "",
    "Every user prompt should enter the Agentic Coding OS Brain (ACOB) agentic preflight before execution.",
    "",
    "- Use gated dispatch, not forced fanout: small or unclear tasks stay with the parent agent.",
    "- Auto-dispatch only when the task has 3+ concrete substeps, has a verifiable outcome, and has low privacy risk.",
    "- Use these Chinese sub-agent roles when dispatch is open: 上下文侦察员, 架构规划师, 代码执行员, 测试验证员, 安全审查员, 文档说明员, 发布检查员.",
    "- If real Codex subagent tools are available, the parent agent should call the selected subagents and merge their evidence.",
    "- If real subagent tools are unavailable, use the generated dispatch plan as guidance and do not claim subagents executed.",
    "- Do not dispatch write-capable agents for secrets, credentials, private memory, persona, self-evolution, destructive operations, or publishing without human approval.",
    "- Subagents must not spawn child agents. The parent agent owns final verification, merge, and user-facing answer.",
    agentsBlockEnd,
  ].join("\n");
}

function installHooks() {
  const hooks = stripManagedHooks(readJson(hooksFile, { hooks: {} }));
  hooks.hooks ||= {};
  hooks.hooks.UserPromptSubmit ||= [];
  hooks.hooks.PostToolUse ||= [];
  hooks.hooks.Stop ||= [];

  hooks.hooks.UserPromptSubmit.push(hookGroup(nodeCommand("scripts/inject-context.cjs"), 5));
  hooks.hooks.PostToolUse.push(hookGroup(nodeCommand("scripts/engineering-harness.cjs"), 5));
  hooks.hooks.Stop.push(hookGroup(nodeCommand("scripts/capture-session.cjs"), 5));

  const backup = backupFile(hooksFile);
  writeJson(hooksFile, hooks);
  return backup;
}

function installGlobalAgentsRules() {
  const current = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, "utf8") : "";
  const cleaned = stripManagedAgentsBlock(current);
  const next = `${cleaned ? `${cleaned}\n\n` : ""}${managedAgentsBlock()}\n`;
  const backup = backupFile(agentsFile);
  fs.mkdirSync(path.dirname(agentsFile), { recursive: true });
  fs.writeFileSync(agentsFile, next, "utf8");
  return backup;
}

function writeInstallConfig(args) {
  writeJson(path.join(installRoot, "config.json"), {
    version: "0.1.0",
    global_agentic: true,
    dispatch_policy: "gated_agentic_preflight",
    installed_with_global_agentic_flag: args.includes("--global-agentic"),
    local_embedding: {
      provider: "ollama",
      model: defaultEmbeddingModel,
      endpoint: defaultEmbeddingEndpoint,
      auto_setup: !args.includes("--skip-embedding"),
      enabled: false,
      status: "not_checked",
      purpose: "local vector retrieval for memory recall and token reduction",
    },
  });
}

function updateEmbeddingConfig(patch) {
  const configFile = path.join(installRoot, "config.json");
  const current = readJson(configFile, {});
  current.local_embedding = {
    provider: "ollama",
    model: defaultEmbeddingModel,
    endpoint: defaultEmbeddingEndpoint,
    auto_setup: true,
    enabled: false,
    status: "not_checked",
    purpose: "local vector retrieval for memory recall and token reduction",
    ...(current.local_embedding || {}),
    ...patch,
  };
  writeJson(configFile, current);
}

async function setupEmbedding(args = []) {
  const statusOnly = args.includes("--status");
  const shouldPull = args.includes("--setup") || args.includes("--pull") || args.includes("--auto") || args.includes("--quickstart");
  fs.mkdirSync(installRoot, { recursive: true });

  const ollama = spawnSync("ollama", ["--version"], { encoding: "utf8" });
  if (ollama.status !== 0) {
    updateEmbeddingConfig({
      enabled: false,
      status: "ollama_missing",
      last_checked_at: new Date().toISOString(),
      install_hint: "Install Ollama, then run: acob embedding --setup",
    });
    console.log("embedding: ollama_missing");
    console.log("hint: install Ollama, then run: acob embedding --setup");
    return { status: "ollama_missing" };
  }

  let listText = "";
  const list = spawnSync("ollama", ["list"], { encoding: "utf8" });
  if (list.status === 0) listText = `${list.stdout}\n${list.stderr}`;
  const hasModel = listText.includes(defaultEmbeddingModel);

  if (!hasModel && shouldPull && !statusOnly) {
    console.log(`embedding: pulling ${defaultEmbeddingModel}`);
    const pull = spawnSync("ollama", ["pull", defaultEmbeddingModel], { stdio: "inherit" });
    if (pull.status !== 0) {
      updateEmbeddingConfig({
        enabled: false,
        status: "pull_failed",
        last_checked_at: new Date().toISOString(),
      });
      console.log("embedding: pull_failed");
      return { status: "pull_failed" };
    }
  }

  const shouldVerify = hasModel || shouldPull;
  if (!shouldVerify || statusOnly) {
    updateEmbeddingConfig({
      enabled: hasModel,
      status: hasModel ? "model_available" : "model_missing",
      last_checked_at: new Date().toISOString(),
    });
    console.log(`embedding: ${hasModel ? "model_available" : "model_missing"}`);
    if (!hasModel) console.log(`hint: acob embedding --setup`);
    return { status: hasModel ? "model_available" : "model_missing" };
  }

  try {
    const response = await fetch(defaultEmbeddingEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: defaultEmbeddingModel, input: "ACOB local memory token reduction check" }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const payload = await response.json();
    const vector = Array.isArray(payload.embeddings) ? payload.embeddings[0] : payload.embedding;
    const dimension = Array.isArray(vector) ? vector.length : 0;
    if (!dimension) throw new Error("empty_embedding");
    updateEmbeddingConfig({
      enabled: true,
      status: "ready",
      dimension,
      last_checked_at: new Date().toISOString(),
    });
    console.log(`embedding: ready (${defaultEmbeddingModel}, ${dimension} dims)`);
    return { status: "ready", dimension };
  } catch (error) {
    updateEmbeddingConfig({
      enabled: false,
      status: "verify_failed",
      last_error: String(error.message || error),
      last_checked_at: new Date().toISOString(),
    });
    console.log("embedding: verify_failed");
    console.log(`reason: ${error.message || error}`);
    return { status: "verify_failed" };
  }
}

async function install(args = []) {
  if (!fs.existsSync(sourceRuntime)) {
    throw new Error(`runtime folder missing: ${sourceRuntime}`);
  }
  fs.mkdirSync(codexHome, { recursive: true });
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.cpSync(sourceRuntime, runtimeRoot, { recursive: true });
  fs.mkdirSync(path.join(installRoot, "data"), { recursive: true });
  writeInstallConfig(args);
  const backup = installHooks();
  const agentsBackup = installGlobalAgentsRules();
  console.log("Agentic Coding OS Brain (ACOB) installed");
  console.log("agentic: global gated preflight enabled");
  console.log(`runtime: ${runtimeRoot}`);
  console.log(`hooks: ${hooksFile}`);
  if (backup) console.log(`backup: ${backup}`);
  console.log(`agents: ${agentsFile}`);
  if (agentsBackup) console.log(`agents backup: ${agentsBackup}`);
  if (!args.includes("--skip-embedding")) {
    await setupEmbedding(["--quickstart"]);
  } else {
    updateEmbeddingConfig({
      enabled: false,
      status: "skipped",
      last_checked_at: new Date().toISOString(),
    });
    console.log("embedding: skipped");
  }
}

async function quickstart(args = []) {
  const installArgs = args.includes("--no-global-agentic") ? [] : ["--global-agentic"];
  if (args.includes("--skip-embedding")) installArgs.push("--skip-embedding");
  await install(installArgs);
  console.log("");
  console.log("Quickstart verification:");
  runStatus(["--summary"]);
  console.log("");
  console.log("Next:");
  console.log("  acob dashboard");
  console.log("  acob embedding --status");
  console.log("  acob dispatch --task \"refactor dashboard, update docs, run checks\" --json");
}

function runScript(script, args = [], inherit = false) {
  const result = spawn(process.execPath, [path.join(runtimeRoot, script), ...args], {
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, ACOB_HOME: installRoot, CODEX_OS_BRAIN_HOME: installRoot },
  });
  return result;
}

function runStatus(args = []) {
  if (!fs.existsSync(path.join(runtimeRoot, "scripts", "global-hook-status.cjs"))) {
    console.error("Agentic Coding OS Brain (ACOB) is not installed. Run: acob install");
    process.exitCode = 1;
    return;
  }
  const child = spawnSync(process.execPath, [path.join(runtimeRoot, "scripts", "global-hook-status.cjs"), ...args], {
    stdio: "inherit",
    env: { ...process.env, ACOB_HOME: installRoot, CODEX_OS_BRAIN_HOME: installRoot },
  });
  process.exitCode = child.status || 0;
}

function runRuntimeOrPackageScript(scriptName, args = []) {
  const installed = path.join(runtimeRoot, scriptName);
  const packaged = path.join(sourceRuntime, scriptName);
  const script = fs.existsSync(installed) ? installed : packaged;
  if (!fs.existsSync(script)) {
    console.error(`missing ${scriptName}; run acob install`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, ACOB_HOME: installRoot, CODEX_OS_BRAIN_HOME: installRoot },
  });
  child.on("exit", (code) => { process.exitCode = code || 0; });
}

function agents(args = []) {
  runRuntimeOrPackageScript("scripts/agentic-dispatch.cjs", ["--list", ...args]);
}

function dispatch(args = []) {
  runRuntimeOrPackageScript("scripts/agentic-dispatch.cjs", args);
}

function agentExecution(args = []) {
  runRuntimeOrPackageScript("scripts/agent-execution-ledger.cjs", args);
}

function agentLock(args = []) {
  runRuntimeOrPackageScript("scripts/agent-permission-lock.cjs", args);
}

function budget(args = []) {
  runRuntimeOrPackageScript("scripts/token-budget-enforcer.cjs", args);
}

function toolEval(args = []) {
  runRuntimeOrPackageScript("scripts/tool-eval-suite.cjs", args);
}

function control(args = []) {
  runRuntimeOrPackageScript("scripts/dashboard-control-plane.cjs", args);
}

function evolutionApply(args = []) {
  runRuntimeOrPackageScript("scripts/evolution-apply.cjs", args);
}

function benchmark(args = []) {
  runRuntimeOrPackageScript("scripts/benchmark-demo.cjs", args);
}

function memoryRetrieval(args = []) {
  runRuntimeOrPackageScript("scripts/memory-retrieval-pipeline.cjs", args);
}

function valueDemo(args = []) {
  runRuntimeOrPackageScript("scripts/value-demo.cjs", args);
}

function memoryLoop(args = []) {
  runRuntimeOrPackageScript("scripts/memory-loop.cjs", args.length ? args : ["--report"]);
}

function metrics(args = []) {
  runRuntimeOrPackageScript("scripts/daily-metrics-report.cjs", args);
}

function dashboard(args) {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? args[portIndex + 1] : "8791";
  if (!fs.existsSync(path.join(runtimeRoot, "dashboard", "dashboard-server.mjs"))) {
    console.error("Agentic Coding OS Brain (ACOB) is not installed. Run: acob install");
    process.exit(1);
  }
  console.log(`Opening Agentic Coding OS Brain (ACOB) dashboard on http://127.0.0.1:${port}/`);
  const child = spawn(process.execPath, [path.join(runtimeRoot, "dashboard", "dashboard-server.mjs")], {
    stdio: "inherit",
    env: { ...process.env, ACOB_HOME: installRoot, CODEX_OS_BRAIN_HOME: installRoot, ACOB_PORT: port, CODEX_OS_BRAIN_PORT: port },
  });
  child.on("exit", (code) => process.exit(code || 0));
}

function check() {
  const checks = [
    ["scripts/inject-context.cjs"],
    ["scripts/global-hook-status.cjs"],
    ["scripts/agentic-dispatch.cjs"],
    ["scripts/engineering-harness.cjs"],
    ["scripts/capture-session.cjs"],
    ["scripts/privacy-scan.cjs"],
    ["dashboard/dashboard-server.mjs"],
  ];
  let failed = false;
  for (const [script] of checks) {
    const target = path.join(runtimeRoot, script);
    if (!fs.existsSync(target)) {
      console.error(`missing ${script}`);
      failed = true;
      continue;
    }
    const child = spawnSync(process.execPath, ["--check", target], { stdio: "inherit" });
    if (child.status) process.exit(child.status);
  }
  if (failed) process.exit(1);
  runStatus(["--summary"]);
}

function uninstall(args) {
  const hooks = stripManagedHooks(readJson(hooksFile, { hooks: {} }));
  const backup = backupFile(hooksFile);
  writeJson(hooksFile, hooks);
  if (fs.existsSync(agentsFile)) {
    const agentsBackup = backupFile(agentsFile);
    fs.writeFileSync(agentsFile, `${stripManagedAgentsBlock(fs.readFileSync(agentsFile, "utf8"))}\n`, "utf8");
    if (agentsBackup) console.log(`agents backup: ${agentsBackup}`);
  }
  if (!args.includes("--keep-runtime")) {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
  console.log("Agentic Coding OS Brain (ACOB) hooks removed");
  if (backup) console.log(`backup: ${backup}`);
}

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "quickstart" || command === "init") await quickstart(args);
  else if (command === "install") await install(args);
  else if (command === "embedding") await setupEmbedding(args.length ? args : ["--status"]);
  else if (command === "demo" || command === "value") valueDemo(args);
  else if (command === "memory-loop" || command === "memory") memoryLoop(args);
  else if (command === "metrics" || command === "daily-report") metrics(args);
  else if (command === "status") runStatus(args);
  else if (command === "agents") agents(args);
  else if (command === "dispatch") dispatch(args);
  else if (command === "agent-execution") agentExecution(args);
  else if (command === "agent-lock") agentLock(args);
  else if (command === "budget") budget(args);
  else if (command === "tool-eval") toolEval(args);
  else if (command === "control") control(args);
  else if (command === "evolution-apply") evolutionApply(args);
  else if (command === "benchmark") benchmark(args);
  else if (command === "memory-retrieval") memoryRetrieval(args);
  else if (command === "dashboard") dashboard(args);
  else if (command === "check" || command === "doctor") check();
  else if (command === "uninstall") uninstall(args);
  else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
