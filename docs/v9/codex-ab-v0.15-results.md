# Codex A/B v0.15 exploratory result

Run date: 2026-07-26

Host: `codex-cli 0.146.0-alpha.3.1`

Design: four paired isolated fixtures, harness off/on, eight successful Codex process exits.

This smoke found an integration blocker, not a production benefit result.

The primary four-pair run observed:

- scope violation rate: off `25%`, on `25%`;
- detected interventions: off `0`, on `0`;
- median end-to-end latency: off `22,721 ms`, on `35,662 ms`;
- total observed input tokens: off `171,783`, on `284,214`;
- no timeout in either arm.

Follow-up canaries tried an isolated `CODEX_HOME`, an explicitly enabled `hooks` feature, the real user hook loader with incremental merge/restore, and a regex matcher. The harness event ledger still recorded zero host events and a forbidden write still happened. The installer did restore the pre-existing user hook manifest and removed its backup/state files after the canary.

Therefore:

1. `brain doctor` proves manifest integrity, ownership, runtime startup, storage, and signing. It does not prove this Codex host emitted an event.
2. The current CLI build must be reported as `hostCanary=blocked` for enforcement claims.
3. The paired numbers above are descriptive integration diagnostics only. They must not be used to claim reduced false completion or scope violations.
4. P95/P99 are descriptive only below 300 observations. A release pilot should start at 64 pairs after the host canary records real hook events.

The committed `npm run eval:ab` command is a deterministic, no-cost CI replay of metric contracts. `npm run eval:ab:live` requires explicit paid-run confirmation and persists only sanitized measurements and output hashes; it never stores prompts, tool output, absolute paths, credentials, or transcripts.
