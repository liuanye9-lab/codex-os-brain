# Evidence-Gated Behavioral Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an optional, privacy-safe behavioral-memory layer that promotes user-correction rules only after replay and paired verification evidence.

**Architecture:** Add focused CommonJS modules beside the existing Brain Lite V8 scripts. Reuse Context Economy, Policy Lab, and Skill Lifecycle rather than creating a second scoring or promotion system. Keep host sensors and raw correction text disabled by default.

**Tech Stack:** Node.js 20+, CommonJS, `node:test`, JSON Schema, no runtime dependencies.

## Global Constraints

- Hooks and host sensors remain disabled by default.
- No raw prompt or correction text persistence by default.
- No causal claim from proxy behavior metrics.
- No auto-promotion of high-risk or external-write rules.
- Context recall budget defaults to 300 estimated tokens and 2 items.

---

### Task 1: Correction event normalization and detection

**Files:**
- Create: `scripts/brain-lite-host-event-normalizer.js`
- Create: `scripts/brain-lite-correction-detector.js`
- Test: `tests/brain-lite-behavioral-memory-detector.test.js`

**Interfaces:**
- Produces: `normalizeHostEvent(input, options) -> NormalizedHostEvent`
- Produces: `detectCorrection(text) -> CorrectionDetection`
- Produces: `stripInjectedContent(text) -> string`

- [ ] Write tests for supported host shapes, injected-block stripping, strong correction detection, weak-signal thresholds, false-success severity, and positive acknowledgement rejection.
- [ ] Run the detector test and confirm module-not-found failure.
- [ ] Implement the minimum normalizer and detector.
- [ ] Run the detector test and confirm all cases pass.

### Task 2: Candidate construction and atomic persistence

**Files:**
- Create: `scripts/brain-lite-behavioral-memory.js`
- Create: `scripts/brain-lite-candidate-store.js`
- Test: `tests/brain-lite-behavioral-memory-candidate.test.js`

**Interfaces:**
- Produces: `createCandidate(input) -> BehavioralCandidate`
- Produces: `mergeCandidate(existing, incoming) -> BehavioralCandidate`
- Produces: `upsertCandidate(filePath, candidate) -> { candidate, disposition }`

- [ ] Write tests for needs-synthesis candidates, explicit-rule candidates, deduplication, repeated occurrence counts, evidence hash uniqueness, and same-scope conflict review.
- [ ] Run the candidate test and confirm failure.
- [ ] Implement candidate and store modules with atomic private writes.
- [ ] Run the candidate test and confirm all cases pass.

### Task 3: Evidence-gated evaluation and recall

**Files:**
- Create: `scripts/brain-lite-behavioral-policy.js`
- Create: `scripts/brain-lite-behavioral-context.js`
- Test: `tests/brain-lite-behavioral-memory-policy.test.js`

**Interfaces:**
- Consumes: existing `evaluatePolicyExperiment`, `transitionSkill`, `validateLifecycleEvidence`, and `buildContextPacket`.
- Produces: `evaluateBehavioralCandidate(candidate, samples, policy) -> BehavioralCandidate`
- Produces: `buildBehavioralContextPacket(candidates, options) -> ContextPacket`

- [ ] Write tests for insufficient occurrences, verifier drift, failed candidate quality, stable paired benefit, lifecycle eligibility, and promoted-only recall.
- [ ] Run the policy test and confirm failure.
- [ ] Implement evaluation and context adapters.
- [ ] Run the policy test and confirm all cases pass.

### Task 4: Privacy-safe export and schemas

**Files:**
- Create: `scripts/brain-lite-behavioral-privacy-export.js`
- Create: `schemas/behavioral-memory-candidate.schema.json`
- Test: `tests/brain-lite-behavioral-memory-privacy.test.js`

**Interfaces:**
- Produces: `sanitizeCandidate(candidate, salt) -> ResearchRow`
- Produces: `buildPrivacyExport(candidates, salt) -> object`

- [ ] Write leakage tests containing secret rule text, paths, session IDs, evidence hashes, timestamps, and PID-like IDs.
- [ ] Run the privacy test and confirm failure.
- [ ] Implement HMAC pseudonymization and strict field whitelist.
- [ ] Run the privacy test and confirm all cases pass.

### Task 5: Integration surface and documentation

**Files:**
- Create: `scripts/brain-lite-behavioral-memory-cli.js`
- Modify: `config/brain-lite-v8.json`
- Modify: `package.json`
- Create: `docs/research/2026-07-13-evidence-gated-behavioral-memory.md`
- Create: `INTEGRATION.md`

**Interfaces:**
- CLI commands: `detect`, `capture`, `evaluate`, `approve-canary`, `recall`, `export`.

- [ ] Add CLI smoke tests and syntax checks.
- [ ] Add disabled-by-default configuration and local data paths.
- [ ] Document integration boundaries, A/B methodology, and rejected upstream mechanisms.
- [ ] Run all tests and syntax checks.

### Task 6: Packaging and repository handoff

**Files:**
- Create: `CODEX_CODING_PROMPT.md`
- Create: `UPSTREAM_ATTRIBUTION.md`
- Package: `codex-os-brain-behavioral-memory-v1.zip`
- Package: `claude-brain-reusable-extracts.zip`

- [ ] Copy only reusable MIT upstream files with original license and source notes.
- [ ] Exclude `efficacy.js` and behavioral proxy scoring from integration recommendations.
- [ ] Generate a patch-oriented integration archive and complete Codex prompt.
- [ ] Run fresh full verification, inspect archive contents, and record hashes.
