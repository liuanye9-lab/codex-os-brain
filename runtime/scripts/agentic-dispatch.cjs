#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = os.homedir();
const ROOT = process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".codex-os-brain");
const RUNTIME = path.join(ROOT, "runtime");
const FALLBACK_RUNTIME = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const LIBRARY_FILE = fs.existsSync(path.join(RUNTIME, "agents", "library.json"))
  ? path.join(RUNTIME, "agents", "library.json")
  : path.join(FALLBACK_RUNTIME, "agents", "library.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function hash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function usage() {
  return [
    "Usage:",
    "  codex-os-brain agents [--json]",
    "  codex-os-brain dispatch --task \"...\" [--json] [--write]",
    "",
    "Dispatch gate:",
    "  opens only for multi-step, verifiable, low-risk tasks where specialist agents add value.",
    "  high-privacy tasks remain parent-owned or read-only unless the user approves escalation.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { task: "", json: false, write: false, list: false, agent: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--task") args.task = argv[++i] || "";
    else if (item === "--agent") args.agent = argv[++i] || "";
    else if (item === "--json") args.json = true;
    else if (item === "--write") args.write = true;
    else if (item === "--list") args.list = true;
    else if (item === "--help" || item === "-h" || item === "help") args.help = true;
    else if (!args.task) args.task = item;
  }
  return args;
}

function classifyTask(task) {
  const text = String(task || "");
  const lower = text.toLowerCase();
  const highPrivacy = /secret|token|credential|password|private key|memory|persona|identity|self[- ]?evolution|隐私|密钥|令牌|密码|记忆|人格|身份|自进化/.test(lower);
  const publicRelease = /public|publish|npm|github|release|公开|发布|开源/.test(lower);
  const docs = /readme|doc|docs|文档|说明|介绍/.test(lower);
  const tests = /test|check|verify|eval|ci|smoke|测试|验证|检查/.test(lower);
  const implementation = /implement|fix|refactor|build|add|create|script|code|实现|修复|重构|构建|新增|脚本|代码/.test(lower);
  const architecture = /architecture|design|system|framework|agentic|sub-agent|subagent|架构|系统|框架|设计|派发|子 agent|子agent/.test(lower);
  const stepSignals = [
    implementation,
    tests,
    docs,
    publicRelease,
    architecture,
    /multiple|several|many|多个|多步|复杂|长期/.test(lower),
  ].filter(Boolean).length;
  const verifiable = tests || implementation || publicRelease || /done|acceptance|验收|通过|pass/.test(lower);
  return {
    highPrivacy,
    publicRelease,
    docs,
    tests,
    implementation,
    architecture,
    stepSignals,
    verifiable,
    privacyRisk: highPrivacy ? "high" : "low",
  };
}

function pickAgents(library, task, forcedAgent = "") {
  const cls = classifyTask(task);
  const agents = library.agents || [];
  if (forcedAgent) return agents.filter((agent) => agent.id === forcedAgent || agent.name === forcedAgent);
  const selected = [];
  const add = (id) => {
    const agent = agents.find((item) => item.id === id);
    if (agent && !selected.some((item) => item.id === id)) selected.push(agent);
  };
  if (cls.publicRelease) {
    add("context-scout");
    add("test-verifier");
    add("security-reviewer");
    add("release-operator");
    return selected.slice(0, library.policy?.max_parallel_agents || 4);
  }
  if (cls.architecture) add("architecture-planner");
  add("context-scout");
  if (cls.implementation && !cls.highPrivacy) add("implementation-worker");
  if (cls.tests || cls.implementation || cls.publicRelease) add("test-verifier");
  if (cls.highPrivacy || cls.publicRelease) add("security-reviewer");
  if (cls.publicRelease) add("release-operator");
  if (cls.docs || cls.publicRelease) add("docs-writer");
  return selected.slice(0, library.policy?.max_parallel_agents || 4);
}

