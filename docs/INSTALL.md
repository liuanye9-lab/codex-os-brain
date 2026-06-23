# Install Guide

## macOS / Linux

```bash
npx codex-os-brain install
codex-os-brain status
codex-os-brain dashboard
```

## Windows PowerShell

```powershell
npx codex-os-brain install
codex-os-brain status
codex-os-brain dashboard
```

If the package is not published to npm yet:

```bash
npx github:liuanye9-lab/codex-os-brain install
```

## Verify Global Coverage

```bash
codex-os-brain status
```

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
