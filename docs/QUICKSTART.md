# ACOB Quickstart

Use ACOB with one command and no hosted backend.

## GitHub Install

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

Equivalent low-friction alias:

```bash
npx -y github:liuanye9-lab/codex-os-brain init
```

This command:

1. installs the public runtime into `~/.acob`
2. updates Codex hooks under `~/.codex/hooks.json`
3. adds the global ACOB agentic preflight block to `~/.codex/AGENTS.md`
4. checks local embedding support through Ollama
5. pulls and verifies `qwen3-embedding:0.6b` when Ollama is available
6. verifies the install with `acob status --summary`

Skip the embedding download:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart --skip-embedding
```

## npm Install

After the package is published to npm:

```bash
npx -y agentic-coding-os-brain@latest quickstart
```

Or install globally:

```bash
npm install -g agentic-coding-os-brain
acob quickstart
```

## Run The Dashboard

```bash
acob dashboard
```

Dashboard URL:

```text
http://127.0.0.1:8791/
```

## Local Embedding

ACOB uses a local embedding model for memory recall and token reduction.

Default model:

```text
qwen3-embedding:0.6b
```

Commands:

```bash
acob embedding --status
acob embedding --setup
```

If Ollama is not installed, quickstart still finishes and records `ollama_missing` in `~/.acob/config.json`.

## Verify

```bash
acob prove
acob demo --task "fix dashboard, update docs, run checks"
acob memory-loop --example --json
acob metrics --json
acob effect
acob status
acob agents
acob embedding --status
acob dispatch --task "refactor dashboard, update docs, run checks" --json
acob doctor
```

`acob prove` is a read-only one-screen proof. It combines install status, public value demo, daily effect score, privacy boundary, and next commands without writing hooks, reports, prompts, or memory.

## Cost And Privacy

- no hosted backend
- no database setup
- no paid model call during install
- optional local embedding model download through Ollama
- no private memory packaged
- no raw prompt stored in public artifacts
- local runtime state stays under `~/.acob`, with automatic read compatibility for older `~/.codex-os-brain` installs
