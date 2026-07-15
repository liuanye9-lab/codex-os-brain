# V9 Reliability Control Plane (P0–P6)

Plain-language map of the 0.10.0 reliability upgrades.

| Priority | What we built | Everyday analogy | CLI surface |
|---|---|---|---|
| **P0** | Executable evidence verifiers | Teacher re-grades the exam; student self-score doesn't count | `brain verify` (re-runs), `brain evidence claim` |
| **P1** | Session handoff artifacts | Shift-change notebook for the next engineer | `brain handoff init\|status\|progress` |
| **P2** | Reliability eval suites | Driving test scorecard with four stations | `npm run eval:reliability` |
| **P3** | Capability path policy | Security checkpoint with path maps, not keyword stickers | PreToolUse via `policy.js` |
| **P4** | Skills welded to evidence | Temp worker badge: budget + expected deliverables | `brain skill activate\|list` |
| **P5** | Multi-host adapters | Universal plug (Codex / Claude / MCP) | `brain hosts list`, `BRAIN_HOST=` |
| **P6** | Versioned memory | Sticky notes labeled “unverified” until stamped | `brain memory add\|recall\|list` |

## Hard rules

1. **Only harness re-runs** can set `harnessVerified: true` and promote a criterion to `passed`.
2. MCP `brain_attach_evidence` is always a **claim** (unverified).
3. Feature backlog `passes: true` requires `verified: true` from handoff API.
4. Recalled memory is injected with `[UNVERIFIED MEMORY]` and is never instruction.
5. Skill outputs are evidence candidates with explicit criteria and token budgets.

## Verifier kinds

- `command_exit_0` / `command` — shell command must exit 0  
- `test_runner` / `tests` — default `npm test` (override with `verifierSpec.command`)  
- `git_diff_bounded` / `scope` — changed paths must stay in allow/deny lists  
- `human_attestation` — shared token confirmation  
- `file_exists` — path must exist  

## Eval suites

```bash
npm run eval:reliability
```

Reports JSON for: false-completion, loop, overreach, tax (latency budgets).
