# Install Guide

## One-Command Quickstart

From GitHub:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

After npm publication:

```bash
npx -y agentic-coding-os-brain@latest quickstart
```

Quickstart installs the runtime, enables global gated agentic preflight, checks Ollama, and prepares the local embedding model used for memory recall and token reduction.

Short alias:

```bash
npx -y github:liuanye9-lab/codex-os-brain init
```

Default local embedding model:

```text
qwen3-embedding:0.6b
```

Skip embedding setup:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart --skip-embedding
```

## macOS / Linux

```bash
npx -y agentic-coding-os-brain@latest install --global-agentic
acob prove
acob status
acob embedding --status
acob demo --task "fix dashboard, update docs, run checks"
acob metrics --json
acob effect
acob dashboard
```

## Windows PowerShell

```powershell
npx -y agentic-coding-os-brain@latest install --global-agentic
acob prove
acob status
acob embedding --status
acob demo --task "fix dashboard, update docs, run checks"
acob metrics --json
acob effect
acob dashboard
```

If the package is not published to npm yet:

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

## Verify Global Coverage

```bash
acob status
```

## Verify Local Embedding

```bash
acob embedding --status
acob embedding --setup
```

If Ollama is missing, install Ollama and rerun `acob embedding --setup`. ACOB keeps the harness usable even when local embedding is not available yet.

## Verify Agentic Dispatch

```bash
acob agents
acob dispatch --task "实现 dashboard 功能，更新文档，运行测试，准备发布" --json
```

The dispatch gate should open for a multi-step, verifiable, low-risk task. For small or high-privacy prompts, the gate should remain closed and the parent agent should work directly or request approval.

The installer also writes a removable managed block to `~/.codex/AGENTS.md` so future Codex conversations receive the global Agentic Coding rule even outside a specific project.

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

If an older or private local harness already provides a compatible hook, `acob status` may report `status: hybrid_active`. Treat this as healthy when the scope is still `all_codex_prompts_on_this_codex_home`.

## Remove

```bash
acob uninstall
```

Keep the runtime folder but remove hooks:

```bash
acob uninstall --keep-runtime
```
