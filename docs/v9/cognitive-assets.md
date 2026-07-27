# Cognitive Asset Protocol v1

Codex Brain 0.16 adds a candidate-first protocol for turning source evidence and verified task outcomes into reusable cognitive assets. It is an evidence and authorization layer, not a personality profiler or an automatic self-modifying agent.

## Lifecycle

The semantic lifecycle and deployment lifecycle are independent:

- semantic: `candidate → confirmed cognition → method_candidate → runnable_playbook → verified_capability`
- deployment: `candidate → shadow → replay → canary → promoted/revoked`

`runnable_playbook` means structurally executable. It does not mean effective. `verified_capability` requires at least ten semantically distinct production-path cases, three boundary or adversarial cases, at least 80% success, zero critical safety failures, and different executor and verifier identities.

## Source and evidence rules

All imported sources default to `quarantined`. A source is excluded from recall, embeddings, compilation, and projection until a protected review explicitly marks it trusted and assigns allowed uses.

Evidence assertions separate four checks:

- anchor: the quoted location exists in the pinned source version
- attribution: the speaker or source identity is correct
- entailment: the evidence supports the claim
- external fact: a source fact has independent verification

A precise quote is not sufficient evidence by itself. Sensitive inferences such as personality, emotion, health, relationships, and values remain isolated and cannot compile into playbooks.

## Provider contract

`createCognitiveAssetProvider()` exposes the stable protocol methods:

- `ingestSource`
- `proposeCognition`
- `approveCognition`
- `compilePlaybook`
- `requestRun`
- `verifyRun`
- `revoke`
- `createProjection`

The reference SQLite provider also exposes source review, evidence assertion, promotion, daily digest, and read-only projection methods. A private provider can implement the same contract without copying private content into the public database.

## Approval and projection

Promotion, source trust changes, and projection creation fail closed unless a protected approval verifier is configured. Approval receipts bind object, object version, action, and exact scope, expire within five minutes, and can be consumed only once.

Projection grants bind recipient agent, purpose, asset versions, policy digest, expiry, and `noOnwardSharing=true`. The MCP surface only exposes status, bounded candidate digest, and purpose-bound read-only projection. It does not expose cognition writes or promotion tools.

## Dependency and withdrawal behavior

Every run, promotion, and projection read recomputes the playbook dependency digest. A changed or invalid cognition/evidence dependency immediately persists `stale_blocked`.

Withdrawal revokes dependent grants, removes normal recall and embedding references, blocks execution, and writes a residue receipt. Append-only audit data, external backups, and previously exported Git history are reported as possible residues rather than falsely claimed as erased.

## CLI and MCP

```bash
brain cognition status --json
brain cognition digest --limit 5 --json
```

The MCP tools are:

- `brain_get_cognitive_asset_status`
- `brain_get_cognitive_review_digest`
- `brain_read_cognitive_projection`

The default runtime uses `operator_guardrail_only`. That mode can inspect status but cannot mint protected approvals or export cross-Agent assets.

## Deliberate v1 boundaries

The protocol does not store hidden reasoning, raw tool output, or unbounded terminal logs. It does not automatically convert daily conversation into stable personality claims. Public markets, subscription kits, A2A networks, and autonomous self-rewriting are out of scope.
