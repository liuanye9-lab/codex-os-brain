# V9 Quickstart

## Install

Use Node.js 20 or newer.

```bash
git clone https://github.com/liuanye9-lab/codex-os-brain.git
cd codex-os-brain
npm install
npm test
npm link
brain status --json
```

Set `CODEX_BRAIN_HOME` to isolate runtime state. If unset, the CLI uses the current user's `.codex-brain` directory.

## Task and evidence flow

```bash
brain task create --task-id release-v9 --objective "verify release" --criterion tests,privacy --json
brain task show --json
brain evidence attach --criterion tests --id evidence-tests --status passed --kind command --ref npm-test --json
brain verify --json
brain task checkpoint --json
```

Evidence is a provenance reference, not raw command output. A task cannot close while any required criterion is missing, failed, or unverified.

## Project hooks

```bash
brain hooks doctor --project "$PWD" --json
brain hooks enable --project "$PWD" --confirm --json
brain hooks disable --project "$PWD" --confirm --json
```

Only the project's `.codex/hooks.json` is written. Hook commands are local, bounded, network-free, and model-free. `PreToolUse` and `Stop` may deny an action at a deterministic policy boundary; advisory observer failures return an empty result.

## MCP

Run the stdio server:

```bash
brain mcp serve
```

Probe it independently:

```bash
node scripts/probe-v9-mcp.mjs
```

Safe read tools include `brain_get_status`, `brain_get_task_contract`, `brain_verify_task`, `brain_list_failures`, and `brain_list_events`. Controlled task mutations are `brain_create_task`, `brain_checkpoint_task`, `brain_attach_evidence`, and `brain_close_task`.

Embedding reads add `brain_get_embedding_status` and `brain_get_embedding_adaptation_prompt`. Model download, configuration, and index promotion remain CLI-only confirmation gates.

## Optional local embeddings

```bash
brain embeddings recommend --profile zh-light --json
brain embeddings doctor --json
brain embeddings pull --model qwen3-embedding:0.6b --confirm-download --json
brain embeddings configure --model qwen3-embedding:0.6b --confirm --json
brain embeddings probe --text "retrieval canary" --json
brain embeddings prompt --json
```

Changing the model, loopback endpoint, or dimensions invalidates the vector index. Rebuild it completely, verify `failedCount: 0`, then run `brain embeddings mark-indexed --manifest /path/to/index-manifest.json --confirm`. See [the local embedding guide](local-embeddings.md).

## Disable or fall back

- Disable project hooks with `brain hooks disable --confirm`.
- Set V9 `enabled` to false to keep the runtime read-only.
- V8 stays selectable through `fallbackVersion: 8`.
- Migration and publication are never exposed as MCP mutations.
