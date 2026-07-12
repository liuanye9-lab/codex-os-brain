# Codex Brain V7 — Evolution Gate

> Historical design record, preserved in de-identified form.

## Starting point

Research-inspired self-improvement is risky if it can directly modify long-lived memory, persona, runtime, or policy merely because an agent proposed it.

## Mechanism

V7 converted a proposed change into a reviewable candidate record. The gate requires relevant combinations of:

- human approval for sensitive core or memory changes;
- candidate-only memory writes until review;
- empirical verification for code/runtime changes;
- sandboxing for self-evolution;
- Fix Rate and related fields for long-horizon work;
- challenge plus verification roles for dual-brain proposals;
- an executable artifact boundary rather than prose-only claims.

The preserved path-neutral gate is in [scripts/evolution-gate.js](scripts/evolution-gate.js).

## Improvement sought

The key improvement was governance: unsafe proposals become reject_or_hold; evidence-backed proposals can become candidates. The gate does not claim that every candidate improves the system.

## Limitation discovered

V7 kept useful guardrails but the surrounding hook and injection stack imposed cost even when a modern coding model could succeed directly. This led to the current native-first policy: verification and safety stay, while memory, subagents, and automation are conditional.
