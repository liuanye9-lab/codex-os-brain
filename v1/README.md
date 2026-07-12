# V1 — Storage Brain to Identity Brain

> Historical design record, preserved in de-identified form.

## Starting point

The earliest exploration treated persistent context as the core problem. A long coding session could lose the active goal, repeat a correction, or forget a decision made only a few turns earlier.

## Mechanism

- a small set of Markdown state and lesson files rather than a large opaque store;
- a lightweight index for recall;
- conditional session-start context injection;
- a Stop-hook lesson capture path for corrections and recurring failure signals;
- an activity-state update path.

## Improvement sought

V1 moved important information from transient chat history into inspectable local artifacts. The useful change was persistence and traceability, not a claimed accuracy score.

## Limitation discovered

Always pushing context toward the agent did not establish whether its confidence was justified. It could preserve a mistaken belief as faithfully as a correct one. That led to V2.

## Historical boundary

The original V1 had no standalone v1 directory; this record preserves its original changelog-level design outline. Machine paths, runtime configuration, and private lesson data are intentionally absent.
