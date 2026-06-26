#!/usr/bin/env node
const crypto = require("crypto");
const path = require("path");

const FORBIDDEN = [".env", "MEMORY.md", "SOUL.md", "IDENTITY.md", "STATE.md", "USER.md", "data/live/", ".git/"];
function vals(name) {
  const out = [];
  for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  return out;
}
function arg(name, fallback = "") {
  return vals(name)[0] || fallback;
}
function id(seed) {
  return crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 10);
}
function norm(file) {
  return path.normalize(file).replaceAll(path.sep, "/").replace(/^\/+/, "");
}
function inScope(file, scopes) {
  const f = norm(file);
  return scopes.some((scope) => {
    const s = norm(scope);
    return f === s || f.startsWith(s.endsWith("/") ? s : `${s}/`);
  });
}
function forbidden(file) {
  const f = norm(file);
  return FORBIDDEN.find((item) => f === item || f.includes(item) || f.startsWith(item));
}
function build() {
  const agentId = arg("--agent-id", "public-agent");
  const allowedWrite = vals("--allow-write");
  const claimed = vals("--claim-file");
  const violations = [];
  for (const file of claimed) {
    const hit = forbidden(file);
    if (hit) violations.push(`${file} is forbidden by ${hit}`);
    if (!inScope(file, allowedWrite)) violations.push(`${file} is outside write scope`);
  }
  return {
    id: `agent-lock-${id(`${agentId}:${claimed.join(",")}`)}`,
    agent_id: agentId,
    allowed_write: allowedWrite,
    claimed_files: claimed,
    forbidden: FORBIDDEN,
    violations,
    status: violations.length ? "blocked" : "locked",
  };
}
const out = process.argv.includes("--example")
  ? { id: "agent-lock-example", agent_id: "implementation-worker", allowed_write: ["runtime/scripts/"], claimed_files: ["runtime/scripts/example.cjs"], forbidden: FORBIDDEN, violations: [], status: "locked" }
  : build();
console.log(JSON.stringify(out, null, 2));
if (out.status === "blocked" && process.argv.includes("--fail-on-block")) process.exitCode = 2;
