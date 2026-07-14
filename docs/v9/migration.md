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
node scripts/v9/migration.js inventory \
  --brain-root tests/fixtures/v9-legacy \
  --output-root /tmp/brain-v9-migration \
  --json
```

The test fixture contains generic V2 and V8 records. Tests verify that source hashes are identical before and after migration, a missing backup blocks apply, and a second apply reports every record unchanged.

## Cloud placeholders

On supported systems a dataless placeholder is recorded with disposition `unavailable_dataless`. Inventory does not hydrate it. The operator may hydrate the source separately and generate a new inventory.

## Rollback

A rollback marker selects a previous runtime version; it does not delete V9 output. V8 remains the default fallback. A live deployment rollback restores only files whose current hash still matches the deployed hash, avoiding overwrite of later human changes.
