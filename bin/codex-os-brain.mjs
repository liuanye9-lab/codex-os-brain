#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceRuntime = path.join(packageRoot, "runtime");
const home = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
const installRoot = process.env.CODEX_OS_BRAIN_HOME || path.join(home, ".codex-os-brain");
const runtimeRoot = path.join(installRoot, "runtime");
const hooksFile = path.join(codexHome, "hooks.json");

function usage() {
  console.log(`Codex OS Brain

Usage:
  codex-os-brain install
  codex-os-brain status [--json]
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

function install() {
  if (!fs.existsSync(sourceRuntime)) {
    throw new Error(`runtime folder missing: ${sourceRuntime}`);
  }
  fs.mkdirSync(codexHome, { recursive: true });
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.cpSync(sourceRuntime, runtimeRoot, { recursive: true });
  fs.mkdirSync(path.join(installRoot, "data"), { recursive: true });
  const backup = installHooks();
  console.log("Codex OS Brain installed");
  console.log(`runtime: ${runtimeRoot}`);
  console.log(`hooks: ${hooksFile}`);
  if (backup) console.log(`backup: ${backup}`);
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
    const child = spawn(process.execPath, ["--check", target], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code) process.exit(code);
    });
  }
  if (failed) process.exit(1);
  runStatus(["--summary"]);
}

function uninstall(args) {
  const hooks = stripManagedHooks(readJson(hooksFile, { hooks: {} }));
  const backup = backupFile(hooksFile);
  writeJson(hooksFile, hooks);
  if (!args.includes("--keep-runtime")) {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
  console.log("Codex OS Brain hooks removed");
  if (backup) console.log(`backup: ${backup}`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "install") install();
  else if (command === "status") runStatus(args);
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
