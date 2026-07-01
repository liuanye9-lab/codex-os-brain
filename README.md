# Agentic Coding OS Brain (ACOB)

> A local-first cognitive operating layer for Codex: memory, self-evolution, multi-agent dispatch, verification, tool reliability, and an observable dashboard.

![runtime](https://img.shields.io/badge/runtime-local--first-2f855a)
![memory](https://img.shields.io/badge/memory-5--layer--architecture-2563eb)
![evolution](https://img.shields.io/badge/self--evolution-revert--on--regression-7c3aed)
![privacy](https://img.shields.io/badge/privacy-public--safe-c53030)
![verification](https://img.shields.io/badge/anti--hallucination-4--layer-e5a00d)
![drift](https://img.shields.io/badge/anti--drift-AAAI--2026-0ea5e9)
![version](https://img.shields.io/badge/harness-v4.0-111827)

Agentic Coding OS Brain (ACOB) turns Codex from a powerful chat-style coding agent into a governed agentic coding system.

**v4.0** adds a research-backed cognitive harness: five-layer memory architecture (Letta + Mem0 + Zep), four-layer anti-hallucination protocol (Chain-of-Verification + Guardian sub-agent), anti-drift protocol (AAAI 2026), token budget allocation, and Evolving Playbook with revert-on-regression. Based on analysis of 16 open-source frameworks and 27 academic papers. See [Agent Harness v4.0](docs/AGENTS_v4_HARNESS.md) for the full operating manual.

It is not a prompt pack. It is a local harness that adds:

- bounded working context
- governed long-term memory
- self-evolution candidates with approval gates
- ROI-gated sub-agent dispatch
- verification-before-completion
- tool-call reliability checks
- privacy scanning
- a local dashboard for observable system state

In plain language:

> Codex is the engine. ACOB is the operating system around it: memory, routing, safety rails, feedback loops, and a dashboard.

## Visual Overview

ACOB is designed as a small public harness, not a private data dump. The public package explains the operating pattern, ships reusable runtime pieces, and keeps personal memory outside the repository.

```mermaid
flowchart LR
  Codex["Codex<br/>coding engine"] --> ACOB["ACOB<br/>local operating layer"]
  ACOB --> Focus["bounded context"]
  ACOB --> Memory["governed memory"]
  ACOB --> Agents["ROI-gated agents"]
  ACOB --> Verify["verification gate"]
  ACOB --> Privacy["privacy scan"]
  ACOB --> Dashboard["observable dashboard"]

  Focus --> Outcome["safer coding loop"]
  Memory --> Outcome
  Agents --> Outcome
  Verify --> Outcome
  Privacy --> Outcome
  Dashboard --> Outcome
```

### Leaf Agent Mascot Layer

The Leaf Agent is the public mascot layer used to make the system easier to understand in demos, docs, and visual explanations.

| IP signal | Public meaning |
|---|---|
| Black long hair | calm, steady, readable agent presence |
| Leaf motif | memory, growth, pruning, and renewal |
| Gentle operator temperament | helpful by default, but grounded in verification |
| Not a data source | mascot identity never grants access to private memory |

The mascot is a communication layer. The actual product value comes from the local runtime, privacy boundaries, verification checks, and public-safe memory workflow.

## v4.0 Cognitive Harness Architecture

v4.0 introduces a research-backed cognitive operating layer inspired by how human cognition works — observable, bounded, evidence-driven, and approval-gated. Designed after analyzing 16 open-source agent frameworks (Letta/MemGPT, Mem0, Zep, Cognee, Cline, Claude Code, Codex CLI, and others) and 27 academic papers on hallucination, drift, memory, and context engineering.

### Five-Layer Memory Architecture

The agent manages its own memory like an OS manages virtual memory — actively paging information in and out across five tiers, not passively waiting for framework injection.

```mermaid
flowchart TB
  subgraph L1["L1 · Rules (Immutable)"]
    direction LR
    ID["Identity"]
    SOUL["Soul"]
    AGENTS["Agents Config"]
  end

  subgraph L2["L2 · Profile (Capped 200 lines)"]
    direction LR
    USER["User Prefs"]
    MEM["Core Memory"]
    ENV["Environment"]
  end

  subgraph L3["L3 · Working Memory (Session)"]
    direction LR
    TODO["TodoList"]
    CTX["Conversation"]
    FILES["Active Files"]
  end

  subgraph L4["L4 · Episodic (Temporal)"]
    direction LR
    DAILY["Daily Logs"]
    DECISION["Decision Records"]
    VALID["valid_at / invalid_at"]
  end

  subgraph L5["L5 · Semantic (Vector)"]
    direction LR
    VEC["Embedding Index"]
    KG["Knowledge Graph"]
    CONF["Confidence Scores"]
  end

  L1 -->|"session bootstrap"| L2
  L2 -->|"active context"| L3
  L3 -->|"recursive summary"| L4
  L4 -->|"fact extraction + dedup"| L5
  L5 -->|"retrieval on demand"| L3

  style L1 fill:#1a1a2e,stroke:#e94560,color:#fff
  style L2 fill:#16213e,stroke:#0f3460,color:#fff
  style L3 fill:#0f3460,stroke:#533483,color:#fff
  style L4 fill:#533483,stroke:#e94560,color:#fff
  style L5 fill:#2b2d42,stroke:#8d99ae,color:#fff
```

Key innovations from research:

| Mechanism | Source | What It Does |
|---|---|---|
| Virtual memory paging | Letta/MemGPT | Agent actively decides what to remember and forget |
| Temporal validity windows | Zep | Facts have `valid_at` / `invalid_at` timestamps |
| Atomic fact extraction | Mem0 | Deduplicates and merges before writing to memory |
| Confidence scoring | AgentMemory | Each memory scored 0-1, low-confidence downweighted |
| Importance decay | EvolveMem | Unreferenced memories naturally lose retrieval rank |
| 200-line hard cap | Claude Code | Forces active curation instead of unbounded growth |

### Anti-Hallucination Protocol (4 Layers)

Hallucination happens when models fabricate plausible-sounding answers rather than admit uncertainty. The defense is layered.

```mermaid
flowchart LR
  subgraph L1H["Layer 1 · Chain-of-Verification"]
    GEN["Generate answer"] --> VQ["Generate verification questions"]
    VQ --> AV["Answer independently"]
    AV --> REV["Revise if needed"]
  end

  subgraph L2H["Layer 2 · Guardian Sub-Agent"]
    ACT["Proposed action"] --> GA["Guardian assesses safety"]
    GA --> SAFE{"Safe?"}
    SAFE -->|"yes"| EXEC["Execute"]
    SAFE -->|"no"| BLOCK["Block + reason"]
  end

  subgraph L3H["Layer 3 · Confidence Tagging"]
    HIGH["High: file/test evidence → assert"]
    MED["Medium: memory-based → hedge"]
    LOW["Low: speculation → declare uncertain"]
  end

  subgraph L4H["Layer 4 · Memory Freshness"]
    CHECK["Check valid_at / invalid_at"]
    STALE["30+ days unverified → downgrade"]
  end

  L1H --> L2H --> L3H --> L4H
```

Layer 1 (Chain-of-Verification) is the lowest-cost defense: generate → verify → revise, all within one model call. Layer 2 (Guardian sub-agent from Codex CLI) is reserved for destructive operations. Layers 3-4 are metadata-level and add near-zero token cost.

### Anti-Drift Protocol (4 Mechanisms)

AAAI 2026 research found that goal drift comes primarily from **pattern-matching prior conversation context**, not from forgetting instructions. The fix targets the root cause.

```mermaid
flowchart TB
  subgraph M1["Mechanism 1 · Identity Re-Read"]
    NEW["New task or topic"] --> READ["Re-confirm identity + rules + state"]
    READ --> ACT["Act from rules, not conversation inertia"]
  end

  subgraph M2["Mechanism 2 · Periodic Goal Check"]
    TURNS["Every 10 turns"] --> ASK["Is my goal still the user's goal?"]
    ASK --> DRIFT{"Drifted?"}
    DRIFT -->|"no"| CONT["Continue"]
    DRIFT -->|"yes"| REALIGN["Realign or confirm with user"]
  end

  subgraph M3["Mechanism 3 · Rule Priority"]
    P1["1. User's explicit instruction (highest)"]
    P2["2. Soul (personality baseline)"]
    P3["3. Agents (action rules)"]
    P4["4. Memory (long-term facts)"]
    P5["5. Implicit context hints (lowest)"]
    P1 --> P2 --> P3 --> P4 --> P5
  end

  subgraph M4["Mechanism 4 · Milestone Re-Anchoring"]
    DONE["Sub-goal completed"] --> CONFIRM["Is overall goal still clear?"]
    CONFIRM --> NEXT["Does next step serve original goal?"]
  end

  M1 --> M2 --> M3 --> M4
```

### Token Budget Allocation

Context window managed as a budget, not an infinite buffer.

```mermaid
pie title Context Window Budget
    "Identity & Rules (L1+L2)" : 20
    "Recent Context (5 turns)" : 30
    "Retrieved Knowledge" : 30
    "Working Space" : 20
```

When conversation exceeds 70% of budget, recursive summarization kicks in (Cline pattern): preserve last 5 turns full, generate structured summary for older turns retaining user goals, agent actions, outputs, errors, and key decisions.

### Evolving Playbook + Revert-on-Regression

Self-improvement without the risk of unstable automatic rewrites.

```mermaid
flowchart LR
  subgraph Playbook["ACE Evolving Playbook"]
    TRACE["Task trace"] --> GEN["Generator: what happened"]
    GEN --> REF["Reflector: what worked / failed"]
    REF --> CUR["Curator: append delta only"]
    CUR --> HANDBOOK["Behavior handbook"]
  end

  subgraph Revert["Revert-on-Regression"]
    CHANGE["New rule applied"] --> OBS["Observe 3-5 similar tasks"]
    OBS --> REG{"Regression?"}
    REG -->|"no"| KEEP["Keep rule"]
    REG -->|"yes"| ROLL["Auto-revert + log reason"]
    ROLL --> WEEKLY["Weekly root cause analysis"]
  end

  HANDBOOK --> CHANGE
```

### Architecture Infographic

```mermaid
flowchart TB
  subgraph "User-Facing Loop"
    Prompt["User task"] --> Entry["Entry gate"]
    Entry --> Context["Working context"]
    Context --> Parent["Parent agent"]
    Parent --> Tools["Tool calls"]
    Tools --> Checks["Verification"]
  end

  subgraph "Governance Layer"
    MemoryPolicy["Memory policy"]
    Dispatch["Dispatch gate"]
    ToolEval["Tool eval"]
    Evolution["Evolution candidate"]
    PrivacyGate["Privacy gate"]
  end

  subgraph "Local Runtime"
    Hooks["Codex hooks"]
    Runtime["Runtime scripts"]
    DashboardLocal["Local dashboard"]
    Config["~/.acob config"]
  end

  Context --> MemoryPolicy
  Parent --> Dispatch
  Tools --> ToolEval
  Checks --> Evolution
  Entry --> PrivacyGate

  Hooks --> Entry
  Runtime --> Context
  Runtime --> Checks
  DashboardLocal --> Checks
  Config --> Runtime

  PrivacyGate --> PublicSafe["public-safe package"]
  Evolution --> Approval["human approval before adoption"]
```

### Product Map

| Layer | Kano role | What users get |
|---|---|---|
| Privacy scan + local storage | Basic | confidence that private files and secrets do not ship |
| Verification-before-completion | Basic | fewer unsupported "done" claims |
| Working context + memory retrieval | Performance | less drift and lower context waste |
| ROI-gated specialist agents | Performance | useful delegation without agent sprawl |
| Dashboard | Excitement | visible state for debugging and trust |
| Leaf Agent visual layer | Excitement | a friendly explanation surface for a technical system |
| Raw logs, private memories, generated caches | Reverse | intentionally excluded from public release |

## 60-Second Quickstart

ACOB is designed to be tried with one command and no hosted backend.

By default, quickstart also prepares the local embedding path used for memory recall and token reduction:

- provider: Ollama
- model: `qwen3-embedding:0.6b`
- purpose: local vector retrieval, not final reasoning
- behavior: auto-detect Ollama, pull the model when available, verify `/api/embed`, then record status under `~/.acob/config.json`

Use the GitHub package today. Until the npm package is published or globally installed, keep using the full `npx -y github:...` command for each CLI call:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

Lowest-friction alias:

```bash
npx -y github:liuanye9-lab/codex-os-brain init
```

Use the npm package after publication:

```bash
npx -y agentic-coding-os-brain@latest quickstart
```

Open the dashboard:

```bash
npx -y github:liuanye9-lab/codex-os-brain dashboard
```

Check local memory retrieval:

```bash
npx -y github:liuanye9-lab/codex-os-brain embedding --status
npx -y github:liuanye9-lab/codex-os-brain embedding --setup
```

Skip embedding setup when you only want the lightweight harness:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart --skip-embedding
```

Verify the system:

```bash
npx -y github:liuanye9-lab/codex-os-brain prove
npx -y github:liuanye9-lab/codex-os-brain demo --task "fix dashboard, update docs, run checks"
npx -y github:liuanye9-lab/codex-os-brain memory-loop --example --json
npx -y github:liuanye9-lab/codex-os-brain metrics --json
npx -y github:liuanye9-lab/codex-os-brain effect
npx -y github:liuanye9-lab/codex-os-brain status
npx -y github:liuanye9-lab/codex-os-brain agents
npx -y github:liuanye9-lab/codex-os-brain embedding --status
npx -y github:liuanye9-lab/codex-os-brain benchmark --example
npx -y github:liuanye9-lab/codex-os-brain memory-retrieval --example
npx -y github:liuanye9-lab/codex-os-brain dispatch --task "refactor dashboard, update docs, run checks" --json
npx -y github:liuanye9-lab/codex-os-brain doctor
```

`prove` is the lowest-friction proof command. It does not install, write reports, or read private memory. It shows install status, memory/context value, dispatch behavior, effect score, privacy boundary, and the next useful command in one screen.

After npm publication or a global install, the shorter `acob ...` commands work too:

```bash
acob prove
acob dashboard
acob doctor
```

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

Existing installs that combine ACOB with a compatible private engineering harness may show `status: hybrid_active`. That is also healthy: the public runtime is active, and an external local hook is providing one of the guardrail steps without packaging private memory.

Low-cost runtime profile:

- no hosted backend
- no database setup
- no paid model call during install
- optional local embedding download through Ollama
- no private memory uploaded
- local files only under `~/.acob`
- dashboard runs on localhost

## Why This Matters

Most coding agents fail in predictable ways:

| Failure | What Usually Happens | ACOB Response |
|---|---|---|
| Long context drift | the agent keeps reading more and forgets what matters | Working Memory + Context Pack |
| Fake memory | everything is dumped into a vector store | governed memory lifecycle and source readback |
| Unverified completion | the agent says done because it looks done | verification-before-completion gate |
| Tool hallucination | API/tool calls succeed but results are not parsed or checked | tool-call ledger and local eval suite |
| Agent sprawl | more agents are spawned without ROI | dispatch gate, token budget, permission lock |
| Unsafe self-improvement | feedback directly changes rules or persona | candidate-only self-evolution with rollback |
| Dashboard illusion | pretty charts imply capability | observable-state dashboard only |

ACOB is built around a simple thesis:

> Agentic coding becomes valuable when memory, tools, agents, evaluation, and feedback are governed as one system.

## Public Value Check

ACOB is useful when the problem is not "make one model remember more text", but "make a coding agent operate with memory, verification, tools, and safe feedback loops".

Current strengths:

- one-command local install for Codex
- first-minute `acob demo` that shows the memory, dispatch, verification, and self-evolution gates without private data
- daily `acob metrics` reports for context weight, memory-loop state, dispatch gates, and verification pressure
- one-screen `acob effect` scorecard for health, score, Kano snapshot, and next action
- candidate-only `acob memory-loop` so memory can close the loop without unsafe auto-promotion
- global preflight hook for every Codex prompt
- local embedding setup for low-cost memory recall
- bounded working context instead of unlimited context stuffing
- public-safe memory lifecycle rules
- ROI-gated sub-agent dispatch
- verification-before-completion checks
- dashboard that shows observable state only

Current honest gaps:

- public benchmark is a deterministic demo, not a live model leaderboard
- memory retrieval v1 is a local auditable pipeline, not a mature graph memory database
- dashboard is an observation surface, not a full remote control plane
- self-evolution remains candidate-gated and does not rewrite core rules automatically

That is intentional for a public release: the project favors local usability, privacy, and verifiability before claiming broad agent intelligence.

## Benchmark Demo

ACOB includes a public benchmark scaffold with 20 coding task scenarios.

It compares:

| Mode | Purpose |
|---|---|
| No ACOB | baseline coding agent without harness governance |
| Long Context Only | more context but no memory lifecycle or verification loop |
| ACOB Working Memory + Replay + Reward | task-scoped attention plus feedback loop |
| ACOB + Memory Lifecycle | retrieval, freshness, privacy, conflict, expiry, context pack |

Metrics:

- success rate
- rework rate
- token estimate
- verification pass rate

Run:

```bash
npm run benchmark:demo -- --example
acob benchmark --example
```

Boundary: this demo is deterministic and transparent. It is a scaffold for public feasibility and future live traces, not a claim that ACOB already beats all other systems on a real benchmark.

## Memory Retrieval Pipeline

ACOB now includes an auditable retrieval pipeline for token-aware memory use:

```text
Task Query
  -> Query Rewrite
  -> Vector Recall Slot
  -> Rerank
  -> Freshness Score
  -> Privacy Label
  -> Conflict Detection
  -> Expiry / Forget
  -> Context Pack Injection
```

It implements:

- memory write policy
- retrieval query rewrite
- vector recall slot through local Ollama embedding
- rerank
- freshness score
- privacy label
- conflict detection
- expiry / forget
- context pack injection

Run:

```bash
npm run memory:retrieve -- --example
acob memory-retrieval --example
```

Default embedding path:

```text
Ollama + qwen3-embedding:0.6b
```

## ACOB vs Mainstream Memory Systems

ACOB does not try to replace Mem0, Zep, Letta, or LangGraph. v4.0 integrates the best mechanisms from each into a unified harness.

| System | Primary Strength | ACOB v4.0 Integration |
|---|---|---|
| Mem0 | atomic fact extraction + dedup merge | L4/L5 write pipeline |
| Zep / Graphiti | temporal validity windows (valid_at / invalid_at) | L4 memory freshness checks |
| Letta / MemGPT | virtual memory paging (agent as memory manager) | Five-layer architecture + working memory rules |
| AgentMemory | confidence scoring on memories | L4/L5 confidence-weighted retrieval |
| EvolveMem | revert-on-regression + importance decay | Evolution protocol + memory decay |
| Cline | Memory Bank forced re-read + recursive summarization | Anti-drift mechanism 1 + context compression |
| Claude Code | 4-tier file hierarchy + 200-line cap | L2 profile layer capacity rules |
| Codex CLI | Guardian safety sub-agent | Anti-hallucination layer 2 |
| ACE Framework | Evolving Playbook (Generator/Reflector/Curator) | Self-evolution incremental learning |
| Cognee | graph-edge grounding for retrieval | L5 semantic knowledge layer |
| Cursor | glob-scoped rule loading | Retrieval scenario routing |
| LangGraph | checkpoint-and-restore + human-in-the-loop | Quality gate + Lay approval |

Open the visual page:

[ACOB vs Mainstream](docs/ACOB_VS_MAINSTREAM.html)

## Research Backing (v4.0)

The v4.0 harness is grounded in peer-reviewed research and production-tested open-source systems:

| Challenge | Key Finding | Source |
|---|---|---|
| Hallucination | Chain-of-Verification (4-step) reduces fabrication without extra tool calls | arXiv:2510.06265 |
| Drift | Drift comes from pattern-matching prior context, not forgetting instructions | AAAI 2026 (arXiv:2505.02709) |
| Memory Loss | Episodic + Semantic dual store with temporal windows outperforms pure vector | arXiv:2602.19320 |
| Context Overflow | Anchored iterative summarization at 70% threshold beats truncation | Zylos Research 2026 |
| Self-Improvement | Evolving Playbook with delta-only append beats full rewrite | ACE (arXiv:2510.04618) |
| Unsafe Evolution | Revert-on-regression auto-undoes changes that hurt performance | EvolveMem (arXiv:2605.13941) |
| Token Efficiency | Memory-aware context management saves 60-90% tokens vs naive approaches | Tencent Cloud Research 2026 |

Full research report: [AI Agent Framework Research 2026](docs/AGENTS_v4_HARNESS.md)

## System Overview

```text
User Task
  -> ACOB Entry Gate
  -> Working Memory
  -> Context Pack
  -> ROI Dispatch Gate
       | simple or risky
       v
       Parent Agent

       | complex + verifiable + low risk
       v
       Specialist Agents
  -> Tool Calls
  -> Verification Gate
  -> Reward Signal
  -> Replay
  -> Memory Cycle
  -> Self-Evolution Candidate
  -> Human Approval Gate
  -> Observable Dashboard
```

## Core Product Layers

| Layer | Purpose | Public Runtime |
|---|---|---|
| Entry Gate | every Codex task enters a preflight contract | `runtime/scripts/inject-context.cjs` |
| Working Context | keeps current goal, constraints, risks, and verification focus bounded | global hook context |
| Memory System | models memory as selected reconstruction, not raw storage | `examples/memory-policy.example.json` |
| Self-Evolution | turns feedback into candidates, not automatic rule changes | `runtime/scripts/evolution-apply.cjs` |
| Multi-Agent Dispatch | routes complex work to specialist templates only when ROI is positive | `runtime/scripts/agentic-dispatch.cjs` |
| Tool Reliability | validates params, parses output, verifies result | `runtime/scripts/tool-eval-suite.cjs` |
| Dashboard | displays observable state and safe controls | `runtime/dashboard/` |
| Privacy Gate | prevents private memory, home paths, secrets, and raw prompts from shipping | `runtime/scripts/privacy-scan.cjs` |

## Memory System

ACOB treats memory as a governed lifecycle, not a vector database.

```text
Task Trace / Feedback / Eval
  -> Memory Candidate
  -> Privacy + Risk Policy
  -> Lifecycle: hot / warm / cold / archived
  -> Retrieval Plan
  -> Metadata + Keyword + Vector Signals
  -> Source Readback
  -> Context Pack
  -> Agent Action
  -> Verification
  -> Memory Cycle Report
```

### Memory Principles

| Principle | Engineering Meaning |
|---|---|
| Memory is not storage | useful information must be selected, scoped, and reconstructed |
| Long context is not intelligence | the system decides what to include and what to drop |
| Vector recall is not truth | recalled memory must be read back from source before it becomes evidence |
| Forgetting is a feature | stale, low-value, conflicting, or risky memory should decay or be blocked |
| Private memory is local | public packages never include private user memory or identity files |

### Public Memory Boundary

The public repository includes memory policy examples and schemas. It does not include:

- private long-term memory
- user profile files
- identity/persona files
- raw session logs
- private local paths
- API keys, tokens, cookies, credentials, or vector indexes

## Self-Evolution System

ACOB supports self-evolution as a controlled feedback loop.

It does not let an agent rewrite its own core rules just because a model reflection sounded plausible.

```text
Task
  -> Verification: run checks / evals / privacy gates
  -> Reward Signal: external evidence
  -> Replay: reinforce or suppress pattern
  -> Evolution Candidate: propose improvement candidate
  -> Human Approval: require approval for adoption
  -> Apply Record: approved apply record or rejection
```

### Self-Evolution Contract

| Rule | Why It Exists |
|---|---|
| feedback creates candidates | prevents unstable automatic rewrites |
| regression evidence required | avoids improving one case while breaking others |
| rollback plan required | every adoption must be reversible |
| high-risk changes need approval | memory, persona, credentials, publishing, and self-evolution remain gated |
| dashboard is evidence, not proof | observable metrics do not become capability claims by themselves |

## Multi-Agent Coding

ACOB includes a public specialist-agent library. The system does not spawn agents for show.

Dispatch opens only when the task has:

- 3+ clear sub-steps
- verifiable output
- low privacy risk or read-only agents
- separable responsibilities
- enough token budget

```text
Task
  -> Dispatch Gate
       | closed
       v
       Parent Agent

       | open
       v
       Dispatch Plan
         -> 上下文侦察员
         -> 架构规划师
         -> 代码执行员
         -> 测试验证员
         -> 安全审查员
         -> Parent Merge
         -> Final Verification
```

| Agent | Stable ID | Role |
|---|---|---|
| 上下文侦察员 | `context-scout` | map repo structure, files, and unknowns |
| 架构规划师 | `architecture-planner` | decompose complex changes and define boundaries |
| 代码执行员 | `implementation-worker` | implement a bounded assigned slice |
| 测试验证员 | `test-verifier` | run focused checks and produce evidence |
| 安全审查员 | `security-reviewer` | review privacy, secrets, and risky operations |
| 文档说明员 | `docs-writer` | update public explanation and user docs |
| 发布检查员 | `release-operator` | inspect package, release, and cross-platform risk |
| 工具调用审计员 | `tool-reliability-auditor` | verify tool parameters, parsing, and post-call results |
| 依赖审计员 | `dependency-auditor` | review dependency, license, supply-chain, and platform risk |
| 合并仲裁员 | `merge-arbiter` | merge agent outputs and define final verification |

## Dashboard

The dashboard is the system's global workspace: it shows observable state, not hidden reasoning.

```text
http://127.0.0.1:8791/
```

It is designed for operational trust:

- Is the global hook active?
- Did the dispatch gate open or close?
- Which specialist agents were selected?
- Did verification run?
- Did the privacy scan pass?
- Is a risky operation waiting for approval?
- Are control-plane commands available?

The dashboard does not show:

- private memory
- raw prompts
- hidden chain-of-thought
- credentials
- private home paths

## Repository Structure

The public repository mirrors the full private project shape while keeping the content public-safe.

```text
.
├── bin/                         # CLI entry
├── dashboard/                   # public dashboard mirror
├── docs/                        # architecture, install, security, release docs
├── evals/                       # public smoke/regression eval descriptions
├── examples/                    # sanitized examples
├── os-agent/                    # public OS-agent bridge boundary
├── plugins/                     # public plugin surface notes
├── research-reviews/            # public research summaries
├── runtime/                     # installable runtime
├── schemas/                     # public artifact schemas
├── scripts/                     # public helper entry notes
├── skills/                      # public skill templates
├── templates/                   # safe installation templates
├── tools/                       # tool reliability contracts
├── v2/ ... v7/                  # versioned architecture layers
└── test/                        # smoke tests
```

## Install And Run

Fastest GitHub path:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

Fastest npm path after publication:

```bash
npx -y agentic-coding-os-brain@latest quickstart
```

Manual npm install:

```bash
npm install -g agentic-coding-os-brain
acob quickstart
```

Verify:

```bash
npx -y github:liuanye9-lab/codex-os-brain status
npx -y github:liuanye9-lab/codex-os-brain agents
npx -y github:liuanye9-lab/codex-os-brain dispatch --task "refactor dashboard, update docs, run checks" --json
```

Start dashboard:

```bash
npx -y github:liuanye9-lab/codex-os-brain dashboard
```

## CLI Surface

After npm publication or a global install, the CLI surface is:

```bash
acob quickstart
acob install --global-agentic
acob status
acob agents
acob dispatch --task "..."
acob dispatch --task "..." --json --write
acob agent-execution --example
acob agent-lock --example
acob budget --example
acob tool-eval
acob benchmark --example
acob memory-retrieval --example
acob control --list
acob evolution-apply --example
acob dashboard
acob check
acob uninstall
```

## Safety And Governance

ACOB uses a public-safe release boundary.

| Boundary | Policy |
|---|---|
| Private memory | excluded from repository and npm package |
| Raw prompts | not stored in public artifacts |
| Secrets | blocked by privacy scan |
| Self-evolution | candidate and approval gated |
| Sub-agents | ROI and privacy gated |
| Tool calls | parameter, parse, and verification checks |
| Dashboard | observable state only |

Run before publishing:

```bash
npm run check
npm run privacy:scan
npm run pack:dry
```

## Why This Is Built For Agentic Coding Infrastructure

ACOB is positioned as infrastructure for the next phase of coding agents:

- agents need memory, but memory needs governance
- agents need tools, but tool calls need verification
- agents need autonomy, but autonomy needs gates
- agents need feedback, but feedback must become evidence-backed candidates
- organizations need dashboards, but dashboards must avoid data illusion

This repository is the public, privacy-safe foundation for that operating layer.

See:

- [Agent Harness v4.0 Operating Manual](docs/AGENTS_v4_HARNESS.md) — full v4.0 cognitive harness documentation
- [Architecture](docs/ARCHITECTURE.md)
- [Agentic Coding](docs/AGENTIC_CODING.md)
- [Quickstart](docs/QUICKSTART.md)
- [Public Benchmark Demo](docs/BENCHMARK_DEMO.md)
- [Memory Retrieval Pipeline](docs/MEMORY_RETRIEVAL_PIPELINE.md)
- [ACOB vs Mainstream](docs/ACOB_VS_MAINSTREAM.html)
- [Security](docs/SECURITY.md)
- [Install](docs/INSTALL.md)
- [Public Release Checklist](docs/PUBLIC_RELEASE_CHECKLIST.md)
- [Repository Boundary](docs/REPOSITORY_BOUNDARY.md)
