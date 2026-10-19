# Legacy seasons and activation boundary

## This candidate starts a new accounting history

The correction is for new `settlement` Registry, Seed, and Archive objects.
Its setup creates an empty Registry, no season, no Seeds, and a zero reward pool.
The new Registry starts its own numeric season sequence; Registry identity and
module/type origin always distinguish it from the legacy game.

There is no entry point that imports a legacy reward pool, assigns historical
GP, accepts an administrative list of entitlements, or resets an already
processed legacy claim. This makes the migration rule enforceable rather than
leaving an undocumented automatic rebudgeting path.

## Ended legacy season

The prior verification observed legacy season 3 ending on October 1, 2026 at
00:00:06.247 UTC. That is a recorded observation, not a fresh assertion about the
current Registry. The underlying source and simulation evidence are in
[`gameplay-verification`](../gameplay-verification/README.md) and
[`contract-reconstruction`](../contract-reconstruction/README.md).

Existing season-3 objects are not accepted by the new typed claim paths. A
payment through the legacy module remains a legacy payment under its old rules.
The proposed new denominator cannot be computed by taking the old Registry's
current total at face value: past claims may already have removed GP or changed
the remaining balance, and a delayed direct claim may have cleared GP without
paying anything.

Before deciding a legacy settlement or compensation:

1. Fix a checkpoint and reconstruct each relevant Seed's state at the original
   cutoff, including protection, GP, ownership, revival, and abandonment.
2. Reconcile successful claim transactions and actual transfers. Distinguish a
   positive payout, a zero result, and a `SeedDied`-only result.
3. Record the actual amount already paid against each Seed/claim digest. Preserve
   that record rather than silently reinterpreting it as unpaid.
4. Present a specific entitlement table, funded total, evidence references, and
   treatment of disputed or unavailable history for project approval.
5. If a correction payment is approved, implement a separately funded, single-use
   compensation record with replay protection. It must not masquerade as a new
   season's accrued GP or draw from the new players' seasonal pool.

These are the proposed reconciliation rules. This draft does not assert that a
particular legacy player is owed a particular amount, and does not implement or
fund compensation.

## Already paid and already processed claims

| Legacy result | Rule for this candidate |
| --- | --- |
| Positive payment confirmed | Preserve the recorded amount. No new automatic entitlement or second payment. |
| Direct claim cleared GP without payment | Keep it separate for evidence-based reconciliation; do not invent GP from the remaining object. |
| Archived claim already processed | Preserve the claim record and payment, including zero-value processing. |
| Unclaimed legacy Seed | Remains a legacy object. No automatic enrollment into a fresh denominator. |
| Unknown or incomplete history | No inferred allocation. Resolve the history before assigning a correction payment. |

The new protocol's own direct and archived claims share a permanent processed
marker and common settlement calculation. Claiming directly and then through
an archive cannot pay the same new Seed again.

## Legacy code remains reachable

Sui does not remove old package versions after an upgrade. Leaving the verified
legacy module byte-exact preserves its old behavior for legacy objects. The
new-type boundary protects new objects and new funds; it does not retroactively
repair or disable the old ones.

Pausing the legacy Registry is not a complete archive shutdown: legacy archived
claims do not take that Registry as an input. Any proposal to pause, archive,
sweep, move funds, or retire an existing legacy route must identify the specific
objects and transactions. None of those actions is performed by this candidate.

## Inventory and frontend

New native Saplings, Tools, Crates, Seeds, challenge books, and archives use
`settlement` type identities. A legacy Tool or Crate cannot be supplied directly
to a new typed inventory entry point. Legacy assets remain in their existing
owners' wallets and are not destroyed, replaced, or converted by setup.

The retained generic NFTree planting function can borrow an owned external NFT
as an opaque identity. This supports external NFT planting semantics; it does
not read, copy, or mutate legacy GP, payout state, or inventory properties.

The application will need an explicit choice of legacy versus new Registry and
module, separate type/event queries, Clock inputs on funding actions, and
settlement-aware reward status. Use `seed_cutoff_growth_points` and
`seed_reward_processed` after cutoff. The wall-clock `seed_state_live` getter
can show later drought and must not decide the right to a frozen entitlement.

No production or accepted-preview configuration is changed by this draft. An
inventory conversion, if wanted, requires a separately reviewed owner-authorized
exchange with exact preservation of the relevant asset properties.
