# Public Release Checklist

Run these before tagging or publishing:

```bash
npm run privacy:scan
npm run agents:list
npm run dispatch:plan -- --task "实现 dashboard 功能，更新文档，运行测试，准备发布" --json
npm run smoke
npm run check
npm pack --dry-run
```

Manual checks:

- package name is `agentic-coding-os-brain`
- `docs/REPOSITORY_BOUNDARY.md` still matches the intended public/private split
- README has no personal names, private paths, or private agent identity
- runtime does not read any private personal Brain home
- installer writes runtime data only under `~/.acob`
- installer modifies only managed blocks/hooks in `~/.codex/hooks.json` and `~/.codex/AGENTS.md`
- hooks merge with backup
- global `~/.codex/AGENTS.md` managed block is backed up, idempotent, and removable by uninstall
- uninstall removes only managed hooks
- dashboard is local-only
- agentic preflight is installed globally by `install --global-agentic`
- sub-agent names are public Chinese role names, not a private persona
- dispatch logs contain only task hashes, character counts, gate state, and selected agent ids/names
- npm package file list is minimal

Do not publish if any private memory, personal user profile, API key, token, or private local path appears in the package.
