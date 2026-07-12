# Codex Brain V3 — Think Loop Design

> Historical design record, preserved in de-identified form.

## Starting point

The observed failure was single-track persistence: after a task stalled, the agent kept modifying the same idea rather than revisiting assumptions or the desired outcome.

## Mechanism

- a short pre-action prompt for engineering-shaped requests: alternatives, cheapest path, and fallback;
- a Stop-hook detector for repeated stuck signals;
- a next-turn breakthrough checklist: backtrack, skip, reverse, decompose, question the goal, or switch tools;
- a proposed lesson and nightly-consolidation extension for recurring blind spots.

## Improvement sought

V3 added a specific intervention at the moment an unproductive loop became visible. The archived implementation record reported five offline synthetic cases passing across trigger, injection, and non-trigger scenarios.

## Limitation discovered

The design also documented harmless false positives during discussion of the loop itself. More importantly, the right reasoning posture depended on the task; a single checklist was not the right context for every request. That led to V4.
