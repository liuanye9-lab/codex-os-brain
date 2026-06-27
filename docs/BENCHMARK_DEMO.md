# Public Benchmark Demo

ACOB includes a deterministic benchmark scaffold for showing how the project should be evaluated.

It compares four operating modes across 20 coding task scenarios:

1. No ACOB
2. Long context only
3. ACOB Working Memory + Replay + Reward
4. ACOB + Memory Lifecycle

Metrics:

- success rate
- rework rate
- token estimate
- verification pass rate

Run:

```bash
npm run benchmark:demo -- --example
acob benchmark --example
```

Important boundary:

This is a public benchmark demo, not a live model leaderboard. It is intentionally deterministic so developers can inspect the evaluation shape without sending private code, prompts, or memory to a hosted service.

Before making performance claims, replace the estimated rows with real Codex task traces:

- observed task result
- checks run
- token count
- retry count
- verification outcome
- privacy result

