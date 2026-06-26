# Agentic Coding OS Brain (ACOB)

Give Codex a local "operating system for thinking and doing": memory discipline, verification gates, safer tool use, and a dashboard you can actually inspect.

Think of Codex as a very capable driver. Agentic Coding OS Brain (ACOB) is the dashboard, seat belt, route planner, rear-view mirror, and maintenance log around that driver.

It does not replace Codex. It wraps Codex with a public, privacy-first harness so every task can enter through a visible, safer, more consistent workflow.

## What Is This?

Agentic Coding OS Brain (ACOB) is a small local runtime that installs into your Codex environment.

After installation, every Codex prompt passes through a global entry gate before the agent starts working. That gate runs an Agentic Coding preflight and reminds the agent to:

- keep the current goal clear
- remember the active constraints
- verify before saying "done"
- slow down on risky changes
- avoid turning private memory into public data
- record sanitized status for a local dashboard
- dispatch Chinese-named specialist sub-agents only when the task is complex, verifiable, and low-risk

In plain language:

> Agentic Coding OS Brain (ACOB) gives Codex a workbench, checklist, dashboard, and learning notebook, without shipping your private life or secrets anywhere.

## What Can It Help You Do?

| If you use Codex for... | Agentic Coding OS Brain (ACOB) helps by... | What you get |
|---|---|---|
| Coding tasks | adding verification-before-completion reminders | fewer "looks done but broken" results |
| Long tasks | keeping a bounded working context | less drift and fewer forgotten constraints |
| Risky edits | raising engineering audit signals | safer changes around config, secrets, memory, and identity |
| Repeated workflows | turning useful patterns into candidate habits | a harness that can become more aligned over time |
| Multi-step work | shaping tasks into dispatchable units | clearer handoffs for sub-agents or future automation |
| Daily usage | showing observable state in a local dashboard | less guessing about what the system is doing |

## One-Screen Mental Model

```mermaid
flowchart LR
  A["You ask Codex to do something"] --> B["Agentic Coding OS Brain (ACOB) entry gate"]
  B --> C["Working context\nWhat is the goal?\nWhat matters now?"]
  C --> D{"Agentic dispatch gate\nShould specialists help?"}
  D -->|"small or risky"| E["Main agent works directly"]
  D -->|"3+ steps\nverifiable\nlow risk"| F["Chinese sub-agent team"]
  E --> G["Verification gate\nHow do we know it worked?"]
  F --> G
  G --> H["Engineering audit\nAny risky boundary touched?"]
  H --> I["Local dashboard\nWhat happened? What needs attention?"]
```

The goal is simple:

> Make Codex less like a blank chat box and more like a repeatable work system.

## Why "Brain"?

This project uses brain-inspired language as a practical analogy, not as a claim of consciousness.

| Brain-like idea | Everyday analogy | Engineering mechanism |
|---|---|---|
| Attention | a desk with only the current papers on it | bounded working context |
| Working memory | a sticky note beside your keyboard | current goal, constraints, risks |
| Long-term memory | a notebook, not a garbage drawer | candidate-only learning |
| Reward | a coach checking the scoreboard | external evidence, tests, reviews |
| Metacognition | knowing when you are unsure | slow down, ask, verify, or stop |
| Social approval | asking the owner before changing the house | human approval for high-risk changes |
| Immune system | a security guard at the door | privacy scan and engineering audit |

## How It Runs

Agentic Coding OS Brain (ACOB) installs three global hook stages into Codex:

| Codex event | Runtime script | What it does |
|---|---|---|
| `UserPromptSubmit` | `inject-context.cjs` | adds the public cognitive harness context and Agentic Coding preflight before work starts |
| `PostToolUse` | `engineering-harness.cjs` | records sanitized risk categories after tool use |
| `Stop` | `capture-session.cjs` | updates a sanitized heartbeat/status file |

