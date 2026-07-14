# Claude Brain distillation audit — 2026-07-14

## Source

- Repository: [384961890-ui/claude-brain](https://github.com/384961890-ui/claude-brain)
- Inspected commit: [`126c47c5e323e8ea8dafbafd3881139360838dce`](https://github.com/384961890-ui/claude-brain/commit/126c47c5e323e8ea8dafbafd3881139360838dce)
- License: [MIT](https://github.com/384961890-ui/claude-brain/blob/126c47c5e323e8ea8dafbafd3881139360838dce/LICENSE)
- Maintenance snapshot: one parentless sanitized public release commit; useful as a mechanism sample, not sufficient evidence for wholesale runtime adoption.

No source code was copied. The mechanisms below were independently implemented against this repository's existing V8 interfaces and tests.

## Adopted and adapted

1. **Orthogonal loops** became a pre-experiment Orthogonality Gate. Unlike the source project, it does not add a hook or prompt loop; it rejects mechanisms that cannot declare a unique failure mode, budgets, verifier, disable condition and off switch.
2. **Lesson efficacy attribution** became offline Evidence/Skill outcome attribution over existing privacy-safe Trace V2 events. The source heuristic behavior score was not reused. Our version requires distinct tasks and verifier coverage, calls the result observational, and never changes lifecycle automatically.
3. **Index gardener** became a read-only index-health check for the actual Brain Lite vector index. It reports stale, dataless, unindexed, missing and temporary state using counts and hashed source references; it does not write a diary or repair files.

## Explicitly rejected

- always-on UserPromptSubmit, Stop, PostToolUse and PostToolUseFailure hook stacks;
- full IDENTITY/STATE/diary injection;
- think-loop, idea-loop and smell-check prompt injection;
- heuristic scoring that treats generic reads as validation or early writes as inherently bad;
- Telegram, external-model and launchd autonomous-loop dependencies;
- automatic lesson promotion, decay or memory rewriting.

## Local constraints preserved

- hooks remain disabled;
- ordinary tasks incur no Brain model call or mandatory V8 process;
- persistent instructions remain capped at 800 estimated tokens;
- recall remains capped at 900 estimated tokens;
- all new modules are independently disableable;
- daily review is deterministic and read-only for attribution and index health.
