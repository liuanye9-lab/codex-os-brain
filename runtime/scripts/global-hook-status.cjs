#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const ROOT = process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".codex-os-brain");
const RUNTIME = path.join(ROOT, "runtime");
const HOOKS_FILE = path.join(CODEX_HOME, "hooks.json");
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

function smokeInjection() {
  const file = path.join(RUNTIME, "scripts", "inject-context.cjs");
  if (!fs.existsSync(file)) return { ok: false, reason: "missing inject-context.cjs" };
  const out = spawnSync(process.execPath, [file], {
    input: JSON.stringify({ prompt: "Codex OS Brain smoke check" }),
    encoding: "utf8",
    timeout: 5000,
  });
  if (out.status !== 0) return { ok: false, status: out.status };
  try {
    const parsed = JSON.parse(out.stdout || "{}");
    const ctx = parsed?.hookSpecificOutput?.additionalContext || "";
    return { ok: ctx.includes("codex-os-brain") && ctx.includes("Agentic Coding Preflight"), chars: ctx.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildStatus() {
  const hooks = readJson(HOOKS_FILE, { hooks: {} });
  const promptCommands = commandList(hooks, "UserPromptSubmit");
  const postToolCommands = commandList(hooks, "PostToolUse");
  const stopCommands = commandList(hooks, "Stop");
  const required = [
    {
      label: "global prompt injection",
      ok: promptCommands.some((item) => item.globalMatcher && item.command.includes(".codex-os-brain") && item.command.includes("inject-context.cjs")) && syntaxOk("scripts/inject-context.cjs"),
    },
    {
      label: "post-tool engineering audit",
      ok: postToolCommands.some((item) => item.globalMatcher && item.command.includes(".codex-os-brain") && item.command.includes("engineering-harness.cjs")) && syntaxOk("scripts/engineering-harness.cjs"),
    },
    {
      label: "stop heartbeat capture",
      ok: stopCommands.some((item) => item.globalMatcher && item.command.includes(".codex-os-brain") && item.command.includes("capture-session.cjs")) && syntaxOk("scripts/capture-session.cjs"),
    },
    {
      label: "agentic dispatch preflight",
      ok: syntaxOk("scripts/agentic-dispatch.cjs"),
    },
  ];
  const injectionSmoke = smokeInjection();
  const globalCoverage = required.every((item) => item.ok) && injectionSmoke.ok;
  return {
    generated_at: new Date().toISOString(),
    status: globalCoverage ? "global_active" : "partial",
    global_coverage: globalCoverage,
    scope: globalCoverage ? "all_codex_prompts_on_this_codex_home" : "not_fully_global",
    codex_home: CODEX_HOME,
    runtime_home: ROOT,
    hooks: {
      file: HOOKS_FILE,
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
