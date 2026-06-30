# Public / Private Repository Boundary

ACOB can be used with two repository surfaces:

- this public package for general users
- a separate private workspace for personal operating habits, continuity, and local runtime coordination

This public repository must stay small, installable, and privacy-safe.

## Public Repository

Keep only reusable, audience-facing assets:

- CLI entry points and runtime templates
- public hook templates
- local dashboard code that reads sanitized state only
- schemas, synthetic examples, and smoke evals
- public docs, quickstart, security notes, and release checklist
- privacy scanner and public package checks

Do not commit:

- live personal memory, persona, user profile, or state files
- raw prompts, raw logs, audit trails, sqlite/db files, vector indexes, or generated runtime data
- `.env`, credentials, tokens, tunnel URLs, API keys, cookies, or private keys
- private absolute paths or machine-specific config
- duplicated iCloud conflict files such as `README 2.md`
- heavyweight artifacts, caches, model files, build output, or dependency folders

## Private Repository

The private repository may hold Lay-specific operating mechanisms and personal workflow preferences, but it still must not become a raw data dump.

Private-safe content includes:

- personal governance docs and approved operating rules
- cross-device coordination scripts and setup notes
- sanitized memory workflows, schemas, and examples
- local performance, token-budget, and recall mechanisms
- private release notes and handoff docs
- richer local-only metrics reports that may reference personal projects without exposing raw private memory

Still keep out of GitHub, even in private:

- raw secret values
- raw chat/session logs
- generated vector indexes
- runtime sqlite/db files
- tunnel runtime logs
- local cache directories
- unreviewed historical audit files

## Kano Simplification Rule

Use Kano as the pruning rule for public release:

| Kano class | Public action |
|---|---|
| Basic | Keep privacy scan, local-only storage, installer safety, smoke tests, and minimal docs. |
| Performance | Improve startup speed, package size, command clarity, verification coverage, and daily local metrics. |
| Excitement | Keep optional dashboard, local embedding, and dispatch demos only when they stay lightweight. |
| Indifferent | Remove duplicate docs, unused examples, generated files, and internal handoff clutter. |
| Reverse | Block raw private memory, secrets, machine paths, hidden telemetry, and large opaque artifacts. |

## Release Gate

Run before publishing or pushing public release changes:

```bash
npm run privacy:scan
npm run smoke
node scripts/check-public-package.mjs
npm run check
npm pack --dry-run
git status -sb
```

The public package is healthy when the tarball stays intentionally small and every included file is useful to a new user.
