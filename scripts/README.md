# Public Scripts

The npm package uses `runtime/scripts/` for installed runtime behavior.

This top-level directory mirrors the private project layout and provides stable entry notes for GitHub readers. Use package scripts for execution:

```bash
npm run check
npm run privacy:scan
npm run agents:list
npm run dispatch:plan -- --task "refactor dashboard and run checks" --json
npm run tool:eval
```
