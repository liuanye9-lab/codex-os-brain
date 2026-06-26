#!/usr/bin/env node
const crypto = require("crypto");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}
function id(seed) {
  return crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 10);
}
function build() {
  const taskId = arg("--task-id", "public-budget-task");
  const max = Math.max(0, Number(arg("--max-tokens", "8000")));
  const used = Math.max(0, Number(arg("--used-tokens", "0")));
  const reserve = Math.max(0, Number(arg("--reserve-tokens", "1200")));
  const roi = Number(arg("--roi-score", "1"));
  const remaining = max - used - reserve;
  const blocked = remaining < 0 || roi < Number(arg("--min-roi", "1"));
  return {
    id: `budget-${id(`${taskId}:${max}:${used}:${reserve}`)}`,
    task_id: taskId,
    max_tokens: max,
    used_tokens: used,
    reserved_tokens: reserve,
    remaining_tokens: remaining,
    roi_score: roi,
    status: blocked ? "blocked" : remaining < Math.max(500, max * 0.15) ? "near_limit" : "within_budget",
    reason: blocked ? "Hard budget or ROI gate blocks further agent fanout." : "Budget allows bounded execution.",
  };
}
const out = process.argv.includes("--example")
  ? { id: "budget-example", task_id: "task-example", max_tokens: 8000, used_tokens: 2000, reserved_tokens: 1200, remaining_tokens: 4800, roi_score: 2, status: "within_budget", reason: "Budget allows bounded execution." }
  : build();
console.log(JSON.stringify(out, null, 2));
if (out.status === "blocked" && process.argv.includes("--fail-on-block")) process.exitCode = 2;
