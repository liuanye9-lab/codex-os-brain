# From Heavy Harness to Measured Augmentation

## Research question

Does routed subagent work improve verified outcomes enough to justify its cost, and what should happen when the user request is too vague to recover the intended contract?

## Evaluation A: clear, verifier-gated coding work

Three synthetic coding tasks covered boundary repair, multi-file rollup and constrained assignment. The parent used the same Terra-high setting in both conditions. The routed condition added two read-only children selected by the deterministic router; all outcomes required public tests, immutable-file checks and an external hidden checker.

| Condition | Verified pass rate | Median input plus output tokens | Median end-to-end time |
|---|---:|---:|---:|
| Parent only | 3/3 | 80,474 | 43.714 s |
| Routed children | 3/3 | 224,312 | 78.929 s |

When the task was already clear and the parent model crossed the quality line, routing added no verified quality and increased median token use by 178.7% and latency by 80.6%.

## Evaluation B: vague request without observable evidence

The same tasks received only a vague request referring to an earlier problem. Source code and public tests were available, but public tests initially passed and the actual defects were only exposed by the external checker.

| Condition | Verified pass rate | Median input plus output tokens | Median end-to-end time |
|---|---:|---:|---:|
| Parent only | 0/3 | 93,411 | 43.520 s |
| Routed children | 0/3 | 251,834 | 94.000 s |

Both conditions found partial code-level intent but missed undisclosed contract rules. The routed condition added 169.6% median token use and 116.0% latency without recovering the missing information.

## Resulting policy

The framework now has a deterministic clarification gate. When a request is marked vague and lacks all of the following, it returns `mother-clarify` rather than dispatching child agents:

- an observable symptom;
- a failing command or log;
- a reproduction;
- a relevant file scope; or
- relevant prior context.

The parent asks for one of those signals in the user’s language. Once a concrete signal exists, normal native-first routing resumes. This is not an always-on hook and does not invoke a model by itself.

## Interpretation boundary

These are exploratory paired samples, not a universal model ranking. They support a narrower conclusion: orchestration should be conditional on evidence and task structure. More agents cannot reliably infer business rules that were never supplied, and stronger models reduce the need for persistent harness control on ordinary work.
