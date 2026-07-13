# Behavioral Memory Audit Record

## Architecture review

The supplied implementation fit V8's native-first direction: it reused Context Economy, Policy Lab, Skill Lifecycle, and Trace V2 instead of introducing an autonomous manager or daemon. Its safe core was the candidate lifecycle and text-free export. The audit found missing defenses at the edges—quoted-text false positives, permissive host arrays, corrupt-store overwrite risk, no lost-update detection, no explicit CLI promotion boundary, weak export salts, and no behavioral trace event.

The resulting design remains disabled by default. It is a sensor-to-candidate pipeline, not an always-on policy engine.

## Findings and changes

| Area | Initial risk | Implemented boundary |
|---|---|---|
| Detection | Quoted examples, ambient blocks, and tool-result text could look like a correction. | Strip fenced/blockquote content and known ambient blocks; accept only known text block types; cap input at 32,768 characters. |
| Candidate merge | Duplicate evidence needed to remain non-inflating; divergent same-scope rules needed review. | Retained evidence-hash dedupe and conflict review; tests cover both. Candidate IDs remain content-derived. |
| Storage | Invalid JSON could be overwritten and concurrent writers could lose updates. | Preserve corruption, exclusive sibling lock, monotonic revision, stale-write error, private modes where supported. |
| Replacement | Replacing an existing file can fail on Windows. | Same-directory rename first; backup/install/restore fallback for Windows replacement errors. |
| Evidence gate | Evaluation could reach canary, but explicit operational approval was not exposed. | Dedicated `approve-canary --confirm-canary`; ordinary commands cannot promote; no-benefit samples remain replay. |
| Trace | No behavioral lifecycle event existed. | Deterministic Trace V2 event with allowlisted action/state and HMAC candidate reference only. |
| Export | Length-only salt validation allowed weak descriptive or repeated salts. | Minimum 32 characters, basic entropy/phrase rejection, strict row allowlist, recursive leakage test. |
| Recall | Promoted-only cap existed but utilization adapter and leakage regression were missing. | Dedup/redaction regression, ≤300 tokens, ≤2 items, and validated Context Economy use marking. |

## Baseline note

The first full baseline ran 105 tests: 104 passed and one integration assertion failed. The implementation correctly delegated syntax checks through `npm run check:behavioral-memory`, while the test incorrectly required the parent script text to contain a behavioral source filename. The assertion was changed to verify the documented command contract; no production behavior was changed for that correction.

## Remaining limits

- Correction detection is conservative pattern matching, not semantic proof that a reusable rule exists.
- The file lock is local and exclusive, not distributed; a crash can leave a stale lock requiring inspection.
- The Windows replacement fallback is recoverable but cannot provide the same replacement atomicity guarantee as POSIX rename on every filesystem.
- HMAC unlinkability depends on callers generating, protecting, and rotating strong salts/keys.
- Passing three paired samples and one canary supports only the measured task family; it is not evidence of universal improvement.
- The feature has not earned always-on activation. Host adapters and hooks remain disabled.
- Fresh local verification used Node.js 26.3.0. The code remains CommonJS and declares Node.js 20+, but a separate Node.js 20 runtime run was not available in this environment and should be added to CI before broader trial.

## Fresh verification evidence

Run on 2026-07-13 from the isolated public checkout:

| Command | Result |
|---|---|
| `npm run test:behavioral-memory` | 44 tests, 44 passed, 0 failed. |
| `npm run check` | Syntax checks and V7 self-test passed; full suite 118 tests, 118 passed, 0 failed. |
| `node scripts/brain-lite-behavioral-memory-cli.js detect --host codex --text "You said it was fixed, but it still fails."` | `matched=true`, `trigger=false_success`, `severity=high`, `confidence=0.95`. |
| Public privacy scanner | Passed with zero findings. |

The temporary CLI smoke flow captured one rule through three distinct correction occurrences, confirmed zero recall before promotion, evaluated three paired samples under one fixed verifier, entered `canary`, required explicit approval, then recalled one promoted item at 59 estimated tokens. The text-free export contained one row, and a scan found none of the raw rule, scope, correction markers, session markers, or synthetic private path.

## Recommendation

Keep disabled by default. It is suitable for an explicit local canary after the host event contract and storage location are reviewed. Broader trial should wait for representative paired evidence showing quality is preserved and the recall benefit exceeds its context and maintenance cost.
