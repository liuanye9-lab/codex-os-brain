# Agentic Coding

Agentic coding means a main agent can plan, delegate, verify, and merge software work through specialized sub-agents.

In Agentic Coding OS Brain (ACOB), this is implemented as a global gated preflight: every Codex prompt is classified first, but sub-agents are used only when the task is complex, verifiable, and low-risk.

It does not mean unlimited autonomy. A useful agentic coding system needs:

- clear specialist roles
- isolated context windows
- bounded permissions
- verification gates
- privacy guards
- parent-agent ownership

## Research-Informed Principles

- SWE-agent shows that the agent-computer interface matters: agents perform better when the environment makes navigation, editing, and testing explicit.
- OpenAI Agents SDK handoffs model delegation as a tool-like transfer to specialists.
- Claude Code subagents use separate agent instances to isolate context and apply specialized instructions.
- AutoGen frames multi-agent systems as independent agents coordinating through messages.
- Guardrails are required because handoffs and tool calls can bypass assumptions if not explicitly constrained.

## Agentic Coding OS Brain (ACOB) Implementation

Files:

| File | Purpose |
|---|---|
| `runtime/agents/library.json` | reusable public sub-agent manifest |
| `runtime/scripts/agentic-dispatch.cjs` | dispatch planner and gate |
| `runtime/scripts/inject-context.cjs` | global `UserPromptSubmit` hook that injects the Agentic Coding preflight |
| `runtime/dashboard/*` | observable agentic status |

Commands:

```bash
acob agents
acob dispatch --task "implement feature, update docs, run tests"
acob dispatch --task "publish package safely" --json --write
acob install --global-agentic
```

## Built-In Agents

| 中文名 | Stable id | Role | Power |
|---|---|---|---|
| 上下文侦察员 | `context-scout` | codebase map and file ownership | read-only |
| 架构规划师 | `architecture-planner` | design options and tradeoffs | read-only, may request child dispatch |
| 代码执行员 | `implementation-worker` | one bounded implementation slice | limited write scope |
| 测试验证员 | `test-verifier` | focused checks and evidence | read/execute safe, no writes by default |
| 安全审查员 | `security-reviewer` | privacy and security review | read-only |
| 文档说明员 | `docs-writer` | documentation updates | docs-only write |
| 发布检查员 | `release-operator` | package/release checks | read/execute safe, no publishing by default |
| 工具调用审计员 | `tool-reliability-auditor` | tool/API parameters, parse, and verification | read/execute safe |
| 依赖审计员 | `dependency-auditor` | dependency, license, size, supply-chain, and platform risk | read-only |
| 合并仲裁员 | `merge-arbiter` | merge order, conflicts, blocked items, final verification | read-only, may request child dispatch |

## Dispatch Gate

Dispatch is recommended only when:

- task has at least three concrete signals or sub-steps
- outcome is verifiable
- privacy risk is low, or selected agents are read-only
- multiple specialists add real value

Closed gate means the parent agent should handle the task directly.

Open gate means the parent agent may call real Codex subagent tools when they are available. If the current environment does not expose subagent tools, the dispatch output is only a plan and must not be reported as executed.

## Controlled Child Dispatch

Sub-agents may not recursively spawn more agents by themselves. ACOB supports child dispatch only as a request back to the Mother Agent:

- only `architecture-planner` and `merge-arbiter` may request child dispatch
- max depth is 2
- max child fanout per L2 agent is 2
- max parallel agents is 4
- max total agents per task is 10
- high-privacy or unverifiable tasks close the execution gate

The purpose is better decomposition, not more noise.

## Safety Rules

- no uncontrolled recursive sub-agents
- no unregistered agents
- no private memory access
- no credential access
- no automatic publish or external action
- no final completion claim without verification evidence
- dashboard shows counts and sanitized status, not raw prompts
- global hook records only sanitized task hashes, character counts, gate state, and selected agent ids/names
