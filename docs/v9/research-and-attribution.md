# Research and Open-Source Attribution

Reviewed on 2026-07-14. V9 adapts public design ideas; it does not copy private state or impersonate a project's maintainers.

## Open-source sources

| Source | Version or date | License | Adopted | Not copied |
|---|---|---|---|---|
| [384961890-ui/claude-brain](https://github.com/384961890-ui/claude-brain) | main reviewed 2026-07-14 | MIT | Lifecycle sensors, checkpoints, failure observation | Keyword-only scoring, transcript assumptions, personal state |
| [LangChain Open SWE](https://github.com/langchain-ai/open-swe) | main reviewed 2026-07-14 | MIT | Bounded task execution and review surfaces | Hosted service integration and product-specific orchestration |
| [Letta Code](https://github.com/letta-ai/letta-code) | main reviewed 2026-07-14 | Apache-2.0 | Durable state and explicit memory boundaries | Server architecture and implementation code |
| [OpenHands](https://github.com/OpenHands/OpenHands) | main reviewed 2026-07-14 | Repository metadata returned NOASSERTION | Action/observation separation and sandbox-oriented thinking | Code, branding, and deployment stack |
| [LangGraph](https://github.com/langchain-ai/langgraph) | main reviewed 2026-07-14 | MIT | Checkpoint and resumable-state concepts | Graph runtime and dependency |

No source code from these projects is included in V9. Their licenses and architectures were checked before adopting only generic concepts.

## 2026 papers and preprints

| Source | Version or date | License/status | Adopted | Not copied |
|---|---|---|---|---|
| [Real-world coding-agent failure study, arXiv:2605.29442](https://arxiv.org/abs/2605.29442) | 2026 preprint | Paper terms | Failure taxonomy and emphasis on constraint, intent, reporting, implementation, diagnosis, and overreach | Dataset contents and evaluation implementation |
| [Agent planning benchmark, arXiv:2606.04874](https://arxiv.org/abs/2606.04874) | 2026 preprint | Paper terms | Plan-state checks and explicit acceptance criteria | Benchmark implementation |
| [MemFail, arXiv:2605.26667](https://arxiv.org/abs/2605.26667) | 2026 preprint | Paper terms | Memory failure as a multi-mode reliability problem | Dataset and model internals |
| [Memex, arXiv:2603.04257](https://arxiv.org/abs/2603.04257) | 2026 preprint | Paper terms | Provenance-aware durable memory concepts | Retrieval implementation |
| [Less Context, arXiv:2606.10209](https://arxiv.org/abs/2606.10209) | 2026 preprint | Paper terms | Bounded context injection and silent fast path | Experimental code |
| [Why Reasoning Fails, arXiv:2601.22311](https://arxiv.org/abs/2601.22311) | 2026 preprint | Paper terms | Separate self-report from external verification | Evaluation artifacts |
| [Multi-agent coordination study, arXiv:2606.08340](https://arxiv.org/abs/2606.08340) | 2026 preprint | Paper terms | Avoid delegation without independent, verifiable advantage | Coordination implementation |
| [Memory poisoning study, arXiv:2606.04329](https://arxiv.org/abs/2606.04329) | 2026 preprint | Paper terms | Treat recalled content as evidence, not instruction | Attack artifacts |
| [Agent reliability synthesis, arXiv:2607.05775](https://arxiv.org/abs/2607.05775) | 2026 preprint | Paper terms | Layered verification and explicit uncertainty boundaries | Taxonomy text and figures |

The real-world study reports 20,574 sessions. The observed symptom distribution informed V9's priority order: constraint violations and intent errors first, then inaccurate completion reporting, faulty implementation, diagnosis, and overreach. This is design inference from the study, not a claim that V9 eliminates those failures.

## Resulting V9 differences

- Deterministic signals replace keyword-only confidence scores.
- Evidence IDs replace self-declared completion.
- Failure classes and signatures replace blind retries.
- Compaction recovery injects a bounded task checkpoint rather than a full transcript.
- Hooks, CLI, and MCP share one policy core.
- Public release uses a clean-room allowlist instead of sanitizing a private tree in place.
