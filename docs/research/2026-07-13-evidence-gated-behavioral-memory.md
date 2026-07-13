# Evidence-Gated Behavioral Memory

## Research question

Can explicit user corrections become durable coding-agent behavior without restoring permanent prompt injection or treating heuristic tool-use scores as causal evidence?

## Upstream ideas retained

The Claude Brain V8 archive contributed four useful engineering ideas:

1. correction events are valuable runtime signals;
2. remembered rules need lifecycle and retirement rather than unlimited accumulation;
3. host-specific events should be normalized behind adapters;
4. research export should use a strict allowlist and exclude conversation text.

## Mechanisms rejected

The integration does not reuse the upstream efficacy attribution method. Assigning one session proxy score to every activated lesson does not isolate a lesson's contribution and has no counterfactual condition. The integration also rejects always-on hook injection and proxy success metrics based primarily on tool sequence, validation-call ratio, or retry counts.

## Revised method

A proposed rule is treated as a policy candidate. It must satisfy all of the following before promotion:

- an explicit synthesized rule exists;
- at least three distinct correction occurrences exist;
- same-scope divergent rules have been reviewed;
- at least three replay cases pass;
- the same deterministic verifier is used across paired samples;
- candidate quality does not fall below the baseline floor;
- the candidate produces a measured token, latency, or verified-quality benefit;
- a separate canary run passes.

External-write or high-risk rules require approval and cannot auto-enter canary.

The implementation also treats storage correctness as part of the evidence boundary. A short-lived exclusive writer lock covers read-modify-write, and a monotonic revision detects stale snapshots. Invalid stores are preserved for inspection instead of being reset or overwritten.

## Privacy boundary

Raw correction text is used only in memory for signal detection. The local candidate record contains a hash of correction evidence and a synthesized behavioral rule, but not the raw user message, session identifier, private path, or hidden reasoning. Research exports remove the rule text and evidence hashes and replace identifiers with caller-salted HMAC pseudonyms.

Behavioral trace events use a separate local HMAC key and a Trace V2 allowlist. They record lifecycle metadata, not the candidate text or raw identifier.

## Interpretation boundary

A promoted candidate is evidence that one rule helped on its measured replay and canary set. It is not evidence of general cognitive improvement, agent individuation, self-awareness, or universal transfer to unrelated tasks.
