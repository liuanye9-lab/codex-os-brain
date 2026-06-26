#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPlan } = require("./agentic-dispatch.cjs");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");

function appendJsonl(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
  } catch {
    // Hooks must not block Codex.
  }
}

function classifyPrompt(prompt) {
  const text = String(prompt || "");
  const engineering = /implement|refactor|fix|build|deploy|migrate|script|test|debug|实现|修复|优化|重构|部署|脚本|测试|调试/i.test(text);
  const highRisk = /memory|persona|identity|secret|token|credential|self[- ]?evolution|隐私|密钥|记忆|人格|自进化/i.test(text);
  const factual = /latest|newest|today|version|price|law|compare|recommend|最新|今天|版本|价格|法律|对比|推荐/i.test(text);
  if (highRisk) return "high_risk";
  if (engineering) return "engineering";
  if (factual) return "factual";
  return "default";
}

function sanitizedDispatchRecord(plan) {
  return {
    ts: plan.generated_at,
    event: "agentic_preflight",
    task_hash: plan.task_hash,
    task_chars: plan.task_chars,
    recommended: plan.recommended,
    gate: plan.gate,
    selected_agent_ids: plan.selected_agents.map((agent) => agent.agent_id),
    selected_agent_names: plan.selected_agents.map((agent) => agent.name),
  };
}

function buildAgenticPreflight(prompt) {
  try {
    const plan = buildPlan(prompt);
    appendJsonl(path.join(DATA_DIR, "agentic-dispatch.jsonl"), sanitizedDispatchRecord(plan));
    const selected = plan.selected_agents.length
      ? plan.selected_agents.map((agent) => `${agent.name}(${agent.agent_id})`).join(", ")
      : "none";
    return [
      "## Agentic Coding Preflight",
      `- Dispatch gate: ${plan.recommended ? "open" : "closed"}`,
      `- Privacy risk: ${plan.gate.privacyRisk}`,
      `- Selected sub-agents: ${selected}`,
      "- If this Codex environment exposes real subagent tools, the parent Agent may call these sub-agents with the generated role prompts.",
      "- If real subagent tools are unavailable, use this as a local dispatch plan and do not claim subagents executed.",
      "- Do not force subagents for small/simple tasks; parent Agent may execute directly when the gate is closed.",
      "- Subagents must not spawn child agents; the parent Agent owns final verification and answer.",
    ].join("\n");
  } catch {
    return [
      "## Agentic Coding Preflight",
      "- Dispatch gate: unavailable",
      "- Fallback: parent Agent executes directly and should run verification before claiming completion.",
    ].join("\n");
  }
}

function buildContext(prompt) {
  const intent = classifyPrompt(prompt);
  const agenticPreflight = buildAgenticPreflight(prompt);
  const lines = [
    "<acob>",
    `> auto-injected public cognitive harness · intent=${intent}`,
    "",
    "## Operating Contract",
    "- Treat memory as candidate-only unless the user explicitly approves promotion.",
    "- Use bounded working context: current goal, constraints, focus files, open questions, risks.",
    "- For code/config changes, verify before claiming completion.",
    "- For privacy, credentials, persona, memory, or self-evolution changes, slow down and request approval.",
    "- Dashboard state is observable evidence, not proof of hidden reasoning or intelligence.",
    "",
    "## Verification Before Completion",
    "- State what changed.",
    "- Run the smallest relevant check.",
    "- If a check cannot run, say exactly why.",
    "- Do not claim done from model self-rating alone.",
    "",
    "## Anti-Pseudo-Bionics",
    "- Long context is not intelligence.",
    "- A vector store is not memory by itself.",
    "- Reflection is not learning without feedback.",
    "- More agents do not automatically mean better results.",
    "- Human approval is the highest gate for risky system changes.",
    "",
    agenticPreflight,
    "</acob>",
  ];
  return lines.join("\n");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input || "{}");
    const prompt = payload.prompt || payload.user_message || "";
    const context = buildContext(prompt);
    appendJsonl(path.join(DATA_DIR, "prompt-events.jsonl"), {
      ts: new Date().toISOString(),
      event: "prompt_injected",
      intent: classifyPrompt(prompt),
      prompt_chars: String(prompt || "").length,
    });
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context,
      },
    }));
  } catch {
    process.exit(0);
  }
});
