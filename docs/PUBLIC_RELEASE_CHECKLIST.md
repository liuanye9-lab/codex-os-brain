# Public Release Checklist

Run these before tagging or publishing:

```bash
npm run privacy:scan
npm run smoke
npm run check
npm pack --dry-run
```

Manual checks:

- package name is `codex-os-brain`
- README has no personal names, private paths, or private agent identity
- runtime does not read any private personal Brain home
- installer writes only `~/.codex-os-brain`
- hooks merge with backup
- uninstall removes only managed hooks
- dashboard is local-only
- npm package file list is minimal

Do not publish if any private memory, personal user profile, API key, token, or private local path appears in the package.
