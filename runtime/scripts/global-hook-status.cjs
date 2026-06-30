#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const RUNTIME = path.join(ROOT, "runtime");
const HOOKS_FILE = path.join(CODEX_HOME, "hooks.json");
const AGENTS_FILE = path.join(CODEX_HOME, "AGENTS.md");
const STATUS_FILE = path.join(ROOT, "data", "global-hook-status.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function commandList(hooks, event) {
  const groups = hooks?.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group, groupIndex) => {
    const matcher = Object.prototype.hasOwnProperty.call(group, "matcher") ? group.matcher : null;
    return (group.hooks || []).map((hook, hookIndex) => ({
      event,
      groupIndex,
      hookIndex,
      matcher,
      globalMatcher: matcher === "",
      command: String(hook.command || ""),
    }));
  });
}

function syntaxOk(script) {
  const file = path.join(RUNTIME, script);
  if (!fs.existsSync(file)) return false;
  const out = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 5000 });
  return out.status === 0;
}

function extractScriptPaths(command) {
  const text = String(command || "");
  const paths = [];
  const quoted = /["']((?:\/|[A-Za-z]:\\)[^"']+\.(?:cjs|mjs|js))["']/g;
  const bare = /(?:^|\s)((?:\/|[A-Za-z]:\\)[^\s"']+\.(?:cjs|mjs|js))/g;
  let match;
  while ((match = quoted.exec(text))) paths.push(match[1]);
  while ((match = bare.exec(text))) paths.push(match[1]);
  return [...new Set(paths.map((item) => item.replace(/[),.;]+$/g, "")))];
}

function externalScriptSyntaxOk(command, keyword) {
  return extractScriptPaths(command)
    .filter((file) => path.basename(file).includes(keyword))
    .some((file) => {
      if (!fs.existsSync(file)) return false;
      const out = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 5000 });
      return out.status === 0;
    });
}

function hookProvider(commands, keyword, packagedScript) {
  const managed = commands.find((item) => (
    item.globalMatcher
    && item.command.includes(keyword)
    && (item.command.includes(".acob") || item.command.includes(".codex-os-brain"))
  ));
  if (managed && syntaxOk(packagedScript)) return "managed_runtime";

  const compatible = commands.find((item) => (
    item.globalMatcher
    && item.command.includes(keyword)
    && externalScriptSyntaxOk(item.command, keyword)
  ));
  if (compatible) return "compatible_external";
  return "missing";
}

function smokeInjection() {
  const file = path.join(RUNTIME, "scripts", "inject-context.cjs");
  if (!fs.existsSync(file)) return { ok: false, reason: "missing inject-context.cjs" };
  const out = spawnSync(process.execPath, [file], {
    input: JSON.stringify({ prompt: "Agentic Coding OS Brain (ACOB) smoke check" }),
    encoding: "utf8",
    timeout: 5000,
  });
  if (out.status !== 0) return { ok: false, status: out.status };
  try {
    const parsed = JSON.parse(out.stdout || "{}");
    const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
    const markerOk = ctx.includes("acob") || ctx.includes("codex-os-brain");
    return { ok: markerOk && ctx.includes("Agentic Coding Preflight"), chars: ctx.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function agentsRuleOk() {
  try {
    const text = fs.readFileSync(AGENTS_FILE, "utf8");
    const acobBlock = text.includes("ACOB_AGENTIC_START") && text.includes("Agentic Coding OS Brain (ACOB) Agentic Coding");
    const legacyBlock = text.includes("CODEX_OS_BRAIN_AGENTIC_START") && text.includes("Codex OS Brain Agentic Coding");
    return acobBlock || legacyBlock;
  } catch {
    return false;
  }
}

function buildStatus() {
  const hooks = readJson(HOOKS_FILE, { hooks: {} });
  const promptCommands = commandList(hooks, "UserPromptSubmit");
  const postToolCommands = commandList(hooks, "PostToolUse");
  const stopCommands = commandList(hooks, "Stop");
  const promptProvider = hookProvider(promptCommands, "inject-context", "scripts/inject-context.cjs");
  const postToolProvider = hookProvider(postToolCommands, "engineering-harness", "scripts/engineering-harness.cjs");
  const stopProvider = hookProvider(stopCommands, "capture-session", "scripts/capture-session.cjs");
  const required = [
    {
      label: "global prompt injection",
      ok: promptProvider !== "missing",
      source: promptProvider,
    },
    {
      label: "post-tool engineering audit",
      ok: postToolProvider !== "missing",
      source: postToolProvider,
    },
    {
      label: "stop heartbeat capture",
      ok: stopProvider !== "missing",
      source: stopProvider,
    },
    {
      label: "agentic dispatch preflight",
      ok: syntaxOk("scripts/agentic-dispatch.cjs"),
    },
    {
      label: "global AGENTS.md agentic rules",
      ok: agentsRuleOk(),
    },
  ];
  const injectionSmoke = smokeInjection();
  const globalCoverage = required.every((item) => item.ok) && injectionSmoke.ok;
  const hybrid = required.some((item) => item.source === "compatible_external");
  return {
    generated_at: new Date().toISOString(),
    status: globalCoverage ? (hybrid ? "hybrid_active" : "global_active") : "partial",
    global_coverage: globalCoverage,
    scope: globalCoverage ? "all_codex_prompts_on_this_codex_home" : "not_fully_global",
    codex_home: CODEX_HOME,
    runtime_home: ROOT,
    runtime_root_selection: process.env.ACOB_RUNTIME_ROOT_SELECTION || "unspecified",
    compatibility_mode: hybrid ? "managed_runtime_plus_compatible_external_hooks" : "managed_runtime",
    hooks: {
      file: HOOKS_FILE,
      agents_file_configured: agentsRuleOk(),
      user_prompt_submit_count: promptCommands.length,
      global_user_prompt_submit_count: promptCommands.filter((item) => item.globalMatcher).length,
      post_tool_use_count: postToolCommands.length,
      stop_count: stopCommands.length,
    },
    required,
    injection_smoke: injectionSmoke,
    privacy_boundary: "No personal memory, identity, user profile, API key, or private prompt content is packaged.",
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const status = buildStatus();
  if (args.has("--write")) {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  }
  if (args.has("--summary")) {
    console.log(`status: ${status.status}`);
    console.log(`scope: ${status.scope}`);
    console.log(`global_user_prompt_submit_count: ${status.hooks.global_user_prompt_submit_count}`);
    console.log(`injection_smoke: ${status.injection_smoke.ok ? "pass" : "fail"}`);
    process.exit(status.global_coverage ? 0 : 1);
  }
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exit(status.global_coverage ? 0 : 1);
}

if (require.main === module) main();
module.exports = { buildStatus };
