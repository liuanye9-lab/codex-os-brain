# V9 Quickstart

## Install

Use Node.js 22.5 or newer. The transactional memory layer uses the built-in `node:sqlite` API.

```bash
npm install --global codex-brain-v9@0.16.0
codex-brain hooks enable --project "$PWD" --confirm --json
codex-brain doctor --project "$PWD" --json
```

For source development:

```bash
git clone https://github.com/liuanye9-lab/codex-os-brain.git
cd codex-os-brain
npm install
npm test
npm run eval:reliability
npm link
brain --help
brain doctor --json
```

Set `CODEX_BRAIN_HOME` for configuration state and `CODEX_BRAIN_STATE_HOME` for mutable local state. With `projectScoped: true`, task, event, failure, embedding, and SQLite paths are partitioned by a hash of the normalized project root. If unset, the CLI uses `~/.codex-brain` and an OS-local application-state directory, but projects remain isolated from one another.

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

For a reviewed contract with custom verifiers, prefer a file:

```bash
brain task create --from task-contract.json --json
```

`command_exit_0` requires `verifierSpec.humanApproved: true` inside the signed contract. All verifier processes use executable/argv execution with `shell: false` and a cleaned environment. The quick CLI flag equivalent is `--approve-custom-verifier`, which should only be used after the operator reviews the command.

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
brain memory create --kind preference --content "prefer local embeddings" --json
# Review the returned memory_id and version before promotion:
brain memory transition --id <memory_id> --status confirmed --expected-version 1 --approved-by operator --json
brain memory query --query "local embeddings" --json
```

Memory is candidate-first. Default query excludes candidates, rejected items, retired items, and confirmed items outside their half-open validity window `[valid_from, valid_to)`.

```bash
brain memory create --kind decision --content "temporary release rule" \
  --valid-from 2026-07-25T00:00:00Z --valid-to 2026-08-01T00:00:00Z --json
brain memory query --query "release rule" --at 2026-07-27T00:00:00Z --json
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

Codex currently loads command hooks from `$CODEX_HOME/hooks.json` (normally `~/.codex/hooks.json`). Enable preserves foreign hook groups, records the Codex Brain owner marker, and creates a private backup plus install-state file beside that loader. Disable restores the exact original, permissions, and symlink when the installed file has not drifted. If another tool adds hooks after installation, disable removes only Codex Brain-owned groups and preserves those later edits. The loader is user-scoped, while control state, contracts, events, evidence, and memory remain project-scoped and are silent when no active project task exists.

`brain hooks doctor` verifies owner, all eleven declared events, duplicate or mismatched groups, manifest fingerprint, package version, installed runtime digest, runtime smoke, storage writability, and a real temporary evidence-signing round trip. It may initialize the OS-local evidence key. A valid foreign-only manifest remains valid but reports `enabled: false`.

The signed acceptance contract pins `required`, verifier kind, and `verifierSpec`. Runtime calls cannot replace the verifier command. Empty criteria, unsigned waivers, or disabling harness verification never produce `complete`. Evidence keys use macOS Keychain, Windows current-user DPAPI, or Linux Secret Service. Linux falls back to a local `0600` key file when Secret Service is unavailable; this weaker mode does not defend against a malicious process running as the same OS user.

See [Hook Coverage Matrix](hook-coverage.md) and [Privacy and Threat Model](privacy-and-threat-model.md).

## MCP

```bash
brain mcp serve
npm run mcp:probe
```

Read tools include status, task, verify (re-run), failures, events, embeddings, handoff, skills, memory recall.  
Mutations: create task, checkpoint, claim evidence, activate skill, close (after harness verify).  
Never: self-certify passed, download models, migrate, bypass policy.

## Reliability eval (P2)

```bash
npm run eval:reliability
```

The runner allocates a temporary project root and separate Brain/state homes. It never initializes or rewrites the caller project's `.brain`.

## Optional local embeddings

```bash
brain embeddings recommend --profile zh-light --json
brain embeddings doctor --json
```

See [local embeddings](local-embeddings.md).

## Disable or fall back

- `brain hooks disable --confirm`
- `brain memory recover --confirm` clears a proven-stale restore lock and crash journal without requiring another restore
- Set V9 `enabled` to false for read-only runtime
- `fallbackVersion: 8` is compatibility metadata only. V8 is not bundled or runtime-selectable; use a separately retained V8 installation for rollback.
- Migration / publish never exposed as MCP mutations
