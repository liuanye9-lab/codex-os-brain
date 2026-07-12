---
name: brain-lite-model-router
description: Decide whether a bounded independent task should stay with the parent agent or be delegated to Sol, Terra, Luna, or Spark. Use when a task has a clear verifier, batch benefit, independent quota advantage, model specialization, or genuine parallelism. Do not use for every request, private-context transfer, inseparable work, or irreversible external writes.
---

# Brain Lite Model Router

Default to parent execution. Run the deterministic gate only when delegation has a plausible advantage.

## Clarify before dispatch

When a request is vague, encode whether there is a concrete symptom, failing check, file scope, or relevant prior context. If all are absent, the gate returns `mother-clarify`: ask for one of those signals and do not start child agents to guess unseen business rules.

```json
{
  "promptClarity": "vague",
  "hasObservableSignal": false,
  "hasFailingVerification": false,
  "hasFileScope": false,
  "hasRelevantContext": false
}
```

Once any signal exists, use the normal route.

1. Encode known task features in a small JSON file.
2. Run `$BRAIN_LITE_HOME/scripts/brain-lite-router.js --features-file <file>`.
3. Stop if the result is `mother-clarify` or `mother-direct`.
4. For a delegated route, send only the goal, hard constraints, relevant files, output contract, verification commands, and read-only permission boundary.
5. Run the child through `brain-lite-delegate.js`; never give it external side effects.
6. The parent runs the independent verifier and appends a final verified event with `brain-lite-routing-ledger.js`.
7. Follow bounded outcome routing. Infrastructure gets at most one same-route retry; capability failure follows the explicit escalation path. Stop when any task budget is exhausted.

Never count model self-report as verification. Never enable Ultra unless a max route has already failed, the work has at least three independent lanes, and a merge verifier exists.
