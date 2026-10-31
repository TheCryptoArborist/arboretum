# Empty settlement Registry — unsigned mainnet review

## Current status

The owner-completed version-12 upgrade is confirmed. Its transaction is `GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU`, at mainnet checkpoint 340000251 on October 30, 2026 at 10:31 p.m. CDT. The actual package is `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a`. The [upgrade verification](../20261031-confirmed-upgrade/verification.json) records the approved kind, module hashes, type origins and authority checks.

This document reviews the **next separate transaction**. It remains unsigned. The current administrator page only has upgrade/receipt controls; no setup signing control has been deployed.

## Exact proposed action

One Move call:

```text
0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a::settlement::create_settlement_registry
```

The only explicit object input is the existing legacy AdminCap, borrowed by the entry point:

- Object ID: `0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3`
- Current object version: `986499447`
- Current digest: `36Cg64NBM7Pa2NEageUkzgZ8MZydWD4BtKavLb3ZgqWN`
- Required sender: `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4`
- Setup transaction kind: **154 bytes**
- Setup kind SHA-256: `2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b`

The [unsigned packet](unsigned-setup.json), [kind bytes](setup-kind.b64), and [unsigned wallet SDK JSON](wallet-transaction.json) describe that same call. The local SDK round trip reproduced the exact bytes and GraphQL payload. Final gas selection and budget are left to the wallet.

## Checked simulation

[Simulation capture](setup-simulation.json), checkpoint **340001424**, timestamp **2026-10-31T03:36:44.677Z**; captured at **2026-10-31T03:36:46.938818+00:00**. The query explicitly used `checksEnabled: true` and `doGasSelection: true`.

| Item | Simulated result |
| --- | --- |
| Execution | SUCCESS |
| Computation cost | 100,000 MIST |
| Storage cost | 6,855,200 MIST |
| Storage rebate | 1,322,268 MIST |
| Estimated net fee | **5,632,932 MIST / 0.005632932 SUI** |
| Shared Registry | One newly created settlement Registry |
| Administrator capability | One newly created capability, owned by the sender and bound to that Registry |
| Event | One `SettlementRegistryCreated` event with the expected administrator and legacy capability |
| Existing Registry inventory | Empty at preparation and simulation checkpoints |

This estimate is for the captured simulation, not a promised final charge or gas budget. A fresh review is required at wallet handoff.

### Initial state

The new Registry has schema version 1, administrator equal to the sender, season ID and start time 0, zero reward pool and treasury, zero Seeds, zero total/eligible Growth Points, no settlement, and six empty tables. Its initial `paused` field is false, but the positive-season-start guard remains unsatisfied, so setup does not start a season or open season funding.

The simulated effects contain nine entries: the new Registry, its new bound AdminCap, six wrapped empty-table IDs, and the legacy AdminCap's version update. The legacy capability's ID, owner, type and contents remain identical; its object version/digest advance as recorded in the simulation. The six wrapped entries have no standalone output state and exactly match the table IDs embedded in the new Registry. The sole balance movement is the estimated SUI gas debit.

This call does not fund a reward pool, move treasury funds, import legacy Seeds or points, enable claims, compensate players, or choose season parameters. Its function accepts none of those objects or amounts.

## Separate live-state check

The [post-simulation public read](post-simulation-state.json) confirms that the legacy AdminCap, UpgradeCap and legacy Registry are unchanged on chain, no settlement Registry exists, and the simulated Registry/AdminCap IDs do not exist. `newRegistryId` and `newAdminCapId` remain **null** in the unsigned packet. Simulated IDs must never be copied into application deployment configuration.

## Next owner flow

A setup approval control still needs to be implemented on the canonical protected administrator site. Before requesting a signature it must revalidate the actual upgrade, current package/authority, refreshed legacy capability reference, absence of an existing settlement Registry, exact setup bytes and a checked simulation. It must retain explicit Slush/provider/account/mainnet selection and a persistent unresolved-request lock.

The contract permits creating additional empty Registries; uniqueness is an operational check, not an onchain one-shot guarantee. Do not automatically retry an uncertain setup request or build a second Registry when a first one exists. After owner approval and real confirmation, verify the transaction bytes, event and effects and use the actual new Registry and AdminCap IDs. Only then can deployment configuration be prepared for subsequent season decisions.

This review created **zero signatures and submitted zero transactions**. The owner-completed package upgrade is the only newly confirmed onchain action in this handoff.

## Offline verification

The independent [offline verifier](../../verify-setup.mjs) checks the real upgrade identity, source and module bytes, unsigned packet and wallet JSON, exact one-call kind, simulation query and inputs, all state fields, table IDs, event, gas debit, and post-simulation live state. Its [accepted result](simulation-summary.json) keeps simulated IDs separate from deployment IDs. The combined release suite passed 20 tests, including 12 setup-verification groups with 86 adversarial rejection cases.

```bash
node settlement-integration/release/verify-setup.mjs \
  settlement-integration/release/evidence/20261031-empty-registry-review
node --test --test-isolation=none settlement-integration/release/*.test.mjs
```
