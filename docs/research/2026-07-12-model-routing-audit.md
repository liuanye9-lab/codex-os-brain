# Brain Lite 1.1 routing thin-spot audit

Date: 2026-07-12

## Scope and source gate

This audit accepts only primary 2026 papers and GitHub repositories whose live GitHub API star count exceeded 10,000 at review time. Star counts are a popularity filter, not evidence of correctness.

| Project | Stars at review | Relevant pattern | Decision |
|---|---:|---|---|
| [LiteLLM](https://github.com/BerriAI/litellm) | 53,270 | Explicit retries, fallbacks, cooldowns, cost and usage tracking | Adopt bounded infrastructure retry/fallback and route cooldown; do not import the gateway |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 37,050 | Durable execution, checkpoints, idempotent replay | Adopt event IDs, attempt state and resumable ledger semantics; do not add a graph runtime |
| [AutoGen](https://github.com/microsoft/autogen) | 59,658 | Max-message, token-usage and timeout termination conditions | Adopt hard attempt, escalation and wall-time budgets |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | 27,815 | Traces, spans, filtered handoffs and guardrails | Adopt trace IDs, minimal task packets and verifier-gated acceptance; keep native Codex execution |
| [TensorZero](https://github.com/tensorzero/tensorzero) | 11,690 | Feedback-linked evaluations, experimentation and replay | Adopt immutable policy versions and distinct representative samples; defer A/B automation until enough data exists |
| [CrewAI](https://github.com/crewAIInc/crewAI) | 55,354 | Role-based multi-agent crews | Do not adopt: fixed roles and extra coordination are unnecessary for the current native-first target |

## 2026 routing papers

- [TwinRouterBench](https://arxiv.org/abs/2605.18859): route decisions should be evaluated on router-visible intermediate trajectories and final execution success, using deterministic scoring where possible.
- [SWE-Router](https://arxiv.org/abs/2607.00053): a cheap model's bounded exploratory trajectory can reveal difficulty that the initial task description cannot.
- [Budget-Aware Agentic Routing](https://arxiv.org/abs/2602.21227): long-horizon routing is sequential and path-dependent, so each task needs an explicit budget rather than an unconstrained escalation loop.
- [Agent-as-a-Router](https://arxiv.org/abs/2606.22902): routing improves when deployment feedback closes a context-action-feedback loop through an orchestrator, verifier and memory of execution-grounded results.

## Thin spots found in the baseline

1. A route could become stable after three repeats of the same sample rather than three distinct representative samples.
2. Append-only events had no idempotency key, so an automation retry could duplicate evidence.
3. Timeout existed per child, but there was no explicit total attempt/escalation budget or circuit-breaker state.
4. Terra/Luna trial routes were chosen from prompt features alone; there was no marked bounded-probe phase before escalation.
5. Trace and policy version fields existed in the schema but were not consistently populated.
6. Infrastructure failure was excluded from capability statistics, but repeated failures did not temporarily suppress an unavailable route.

## Accepted refinements

- Require three distinct task fingerprints for a `3/3 stable` classification. Repeated runs of one sample remain `accumulating`.
- Derive an `eventId` from trace, phase, route, attempt and outcome; append becomes idempotent without rewriting history.
- Add policy version, trace ID, phase, attempt, maximum attempts, maximum capability escalations and total wall-time budget to every delegated run.
- Mark low-cost trial routes as `probe` routes with a bounded evidence contract. The mother Agent evaluates the returned trajectory before continuing or escalating.
- Add a route-level circuit breaker only after repeated recent infrastructure failures. It changes availability, not capability classification, and expires automatically.
- Keep all changes deterministic, local and dependency-free. No global hook, gateway, graph engine, neural router or automatic Ultra orchestration is added.

## Deferred until evidence exists

- Automatic A/B traffic allocation.
- Learned neural or LLM-based routers.
- Step-level mid-run model swapping inside a single Codex child.
- Always-on traces containing prompts or tool payloads.
- A global hook for coverage. Reconsider only after at least 14 days if native coverage remains below 80%.
