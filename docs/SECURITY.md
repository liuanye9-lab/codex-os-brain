# Security and Privacy

Agentic Coding OS Brain (ACOB) is designed for public distribution. The package must remain free of personal runtime data.

## Never Commit

- `MEMORY.md`
- `USER.md`
- `STATE.md`
- `IDENTITY.md`
- `SOUL.md`
- `auth.json`
- `credentials.json`
- `.env`
- local logs
- JSONL runtime ledgers
- private dashboard artifacts
- API keys, access tokens, private keys, cookies, or session dumps

## Before Publishing

Run:

```bash
npm run privacy:scan
node scripts/check-public-package.mjs
npm run check
npm pack --dry-run
```

Then inspect the package file list. It should match the allowlist enforced by `scripts/check-public-package.mjs` and `package.json.files`:

- `bin/`
- `dashboard/`
- `evals/`
- `examples/`
- `os-agent/`
- `plugins/`
- `research-reviews/`
- `runtime/`
- `schemas/`
- `scripts/`
- `skills/`
- `templates/`
- `tools/`
- `v2/` through `v7/`
- `docs/`
- `README.md`
- `LICENSE`
- `package.json`

The package should stay intentionally small. Do not add a new packaged directory unless it is needed for install, runtime behavior, verification, examples, or public documentation.

## Hook Safety

The installer backs up `~/.codex/hooks.json` before writing. It removes only hook commands containing `.acob` during reinstall or uninstall.

The runtime scripts follow a fail-open policy: if a hook script fails, it exits without blocking Codex.

## Dashboard Safety

The dashboard is local-only by default:

```text
http://127.0.0.1:8791/
```

Do not expose it to the public internet unless you add authentication and review the data boundary.
