# System Flow Dashboard

This public dashboard mirrors the observable ACOB runtime surface.

It intentionally shows only public-safe state:

- global hook status
- agentic dispatch gate state
- verification and privacy scan status
- registered public sub-agent templates
- local control-plane command availability

It does not expose raw prompts, hidden reasoning chains, private memory, local home paths, or secrets.

For the npm runtime dashboard, see:

```bash
npm run dashboard:control -- --list
node runtime/dashboard/dashboard-server.mjs
```
