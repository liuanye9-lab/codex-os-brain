#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");
const AUDIT_FILE = path.join(DATA_DIR, "engineering-audit.jsonl");
const RED_FLAG_FILE = path.join(DATA_DIR, "red-flag.json");

const WRITE_TOOLS = /apply_patch|edit|write|create|delete|Bash|Shell|exec/i;
const RISKY_WORDS = /secret|token|credential|api[_-]?key|password|private[_-]?key|MEMORY\.md|IDENTITY\.md|SOUL\.md|persona|self[- ]?evolution/i;
const CONFIG_WORDS = /package\.json|hooks\.json|config|\.env|workflow|Dockerfile|schema|migration/i;

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function sanitizePath(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.split(/[\\/]/).slice(-3).join("/");
}

function collectText(value, depth = 0) {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.map((item) => collectText(item, depth + 1)).join("\n");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}:${collectText(item, depth + 1)}`).join("\n");
  return String(value);
}

function analyze(payload) {
  const toolName = payload.tool_name || payload.toolName || payload.name || "";
  const text = collectText(payload.tool_input || payload.arguments || payload);
  const risks = [];
  if (WRITE_TOOLS.test(toolName)) risks.push({ rule: "tool_may_modify_state", severity: "medium" });
  if (CONFIG_WORDS.test(text)) risks.push({ rule: "config_or_schema_change", severity: "medium" });
  if (RISKY_WORDS.test(text)) risks.push({ rule: "sensitive_boundary", severity: "high" });
  return {
    ts: new Date().toISOString(),
    event: "post_tool_audit",
    tool: String(toolName || "unknown").slice(0, 80),
    risks,
    files: Array.from(new Set((text.match(/[A-Za-z0-9._/-]+\.(?:js|mjs|cjs|json|md|toml|yml|yaml|ts|tsx|py|sh|ps1)/g) || []).map(sanitizePath))).slice(0, 12),
  };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input || "{}");
    const audit = analyze(payload);
    appendJsonl(AUDIT_FILE, audit);
    if (audit.risks.some((risk) => risk.severity === "high")) {
      fs.writeFileSync(RED_FLAG_FILE, `${JSON.stringify({
        raised_at: audit.ts,
        reason: "sensitive_boundary",
        required_action: "verify, explain, or request human approval before claiming completion",
      }, null, 2)}\n`, "utf8");
    }
  } catch {
    // Hooks must not block Codex.
  }
});

module.exports = { analyze };
