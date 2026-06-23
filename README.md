# Codex OS Brain

Give Codex a local "operating system for thinking and doing": memory discipline, verification gates, safer tool use, and a dashboard you can actually inspect.

Think of Codex as a very capable driver. Codex OS Brain is the dashboard, seat belt, route planner, rear-view mirror, and maintenance log around that driver.

It does not replace Codex. It wraps Codex with a public, privacy-first harness so every task can enter through a visible, safer, more consistent workflow.

## What Is This?

Codex OS Brain is a small local runtime that installs into your Codex environment.

After installation, your Codex prompts pass through a global entry gate before the agent starts working. That gate reminds the agent to:

- keep the current goal clear
- remember the active constraints
- verify before saying "done"
- slow down on risky changes
- avoid turning private memory into public data
- record sanitized status for a local dashboard

In plain language:

> Codex OS Brain gives Codex a workbench, checklist, dashboard, and learning notebook, without shipping your private life or secrets anywhere.

## What Can It Help You Do?

| If you use Codex for... | Codex OS Brain helps by... | What you get |
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
  A["You ask Codex to do something"] --> B["Codex OS Brain entry gate"]
  B --> C["Working context\nWhat is the goal?\nWhat matters now?"]
  C --> D["Verification gate\nHow do we know it worked?"]
  D --> E["Codex uses tools"]
  E --> F["Engineering audit\nAny risky boundary touched?"]
  F --> G["Local dashboard\nWhat happened? What needs attention?"]
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

Codex OS Brain installs three global hook stages into Codex:

| Codex event | Runtime script | What it does |
|---|---|---|
| `UserPromptSubmit` | `inject-context.cjs` | adds the public cognitive harness context before work starts |
| `PostToolUse` | `engineering-harness.cjs` | records sanitized risk categories after tool use |
| `Stop` | `capture-session.cjs` | updates a sanitized heartbeat/status file |

```mermaid
sequenceDiagram
  participant U as User
  participant C as Codex
  participant H as Codex OS Brain Hooks
  participant D as Dashboard

  U->>C: Prompt
  C->>H: UserPromptSubmit
  H-->>C: Goal / constraints / verification reminders
  C->>C: Work with tools
  C->>H: PostToolUse
  H-->>D: Sanitized audit category
  C->>H: Stop
  H-->>D: Heartbeat and status
```

## Agent Memory, Without the Privacy Trap

Most "AI memory" systems make a dangerous mistake: they store everything and call it intelligence.

Codex OS Brain takes the opposite approach:

- memory should be selected, not dumped
- learning should require feedback, not just accumulation
- private user facts should not be packaged into a public tool
- useful patterns should start as candidates, not permanent rules
- risky memory, persona, or self-evolution changes need human approval

In this public package, no private long-term memory is included. The installed runtime only writes sanitized local status under:

```text
~/.codex-os-brain/data
```

That makes the framework reusable without leaking the original user's personal agent, memory, identity, logs, or secrets.

## Sub-Agent Dispatch Model

Codex OS Brain is designed so bigger tasks can be split like a small team:

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

The current public package provides the global harness, audit layer, and dashboard foundation. Real sub-agent backends can be added on top of this dispatch model.

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

It does not show hidden reasoning chains. It does not show private memory. It does not show your raw prompt text.

Think of it like a car dashboard:

- speedometer: is the runtime active?
- warning light: did a risky boundary get touched?
- odometer: how many events have passed through?
- service light: what needs verification or approval?

## Why This Gets Better Over Time

Codex OS Brain is a harness for repeated use.

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
npx codex-os-brain install
```

Until npm publication, install from GitHub:

```bash
npx --yes github:liuanye9-lab/codex-os-brain install
```

Then verify:

```bash
codex-os-brain status
```

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

Start the dashboard:

```bash
codex-os-brain dashboard
```

## Commands

```bash
codex-os-brain install
codex-os-brain status
codex-os-brain dashboard
codex-os-brain check
codex-os-brain uninstall
```

## What Gets Installed

The installer:

1. copies the public runtime to `~/.codex-os-brain`
2. backs up `~/.codex/hooks.json`
3. adds global Codex hooks with empty matchers
4. writes only sanitized local status files under `~/.codex-os-brain/data`

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

Codex OS Brain treats learning and self-evolution as candidate-only by default:

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
