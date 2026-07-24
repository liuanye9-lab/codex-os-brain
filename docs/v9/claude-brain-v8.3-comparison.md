# Claude Brain v8.3 clean-room comparison

Reviewed on 2026-07-25:

- Source: [`384961890-ui/claude-brain`](https://github.com/384961890-ui/claude-brain)
- Reviewed branch/release description: `main`, README version 8.3
- License: MIT
- Method: public README, repository tree, design documents, scripts, and license were reviewed as evidence. No upstream source code is copied into Codex Brain.

## What the comparison changed

| Claude Brain mechanism | Codex Brain decision | Local implementation | Verification |
|---|---|---|---|
| Hook-based orthogonal loops | Keep the failure-mode separation, but share one small core across hooks, CLI, and MCP | `scripts/v9/core.js`, `scripts/v9/hooks/` | `tests/brain-v9-cross-surface.test.mjs`, `tests/brain-v9-hooks.test.js` |
| File-native temporal graph | Keep time as a first-class retrieval boundary; use transactional SQLite rather than making files the authoritative runtime store | `scripts/v9/memory-service.js`, `scripts/v9/memory-db.js` | `tests/brain-v9-memory-service.test.js` |
| Grep → embeddings → reranking | Keep the cheapest trustworthy tier first; use FTS5 with optional exact local vectors and explicit degraded state | `scripts/v9/memory-service.js`, `scripts/v9/embeddings.js` | `tests/brain-v9-memory-service.test.js`, `tests/brain-v9-embeddings.test.js` |
| Correction capture and lesson lifecycle | Keep candidate-first learning; never auto-promote corrections into confirmed memory or policy | `scripts/brain-lite-behavioral-memory.js`, `scripts/v9/memory-harness.js` | behavioral-memory and memory-harness tests |
| Efficacy attribution | Retain as observational evidence only; never label correlation as causal benefit | `scripts/brain-lite-outcome-attribution.js` | `tests/brain-lite-v8-outcome-attribution.test.js` |
| Self-test and loud retrieval failure | Make public interfaces discoverable and release checks executable | `brain --help`, `brain doctor`, `npm run check` | CLI, MCP, release, and public-export tests |

## Deliberately not copied

- Upstream code, branding, cover composition, private memory, user profiles, and host-specific state.
- A default always-on graph or model service.
- Automatic lesson or policy promotion.
- Claims that session outcomes prove a lesson caused improvement.
- A “final framework” posture. Codex Brain keeps mechanisms replaceable and evidence-gated.

## New defects found by the comparison

The 2026-07-25 review exposed three public-surface failures in this repository:

1. MCP memory recall still called removed V8-style methods.
2. Memory validity columns existed, but lexical and vector recall did not enforce them.
3. Documentation advertised obsolete memory commands and an incorrect Node.js floor.

Version 0.11 fixes these defects and adds tests that fail if the governed search path, temporal boundary, or MCP sanitization drifts again.

## Boundary

This comparison supports mechanism selection and regression testing. It does not prove broad real-world productivity improvement. The bundled reliability eval is a deterministic mechanism suite for false completion, looping, overreach, and hot-path latency; it is not a controlled user study.
