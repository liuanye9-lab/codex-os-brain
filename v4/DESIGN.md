# Codex Brain V4 — Mode Router Design

> Historical design record, preserved in de-identified form.

## Starting point

An agent could know an engineering principle in the abstract, then drop it under pressure and optimize only the nearest local task.

## Mechanism

A lightweight deterministic router chose one short operating frame:

| Mode | Intended use |
|---|---|
| owner | architecture, memory, automation, and long-term system integrity |
| operator | shortest verified path for an execution task |
| reviewer | evidence and risks before summary |
| coach | make unclear work actionable without unnecessary questioning |

## Improvement sought

Instead of injecting a long persona or management prompt every turn, V4 selected a narrow posture from explicit signals. It was designed to guide actions, not create facts or mutate memory.

## Limitation discovered

The router was text-bound. It did not preserve a screenshot or document as future evidence, and therefore could not resolve later questions about material outside the current chat. That led to V5.
