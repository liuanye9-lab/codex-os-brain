# Architecture

Agentic Coding OS Brain (ACOB) is a local Codex hook runtime. It is intentionally small and observable.

## Runtime Flow

```mermaid
flowchart TD
  A["User prompt in Codex"] --> B["UserPromptSubmit hook"]
  B --> C["inject-context.cjs"]
  C --> D["Agentic preflight\nclassify task and gate dispatch"]
  D --> E{"Dispatch gate"}
  E -->|"open"| F["Chinese sub-agent plan"]
  E -->|"closed"| G["Parent agent works directly"]
  F --> H["Codex executes task"]
  G --> H
  H --> I["PostToolUse hook"]
  I --> J["engineering-harness.cjs"]
  H --> K["Stop hook"]
  K --> L["capture-session.cjs"]
  J --> M["Local dashboard"]
  L --> M
```

## Agentic Coding Layer

The agentic layer is declarative and globally injected. `runtime/agents/library.json` defines reusable Chinese-named sub-agent templates with permissions, budgets, recursion policy, verification expectations, and redaction rules.

`runtime/scripts/agentic-dispatch.cjs` does not execute arbitrary work. It produces an auditable dispatch plan, and `inject-context.cjs` runs this preflight for every prompt:

```mermaid
flowchart TD
  A["Task"] --> B["Classify risk and shape"]
  B --> C{"Dispatch gate"}
  C -->|"closed"| D["Parent agent works directly"]
  C -->|"open"| E["Select specialist agents"]
  E --> F["上下文侦察员"]
  E --> G["代码执行员"]
  E --> H["测试验证员"]
  E --> I["安全审查员"]
  F --> J["Parent merge gate"]
  G --> J
  H --> J
  I --> J
```

Dispatch rules:

- no recursive sub-agents
- max fanout is bounded
- high-risk tasks default to read-only review unless approved
- sub-agent output is advice/evidence, not final completion
- parent agent owns final merge and user-facing answer
- if real subagent tools are unavailable, the dispatch plan is advisory only

## Installed Files

| Path | Purpose |
|---|---|
| `~/.acob/runtime` | Public runtime copied from this package |
| `~/.acob/data` | Sanitized local status and audit counts |
| `~/.codex/hooks.json` | User's Codex hook file, backed up before modification |
| `~/.codex/AGENTS.md` | User's global Codex instruction file, updated with a removable Agentic Coding block |

## Cognitive Layers

| Layer | Engineering Mechanism |
|---|---|
| Perception | `UserPromptSubmit` hook receives prompt metadata |
| Attention | injected bounded context rules |
| Working Context | current goal, constraints, focus, questions, risk reminders |
| Verification | completion must cite command/test/manual evidence |
| Reward | external evidence only; no model self-rating |
| Replay | future extension, candidate-only by default |
| Metacognition | high-risk prompts slow down and request approval |
| Social Approval | risky memory/persona/self-evolution changes require humans |
| Immune System | privacy scan and engineering audit |

## Data Boundary

The runtime does not package or require private memory. Local data files are created only after install and remain on the user's machine.

The dashboard displays observable state only:

- hook coverage
- sanitized event counts
- risk categories
- red-flag state

It does not display hidden reasoning chains or private prompt bodies.
