# Privacy and Threat Model

## Protected data

- Credentials, tokens, environment files, and authentication material.
- Identity, soul, memory, state, and private project adapters.
- Raw prompts, chain-of-thought, transcripts, session archives, and raw tool output.
- Local absolute paths and unreviewed V1–V8 data.

## Data written by V9

Task contracts store objectives, explicit constraints, scope, criterion states, and evidence references. Events use a fixed allowlist of identifiers, status, reason code, signature, duration, and timestamps. Failure signatures are hashes over bounded classifications, not raw error bodies.

Files are created with private runtime permissions. `0600` permissions are access control, not encryption. The live SQLite database is plaintext; Memory and Cognitive Labs are therefore disabled by default, and the public cognitive provider refuses sensitive inferences instead of silently persisting them. Hot hooks make no network or model request.

## Data lifecycle

| Data | Authoritative location | Default lifecycle | Delete meaning |
|---|---|---|---|
| Task contracts, events, failures, handoff | `CODEX_BRAIN_STATE_HOME` runtime tree | Local until the operator removes the isolated state tree | Runtime file removal; no remote copy is created by V9 |
| Memory, provenance, feedback, eval cases | Local SQLite + WAL | Candidate/confirmed/rejected/retired lifecycle with append-only audit events | `brain memory delete` retires or rejects and removes recall indexing; expired cognitive sources can be tombstoned by the confirmation-gated retention controller; neither path is forensic erasure |
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

## Trust boundary and platform key storage

Contract and evidence seals protect against direct edits to task JSON when the signing key remains outside that JSON tree. macOS uses Keychain, Windows uses current-user DPAPI, and Linux first attempts Secret Service through `secret-tool`. A Linux host without Secret Service falls back to a local `0600` key file; this is a compatibility mode with a weaker boundary.

The same operating-system user is not treated as hostile. A process that can modify the installed npm package, hook runner, process environment, credential store, or local key file can replace the verifier or obtain equivalent authority. Use a separate OS account, container, VM, or CI protection boundary when same-UID adversaries are in scope.

The built-in test runner is cooperative. It seals package scripts, lockfiles, and test inputs at task creation and refuses to run when they drift, but it still executes with the current user identity and a reduced environment. Its result is `project_tests`, not `trusted_acceptance`. A contract that requires trusted acceptance stays blocked until an isolated runner is configured.

Path preflight resolves the nearest existing parent for new files, which closes parent-symlink lexical escapes. It does not eliminate TOCTOU or indirect writes through arbitrary interpreters. Treat command parsing as a risk heuristic and combine PreToolUse with PostToolUse, Git diff review, and an OS sandbox for hostile workloads.

`brain doctor` verifies manifest ownership, declared event completeness, manifest fingerprint, installed package version, runtime digest, storage writability, hook process startup, and a temporary contract/evidence signing round trip. It may initialize the platform evidence key on first use. These checks detect drift and broken integration; they are not remote attestation.

## Public release boundary

The public repository is constructed in a new directory from `config/public-export-allowlist.json`. The builder rejects parent traversal, absolute paths, symlinks, dataless files, and a nonempty destination. The export manifest contains public relative paths, sizes, and hashes only.

Before release, scan:

1. Source and file names.
2. Generated export contents.
3. Package contents from `npm pack --dry-run --json`.
4. Staged Git diff.
5. The outgoing commit range.

No threat model can guarantee that a new secret format will be detected. Review the allowlist and staged diff before every public push.
