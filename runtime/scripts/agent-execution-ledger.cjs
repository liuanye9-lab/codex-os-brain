#!/usr/bin/env node
const crypto = require("crypto");

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
function parseResult(raw) {
  const [agent_id, status = "completed", evidence = "imported result"] = raw.split(":");
  return { agent_id, status, evidence: [evidence] };
}
function build() {
  const taskId = arg("--task-id", "public-agent-execution");
  const agents = vals("--agent");
  const requests = agents.length ? agents : ["context-scout", "test-verifier"];
  const results = vals("--result").map(parseResult);
  const blocked = results.filter((item) => !["completed", "pass", "ready"].includes(item.status)).length;
  const ready = results.length >= requests.length && blocked === 0;
  return {
    id: `agent-execution-${id(`${taskId}:${requests.length}:${results.length}`)}`,
    task_id: taskId,
    mode: results.length ? "imported_results" : "manifest_only",
    spawn_requests: requests.map((agent_id) => ({ agent_id, message: `Run bounded subtask for ${taskId}`, privacy_level: "low" })),
    results,
    merge: { ready, completed: results.length - blocked, blocked, next_action: ready ? "merge and verify" : "import real wait_agent results before claiming completion" },
    status: ready ? "merged" : "planned",
  };
}
const out = process.argv.includes("--example")
  ? { id: "agent-execution-example", task_id: "task-example", mode: "manifest_only", spawn_requests: [{ agent_id: "context-scout", message: "Read only context", privacy_level: "low" }], results: [], merge: { ready: false, completed: 0, blocked: 0, next_action: "import real wait_agent results before claiming completion" }, status: "planned" }
  : build();
console.log(JSON.stringify(out, null, 2));
