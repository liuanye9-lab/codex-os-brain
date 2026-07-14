# Privacy and Threat Model

## Protected data

- Credentials, tokens, environment files, and authentication material.
- Identity, soul, memory, state, and private project adapters.
- Raw prompts, chain-of-thought, transcripts, session archives, and raw tool output.
- Local absolute paths and unreviewed V1–V8 data.

## Data written by V9

Task contracts store objectives, explicit constraints, scope, criterion states, and evidence references. Events use a fixed allowlist of identifiers, status, reason code, signature, duration, and timestamps. Failure signatures are hashes over bounded classifications, not raw error bodies.

Files are created with private runtime permissions. Hot hooks make no network or model request.

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
