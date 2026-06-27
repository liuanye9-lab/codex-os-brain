# ACOB Quickstart

Use ACOB with one command and no hosted backend.

## GitHub Install

```bash
npx -y github:liuanye9-lab/codex-os-brain quickstart
```

This command:

1. installs the public runtime into `~/.acob`
2. updates Codex hooks under `~/.codex/hooks.json`
3. adds the global ACOB agentic preflight block to `~/.codex/AGENTS.md`
4. verifies the install with `acob status --summary`

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

## Verify

```bash
acob status
acob agents
acob dispatch --task "refactor dashboard, update docs, run checks" --json
acob check
```

## Cost And Privacy

- no hosted backend
- no database setup
- no paid model call during install
- no private memory packaged
- no raw prompt stored in public artifacts
- local runtime state stays under `~/.acob`
