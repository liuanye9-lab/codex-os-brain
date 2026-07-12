# Codex Brain V5 — Multimodal Ingest Design

> Historical design record, preserved in de-identified form.

## Starting point

Screenshots and PDFs can affect a task in the current turn yet disappear from recall later. Treating them as fully understood without extractable evidence would also be unsafe.

## Mechanism

A sidecar index recorded only evidence that could be represented safely:

- file kind and metadata;
- user-provided surrounding context;
- extractable text when local tooling genuinely produced it;
- an explicit status distinguishing indexed, missing, and unsupported material.

## Improvement sought

V5 made multimodal references durable without pretending that metadata equals OCR or that every image had been interpreted. It also prohibited full-document prompt dumping and secret indexing.

## Limitation discovered

Better evidence intake did not control what happened after a tool edit: structural debt, missing verification, and risky dependencies could still be introduced. That led to V6.
