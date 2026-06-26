#!/usr/bin/env node
const { spawnSync } = require("child_process");

const COMMANDS = {
  "dispatch:example": { label: "Run dispatch example", permission_level: "read", requires_confirmation: false, argv: ["node", "runtime/scripts/agentic-dispatch.cjs", "--task", "update docs run checks", "--json"], timeout_ms: 10000 },
  "agent:execution:example": { label: "Run agent execution ledger example", permission_level: "read", requires_confirmation: false, argv: ["node", "runtime/scripts/agent-execution-ledger.cjs", "--example"], timeout_ms: 10000 },
  "tool:eval": { label: "Run tool eval", permission_level: "verify", requires_confirmation: false, argv: ["node", "runtime/scripts/tool-eval-suite.cjs"], timeout_ms: 10000 },
  "evolution:apply": { label: "Apply approved evolution record", permission_level: "self_evolution", requires_confirmation: true, argv: ["node", "runtime/scripts/evolution-apply.cjs"], timeout_ms: 10000 },
};
function list() {
  return { commands: Object.entries(COMMANDS).map(([command, spec]) => ({ command, ...spec, status: "available" })) };
}
function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}
function run(command, confirm = "") {
  const spec = COMMANDS[command];
  if (!spec) throw new Error(`unknown command: ${command}`);
  if (spec.requires_confirmation && confirm !== "USER_APPROVED") return { command, ...spec, status: "blocked", reason: "missing USER_APPROVED confirmation" };
  const [cmd, ...args] = spec.argv;
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: spec.timeout_ms, stdio: ["ignore", "pipe", "pipe"] });
  return { command, ...spec, status: result.status === 0 ? "executed" : "failed", exit_code: result.status, stdout_excerpt: String(result.stdout || "").slice(0, 1200), stderr_excerpt: String(result.stderr || "").slice(0, 1200) };
}
if (require.main === module) {
  const out = process.argv.includes("--list") || process.argv.includes("--example") ? list() : run(arg("--run"), arg("--confirm"));
  console.log(JSON.stringify(out, null, 2));
  if (out.status === "blocked" || out.status === "failed") process.exitCode = 2;
}
module.exports = { list, run };
