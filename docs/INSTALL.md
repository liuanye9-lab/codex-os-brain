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
npx -y github:liuanye9-lab/codex-os-brain install --global-agentic
npx -y github:liuanye9-lab/codex-os-brain prove
npx -y github:liuanye9-lab/codex-os-brain status
npx -y github:liuanye9-lab/codex-os-brain embedding --status
npx -y github:liuanye9-lab/codex-os-brain demo --task "fix dashboard, update docs, run checks"
npx -y github:liuanye9-lab/codex-os-brain metrics --json
npx -y github:liuanye9-lab/codex-os-brain effect
npx -y github:liuanye9-lab/codex-os-brain dashboard
```

## Windows PowerShell

```powershell
npx -y github:liuanye9-lab/codex-os-brain install --global-agentic
npx -y github:liuanye9-lab/codex-os-brain prove
npx -y github:liuanye9-lab/codex-os-brain status
npx -y github:liuanye9-lab/codex-os-brain embedding --status
npx -y github:liuanye9-lab/codex-os-brain demo --task "fix dashboard, update docs, run checks"
npx -y github:liuanye9-lab/codex-os-brain metrics --json
npx -y github:liuanye9-lab/codex-os-brain effect
npx -y github:liuanye9-lab/codex-os-brain dashboard
```

After npm publication or a global install, the shorter commands are available:

```bash
npx -y agentic-coding-os-brain@latest install --global-agentic
acob prove
acob status
acob embedding --status
acob dashboard
```

## Verify Global Coverage

```bash
npx -y github:liuanye9-lab/codex-os-brain status
```

## Verify Local Embedding

```bash
npx -y github:liuanye9-lab/codex-os-brain embedding --status
npx -y github:liuanye9-lab/codex-os-brain embedding --setup
```

If Ollama is missing, install Ollama and rerun `npx -y github:liuanye9-lab/codex-os-brain embedding --setup`. ACOB keeps the harness usable even when local embedding is not available yet.

## Verify Agentic Dispatch

```bash
npx -y github:liuanye9-lab/codex-os-brain agents
npx -y github:liuanye9-lab/codex-os-brain dispatch --task "实现 dashboard 功能，更新文档，运行测试，准备发布" --json
```

The dispatch gate should open for a multi-step, verifiable, low-risk task. For small or high-privacy prompts, the gate should remain closed and the parent agent should work directly or request approval.

The installer also writes a removable managed block to `~/.codex/AGENTS.md` so future Codex conversations receive the global Agentic Coding rule even outside a specific project.

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

If an older or private local harness already provides a compatible hook, `status` may report `status: hybrid_active`. Treat this as healthy when the scope is still `all_codex_prompts_on_this_codex_home`.

## Remove

```bash
npx -y github:liuanye9-lab/codex-os-brain uninstall
```

Keep the runtime folder but remove hooks:

```bash
npx -y github:liuanye9-lab/codex-os-brain uninstall --keep-runtime
```
