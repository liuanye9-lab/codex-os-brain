# First-Minute Value Demo

ACOB should feel useful before a user trusts it with real work.

Run:

```bash
acob demo --task "fix dashboard, update docs, run checks"
```

JSON mode:

```bash
acob demo --task "fix dashboard, update docs, run checks" --json
```

Write the local report:

```bash
acob demo --task "fix dashboard, update docs, run checks" --write
```

The demo shows four public-safe mechanisms:

| Mechanism | What users see |
|---|---|
| Memory context | bounded public memory items are included, stale/private items are dropped |
| Agent dispatch | specialist agents are recommended only when the task is multi-step, verifiable, and low privacy risk |
| Efficiency profile | deterministic scaffold for token, rework, success, and verification lift |
| Self-evolution gate | candidate-only improvement flow that requires human approval, rollback, and verification |

Important boundary:

This is a deterministic public scaffold, not a live model benchmark. Use observed traces, token counts, retry counts, and verification results before making external performance claims.

The demo does not read private memory or upload data.
