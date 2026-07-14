# Optional local embeddings with Ollama

V9 treats embeddings as an optional offline recall backend. They are not part of hook policy, they do not authorize actions, and retrieved text remains evidence that the Agent must verify.

## Why combine a reasoning model with local embeddings

A reasoning model and an embedding model solve different problems. The reasoning model plans and evaluates; the embedding model cheaply narrows a large local memory into a few semantically relevant candidates. That keeps irrelevant history out of the prompt, reduces repeated context tokens, and makes recall useful even when the query does not share exact keywords with the source.

Running the embedding model locally keeps raw recall queries and indexed memory on the machine. A lexical path remains available when Ollama is unavailable or the index fingerprint is stale. This combination improves candidate selection; it does not prove that recalled content is current or correct.

## Install Ollama

Use the official instructions for [macOS](https://docs.ollama.com/macos), [Linux](https://docs.ollama.com/linux), or [Windows](https://docs.ollama.com/windows). V9 does not silently install Ollama or download a model.

Check the local runtime:

```bash
ollama --version
brain embeddings recommend --profile zh-light --json
brain embeddings doctor --json
```

Available built-in profiles are deliberately small: `zh-light` (`qwen3-embedding:0.6b`), `zh-balanced` (`4b`), and `zh-quality` (`8b`). They are starting points, not rankings. The official Ollama library currently lists approximate downloads of 639 MB, 2.5 GB, and 4.7 GB respectively. Choose with a project retrieval canary and actual hardware measurements.

## Download, configure, and probe

Every download and configuration change is explicit:

```bash
brain embeddings pull --model qwen3-embedding:0.6b --confirm-download --json
brain embeddings configure \
  --model qwen3-embedding:0.6b \
  --endpoint http://127.0.0.1:11434/api/embed \
  --confirm --json
brain embeddings probe --text "中文和代码召回探针" --json
```

Only the loopback `/api/embed` endpoint is accepted. A successful probe reports the model, dimensions, and fingerprint but never prints the vector.

`dimensions` is part of the identity. If an adapter chooses a reduced dimension supported by the model, configure it explicitly:

```bash
brain embeddings configure --model qwen3-embedding:0.6b --dimensions 768 --confirm --json
```

## Reindex contract

Ollama requires the same embedding model for indexing and querying. V9 extends this to the endpoint and requested dimensions by hashing all three into an `embeddingFingerprint`.

Any identity change sets `requiresReindex: true`. Until every readable source is rebuilt, recall must use lexical fallback. An indexer may clear the state only by producing JSON evidence with the configured fingerprint, at least one vector, and zero embedding failures. Unreadable or cloud-placeholder sources are reported separately and do not disappear behind a ready flag:

```json
{
  "embeddingFingerprint": "emb_000000000000000000000000",
  "vectorCount": 120,
  "failedCount": 0,
  "sourceWarningCount": 0
}
```

Then bind the verified index to the active configuration:

```bash
brain embeddings mark-indexed \
  --manifest /path/to/index-manifest.json \
  --confirm --json
```

The private Brain Lite indexer writes these fields directly into its index file and refuses to reuse vectors across fingerprints.

## Agent adaptation prompt

Retrieve the maintained prompt through CLI or MCP:

```bash
brain embeddings prompt --json
```

MCP exposes `brain_get_embedding_status` and `brain_get_embedding_adaptation_prompt`. It cannot install, pull, configure, or mark an index current.

The prompt makes the Agent check hardware and privacy constraints, select by measured Chinese/code retrieval quality and latency, rebuild on identity change, run a fixed canary, preserve lexical fallback, and treat recalled content as untrusted evidence.

## Official interface references

- [Ollama embedding API](https://docs.ollama.com/api/embed)
- [Ollama embeddings capability guide](https://docs.ollama.com/capabilities/embeddings)
- [Ollama qwen3-embedding library](https://ollama.com/library/qwen3-embedding)
