# Season payout correction candidate

This directory implements a separate, additive `arboretum::settlement` module
for fresh seasons. It is built alongside the byte-exact deployed version-11
`arboretum` module. The candidate freezes eligibility at season end and pays
every Seed from one original funded pool and eligible Growth Point denominator.

**This is a review candidate, not an activated contract or a correction to an
already processed legacy claim.** The executable verification result is recorded
in [verification-summary.json](evidence/verification-summary.json). The economic
rules below are proposed defaults for review before deployment.

## Why a new module is necessary

The verified legacy contract has no version guard on its shared Registry or
owned Seeds. Sui retains old package versions, so merely adding counters to the
same objects would leave old watering, planting, and claim methods able to bypass
those counters. The current Sui upgrade documentation explicitly describes this
problem and recommends new types with protected setup when a flawed shared
object lacks the required guard:
[Upgrading Packages](https://docs.sui.io/develop/publish-upgrade-packages/upgrade).

The candidate therefore adds a distinct module and distinct Registry, Seed,
Archive, inventory, and challenge types. Its existing-state boundary is narrow:
`create_settlement_registry` takes an immutable legacy AdminCap reference to
authorize creating an **empty** new Registry. It does not accept a legacy Seed,
Archive, payout history, or balance. It does not call legacy implementations.

The old module in the generated package is copied directly from
[`contract-reconstruction/source/arboretum.move`](../contract-reconstruction/source/arboretum.move).
Verification requires all its bytes to match the actual version-11 upgrade
input, preserving all 96 functions and 32 struct layouts. The historical saved
source and the verified reconstruction remain separate and unchanged.

New types have a version field and checks from their first release. Seeds and
Archives also carry the originating Registry ID, preventing another Registry
with the same numeric season from supplying a claim. The new AdminCap binds to
one Registry. Its possession follows administrative transfers for existing
archives and challenge books; their stored administrator address is provenance.

Module initializers do not run again during an upgrade. Setup is an explicit,
capability-protected entry point, rather than a new `init` function. Deployment
and setup have not been performed.

## Proposed payout rules

| Decision | Implemented candidate rule |
| --- | --- |
| Eligibility time | The fixed season cutoff, not the date of a claim. |
| Drought | A Seed is ineligible at 10 complete dry days unless its protection reaches the cutoff. |
| Protection boundary | Expiry exactly equal to cutoff still protects the Seed. |
| Wilting | A wilting Seed remains eligible unless it meets the death rule. |
| Already recorded death | A Seed marked dead contributes zero, including after its GP has been cleared. |
| Eligible denominator | Sum of eligible GP is complete before the first payment; excluded GP never dilutes another claimant. |
| Entitlement | Floor of `eligible Seed GP × original funded pool / original eligible GP`, using `u128` multiplication. |
| Rounding | Each entitlement is rounded down independently. Later claimants do not receive earlier remainders. |
| Deadline | Claims are allowed through `season cutoff + 7 days`, inclusive, for both routes. |
| Archiving | Moves the existing settlement and remaining balance. It never creates a new denominator or extends the deadline. |
| Zero entitlement | Explicit processed event and permanent replay protection, including zero GP, zero pool, and zero floor amounts. |
| Residual balance | Unclaimed amounts and rounding residue stay in the pool until after the deadline; the bound AdminCap can then sweep them to the existing treasury wallet. |
| No eligible GP | Nobody is assigned an entitlement; the entire pool remains residual until the same sweep boundary. |
| Gameplay pause | Blocks gameplay and revenue. Completed-season entitlements remain claimable during their fixed window. |
| Already processed legacy claims | Remain separate. No automatic recalculation, payment, GP restoration, or compensation. |

For example, with an original pool of 1,000 MIST, an eligible 40-GP Seed, and an
ineligible 60-GP Seed, the eligible denominator is 40. The eligible Seed receives
1,000 MIST whether it claims before or after the ineligible Seed, directly or
through an archive. In the verified legacy contract, the corresponding claim
order could instead change its payout from 400 to 1,000 MIST. The new tests
exercise the corrected result.

The all-order test uses 10 MIST and three eligible Seeds with GP weights 1, 2,
and 3. They receive 1, 3, and 5 MIST respectively in all six orders, leaving
1 MIST residual. The last claimant never receives an extra rounding unit merely
for claiming last.

## How the denominator becomes complete

Owned Seeds cannot be enumerated and borrowed together by an arbitrary admin
transaction. Instead, every new Seed records its prospective eligible GP at the
known season cutoff. Every care mutation subtracts that Seed's previous
contribution and adds its final contribution to the Registry total.

The synchronization points cover both planting routes, watering **after** the
timestamp changes, tools that add GP, tools that change watering or protection,
observed death, both revival methods, and abandonment. Replacing a long Drought
Shield with shorter protection can reduce eligibility, so synchronization uses
the final state rather than assuming eligibility only increases.

Once the cutoff arrives, care is closed. Finalization requires constant work:
it freezes the already maintained eligible total and the pool balance. Anyone
may call `finalize_reward_settlement`, and the first direct claim invokes the
same finalizer automatically. Repeating finalization validates and preserves the
same values.

`SettlementState` records the original pool, eligible GP, season, cutoff, and
deadline. Only its paid amount and processed counters change afterward. Every
positive claim checks:

```text
cumulative paid + remaining pool = original funded pool
processed eligible GP <= original eligible GP
```

Each Seed's `reward_processed` marker is checked before its points are cleared.
Both claim routes call the same `settle_seed_reward` helper. Archiving moves
that same SettlementState value and remaining balance into the Archive.

## Timing and funding boundaries

The new module's crate purchases, Boom/Victory wrappers, Supply Drop purchase,
and administrative pool deposit take a Clock argument. They require an active
season and reject receipts at or after cutoff. This is necessary to make the
funded pool independent of claim timing. Deposits before the season starts are
also rejected; start the season before funding it.

Planting already takes Clock and closes at cutoff. The existing test prices,
referral calculations, reward/treasury/dev splits, item charge effects, and crate
loot logic are retained. This candidate does not activate the separate economy
pricing proposal.

`reset_season` retains the 24-hour review delay. The explicit
`finalize_season_archive_now` method can archive at cutoff or later, but can no
longer end a season early. A much later archive still uses the original
`cutoff + 7 days` deadline, and can be swept immediately if that deadline has
already passed. Sweep is rejected at the deadline itself and cannot run twice.

## Legacy season and frontend integration

See [legacy-transition.md](legacy-transition.md) for the concrete treatment of
ended seasons, paid claims, GP lost in a legacy claim, and inventory.

The existing production frontend and accepted preview are unchanged. A future
integration must choose the new module and Registry deliberately, use its new
type origins for object and event queries, pass Clock to the changed funding
calls, and read `cutoff_growth_points` and `reward_processed` for payout status.
The old `seed_state_live` view remains a wall-clock gameplay view and is not an
after-cutoff payout eligibility test.

The new module's native Sapling, Tool, and Crate types differ from legacy
inventory. Generic NFTree planting accepts an owned external NFT identity, but
does not import its private fields or historical GP. This draft does not promise
legacy inventory conversion or a one-line package-ID switch.

## Verification and reproduction

The saved full run completed on October 19, 2026 with status
`CANDIDATE_VERIFIED`:

| Check | Result |
| --- | --- |
| Actual Move VM tests | 79 passed, 0 failed: 71 new settlement cases and 8 retained Canopy cases. |
| Type isolation | 6 successful compiler controls and 6 specific incompatible-type rejections. |
| Bytecode comparator mutation tests | 20 passed. |
| Legacy deployed module | All 18,034 bytes, 96 functions, and 32 layouts preserved exactly. |
| Linked framework | All 89 compiled modules match the verified deployment. |
| Economics and care scope | All 72 existing non-error constants unchanged; 21 complete function bodies match after the individually listed guard, Clock, and accounting additions. |
| Build inputs | All 238 framework source files unchanged; empty keystore throughout. |

The new module is 22,221 bytes, SHA256
`b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531`.
Its source SHA256 is
`91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb`.
See [review-notes.md](review-notes.md) for the independent source/test review,
including the administrative transfer issue identified and corrected.

The runner compiles production bytes separately from all test fixtures. It
checks the exact pinned compiler, framework archive, extracted framework tree,
legacy module, and all 89 linked dependency modules. It uses an empty keystore
and a loopback-only client configuration, and performs no chain call or signing
operation.

The VM fixture exercises actual entry points and transferred balances, including
direct/archive parity, claim ordering, fractional arithmetic, replay, cutoff
care and protection boundaries, fixed deadlines, residual sweeping, owner and
Registry binding, version rejection, and active/closed funding. The four
retained Canopy tests run in both modules.

Compiler probes first compile the real public Registry, Seed, and Archive
getters with their proper types. Changing only the argument to the other
module's type must fail with the specific incompatible-type diagnostic. This is
checked in both directions. The existing 20 bytecode-comparator mutation checks
also run.

To reproduce using the public pinned toolchain:

```bash
python3 contract-reconstruction/prepare_toolchain.py \
  --work-dir /tmp/arboretum-v11-tools

python3 contract-payout/verify_candidate.py \
  --compiler /tmp/arboretum-v11-tools/sui \
  --compiler-archive /tmp/arboretum-v11-tools/sui-mainnet-v1.78.1-ubuntu-x86_64.tgz \
  --framework-dir /tmp/arboretum-v11-tools/framework-8b9163554164776bc3372d828f8d6ced55aa2b5e \
  --framework-archive /tmp/arboretum-v11-tools/framework-8b9163554164776bc3372d828f8d6ced55aa2b5e.tar.gz \
  --work-dir /tmp/arboretum-payout-build
```

The generated manifest is an isolated reproduction manifest, not a production
publish manifest. The compiler is `sui 1.78.1-722ac4fcf484`, with the exact
`8b9163554164776bc3372d828f8d6ced55aa2b5e` framework that reproduced version 11.

Evidence files include the production module bytes as base64 and SHA256, exact
legacy comparison, new type and entry signatures, named VM results, positive and
negative compiler probe logs, and verification summary. The GitHub workflow
`Settlement payout candidate` repeats these checks and uploads the evidence.

## Scope of the result

This establishes a tested settlement candidate and an additive code/type
boundary. It is not a mainnet upgrade simulation, verification of the current
UpgradeCap policy, deployment authorization, broad game audit, or migration of
the ended legacy season. Before activation, the economic policy and legacy
treatment must be agreed, the new frontend route must be integrated and tested,
and the exact deployment/setup transactions must be prepared and reviewed with
current chain inputs.

## Official references consulted

- [Sui package upgrades and versioned objects](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)
- [Sui security best practices](https://docs.sui.io/develop/security/best-practices)
- [Mysten Labs build and test skill](https://github.com/MystenLabs/skills/blob/main/sui-build-test/SKILL.md)
- [Mysten Labs Move unit testing skill](https://github.com/MystenLabs/skills/blob/main/move-unit-testing/SKILL.md)
- [Mysten Labs Move security skill](https://github.com/MystenLabs/skills/blob/main/move-security/SKILL.md)

The official skills were consulted for this implementation. Their current
general manifest guidance does not replace the older, hash-pinned compiler and
framework required for the verified deployed baseline.