```mermaid
sequenceDiagram
  participant U as User
  participant C as Codex
  participant H as Agentic Coding OS Brain (ACOB) Hooks
  participant D as Dashboard

  U->>C: Prompt
  C->>H: UserPromptSubmit
  H-->>C: Goal / constraints / verification reminders / agentic preflight
  C->>C: Work with tools
  C->>H: PostToolUse
  H-->>D: Sanitized audit category
  C->>H: Stop
  H-->>D: Heartbeat and status
```

## Agent Memory, Without the Privacy Trap

Most "AI memory" systems make a dangerous mistake: they store everything and call it intelligence.

Agentic Coding OS Brain (ACOB) takes the opposite approach:

- memory should be selected, not dumped
- learning should require feedback, not just accumulation
- private user facts should not be packaged into a public tool
- useful patterns should start as candidates, not permanent rules
- risky memory, persona, or self-evolution changes need human approval

In this public package, no private long-term memory is included. The installed runtime only writes sanitized local status under:

```text
~/.acob/data
```

That makes the framework reusable without leaking the original user's personal agent, memory, identity, logs, or secrets.

## Sub-Agent Dispatch Model

Agentic Coding OS Brain (ACOB) is designed so bigger tasks can be split like a small team:

```mermaid
flowchart TD
  A["Task"] --> B{"Should this be split?"}
  B -->|"small task"| C["Main agent handles it"]
  B -->|"3+ clear steps\nverifiable\nlow privacy risk"| D["Dispatch plan"]
  D --> E["Planner"]
  D --> F["Context inspector"]
  D --> G["Reviewer / QA"]
  E --> H["Main agent merges results"]
  F --> H
  G --> H
  H --> I["Verification gate"]
```

The important rule:

> More agents do not automatically mean more intelligence.

Sub-agents should be used only when the task has clear parts, low privacy risk, and a way to verify results. Otherwise, the main agent should keep the work simple.

The public package now includes a local sub-agent library and dispatch planner:

```bash
acob agents
acob dispatch --task "refactor the dashboard, update docs, run checks" --json
```

Built-in Chinese agent templates:

| Agent | Stable id | Job | Default power |
|---|---|---|---|
| 上下文侦察员 | `context-scout` | map files, APIs, patterns, constraints | read-only |
| 架构规划师 | `architecture-planner` | compare designs and choose the smallest viable plan | read-only, may request child dispatch |
| 代码执行员 | `implementation-worker` | implement one bounded, assigned slice | limited write scope |
| 测试验证员 | `test-verifier` | find and run focused verification | read/execute safe checks, no writes by default |
| 安全审查员 | `security-reviewer` | review secrets, privacy, hooks, local servers | read-only |
| 文档说明员 | `docs-writer` | update README/docs/user-facing explanation | docs-only write scope |
| 发布检查员 | `release-operator` | run release checklist and package inspection | read/execute safe checks, no publishing by default |
| 工具调用审计员 | `tool-reliability-auditor` | check API/tool parameters, parsing, and post-call verification | read/execute safe checks |
| 依赖审计员 | `dependency-auditor` | check dependency, license, size, supply-chain, and platform risk | read-only |
| 合并仲裁员 | `merge-arbiter` | merge sub-agent outputs, detect conflicts, and define final verification | read-only, may request child dispatch |

The dispatch gate opens only when:

- the task has enough clear sub-steps
- the outcome is verifiable
- privacy risk is low, or selected agents are read-only
- responsibilities are disjoint
- the parent agent remains responsible for final merge

This means Agentic Coding OS Brain (ACOB) supports agentic coding without pretending that "more agents" automatically means better work.

When the dispatch gate opens and the current Codex environment exposes real subagent tools, the parent agent can call those subagents directly. When the environment does not expose real subagent tools, Agentic Coding OS Brain (ACOB) falls back to the local dispatch plan and must not pretend the subagents executed.

### Controlled Child Dispatch

ACOB allows child dispatch as a proposal, not as uncontrolled recursion.

- only `architecture-planner` and `merge-arbiter` may request child dispatch
- Mother Agent must approve before any child agent executes
- max child depth is 2
- max child fanout per L2 agent is 2
- max parallel agents is 4
- max total agents per task is 10
- high-privacy, secret, persona, memory, destructive, and publishing tasks require approval

