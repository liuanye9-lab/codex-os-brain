# Install Guide

## macOS / Linux

```bash
npx codex-os-brain install --global-agentic
codex-os-brain status
codex-os-brain dashboard
```

## Windows PowerShell

```powershell
npx codex-os-brain install --global-agentic
codex-os-brain status
codex-os-brain dashboard
```

If the package is not published to npm yet:

```bash
npx github:liuanye9-lab/codex-os-brain install --global-agentic
```

## Verify Global Coverage

```bash
codex-os-brain status
```

## Verify Agentic Dispatch

```bash
codex-os-brain agents
codex-os-brain dispatch --task "实现 dashboard 功能，更新文档，运行测试，准备发布" --json
```

The dispatch gate should open for a multi-step, verifiable, low-risk task. For small or high-privacy prompts, the gate should remain closed and the parent agent should work directly or request approval.

Expected:

```text
status: global_active
scope: all_codex_prompts_on_this_codex_home
```

## Remove

```bash
codex-os-brain uninstall
```

Keep the runtime folder but remove hooks:

```bash
codex-os-brain uninstall --keep-runtime
```
