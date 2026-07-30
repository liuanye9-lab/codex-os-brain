# Cognitive Asset Protocol v1

Codex Brain 0.16 adds a candidate-first protocol for turning source evidence and verified task outcomes into reusable cognitive assets. It is an evidence and authorization layer, not a personality profiler or an automatic self-modifying agent.

## Lifecycle

The semantic lifecycle and deployment lifecycle are independent:

- semantic: `candidate → confirmed cognition → method_candidate → runnable_playbook → verified_capability`
- deployment: `candidate → shadow → replay → canary → promoted/revoked`

The product lifecycle extends this protocol without merging the state machines:

`Evidence → Cognition → Playbook → Knowledge Base → Agent Profile → Context/Run Receipt → new candidate`

A Knowledge Base is a published, versioned bundle of confirmed cognition and runnable or verified Playbooks. An Agent Profile is a purpose-bound configuration that pins published Knowledge Bases, Playbooks, declared policy/tool contracts, and a context token budget. Neither object grants execution authority.

`runnable_playbook` means the manifest passed structural gates. The bundled provider is a manifest catalog and run-request preparation layer, not an executor: it does not dispatch steps, manage a worker lifecycle, or claim that a run completed. `verified_capability` requires at least ten semantically distinct production-path cases, three boundary or adversarial cases, at least 80% success, and zero critical safety failures.

Only externally verified signed reuse receipts count. Each receipt binds a unique nonce, task and playbook version, executor and verifier principals in different trust domains, input/output/artifact/runner/policy digests, timestamps, outcome, and production-path flag. The provider requires an external `reuseReceiptVerifier`; without it, reuse recording and automatic promotion fail closed. Plain identity strings and caller-supplied hashes no longer count.

## Source and evidence rules

All imported sources default to `quarantined`. A source is excluded from recall, embeddings, compilation, and projection until a protected review explicitly marks it trusted and assigns allowed uses.

Evidence assertions separate four checks:

- anchor: the quoted location exists in the pinned source version
- attribution: the speaker or source identity is correct
- entailment: the evidence supports the claim
- external fact: a source fact has independent verification

A precise quote is not sufficient evidence by itself. The public SQLite provider is not encrypted at rest. It rejects source content explicitly marked sensitive and cognition declared as sensitive or personal scope, plus normalized sensitive type aliases such as personality, emotion, medical/health, relationship, and values, with `sensitive_store_unavailable`. This is a policy classification gate, not automatic content recognition.

Source retention accepts either an absolute `expiresAt` or a bounded `retentionDays`. `retentionStatus()` reports expired sources without mutating them. `enforceRetention({confirm:true})` removes recall and embedding entries, tombstones source URI/content/subjects and evidence anchors, retires direct cognition dependencies, stale-blocks dependent playbooks, revokes their projections, and records a sanitized audit event. Its receipt explicitly says `logicalTombstone:true` and `forensicErasure:false`; content hashes, SQLite free pages/WAL, and old external backups remain reported residues. The CLI equivalent requires `brain cognition retention-enforce --enable-cognitive-assets --confirm-labs --confirm-retention`.

## Provider contract

`createCognitiveAssetProvider()` is an opt-in lab provider. It exposes:

- `ingestSource`
- `proposeCognition`
- `approveCognition`
- `compilePlaybook`
- `compileKnowledgeBase`
- `publishKnowledgeBase`
- `compileAgentProfile`
- `assessAgent`
- `deployAgent`
- `prepareAgentContext`
- `revokeProduct`
- `productMap`
- `prepareRun` (`requestRun` remains a compatibility alias)
- `verifyRun`
- `revoke`
- `createProjection`

The reference SQLite provider also exposes source review, evidence assertion, promotion, daily digest, and read-only projection methods. A private provider can implement the same contract without copying private content into the public database.

## Approval and projection

Promotion, source trust changes, and projection creation fail closed unless a protected approval verifier is configured. Approval receipts bind object, object version, action, and exact scope, expire within five minutes, and can be consumed only once.

Projection grants bind recipient agent, purpose, asset versions, policy digest, expiry, and `noOnwardSharing=true`. The MCP surface only exposes status, bounded candidate digest, and purpose-bound read-only projection. It does not expose cognition writes or promotion tools.

## Dependency and withdrawal behavior

Every run, promotion, and projection read recomputes the playbook dependency digest. A changed or invalid cognition/evidence dependency immediately persists `stale_blocked`.

Knowledge Base publication and every Agent readiness/context check also recompute the full dependency digest. Drift cascades from evidence or cognition to Playbook, Knowledge Base, and Agent. Agent deployment is sequential (`draft → shadow → canary → active`): canary requires successful signed production-path evidence, while active requires all bound Playbooks to be `verified_capability`.

Prepared Agent context is purpose-bound and estimated against the complete response envelope. Knowledge Base retrieval limits cap eligible claims and Playbooks, evidence IDs remain as citation handles, raw source content is excluded, and a budget below the minimum envelope fails explicitly.

Withdrawal revokes dependent grants, removes normal recall and embedding references, blocks execution, and writes a residue receipt. Append-only audit data, external backups, and previously exported Git history are reported as possible residues rather than falsely claimed as erased.

## CLI and MCP

```bash
brain cognition status --enable-cognitive-assets --confirm-labs --json
brain cognition digest --enable-cognitive-assets --confirm-labs --limit 5 --json
brain cognition product-map --enable-cognitive-assets --confirm-labs --json
brain cognition agent-readiness --id AGENT_ID --target shadow --enable-cognitive-assets --confirm-labs --json
brain cognition agent-context --id AGENT_ID --token-budget 1200 --enable-cognitive-assets --confirm-labs --json
```

The MCP tools are:

- `brain_get_cognitive_asset_status`
- `brain_get_cognitive_review_digest`
- `brain_get_cognitive_product_map`
- `brain_assess_cognitive_agent`
- `brain_prepare_cognitive_agent_context`
- `brain_read_cognitive_projection`

The default runtime does not register these tools because `cognitiveAssets.enabled=false`. When explicitly enabled, it uses `operator_guardrail_only`. That mode can inspect status but cannot mint protected approvals, verify reuse receipts, promote verified capability, or export cross-Agent assets.

## Deliberate v1 boundaries

The protocol does not store hidden reasoning, raw tool output, or unbounded terminal logs. It does not automatically convert daily conversation into stable personality claims. Public markets, subscription kits, A2A networks, and autonomous self-rewriting are out of scope.

The product rationale, open-source comparison, current paper signals, and P2 evaluation priorities are documented in [Cognitive Product Framework](cognitive-product-framework.md).
