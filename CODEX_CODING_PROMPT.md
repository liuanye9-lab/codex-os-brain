# Codex Coding Prompt: Audit and Optimize Evidence-Gated Behavioral Memory

You are working in the `codex-os-brain` repository. A feature branch named `feat/evidence-gated-behavioral-memory` contains an initial implementation of optional behavioral memory for V8.

Your job is to audit, improve, and verify this implementation. Do not rewrite the project around a new framework. Preserve V8's native-first philosophy.

## First actions

1. Read:
   - `README.md`
   - `v8/DESIGN.md`
   - `INTEGRATION.md`
   - `docs/research/2026-07-13-evidence-gated-behavioral-memory.md`
   - `docs/superpowers/specs/2026-07-13-evidence-gated-behavioral-memory-design.md`
   - `docs/superpowers/plans/2026-07-13-evidence-gated-behavioral-memory.md`
2. Inspect all files matching:
   - `scripts/brain-lite-behavioral-*`
   - `scripts/brain-lite-candidate-store.js`
   - `scripts/brain-lite-correction-detector.js`
   - `scripts/brain-lite-host-event-normalizer.js`
   - `tests/brain-lite-behavioral-memory-*.test.js`
3. Run the unmodified baseline:

```bash
npm install
npm run check
npm run test:behavioral-memory
```

Record exact pass/fail output before editing.

## Non-negotiable constraints

- Keep `hooks.enabled=false` and `behavioralMemory.enabled=false` by default.
- Host adapters are sensor-only. They may observe and normalize events but may not change parent budgets, routing, writes, verifier acceptance, or final delivery.
- Do not persist raw prompts, raw correction text, session IDs, private paths, credentials, or hidden reasoning.
- Do not call tool-use heuristics, session proxy scores, or correlations "causal efficacy".
- Do not automatically promote a rule after one correction.
- Do not auto-promote external-write or high-risk rules.
- Only `promoted`, conflict-free rules may enter Context Economy.
- Keep behavioral recall bounded to at most 300 estimated tokens and 2 items unless a measured experiment justifies another limit.
- Do not add runtime dependencies unless there is a demonstrated need that cannot be met with Node.js built-ins.
- Preserve Node.js 20 compatibility and CommonJS conventions used by the repository.

## Required audit

Review the current implementation for:

1. **False-positive correction detection**
   - injected control blocks;
   - quoted text;
   - positive acknowledgements;
   - mixed Chinese and English messages;
   - regex denial-of-service risk;
   - host content arrays and malformed events.

2. **Candidate identity and merging**
   - repeated identical evidence must not inflate occurrence counts;
   - semantically different rules must not merge merely because scopes match;
   - same-scope divergent rules must remain reviewable;
   - candidate IDs must not encode timestamps, PID, session IDs, or user identity.

3. **Storage safety**
   - atomic writes on Windows, macOS, and Linux;
   - file mode behavior where POSIX modes are unsupported;
   - corrupted JSON recovery must fail safely and preserve the original file;
   - concurrent writers must not silently lose data. If robust locking is out of scope, document the single-writer contract and add a detectable revision field.

4. **Evidence gate correctness**
   - fixed verifier hash across paired samples;
   - unique sample IDs;
   - candidate quality floor;
   - critical-failure revocation;
   - minimum occurrences and replay passes;
   - canary approval remains explicit;
   - external-write and high-risk candidates require approval.

5. **Privacy export**
   - no rule text, scope text, rule hash, evidence hash, exact timestamp, session ID, path, PID-like raw ID, sample payload, or free text;
   - HMAC pseudonyms are stable inside one study salt and unlinkable across different salts;
   - reject missing or weak salts;
   - add a recursive leakage test with nested secret values.

6. **Context integration**
   - promoted-only recall;
   - conflict-free recall;
   - deduplication;
   - 300-token and 2-item hard caps;
   - no secret leakage through rule content after `redactSensitive`;
   - utilization can be marked through the existing Context Economy API.

## Implementation method

Use strict test-driven development for every behavior change:

1. add one focused failing test;
2. run it and confirm the expected failure;
3. implement the smallest change;
4. run the focused test;
5. run `npm run test:behavioral-memory`;
6. commit a small coherent change.

Do not modify tests merely to fit the current implementation. Change a test only when the written design is internally inconsistent, and document that decision.

## Required improvements

Implement the following if the audit confirms they are missing:

- safe corrupted-store handling with a clear error and no overwrite;
- store revision number or equivalent lost-update detection;
- recursive export leakage test;
- quoted/injected-content false-positive tests;
- Windows-safe atomic replacement strategy or documented fallback;
- a deterministic `behavioral-memory` trace event that stores only allowlisted metadata and pseudonymous candidate reference;
- an A/B fixture showing a rule with no measured benefit remains in trial/replay rather than being promoted;
- a CLI command or library function for explicit canary approval that cannot be triggered by ordinary capture/evaluate commands;
- documentation of the single-writer or locking model.

## Repository integration

Do not duplicate existing V8 modules. Reuse:

- `brain-lite-common.js`
- `brain-lite-context-economy.js`
- `brain-lite-policy-lab.js`
- `brain-lite-skill-lifecycle-v2.js`
- `brain-lite-trace-v2.js` where appropriate.

Keep each new file focused. Avoid a single large manager class or an autonomous hook daemon.

## Final verification

Run fresh, complete commands:

```bash
npm run test:behavioral-memory
npm run check
node scripts/brain-lite-behavioral-memory-cli.js detect --host codex --text "You said it was fixed, but it still fails."
```

Also perform one temporary-directory smoke flow:

1. capture one explicit read-only rule;
2. confirm it is not recalled while still a candidate;
3. evaluate three paired samples with one fixed verifier;
4. explicitly approve a passing canary;
5. confirm it is recalled within the context cap;
6. export with a random salt;
7. scan the export for the raw rule, scope, correction text, session ID, and file path and confirm none appear.

## Deliverables

Return:

- a concise architecture review;
- files changed and why;
- exact test commands and outputs;
- remaining limitations;
- any result that prevents the feature from being safely enabled;
- a final recommendation: keep disabled, enable for local canary, or eligible for broader trial.

Do not claim completion without fresh command evidence.
