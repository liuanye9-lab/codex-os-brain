# V9 Quickstart

## Install

Use Node.js 20 or newer.

```bash
git clone https://github.com/liuanye9-lab/codex-os-brain.git
cd codex-os-brain
npm install
npm test
npm run eval:reliability
npm link
brain status --json
```

Set `CODEX_BRAIN_HOME` to isolate runtime state. If unset, the CLI uses `~/.codex-brain`.

## Task and evidence flow (P0)

```bash
brain task create --task-id release-v9 --objective "verify release" --criterion tests --json
brain task show --json

# Agent may only claim (always unverified)
brain evidence claim --criterion tests --id evidence-tests --kind claim --ref agent --json

# Harness re-runs executable verifiers — the only path to "passed"
brain verify --json

# Stored evaluation only (no re-run)
brain verify --status-only --json

brain task checkpoint --summary "mid-flight" --json
```

`brain evidence attach` remains for compatibility but is treated as a claim unless an internal harness path sets `harnessVerified` with `allowHarnessAttach`.

## Session handoff (P1)

```bash
brain handoff init --objective "verify release" --json
brain handoff status --json
brain handoff progress --summary "finished smoke path" --json
```

Creates `.brain/feature-backlog.json`, `.brain/progress.md`, and `.brain/smoke.sh`.

## Skills (P4)

```bash
brain skill list --json
brain skill activate --id brain-lite-model-router --criterion tests --budget 2000 --json
```

## Memory (P6)

```bash
brain memory add --text "prefer local embeddings" --tags embed --json
brain memory recall --query "embed" --json
brain memory list --json
```

## Hosts (P5)

```bash
brain hosts list --json
# BRAIN_HOST=codex|claude|mcp node bin/brain-hook.js
```

## Project hooks

```bash
brain hooks doctor --project "$PWD" --json
brain hooks enable --project "$PWD" --confirm --json
brain hooks disable --project "$PWD" --confirm --json
```

Only the project's `.codex/hooks.json` is written. Hook commands are local, bounded, network-free, and model-free.

## MCP

```bash
brain mcp serve
node scripts/probe-v9-mcp.mjs
```

Read tools include status, task, verify (re-run), failures, events, embeddings, handoff, skills, memory recall.  
Mutations: create task, checkpoint, claim evidence, activate skill, close (after harness verify).  
Never: self-certify passed, download models, migrate, bypass policy.

## Reliability eval (P2)

```bash
npm run eval:reliability
```

## Optional local embeddings

```bash
brain embeddings recommend --profile zh-light --json
brain embeddings doctor --json
```

See [local embeddings](local-embeddings.md).

## Disable or fall back

- `brain hooks disable --confirm`
- Set V9 `enabled` to false for read-only runtime
- `fallbackVersion: 8` keeps V8 selectable
- Migration / publish never exposed as MCP mutations
