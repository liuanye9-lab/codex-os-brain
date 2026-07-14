# Evidence-Gated Behavioral Memory Design

## Goal

Add an optional behavioral-memory layer to Codex OS Brain V8 that converts explicit user corrections into reviewable rule candidates, tests them against independent verification, and promotes only repeated rules with measured benefit.

## Non-goals

- Do not restore always-on prompt injection or the V1–V7 hook stack.
- Do not call proxy tool-use scores causal efficacy.
- Do not persist raw prompts, private paths, session identifiers, or hidden reasoning by default.
- Do not auto-promote external-write or high-risk rules.

## Architecture

1. `host-event-normalizer` converts Claude Code, Codex, ZCode, and generic events into one in-memory event shape.
2. `correction-detector` strips injected blocks and detects explicit correction, false-success, abandon, and weak rephrase signals.
3. `behavioral-memory` creates privacy-safe candidates. A candidate without an explicit proposed rule remains `needs-synthesis` and cannot be recalled.
4. `candidate-store` persists candidates in a local private JSON file with an exclusive writer lock, revision check, corrupt-store preservation, and recoverable Windows replacement fallback. Same-scope disagreements remain under human review.
5. `behavioral-policy` evaluates paired samples with the existing Policy Lab and advances candidates through the existing Skill Lifecycle.
6. `behavioral-context` recalls only `promoted` candidates through Context Economy with a separate 300-token default budget.
7. `behavioral-trace` emits allowlisted Trace V2 metadata with a local-keyed HMAC candidate reference.
8. `privacy-export` emits pseudonymous, date-level, text-free research rows using HMAC identifiers and rejects weak salts.

## Data flow

```text
Optional host sensor
  -> normalized event (raw text remains in memory)
  -> correction detection
  -> explicit proposed rule or needs-synthesis candidate
  -> local candidate store
  -> repeated occurrence + replay evidence
  -> paired Policy Lab evaluation
  -> candidate/shadow/replay/canary/promoted/revoked
  -> bounded Context Economy packet
```

## Safety and privacy

- Feature disabled by default.
- Host adapters are sensors only and cannot change parent budgets, routing, writes, or verifier acceptance.
- Raw correction text is not stored by default; only a SHA-256 evidence hash is persisted.
- Export IDs are derived from HMAC with caller-provided salt and contain no timestamp or PID.
- Same-scope divergent rules are not automatically merged.
- Ordinary capture and evaluation cannot promote a candidate; canary approval is a separate confirmed operation.
- Corrupt stores fail closed and concurrent writers receive a lock or revision conflict.

## Success criteria

- All new behavior is covered by Node test-runner tests written before implementation.
- Correction detection rejects injected content and positive acknowledgements.
- Candidates require an explicit proposed rule before promotion eligibility.
- Only promoted rules enter context packets.
- Policy evaluation rejects verifier drift, quality regression, insufficient occurrences, and failed replay evidence.
- Privacy export contains no rule text, evidence hashes, exact timestamps, session identifiers, or source paths.
