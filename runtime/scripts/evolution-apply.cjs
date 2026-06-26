#!/usr/bin/env node

const approved = process.argv.includes("--approved");
const highRisk = process.argv.includes("--high-risk");
const out = process.argv.includes("--example")
  ? { id: "evolution-apply-example", candidate_id: "candidate-example", approved_by: "human", apply_mode: "record_only", target_files: ["data/sanitized/evolution-applied/candidate-example.json"], verification: ["npm run check"], rollback_plan: "delete the sanitized apply record", blocked_reasons: [], status: "applied" }
  : {
      id: "evolution-apply-manual",
      candidate_id: "manual-candidate",
      approved_by: approved ? "human" : "",
      apply_mode: approved ? "record_only" : "blocked",
      target_files: [],
      verification: ["npm run check"],
      rollback_plan: "reject the candidate",
      blocked_reasons: approved && !highRisk ? [] : ["self-evolution adoption requires explicit human approval and safe target scope"],
      status: approved && !highRisk ? "applied" : "approval_required",
    };
console.log(JSON.stringify(out, null, 2));
if (out.status !== "applied" && process.argv.includes("--fail-on-block")) process.exitCode = 2;
