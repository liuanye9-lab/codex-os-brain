# Codex Brain V6 — Engineering Harness Design

> Historical design record, preserved in de-identified form.

## Starting point

AI-assisted changes can look locally successful while placing behaviour in the wrong dispatch layer, skipping verification, leaving debug code, adding unneeded dependencies, or hiding risky edits in a growing file.

## Mechanism

V6 used a post-tool engineering harness with pure detectors and a red-light record. It checked for dispatcher fatigue, sensitive core edits, missing verification, likely secrets, TODO accumulation, oversized files/functions, dead code, debug leftovers, missing multimodal sidecars, and dependency review.

## Improvement sought

The design made failure patterns visible close to the causal edit. It included source-extension gates, large-file skips, throttling, and false-positive regression cases so the harness would not become continuous noise.

## Limitation discovered

This was an advisory hook-era system. It could guide and record but should not silently block or rewrite work. As the framework became capable of changing itself, the remaining risk was ungrounded adoption of its own proposals. That led to V7.
