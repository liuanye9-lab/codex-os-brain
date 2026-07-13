# Evidence-Gated Behavioral Memory Integration

This optional V8 layer converts explicit user corrections into reviewable rule candidates without restoring permanent prompt injection.

## Architecture

```text
optional host sensor
  -> normalized event
  -> correction detection
  -> candidate or needs-synthesis
  -> local private store
  -> repeated evidence + replay
  -> fixed-verifier paired evaluation
  -> canary
  -> explicit canary pass
  -> bounded promoted-only recall
```

## Safety defaults

- `hooks.enabled=false`
- `behavioralMemory.enabled=false`
- host adapters are sensor-only and disabled
- raw correction text is not persisted
- an explicit proposed rule is required
- external-write and high-risk rules require approval
- recall is capped at 300 estimated tokens and 2 items

## CLI

Detect without persistence:

```bash
node scripts/brain-lite-behavioral-memory-cli.js detect \
  --host codex \
  --text "You said it was fixed, but it still fails."
```

Capture a reviewed rule candidate:

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

Recall promoted rules only:

```bash
node scripts/brain-lite-behavioral-memory-cli.js recall \
  --store ./data/brain-lite/v8-behavioral-memory.json
```

Export text-free research rows:

```bash
node scripts/brain-lite-behavioral-memory-cli.js export \
  --store ./data/brain-lite/v8-behavioral-memory.json \
  --salt "participant-specific-random-salt"
```

## Verification

```bash
npm run test:behavioral-memory
npm run check:behavioral-memory
npm run check
```

A correction is not automatically a reusable rule. Promotion requires at least three distinct occurrences, three passing replays, one fixed verifier across paired samples, preserved quality, measurable benefit, and a separate canary pass.
