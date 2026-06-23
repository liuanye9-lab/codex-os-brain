#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".codex-os-brain");
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

function buildContext(prompt) {
  const intent = classifyPrompt(prompt);
  const lines = [
    "<codex-os-brain>",
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
    "</codex-os-brain>",
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
