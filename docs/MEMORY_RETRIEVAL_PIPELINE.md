# Memory Retrieval Pipeline

ACOB treats memory retrieval as an auditable pipeline, not as "dump everything into a vector database".

The public v1 pipeline demonstrates:

- memory write policy
- retrieval query rewrite
- vector recall slot through local Ollama embedding
- keyword and metadata fallback
- rerank
- freshness score
- privacy label
- conflict detection
- expiry / forget
- context pack injection

Run:

```bash
npm run memory:retrieve -- --example
acob memory-retrieval --example
```

Default embedding slot:

```text
qwen3-embedding:0.6b
```

The example does not read private live memory. It uses sanitized public example memory items and returns a context pack with included and dropped items.

Core contract:

| Step | Rule |
|---|---|
| Write policy | memory starts as candidate-only |
| Query rewrite | expand only task-relevant retrieval terms |
| Vector recall | optional local embedding path, never final truth |
| Rerank | combine keyword, freshness, evidence, conflict, privacy |
| Privacy label | private or unclear memory becomes placeholder or blocked |
| Conflict detection | conflicting memory requires source readback |
| Expiry / forget | expired or low-value memory is dropped from context |
| Context pack | inject bounded items with include/drop reasons |

