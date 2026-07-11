# Architecture

Brain Lite separates five decisions that larger harnesses often mix together:

1. **Dispatch** — a pure function decides whether delegation has enough expected benefit.
2. **Selection** — a task-family policy chooses a model and effort, optionally using verified local evidence.
3. **Execution** — a child receives a minimal packet and runs read-only with a structured output contract.
4. **Acceptance** — the parent runs an independent verifier and records the real outcome.
5. **Learning** — an offline job derives stable, trial, blocked, or temporarily unavailable routes.

The system remains usable when every Brain Lite module is disabled because the parent agent is always the fallback.

## Outcome state

Capability and availability are deliberately separate:

- verifier failure is capability evidence;
- timeout, quota, transport, authentication, and model availability are infrastructure evidence;
- preliminary child output is neither success nor failure until a verifier produces a final event.

Policy learning uses the most recent outcome for each distinct task fingerprint. Replaying one task does not increase the independent sample count.

## Adaptation boundary

Derived state never overwrites the base configuration. A stable route can influence only low-risk work with an independent verifier. All other changes remain review candidates.

No hook is necessary for this design. If native execution data is insufficient, add an observer only after measuring coverage and only if it remains deterministic, non-injecting, and fast.
