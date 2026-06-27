# Public Tools

This directory documents tool-facing contracts for the public harness.

Executable package tools live in:

```text
runtime/scripts/
```

Tool reliability principles:

- validate parameters before calling
- parse output after calling
- verify result against the task goal
- do not treat tool success as task success
- record only sanitized evidence