This keeps agentic coding useful without turning every prompt into an expensive agent swarm.

### Hard Gates Added In ACOB

ACOB now includes local hard gates for the common failure modes in agentic coding:

| Failure mode | ACOB mechanism | Command |
|---|---|---|
| manifest treated as real sub-agent execution | execution ledger requires imported results before merge-ready | `acob agent-execution --example` |
| write-capable agent touches forbidden files | permission lock validates claimed files against write scope | `acob agent-lock --example` |
| fanout burns unlimited context | budget enforcer blocks over-budget or low-ROI dispatch | `acob budget --example` |
| tool call success is mistaken for task success | local tool eval covers missing params, privacy block, parse fail, unverified success | `acob tool-eval` |
| dashboard can only observe | dashboard exposes localhost allowlisted control commands | `acob control --list` |
| self-evolution has no adoption bridge | apply record requires explicit human approval | `acob evolution-apply --example` |

These gates are harness controls, not an OS kernel sandbox. Real sub-agent execution still depends on the current Codex environment exposing sub-agent tools, and the parent agent still owns final merge and verification.

## Dashboard

The local dashboard is the control panel for the harness.

```text
http://127.0.0.1:8791/
```

It shows observable state only:

- whether the global Codex entry is active
- whether prompt injection is working
- how many sanitized prompt events were recorded
- how many engineering audits happened
- whether a red flag is raised
- whether privacy boundaries are intact
- which agent templates are registered
- which control-plane commands are available
- whether the latest dispatch was recommended or blocked

It does not show hidden reasoning chains. It does not show private memory. It does not show your raw prompt text.

Think of it like a car dashboard:

- speedometer: is the runtime active?
- warning light: did a risky boundary get touched?
- odometer: how many events have passed through?
- service light: what needs verification or approval?

## Why This Gets Better Over Time

Agentic Coding OS Brain (ACOB) is a harness for repeated use.

The more you use it, the more useful its local signals become:

- repeated task shapes become easier to recognize
- verification habits become consistent
- risky patterns become visible
- dashboard history gives you feedback
- future memory or skill promotion can be evidence-based instead of guessed

It is "越用越懂用户" in the practical sense:

> Not because it magically knows you, but because it keeps better local structure around your repeated goals, constraints, feedback, and verification patterns.

The public package starts with safe infrastructure. Personal memory should be added locally by the user, deliberately, and never shipped as part of the package.

## Install

After the package is published to npm:

```bash
npx agentic-coding-os-brain install --global-agentic
```

Until npm publication, install from GitHub:

```bash
npx --yes github:liuanye9-lab/codex-os-brain install --global-agentic
```

Then verify:

```bash
acob status
```

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

Start the dashboard:

```bash
acob dashboard
```

## Commands

```bash
acob install --global-agentic
acob status
acob agents
acob dispatch --task "..."
acob dispatch --task "..." --json --write
acob dashboard
acob check
acob uninstall
```

## What Gets Installed

The installer:

1. copies the public runtime to `~/.acob`
2. backs up `~/.codex/hooks.json`
3. adds global Codex hooks with empty matchers
4. backs up and updates `~/.codex/AGENTS.md` with a removable Agentic Coding managed block
5. enables gated Agentic Coding preflight globally
6. writes only sanitized local status files under `~/.acob/data`

## What Is Explicitly Not Included

- no private long-term memory
- no user profile
- no persona or identity file
- no API key
- no token
- no private local paths
- no automatic memory promotion
- no automatic self-evolution adoption
- no hidden chain-of-thought dashboard

## Safety Model

Agentic Coding OS Brain (ACOB) treats learning and self-evolution as candidate-only by default:

- learning requires external evidence
- confidence should control action speed
- high-risk changes require human approval
- dashboard state is evidence, not proof of intelligence
- private data stays local and is not packaged

## Development

```bash
npm run check
npm run privacy:scan
npm run pack:dry
```

See [docs/SECURITY.md](docs/SECURITY.md) before publishing or modifying install behavior.
