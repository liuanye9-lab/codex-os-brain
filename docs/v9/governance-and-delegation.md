# Binding a governance skill to the harness

A content-governance workflow already knows what must not ship: an unadjudicated source conflict, a
sensitive item nobody cleared, a page whose provenance cannot be established. Written inside a
skill, those rules are prose, and prose is advisory — the agent follows it when it remembers to.

The harness turns the same rules into a gate. This page describes the binding, using
`enterprise-kb-ops` as the worked example. Nothing here is specific to that skill: any workflow that
maintains a manifest of what it produced can bind the same way.

## The four pieces

| Piece | Owner | What it decides |
|---|---|---|
| Skill | the workflow | what work exists, and which entries are fit to publish |
| Task contract | the harness | what "done" means, signed before work starts |
| Delegation ledger | the harness | who does which unit, and whether anyone checked it |
| Stop gate | the harness | whether a completion claim is allowed through |

The skill decides *content*. The harness decides *whether the claim about that content is true*.
Neither replaces the other, and the harness never edits knowledge.

## 1. Declare governance as an acceptance criterion

The skill maintains `knowledge-manifest.json` as it works. Name it in the contract and the manifest
stops being a report and becomes an acceptance test:

```bash
brain task create \
  --task-id kb-2026q3 \
  --objective "publish the Q3 policy set to the team wiki" \
  --criterion governance \
  --json
```

The `governance` criterion resolves to the `manifest_gate` verifier, which refuses completion while
any entry is unresolved. It fails closed: a missing, empty, or unreadable manifest is a failure, and
an entry with no `production_ready` field is treated as consent withheld, not as consent given.

It also rejects a manifest whose `parent_id`, `source_ids` or `related_ids` point at entries that do
not exist. A manifest with dangling references cannot be trusted to describe what actually shipped,
so a high quality score on top of it means nothing.

Expected shape:

```json
{
  "entries": [
    { "id": "policy-expense", "production_ready": true,  "source_ids": ["src-hr-01"] },
    { "id": "policy-travel",  "production_ready": false, "note": "conflicting effective dates" },
    { "id": "src-hr-01",      "production_ready": true }
  ]
}
```

With `policy-travel` unresolved, the Stop gate blocks. That is the whole point: the conflict has to
be adjudicated by a person, not narrated away by an agent.

## 2. Exclude the workflow's own artifacts from the input seal

The harness seals verifier inputs so a verifier cannot be retargeted mid-task — rewriting the test
command until it passes is the canonical abuse, and the seal catches it.

But a governance workflow *writes its manifest as it works*, and a self-updating skill rewrites its
own directory. Those are task outputs, not verifier inputs. Sealing them reports tampering for doing
the job. Declare them on the contract instead:

```json
{
  "verifierSpec": {
    "baselinePaths": ["package.json", "tests", "workspace"],
    "baselineExcludePaths": ["workspace/knowledge-manifest.json"]
  }
}
```

Two rules, both load-bearing:

- **Exclusions must be declared, never inferred.** An exclusion weakens the seal; the contract has
  to say so out loud, and it is signed.
- **Exclude the artifact, not its directory.** Excluding `workspace/` would also stop sealing
  anything else that lands there later.

Everything outside the exclusion stays sealed — a rewritten `package.json` still fails with
`verifier_inputs_changed`.

## 3. Split only where the work is genuinely independent

Delegation is justified by the shape of the task, not by a preference for more agents. Each handoff
can only lose information, so the split has to buy back more than it costs.

Ask the harness rather than guessing:

```bash
brain fanout assess --units 500 \
  --independent-units --isolated-context --per-unit-verifiable --json
```

Run against the phases of a knowledge-base build, the answer differs per phase:

| Phase | Shape | Verdict |
|---|---|---|
| Inventory hundreds of files | hashing and dedup per file; no unit needs another | **fan out** |
| Score pages individually | each page scored on its own evidence | **fan out** |
| Publish with cross-page consistency | pages must agree; needs the whole picture | **single agent** |
| Handle three files | too few to pay for the handoffs | **single agent** |

