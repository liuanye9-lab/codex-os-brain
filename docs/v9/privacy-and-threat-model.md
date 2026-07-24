# Privacy and Threat Model

## Protected data

- Credentials, tokens, environment files, and authentication material.
- Identity, soul, memory, state, and private project adapters.
- Raw prompts, chain-of-thought, transcripts, session archives, and raw tool output.
- Local absolute paths and unreviewed V1–V8 data.

## Data written by V9

Task contracts store objectives, explicit constraints, scope, criterion states, and evidence references. Events use a fixed allowlist of identifiers, status, reason code, signature, duration, and timestamps. Failure signatures are hashes over bounded classifications, not raw error bodies.

Files are created with private runtime permissions. Hot hooks make no network or model request.

## Data lifecycle

| Data | Authoritative location | Default lifecycle | Delete meaning |
|---|---|---|---|
| Task contracts, events, failures, handoff | `CODEX_BRAIN_STATE_HOME` runtime tree | Local until the operator removes the isolated state tree | Runtime file removal; no remote copy is created by V9 |
| Memory, provenance, feedback, eval cases | Local SQLite + WAL | Candidate/confirmed/rejected/retired lifecycle with append-only audit events | `brain memory delete` retires or rejects and removes recall indexing; it is a soft tombstone, not forensic erasure |
| Embeddings | Local SQLite, keyed by model fingerprint | Rebuilt when the fingerprint changes | Removed with the database or an operator-managed maintenance action |
| Encrypted backups | Operator-selected private sync target | Retained until the operator deletes the `.cbmem` packages | Retiring a memory does not rewrite existing encrypted backups |
| Public export | New allowlisted directory | Static release artifact | Excludes runtime state, raw databases, memory, credentials, and private paths |

`CODEX_BRAIN_HOME` selects the installation/configuration home. `CODEX_BRAIN_STATE_HOME` isolates mutable runtime state. Do not point the live SQLite WAL database at iCloud, NFS, or another sync filesystem.

## Decisions

| Boundary | Behavior when policy cannot be verified |
|---|---|
| Credential or privacy boundary | Fail closed |
| Explicit forbidden scope | Fail closed |
| Destructive or external write | Require confirmation |
| Unsupported completion claim | Fail closed |
| Advisory telemetry or checkpoint observer | Fail open and record an internal error when possible |

## Public release boundary

The public repository is constructed in a new directory from `config/public-export-allowlist.json`. The builder rejects parent traversal, absolute paths, symlinks, dataless files, and a nonempty destination. The export manifest contains public relative paths, sizes, and hashes only.

Before release, scan:

1. Source and file names.
2. Generated export contents.
3. Package contents from `npm pack --dry-run --json`.
4. Staged Git diff.
5. The outgoing commit range.

No threat model can guarantee that a new secret format will be detected. Review the allowlist and staged diff before every public push.
