# Metrics Feedback Loop

ACOB measures observable local runtime behavior. It does not score itself by model confidence or dashboard decoration.

Run the daily report:

```bash
acob metrics
```

JSON mode:

```bash
acob metrics --json
```

Write local report files:

```bash
acob metrics --write
```

Reports are written under:

```text
~/.acob/reports/YYYY-MM-DD.json
~/.acob/reports/YYYY-MM-DD.md
```

## What The Report Measures

| Area | Signal |
|---|---|
| System slimming | prompt count, prompt chars, injected context chars, context budget overruns |
| Memory loop | candidates, approved records, rejected records, pending review, auto-promote status |
| Agent dispatch | gate-open rate, high-privacy events, average selected agents |
| Verification pressure | post-tool audits, risk severity counts, active red flag |
| Intent mix | observed prompt intent distribution |

## Memory Loop

Create a public-safe candidate:

```bash
acob memory-loop --candidate "Public releases require privacy scan and package gate." --public --tag release --write --json
```

Review current state:

```bash
acob memory-loop --report
```

Apply only with explicit approval:

```bash
acob memory-loop --apply mem-candidate-id --approved --json
```

Reject stale or low-value candidates:

```bash
acob memory-loop --reject mem-candidate-id --reason "too broad" --json
```

Memory remains candidate-only by default. Public ACOB never auto-promotes personal memory.

## Public / Private Boundary

Public metrics are local, aggregate, and sanitized:

- prompt character counts, not raw prompts
- dispatch hashes, not task text
- context length and budget status
- memory candidate status
- audit risk counts

Private deployments may add personal continuity and richer local evidence, but raw private memory, secrets, chat logs, vector indexes, sqlite/db files, and generated caches still stay out of public Git and npm packages.

## Cron Example

```bash
0 22 * * * acob metrics --write >/tmp/acob-metrics.log 2>&1
```

The report is useful only as observable evidence. It should be paired with real task traces before making external performance claims.
