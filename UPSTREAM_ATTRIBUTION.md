# Upstream Attribution

The behavioral-memory design was informed by the MIT-licensed project distributed in the supplied archive as `claude-brain-v8`.

- Upstream copyright: Copyright (c) 2026 384961890-ui
- Upstream license: MIT License
- Reviewed source areas: correction capture, lesson decay and archive concepts, host shims, and privacy-oriented export.

The separate `claude-brain-reusable-extracts.zip` contains selected upstream files unchanged together with the original license.

## Adaptation status

The Codex OS Brain integration is a new implementation. It reuses concepts and pattern categories but changes the architecture:

- correction text is not persisted by default;
- rules require explicit synthesis;
- rule promotion uses Codex OS Brain Policy Lab and Skill Lifecycle;
- recall uses Context Economy limits;
- export identifiers use participant-salted HMAC;
- upstream `efficacy.js` and proxy behavior scoring are excluded from the recommended integration.
