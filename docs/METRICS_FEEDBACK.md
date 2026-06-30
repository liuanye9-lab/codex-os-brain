# Metrics Feedback Loop

ACOB measures observable local runtime behavior. It does not score itself by model confidence or dashboard decoration.

Run the daily report:

```bash
acob metrics
```

Run the one-screen effect scorecard:

```bash
acob effect
```

JSON mode:

```bash
acob metrics --json
acob effect --json
```

Write local report files:

```bash
acob metrics --write
acob effect --write
```

Reports are written under:

```text
~/.acob/reports/YYYY-MM-DD.json
~/.acob/reports/YYYY-MM-DD.md
~/.acob/reports/YYYY-MM-DD.effect.json
~/.acob/reports/YYYY-MM-DD.effect.md
```

The date is the machine's local calendar date. This keeps late-night and early-morning work in the same day the user sees locally instead of splitting it by UTC.

If neither `ACOB_HOME` nor `CODEX_OS_BRAIN_HOME` is set, metrics automatically chooses the local runtime with the most observed sanitized events from:

```text
~/.acob
~/.codex-os-brain
```

This keeps current ACOB installs and older `codex-os-brain` installs readable without manual flags. Set `ACOB_HOME=/path/to/runtime` when you need a specific runtime.

## What The Report Measures

`acob metrics` is the evidence ledger. `acob effect` is the user-facing scorecard built from the same sanitized data.

| Area | Signal |
|---|---|
| System slimming | prompt count, prompt chars, injected context chars, context budget overruns |
| Memory loop | candidates, approved records, rejected records, pending review, auto-promote status |
| Self-evolution | candidates, applied-with-verification records, rejected records, rollback availability, auto-apply status |
| Agent dispatch | gate-open rate, high-privacy events, average selected agents |
| Verification pressure | post-tool audits, risk severity counts, active and archived red flags |
| Intent mix | observed prompt intent distribution |

`acob effect` also maps the same signals into a Kano-style snapshot:

| Kano Type | ACOB Meaning |
|---|---|
| Basic needs | privacy boundary, human-approved memory, red-flag lifecycle |
| Performance needs | context budget, gated dispatch, verification pressure |
| Delight needs | one-command status, visible memory learning loop |
| Reverse needs avoided | no forced fanout, no personal-memory publishing, no vanity confidence score |

## Red Flag Lifecycle

Check current red-light status:

```bash
acob red-flag status --json
```

Archive a verified red flag instead of deleting it by hand:

```bash
acob red-flag clear --reason "verified and explained before completion" --verification "npm run check" --json
```

The archive stores only red-flag metadata, clear reason, and verification labels. It does not store raw prompts or tool inputs.

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
- self-evolution counts and gate status
- sanitized red-flag metadata, not raw reasons or local paths

Private deployments may add personal continuity and richer local evidence, but raw private memory, secrets, chat logs, vector indexes, sqlite/db files, and generated caches still stay out of public Git and npm packages.

## Cron Example

```bash
0 22 * * * acob metrics --write >/tmp/acob-metrics.log 2>&1
```

The report is useful only as observable evidence. It should be paired with real task traces before making external performance claims.
