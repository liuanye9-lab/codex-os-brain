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
const installRoot = process.env.CODEX_OS_BRAIN_HOME || path.join(home, ".codex-os-brain");
const runtimeRoot = path.join(installRoot, "runtime");
const hooksFile = path.join(codexHome, "hooks.json");
const agentsFile = path.join(codexHome, "AGENTS.md");
const agentsBlockStart = "<!-- CODEX_OS_BRAIN_AGENTIC_START -->";
const agentsBlockEnd = "<!-- CODEX_OS_BRAIN_AGENTIC_END -->";

function usage() {
  console.log(`Codex OS Brain

Usage:
  codex-os-brain install [--global-agentic]
  codex-os-brain status [--json]
  codex-os-brain agents [--json]
  codex-os-brain dispatch --task "..." [--json] [--write]
  codex-os-brain dashboard [--port 8791]
  codex-os-brain check
  codex-os-brain uninstall [--keep-runtime]

Environment:
  CODEX_HOME            Defaults to ~/.codex
  CODEX_OS_BRAIN_HOME   Defaults to ~/.codex-os-brain
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
  const backup = `${file}.codex-os-brain-${stamp}.bak`;
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
      return !entries.some((hook) => String(hook.command || "").includes(".codex-os-brain"));
    });
  }
  hooks.hooks = events;
  return hooks;
}

function stripManagedAgentsBlock(text) {
  const pattern = new RegExp(`\\n?${agentsBlockStart}[\\s\\S]*?${agentsBlockEnd}\\n?`, "g");
  return String(text || "").replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function managedAgentsBlock() {
  return [
    agentsBlockStart,
    "## Codex OS Brain Agentic Coding",
    "",
    "Every user prompt should enter the Codex OS Brain agentic preflight before execution.",
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
  });
}

function install(args = []) {
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
  console.log("Codex OS Brain installed");
  console.log("agentic: global gated preflight enabled");
  console.log(`runtime: ${runtimeRoot}`);
  console.log(`hooks: ${hooksFile}`);
  if (backup) console.log(`backup: ${backup}`);
  console.log(`agents: ${agentsFile}`);
  if (agentsBackup) console.log(`agents backup: ${agentsBackup}`);
  runStatus(["--summary"]);
}

function runScript(script, args = [], inherit = false) {
  const result = spawn(process.execPath, [path.join(runtimeRoot, script), ...args], {
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, CODEX_OS_BRAIN_HOME: installRoot },
  });
  return result;
}

function runStatus(args = []) {
  if (!fs.existsSync(path.join(runtimeRoot, "scripts", "global-hook-status.cjs"))) {
    console.error("Codex OS Brain is not installed. Run: codex-os-brain install");
    process.exitCode = 1;
    return;
  }
  const child = runScript("scripts/global-hook-status.cjs", args, true);
  child.on("exit", (code) => { process.exitCode = code || 0; });
}

function runRuntimeOrPackageScript(scriptName, args = []) {
  const installed = path.join(runtimeRoot, scriptName);
  const packaged = path.join(sourceRuntime, scriptName);
  const script = fs.existsSync(installed) ? installed : packaged;
  if (!fs.existsSync(script)) {
    console.error(`missing ${scriptName}; run codex-os-brain install`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, CODEX_OS_BRAIN_HOME: installRoot },
  });
  child.on("exit", (code) => { process.exitCode = code || 0; });
}

function agents(args = []) {
  runRuntimeOrPackageScript("scripts/agentic-dispatch.cjs", ["--list", ...args]);
}

function dispatch(args = []) {
  runRuntimeOrPackageScript("scripts/agentic-dispatch.cjs", args);
}

function dashboard(args) {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? args[portIndex + 1] : "8791";
  if (!fs.existsSync(path.join(runtimeRoot, "dashboard", "dashboard-server.mjs"))) {
    console.error("Codex OS Brain is not installed. Run: codex-os-brain install");
    process.exit(1);
  }
  console.log(`Opening Codex OS Brain dashboard on http://127.0.0.1:${port}/`);
  const child = spawn(process.execPath, [path.join(runtimeRoot, "dashboard", "dashboard-server.mjs")], {
    stdio: "inherit",
    env: { ...process.env, CODEX_OS_BRAIN_HOME: installRoot, CODEX_OS_BRAIN_PORT: port },
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
  console.log("Codex OS Brain hooks removed");
  if (backup) console.log(`backup: ${backup}`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "install") install(args);
  else if (command === "status") runStatus(args);
  else if (command === "agents") agents(args);
  else if (command === "dispatch") dispatch(args);
  else if (command === "dashboard") dashboard(args);
  else if (command === "check") check();
  else if (command === "uninstall") uninstall(args);
  else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
