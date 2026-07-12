# V2 — Honest Sleep Loop

> Historical design record, preserved in de-identified form.

## Starting point

V1 could retain context, but retention is not calibration. The V2 question was: how can an agent avoid sounding more certain than its evidence allows?

## Mechanism

The design separated online and offline work:

- online: confidence signals, fusion, adversarial probe, then answer, hedge, or ask;
- offline: revisit memory, re-evaluate confidence, then promote, mark uncertain, or review.

It proposed five evidence sources: verbal confidence, consistency across runs, cross-model agreement, provider probability signals where available, and historical calibration. A nightly consolidation loop would revisit memory rather than treating every write as permanent truth.

## Improvement sought

The improvement was a new decision boundary: self-report could not by itself count as reliable evidence. The system should either verify, hedge, or request more information.

## Limitation discovered

The archival record distinguishes finished protocol/scaffolding from roadmap items. It was not a completed universal calibration system, and a more honest agent could still persist with a bad local search path. That led to V3.
