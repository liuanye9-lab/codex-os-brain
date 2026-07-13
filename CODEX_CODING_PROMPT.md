# Codex Coding Prompt: Audit and Optimize Evidence-Gated Behavioral Memory

Work in `liuanye9-lab/codex-os-brain` on branch `feat/evidence-gated-behavioral-memory`.

## First actions

Read `README.md`, `v8/DESIGN.md`, `INTEGRATION.md`, the behavioral-memory research note, all new behavioral scripts, and all `tests/brain-lite-behavioral-memory-*.test.js` files. Then run:

```bash
npm install
npm run check
npm run test:behavioral-memory
```

Record exact baseline output before editing.

## Non-negotiable constraints

- Keep hooks and behavioral memory disabled by default.
- Host adapters are sensor-only; they cannot change parent budgets, routing, writes, verifier acceptance, or final delivery.
- Do not persist raw prompts, raw corrections, session IDs, private paths, credentials, or hidden reasoning.
- Do not describe tool-use heuristics or correlations as causal efficacy.
- Do not promote after one correction.
- Do not auto-promote external-write or high-risk rules.
- Only promoted, conflict-free rules may enter Context Economy.
- Preserve the 300-token and 2-item behavioral recall caps unless a measured experiment justifies changing them.
- Keep Node.js 20 compatibility, CommonJS, and zero new runtime dependencies unless strictly necessary.

## Audit targets

1. Correction false positives: injected blocks, quoted text, positive acknowledgements, malformed host events, mixed Chinese/English, and regex performance.
2. Candidate identity: duplicate evidence must not inflate occurrences; different rules must not merge merely because scopes match; IDs must not encode time, PID, session, or identity.
3. Storage: corrupted JSON must fail safely; document or improve the single-writer model; detect lost updates; account for Windows atomic replacement behavior.
4. Evidence gate: fixed verifier hash, unique sample IDs, quality floor, critical-failure revocation, replay and occurrence thresholds, explicit canary approval, and risk approval.
5. Privacy export: recursively test for nested text leakage; no rule, scope, hashes, timestamps, session IDs, paths, PID-like raw IDs, or sample payloads.
6. Context recall: promoted-only, conflict-free, deduplicated, redacted, and hard-capped.

## Required method

Use strict TDD for every behavior change:

1. add one focused failing test;
2. run it and confirm the expected failure;
3. implement the smallest change;
4. run the focused test;
5. run `npm run test:behavioral-memory`;
6. commit a small coherent change.

## Improvements to implement when missing

- corrupted-store protection without overwriting the source;
- revision or lost-update detection;
- recursive privacy leakage tests;
- quoted/injected-content false-positive tests;
- Windows-safe atomic-write fallback or explicit limitation;
- an allowlisted behavioral-memory trace event using pseudonymous references only;
- an A/B fixture where no measured benefit remains trial/replay;
- an explicit canary approval CLI/library path that ordinary capture/evaluate cannot trigger;
- documentation of locking or the single-writer contract.

Reuse existing V8 modules: `brain-lite-common.js`, `brain-lite-context-economy.js`, `brain-lite-policy-lab.js`, `brain-lite-skill-lifecycle-v2.js`, and `brain-lite-trace-v2.js`. Do not build an always-on daemon or duplicate those systems.

## Final verification

Run fresh:

```bash
npm run test:behavioral-memory
npm run check
node scripts/brain-lite-behavioral-memory-cli.js detect --host codex --text "You said it was fixed, but it still fails."
```

Also run a temporary-directory smoke flow: capture three distinct corrections for one read-only rule; prove candidate recall is empty; add three passing replays; evaluate three paired samples with one verifier; explicitly approve canary; prove promoted recall stays within caps; export with a random salt; scan the export for raw rule, scope, correction text, session ID, and path.

Return architecture findings, files changed, exact test evidence, remaining limitations, and one recommendation: keep disabled, local canary, or broader trial. Do not claim completion without fresh command evidence.
