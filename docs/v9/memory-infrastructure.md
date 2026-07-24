# V9 Transactional Memory Infrastructure

V9 uses a local SQLite database as the authoritative runtime store. Markdown remains a human-reviewable source and export format; grep remains a diagnostic locator. Neither is presented as the transactional memory layer.

## Storage boundary

The default database is outside the repository and outside the iCloud-backed Brain directory:

```text
~/Library/Application Support/CodexBrain/runtime/v9/memory/memory.sqlite3
```

Override it with `CODEX_BRAIN_STATE_HOME` for tests or isolated installations. Do not place a WAL database on a network or cloud-synchronized filesystem.

The database enables WAL, `synchronous=FULL`, foreign keys, constraints, a 5-second busy timeout, optimistic versions, idempotent event keys, and private `0600` permissions.

## P0-P4 capability boundary

P0: `config/v9-capabilities.json` maps every public claim to a verifier. Live deployment copies implementation and tests from the Git source; generated databases and private records are never committed.

P1: `memory_items`, `memory_events`, `source_documents`, and `search_index` provide candidate-first CRUD, audit history, provenance, transactional updates, FTS5 trigram matching, and BM25 ranking.

P2: `embeddings` persists Float32 vectors by model fingerprint. Query embeddings come only from the configured loopback Ollama endpoint. If it is unavailable, retrieval degrades to FTS5 and reports that degradation. Exact cosine is the baseline until a measured corpus-size or latency threshold justifies ANN infrastructure.

P3: `entities` and `edges` support approved, temporal relationships. Recursive CTE traversal is bounded to depth 10. Graphiti or another graph service is considered only after fixed graph evals show that SQL traversal is insufficient.

P4: `agent_state_blocks` separates working, core, project, archival, and external context. `retrieval_feedback`, `retrieval_eval_cases`, `harness_runs`, and `evolution_candidates` form the sustainable improvement loop.

## Governance loop

```text
source evidence -> transactional ingest -> hybrid retrieval -> task use
      -> explicit feedback -> fixed eval -> harness cycle
      -> reviewable evolution candidate -> operator approval -> bounded experiment
      -> verify next comparable cases -> keep or revert
```

The harness never promotes memory or applies policy automatically. A memory starts as `candidate`. Promotion to `confirmed`, retirement of confirmed memory, active graph edges, read-only state changes, and evolution adoption require explicit approval plus an expected version.

## Temporal validity

Memory validity uses RFC 3339 timestamps normalized to UTC and a half-open interval:

```text
[valid_from, valid_to)
```

An item is visible at `valid_from` and invisible at `valid_to`. Null bounds mean unbounded. The same validity predicate is enforced for lexical and vector candidates, so an expired confirmed memory cannot re-enter through semantic ranking.

```bash
brain memory create --kind decision --content "temporary release rule" \
  --valid-from 2026-07-25T00:00:00Z --valid-to 2026-08-01T00:00:00Z
brain memory query --query "release rule" --at 2026-07-27T00:00:00Z
```

Malformed timestamps and zero/negative intervals fail before database writes.

## Commands

```bash
brain memory status
brain memory create --kind fact --content "candidate content"
brain memory transition --id mem_x --status confirmed --expected-version 1 --approved-by operator
brain memory delete --id mem_x --expected-version 2 --approved-by operator --reason "superseded"
brain memory query --query "transactional retrieval"
brain memory query --query "transactional retrieval" --semantic
brain memory aggregate --by status
brain memory import-index --input /absolute/path/to/index.json --confirm
brain memory entity --type project --name Brain
brain memory link --from ent_a --to ent_b --relation adopts --status active --approved-by operator
brain memory traverse --id ent_a --depth 3
brain memory state-put --id current-goal --agent agent-a --scope working --content "verify kernel"
brain memory feedback --query "..." --signal missed
brain memory eval-add --id zh-001 --query "..." --expected doc_x --tags zh
brain memory backup --confirm
brain memory backup-key-init --confirm
brain memory backup-encrypted --confirm
brain memory backup-verify --input /path/to/backup.cbmem
brain memory backup-compare --input /path/to/incoming.cbmem
brain memory restore-encrypted --input /path/to/incoming.cbmem --confirm-restore
brain memory recovery-drill --share-a /offline/a.cbkey --share-b /offline/b.cbkey --passphrase-a-file /private/pass-a --passphrase-b-file /private/pass-b --input /path/to/backup.cbmem
brain harness cycle
brain harness candidates
```

The existing Brain Lite daily review runs the memory Harness cycle by default. Use `--no-memory-harness` only for isolated diagnostics. Run `npm run memory:v9:capabilities` and `npm run test:v9:memory` before deployment. For local recovery, back up with `brain memory backup --confirm`; never copy only the main file while `-wal` contains committed transactions. For repository or cloud synchronization, use `brain memory backup-encrypted --confirm` and sync only `.cbmem` packages. See `encrypted-backup-and-sync.md`.
