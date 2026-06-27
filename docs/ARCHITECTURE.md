# Architecture

Agentic Coding OS Brain (ACOB) is a local Codex hook runtime. It is intentionally small and observable.

## Runtime Flow

```text
User prompt in Codex
  -> UserPromptSubmit hook
  -> inject-context.cjs
  -> Agentic preflight: classify task and gate dispatch
  -> Dispatch gate
       | open
       v
       Chinese sub-agent plan

       | closed
       v
       Parent agent works directly
  -> Codex executes task
  -> PostToolUse hook -> engineering-harness.cjs -> Local dashboard
  -> Stop hook        -> capture-session.cjs      -> Local dashboard
```

## Agentic Coding Layer

The agentic layer is declarative and globally injected. `runtime/agents/library.json` defines reusable Chinese-named sub-agent templates with permissions, budgets, recursion policy, verification expectations, and redaction rules.

`runtime/scripts/agentic-dispatch.cjs` does not execute arbitrary work. It produces an auditable dispatch plan, and `inject-context.cjs` runs this preflight for every prompt:

```text
Task
  -> Classify risk and shape
  -> Dispatch gate
       | closed
       v
       Parent agent works directly

       | open
       v
       Select specialist agents
         -> 上下文侦察员
         -> 代码执行员
         -> 测试验证员
         -> 安全审查员
         -> Parent merge gate
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
