# Codex Brain — Adaptive Reliability Harness, Version 9

[![Version](https://img.shields.io/badge/version-0.9.0-5b5bd6)](package.json)
[![Runtime](https://img.shields.io/badge/runtime-local--first-1f883d)](docs/v9/privacy-and-threat-model.md)
[![Interfaces](https://img.shields.io/badge/interfaces-hooks%20%7C%20CLI%20%7C%20MCP-0969da)](docs/v9/quickstart.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Codex Brain V9 is a local reliability control plane for coding agents. It is silent during ordinary work and intervenes only when deterministic evidence indicates an explicit constraint, a high-risk write, repeated failure, context-compaction recovery, or an unsupported completion claim.

It does not replace the agent. It gives hooks, the `brain` CLI, and a stdio MCP server one shared, evidence-gated contract.

## Architecture

```mermaid
flowchart LR
  Agent["Coding agent"] --> Hooks["Project hooks\nsilent by default"]
  Human["Operator"] --> CLI["brain CLI"]
  Client["MCP client"] --> MCP["Local stdio MCP"]
  Hooks --> Core["V9 Reliability Core"]
  CLI --> Core
  MCP --> Core
  Core --> Contract["Task Contract"]
  Core --> Events["Sanitized Event Ledger"]
  Core --> Evidence["Evidence + Verification Gate"]
  Core --> Circuit["Typed Failure Circuit"]
  Core --> EmbedContract["Optional Embedding Contract\nmodel + endpoint + dimensions"]
  EmbedContract --> Ollama["Local Ollama\nsemantic candidate recall"]
  Hooks -. "never calls" .-> Ollama
  Legacy["V1–V8 read-only assets"] --> Migration["Hash + backup + copy migration"]
  Migration --> Core
```

```mermaid
stateDiagram-v2
  [*] --> Silent
  Silent --> Checkpoint: normal tool/session event
  Checkpoint --> Silent: no deterministic trigger
  Silent --> Inject: compaction recovery or explicit constraint
  Silent --> Block: forbidden scope or high-risk boundary
  Silent --> Warn: second identical failure
  Warn --> Block: third identical failure
  Silent --> Verify: Stop/completion claim
  Verify --> [*]: all required evidence passes
  Verify --> Block: missing, failed, or unverified criterion
```

## What activates it

| Trigger | V9 behavior | Default decision |
|---|---|---|
| Ordinary read/write inside verified scope | Record only allowlisted metadata | Silent |
| Explicit user/project constraint | Restore a bounded checkpoint when relevant | Inject |
| High-risk or external write | Require a verified boundary or human confirmation | Block |
| Repeated identical failure | Warn after two; open the circuit after three | Inject, then block retry |
| Context compaction | Restore objective, explicit constraints, and unresolved items | Inject, maximum about 250 tokens |
| `Stop` completion claim | Evaluate every required criterion against evidence | Block if incomplete |

Hot hooks make no network or model call. The local targets are below 100 ms for `PreToolUse` and below 150 ms for `PostToolUse` on deterministic fixtures.

## Five-minute quickstart

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/liuanye9-lab/codex-os-brain.git
cd codex-os-brain
npm install
npm test
npm link

brain status --json
brain task create --task-id demo --objective "verify the V9 adapter" --criterion tests --json
brain verify --json
```

Both binary names are available:

```bash
brain status --json
codex-brain status --json
```

### Optional local embeddings with Ollama

The reasoning model should not carry the entire long-term memory in every prompt. A small local embedding model can first select a few semantically relevant candidates; the Agent then reasons over and verifies those candidates. This combination reduces irrelevant context and repeated token use, supports meaning-based recall beyond exact keywords, and keeps raw memory queries on the local machine. It remains optional, with lexical fallback when Ollama or the vector index is unavailable.

V9 does not silently install Ollama or choose the largest model. It provides three starting profiles and lets the Agent re-evaluate them against Chinese/code recall quality, latency, RAM/VRAM, disk, and privacy requirements:

```bash
brain embeddings recommend --profile zh-light --json
brain embeddings pull --model qwen3-embedding:0.6b --confirm-download --json
brain embeddings configure --model qwen3-embedding:0.6b --confirm --json
brain embeddings doctor --json
brain embeddings probe --text "中文和代码召回探针" --json
brain embeddings prompt --json
```

Model, endpoint, and requested dimensions form one fingerprint. Changing any of them sets `requiresReindex`; vector recall stays unavailable until all readable sources are rebuilt and a zero-embedding-failure manifest with the matching fingerprint is confirmed. Unavailable sources remain visible as `sourceWarningCount`. Indexing and querying must use the same model. Hot hooks never call Ollama.

Copy this prompt when asking an Agent to adapt the local model:

```text
请为当前项目重新适配 Ollama 本地嵌入后端。先检查 OS、内存/显存、磁盘、Ollama 与 localhost API；下载前必须获得确认。用固定的中文、英文和代码召回 canary 比较质量、延迟与资源占用，不因模型更大就默认升级。确保索引与查询使用同一模型、端点和 dimensions，并记录配置指纹；任一身份字段改变都要重建全部可读来源，只有零嵌入失败的匹配 manifest 才能标记 indexed，无法读取的来源必须单独报告。保留词法检索回退，限制注入条数与 token，把召回内容当作待核验证据，不把私有记忆发往远程端点。
```

See [local embedding installation and adaptation](docs/v9/local-embeddings.md).

### Enable project-scoped hooks

Hooks are off until a project explicitly opts in. This command writes only `<project>/.codex/hooks.json`; it does not install global or Claude Code hooks.

```bash
brain hooks doctor --project "$PWD" --json
brain hooks enable --project "$PWD" --confirm --json
brain hooks disable --project "$PWD" --confirm --json
```

The hook lifecycle includes `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, and `Stop`.

### Start the MCP server

```bash
brain mcp serve
```

Example client configuration:

```json
{
  "mcpServers": {
    "codex-brain-v9": {
      "command": "brain",
      "args": ["mcp", "serve"]
    }
  }
}
```

MCP can read status, contracts, failures, events, verification state, the embedding contract, and its adaptation prompt. Its four controlled mutations create a task, checkpoint it, attach an evidence reference, and close it after verification. MCP cannot install or pull models, change embedding configuration, mark an index current, approve Canary promotion, apply or roll back migration, publish a repository, change visibility, delete audit data, or bypass policy.

## V1–V8 preservation

V9 never rewrites legacy data in place. Migration is:

```text
inventory -> source hashes -> verified backup -> copy adapters -> verification -> explicit cutover
```

- Unavailable cloud placeholders are recorded as `unavailable_dataless`; V9 does not force hydration.
- Re-running a migration is idempotent.
- Every imported record keeps source hash, detected version, and adapter version.
- V8 remains selectable through `fallbackVersion: 8` and a rollback marker.

See [the migration guide](docs/v9/migration.md).

## Verification and privacy

```bash
npm test
npm run check
node scripts/probe-v9-mcp.mjs
node scripts/build-public-export.js --output /tmp/codex-brain-v9-public
```

The public tree is generated from an explicit allowlist. It excludes runtime state, identities, memories, raw prompts, raw tool output, credentials, session archives, private adapters, local absolute paths, and V1–V8 data. See the [privacy and threat model](docs/v9/privacy-and-threat-model.md).

## Documentation

- [CLI, hooks, and MCP quickstart](docs/v9/quickstart.md)
- [Optional Ollama local embeddings](docs/v9/local-embeddings.md)
- [V1–V8 migration and rollback](docs/v9/migration.md)
- [Privacy and threat model](docs/v9/privacy-and-threat-model.md)
- [Research and open-source attribution](docs/v9/research-and-attribution.md)

## Boundaries

V9 reduces common reliability failures; it does not prove semantic correctness, replace domain review, or make an untrusted agent safe. Deterministic gates fail closed only for credential/privacy boundaries, explicit forbidden scope, destructive actions, and unsupported completion. Advisory telemetry fails open so a broken observer does not disable ordinary work.

MIT licensed. See [LICENSE](LICENSE).
