# V1–V8 Preservation and V9 Migration

V9 treats every discoverable legacy file as read-only source evidence. It does not rename, edit, delete, or normalize a V1–V8 file in place.

## Sequence

1. Inventory regular files and record missing or unavailable placeholders.
2. Detect the source version from versioned paths; root-era assets are recorded as V1 compatibility data.
3. Hash every available source file.
4. Require a backup manifest matching the inventory hash.
5. Copy into the V9 import namespace with source hash and adapter version.
6. Verify the number and hashes of imported records.
7. Cut over only after explicit operator confirmation.

## Synthetic example

```bash
brain migrate inventory \
  --brain-root tests/fixtures/v9-legacy \
  --output-root /tmp/brain-v9-migration \
  --json > /tmp/brain-v9-manifest.json

brain migrate backup \
  --manifest /tmp/brain-v9-manifest.json \
  --brain-root tests/fixtures/v9-legacy \
  --output-root /tmp/brain-v9-migration \
  --backup-root /tmp/brain-v9-backup \
  --confirm-backup --json

brain migrate apply \
  --manifest /tmp/brain-v9-manifest.json \
  --brain-root tests/fixtures/v9-legacy \
  --output-root /tmp/brain-v9-migration \
  --backup-root /tmp/brain-v9-backup \
  --confirm-migration --json
```

The apply step rebuilds the inventory from the operator-supplied roots, rejects path escapes, and verifies every backup file against its source hash. A marker-only backup is not accepted. The test fixture contains generic V2 and V8 records; a second apply reports every record unchanged.

## Cloud placeholders

On supported systems a dataless placeholder is recorded with disposition `unavailable_dataless`. Inventory does not hydrate it. The operator may hydrate the source separately and generate a new inventory.

## Rollback

A rollback marker records operator intent and does not delete V9 output. V8 is not bundled or selected by the V9 runtime; an actual rollback requires a separately retained V8 installation. A live deployment rollback restores only files whose current hash still matches the deployed hash, avoiding overwrite of later human changes.
