# Evidence-Gated Behavioral Memory

## Research question

Can explicit user corrections become durable coding-agent behavior without restoring permanent prompt injection or treating heuristic tool-use scores as causal evidence?

## Retained ideas from Claude Brain V8

1. User correction events are useful runtime signals.
2. Remembered rules need lifecycle and retirement rather than unlimited accumulation.
3. Host-specific event shapes should be normalized behind adapters.
4. Research export should use a strict allowlist and exclude conversation text.

## Rejected mechanisms

This integration does not reuse session proxy scoring as lesson efficacy. Assigning one session score to every activated lesson does not isolate contribution and has no counterfactual condition. It also rejects always-on hook injection and success claims based primarily on tool sequence, validation-call ratio, or retry counts.

## Revised method

A proposed rule is treated as a policy candidate. Before promotion it needs:

- an explicit synthesized rule;
- at least three distinct correction occurrences;
- review of same-scope divergent rules;
- at least three passing replay cases;
- one unchanged deterministic verifier across paired samples;
- no candidate quality regression;
- a measured token, latency, or verified-quality benefit;
- a separate passing canary.

External-write and high-risk rules require approval.

## Privacy boundary

Raw correction text is used only in memory for signal detection. The candidate store contains a correction evidence hash and synthesized rule, not the raw message, session identifier, private path, or hidden reasoning. Research export removes rule text and evidence hashes and uses participant-salted HMAC pseudonyms.

## Interpretation boundary

A promoted candidate is evidence that one rule helped on its measured replay and canary set. It is not evidence of general cognitive improvement, agent individuation, self-awareness, or universal transfer.
