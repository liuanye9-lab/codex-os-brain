# Hook Coverage Matrix

This matrix describes the harness contract, not a claim that every Codex host version emits every event. Run `brain doctor --project "$PWD" --json` after installation and verify the host behavior in the target environment.

V11 registers three events. Every other lifecycle event is left to the host; a sensor with no distinct
failure mode is cost, not coverage.

| Event | Harness behavior | Failure mode it catches | Can block when host honors output | Failure policy | Regression coverage |
|---|---|---|---:|---|---|
| `SessionStart` | bounded local session recall | lost contract context after a new or resumed session | no | fail open | handler + install smoke |
| `PreToolUse` | path and risk decision | action outside the signed task boundary | yes | fail closed | policy + hook tests |
| `Stop` | real-time verifier rerun and completion gate | completion claimed without passing acceptance | yes | fail closed | completion tests |

`PreToolUse` and `Stop` are the only declared blocking paths.

Removed in V11 (previously registered, now unregistered): `SessionEnd`, `UserPromptSubmit`,
`PostToolUse`, `PermissionRequest`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`.
These were observation-only or duplicated `PreToolUse`, and the installer no longer writes them.
An entry for one of these events in a user's `hooks.json` therefore belongs to the user and is never
modified or removed by this installer.

A registered hook is not an operating-system security boundary: direct filesystem writes, processes that bypass the host hook protocol, a modified package runtime, and a malicious process running as the same OS user remain outside the guarantee.

The manifest provides a POSIX command and a Windows command form. The CI matrix exercises source and production smoke tests on Linux, macOS, and Windows, but it does not prove that an arbitrary future host release will preserve identical event names or decision semantics.

## Tool-path coverage

| Operation path | Observed by declared hooks | Current decision strength | Tested locally |
|---|---:|---|---:|
| Bash / `exec_command` | yes | path/risk decision; unresolved bounded scope asks for confirmation | yes |
| `apply_patch` / Write / Edit | yes | patch headers are parsed; forbidden/out-of-scope paths block | yes |
| MCP filesystem | yes when the host emits local tool hooks | common path fields are checked; unknown write shapes ask for confirmation | policy unit coverage; live host pending |
| MCP database | yes when the host emits local tool hooks | write/query-like names with unresolved bounded scope ask for confirmation | policy unit coverage; live database pending |
| Agent / `spawn_agent` | yes; canonical matcher is `Agent` | unresolved bounded scope asks for confirmation; child actions still need their own hooks | policy unit coverage; live host pending |
| `PermissionRequest` | yes | risk decision; internal failure is fail closed | manifest/dispatch coverage; live host pending |
| Hosted tools such as WebSearch | no | none | documented limitation |

The manifest uses `matcher: "*"`, so new local function and MCP tool names are not silently excluded by a narrow name regex. Unknown argument shapes are not interpreted as proof that an action is in scope.
