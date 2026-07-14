# Evidence-Gated Behavioral Memory Integration

This package adds an optional behavioral-memory layer to Codex OS Brain V8. It keeps native parent execution as the default and treats host hooks as disabled, sensor-only adapters.

## What it adds

- Claude Code, Codex, ZCode, and generic event normalization.
- Correction detection after injected control blocks are removed.
- Privacy-safe candidate creation without raw prompt persistence.
- Exact-rule deduplication and conservative same-scope conflict review.
- Policy Lab and Skill Lifecycle reuse for replay, paired evaluation, canary, promotion, and revocation.
- Promoted-only Context Economy recall with a separate 300-token and 2-item default cap.
- HMAC-pseudonymous, text-free research export.
- Revision-checked, lock-protected local writes with corrupt-store preservation.
- Allowlisted behavioral trace metadata with a salted candidate reference.

## What it deliberately does not add

- Always-on hooks.
- Automatic prompt injection of every remembered correction.
- Causal claims from tool-call counts or heuristic behavior scores.
- Automatic promotion after one user correction.
- Automatic activation of external-write rules.
- Raw prompt, session ID, private path, or hidden reasoning storage.

## Files to add to Codex OS Brain

```text
scripts/brain-lite-host-event-normalizer.js
scripts/brain-lite-correction-detector.js
scripts/brain-lite-behavioral-memory.js
scripts/brain-lite-candidate-store.js
scripts/brain-lite-behavioral-policy.js
scripts/brain-lite-behavioral-context.js
scripts/brain-lite-behavioral-privacy-export.js
scripts/brain-lite-behavioral-trace.js
scripts/brain-lite-behavioral-memory-cli.js
schemas/behavioral-memory-candidate.schema.json
tests/brain-lite-behavioral-memory-*.test.js
```

The new modules reuse these existing V8 modules:

```text
scripts/brain-lite-common.js
scripts/brain-lite-context-economy.js
scripts/brain-lite-policy-lab.js
scripts/brain-lite-skill-lifecycle-v2.js
```

## Configuration

The feature is disabled by default:

```json
{
  "behavioralMemory": {
    "enabled": false,
    "sensorOnly": true,
    "storeRawCorrectionText": false,
    "requireExplicitRule": true,
    "contextTokenBudget": 300,
    "maxContextItems": 2,
    "hostAdapters": {
      "claudeCode": false,
      "codex": false,
      "zcode": false
    }
  }
}
```

Do not enable a host adapter until its event contract is tested against the current host version.

## CLI examples

### Detect a correction without persisting it

```bash
node scripts/brain-lite-behavioral-memory-cli.js detect \
  --host codex \
  --text "You said it was fixed, but it still fails."
```

### Capture a reviewed rule candidate

```bash
cat <<'JSON' | node scripts/brain-lite-behavioral-memory-cli.js capture \
  --store ./data/brain-lite/v8-behavioral-memory.json
{
  "host": "codex",
  "conversation_id": "local-only-id",
  "input_text": "不对，你又在没有验证时说完成了。",
  "scopeKey": "verification.delivery",
  "proposedRule": "Run the declared verifier before claiming completion.",
  "risk": "read-only"
}
JSON
```

The session identifier and raw correction text are not written into the candidate store.

### Recall promoted rules only

```bash
node scripts/brain-lite-behavioral-memory-cli.js recall \
  --store ./data/brain-lite/v8-behavioral-memory.json
```

### Evaluate paired samples

```bash
cat <<'JSON' | node scripts/brain-lite-behavioral-memory-cli.js evaluate \
  --store ./data/brain-lite/v8-behavioral-memory.json \
  --config ./config/brain-lite-v8.json
{
  "candidateId": "bm_REPLACE_WITH_REAL_ID",
  "samples": [
    {
      "sampleId": "task-a",
      "verifierHash": "sha256-of-fixed-verifier",
      "baseline": { "passed": true, "tokens": 1000, "durationMs": 1000 },
      "candidate": { "passed": true, "tokens": 790, "durationMs": 900 }
    },
    {
      "sampleId": "task-b",
      "verifierHash": "sha256-of-fixed-verifier",
      "baseline": { "passed": true, "tokens": 1100, "durationMs": 1200 },
      "candidate": { "passed": true, "tokens": 850, "durationMs": 1000 }
    },
    {
      "sampleId": "task-c",
      "verifierHash": "sha256-of-fixed-verifier",
      "baseline": { "passed": true, "tokens": 900, "durationMs": 900 },
      "candidate": { "passed": true, "tokens": 700, "durationMs": 780 }
    }
  ]
}
JSON
```

The command can move an eligible candidate to `canary`, but it cannot promote it.

### Explicitly approve a canary result

```bash
cat <<'JSON' | node scripts/brain-lite-behavioral-memory-cli.js approve-canary \
  --store ./data/brain-lite/v8-behavioral-memory.json \
  --confirm-canary
{
  "candidateId": "bm_REPLACE_WITH_REAL_ID",
  "passed": true
}
JSON
```

`capture` and `evaluate` cannot trigger this transition. External-write and high-risk candidates cannot be promoted through behavioral canary approval.

### Export text-free research rows

```bash
node scripts/brain-lite-behavioral-memory-cli.js export \
  --store ./data/brain-lite/v8-behavioral-memory.json \
  --salt "REPLACE_WITH_32_OR_MORE_RANDOM_CHARACTERS"
```

Use a cryptographically random salt of at least 32 characters and a different salt for each study boundary. Descriptive or repeated salts are rejected.

## Storage and concurrency model

The JSON candidate store has a monotonic `revision`. Every mutation holds a short-lived sibling `.lock` file from read through replacement and verifies the expected revision before writing. A competing writer receives a detectable lock or revision error rather than silently overwriting newer data.

- This is a single-store, exclusive-writer contract; it is not a distributed lock.
- A process crash can leave a stale `.lock` file. Inspect the owning process and store before removing it manually.
- Invalid JSON or an invalid top-level shape raises `CandidateStoreCorruptError`; the original file is not rewritten.
- POSIX permission hardening is best-effort on filesystems that do not support `chmod`.
- Normal replacement uses same-directory rename. If Windows refuses replacement of an existing target, the writer renames the old target to a unique backup, installs the new file, removes the backup, and attempts restoration if installation fails.

## Trace boundary

`buildBehavioralTraceEvent` creates deterministic `behavioral_memory` Trace V2 events. It records only action, state, privacy class, policy version, and a local-keyed HMAC candidate reference. Rule text, scope text, correction text, candidate ID, session ID, and paths are not accepted by the trace allowlist.

## Verification

```bash
npm run test:behavioral-memory
npm run check:behavioral-memory
npm run check
```

## Operational boundary

A correction event is not automatically a true reusable rule. The expected path is:

```text
correction signal
  -> candidate or needs-synthesis
  -> repeated distinct evidence
  -> human conflict review when needed
  -> replay evidence
  -> paired fixed-verifier evaluation
  -> canary
  -> explicit canary pass
  -> promoted recall
```