Same skill, opposite answers. That is the expected result, and it is why the judgement is per phase
rather than per project.

Note the fourth column of the rule: work that cannot be checked one unit at a time is never split.
Splitting unverifiable work only produces more unverified output, faster.

Two distinctions matter here, both added after eval cases were written specifically to break the
first version of these criteria:

- **Shared read-only context is not coupling.** A style guide, schema or constant every unit reads
  can be copied into each dispatch for nothing. Pass `--shared-readonly`. Only shared *mutable*
  state — an index every unit writes to — forces a single agent.
- **Ordering is a dependency in its own right.** Units with no data dependency may still have to be
  produced in sequence. Pass `--order-dependent` and the split is refused.

## 4.5 Recover work from workers that died

A claim is a lease, not a permanent assignment. A worker that crashes mid-unit would otherwise take
that unit with it: nobody could claim it, and the work would be silently missing from the result.

```bash
brain fanout status  --plan kb-2026q3 --json    # stalled: units held past their lease
brain fanout reclaim --plan kb-2026q3 --json    # return them to the pool
```

A live claim is never stolen — only leases that have actually expired are recovered, and each
recovery is recorded with the worker it came from. Reclaiming is a deliberate command rather than an
automatic side effect, so a slow worker is declared dead by a person, not by a timeout you forgot
about.

## 4. Delegate through the ledger, not through the prompt

Step repetition is the largest single failure mode in multi-agent runs, and it is not fixable by
asking. A worker told "don't redo finished work" has no way to see what anyone else did.

So the completed set lives in a ledger the lead owns and every dispatch reads:

```bash
brain fanout register --plan kb-2026q3 --units "f1,f2,f3" --json
brain fanout claim    --plan kb-2026q3 --worker inventory-A --limit 2 --json
```

`claim` returns two things: the units this worker may take, and `completedContext` — the read-only
list of what is already done. Injecting that list into the dispatch is what prevents repetition;
workers never write it.

A unit already claimed or finished is never handed out twice, and a worker cannot complete a unit
another worker holds.

## 5. Count what nobody checked

Delegated output is not evidence. Record it either way, but record honestly whether it was checked:

```bash
brain fanout complete --plan kb-2026q3 --unit f1 --worker inventory-A \
  --verified --verifier-ref "ev#<id-from-a-harness-run>" --json
```

`--verified` without `--verifier-ref` is refused. A worker cannot vouch for itself, exactly as an
agent cannot self-certify a task.

```bash
brain fanout status --plan kb-2026q3 --json
```

Watch `zeroVerificationRate` — the share of completed units adopted with no harness check at all. It
is the honest measure of whether a fan-out is producing verified work or just producing volume. A
rate near 1.0 means the delegation is propagating unexamined output, and the speed it bought is not
worth what it cost.

## 6. Keep the gate bounded

The Stop gate refuses completion while criteria are unverified. Because a criterion can be
impossible — a missing binary, a verifier that always crashes, a conflict nobody will adjudicate —
the gate is bounded so it cannot trap a session:

- **Block cap.** The same task is blocked at most three times.
- **Stall detection.** If the unresolved set stops shrinking between attempts, the agent is looping
  rather than converging, and the gate steps aside.

A released stop is **not** a pass. It is recorded as `released WITHOUT verification` with the reason,
the criteria stay unverified, and the contract stays open. Both bounds are per task and per project,
so one stuck task never lowers the gate for anything else.

One deliberate exception: if the gate ledger itself cannot be read, the gate keeps blocking. Stop is
a fail-closed event, and an unwritable state directory must not become a way to switch it off.

## What this binding does not do

- It does not check that published prose is *correct*. It checks that entries claiming production
  readiness are internally consistent, resolvable, and adjudicated.
- It does not spawn or schedule agents. The ledger records claims and outcomes; the host runs the
  workers.
- It does not make delegation safe by itself. An unverifiable unit stays unverifiable no matter how
  many workers process it.