function gateDecision(task, selected) {
  const cls = classifyTask(task);
  const enoughSteps = cls.stepSignals >= 3;
  const hasVerification = cls.verifiable;
  const privacyOk = cls.privacyRisk === "low" || selected.every((agent) => agent.tool_policy === "read_only");
  const useful = selected.length >= 2;
  return {
    open: enoughSteps && hasVerification && privacyOk && useful,
    enoughSteps,
    hasVerification,
    privacyOk,
    useful,
    privacyRisk: cls.privacyRisk,
    reasons: [
      enoughSteps ? "task has enough distinct signals" : "task is too small or underspecified",
      hasVerification ? "task has a verifiable outcome" : "verification is unclear",
      privacyOk ? "privacy gate allows selected agents" : "privacy risk blocks write-capable subagents",
      useful ? "multiple specialist agents add value" : "single-agent execution is enough",
    ],
  };
}

function promptForAgent(agent, task, gate) {
  return [
    `Role: ${agent.name} (${agent.id})`,
    `Task: ${task}`,
    "",
    "Operating rules:",
    "- You are a sub-agent, not the final owner.",
    "- Return concise evidence, changed files if any, checks run, and remaining risks.",
    "- Do not spawn child agents.",
    "- Do not access private memory, credentials, or unrelated user data.",
    `- Tool policy: ${agent.tool_policy}. Write scope: ${agent.write_scope}.`,
    "",
    "Expected output:",
    ...agent.outputs.map((item) => `- ${item}`),
    "",
    `Dispatch gate: ${gate.open ? "open" : "closed"}. If closed, provide read-only advice only.`,
  ].join("\n");
}

function buildPlan(task, forcedAgent = "") {
  const library = readJson(LIBRARY_FILE, { version: "missing", policy: {}, agents: [] });
  const selected = pickAgents(library, task, forcedAgent);
  const gate = gateDecision(task, selected);
  const dispatch = selected.map((agent, index) => ({
    order: index + 1,
    agent_id: agent.id,
    name: agent.name,
    type: agent.type,
    tool_policy: agent.tool_policy,
    write_scope: gate.open ? agent.write_scope : "read_only_due_to_closed_gate",
    privacy_level: agent.privacy_level,
    prompt: promptForAgent(agent, task, gate),
  }));
  return {
    generated_at: new Date().toISOString(),
    task_hash: hash(task),
    task_chars: String(task || "").length,
    library_version: library.version,
    gate,
    recommended: gate.open,
    selected_agents: dispatch,
    parent_agent_contract: [
      "Parent agent owns final answer and merge.",
      "Subagents must have disjoint responsibilities.",
      "No recursive subagents.",
      "No final completion claim without verification evidence.",
    ],
  };
}

function writePlan(plan) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const record = {
    generated_at: plan.generated_at,
    task_hash: plan.task_hash,
    task_chars: plan.task_chars,
    recommended: plan.recommended,
    gate: plan.gate,
    selected_agent_ids: plan.selected_agents.map((agent) => agent.agent_id),
  };
  fs.appendFileSync(path.join(DATA_DIR, "agentic-dispatch.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const library = readJson(LIBRARY_FILE, { version: "missing", policy: {}, agents: [] });
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.list) {
    const result = { version: library.version, policy: library.policy, agents: library.agents };
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${library.agents.map((agent) => `${agent.name} (${agent.id}): ${agent.description}`).join("\n")}\n`);
    return;
  }
  if (!args.task) {
    console.error(usage());
    process.exit(1);
  }
  const plan = buildPlan(args.task, args.agent);
  if (args.write) writePlan(plan);
  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else {
    console.log(`Agentic dispatch: ${plan.recommended ? "recommended" : "not recommended"}`);
    console.log(`privacy: ${plan.gate.privacyRisk}`);
    for (const reason of plan.gate.reasons) console.log(`- ${reason}`);
    console.log("Agents:");
    for (const agent of plan.selected_agents) console.log(`- ${agent.agent_id} (${agent.tool_policy})`);
  }
  process.exit(plan.recommended ? 0 : 2);
}

if (require.main === module) main();
module.exports = { buildPlan, classifyTask };
