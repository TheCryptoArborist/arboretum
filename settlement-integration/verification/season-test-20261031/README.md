# First-season lifecycle test and mainnet rehearsal

**The 19 first-season Move VM tests passed, and the checked unsigned 24-hour
start-season simulation succeeded. No season was started and no real SUI was
spent.** This test step also reproduced an inventory-isolation limitation that
must be addressed before paid mainnet testing under a temporary cheap economy.

This evidence follows the [published read-only New seasons release](../new-seasons-20261031/README.md)
and the confirmed v12 upgrade/empty Registry setup. The owner requested the next
test step. The 24-hour duration was selected for this unsigned rehearsal only;
it is not a live start time, scheduled season or funding instruction.

## Results and actual chain state

| Check | Result | Evidence |
| --- | --- | --- |
| Production module identity | Both rebuilt modules exactly match the confirmed v12 bytes after only the original self-address binding; 89 linked framework modules match | [Move summary](move/summary.json), [production build log](move/production-build.log) |
| First-season contract entrypoints | 19 passed, 0 failed | [Move test log](move/first-season-tests.log) |
| Offline evidence-validator regressions | 30 passed, 0 failed or skipped; no network calls | [Validator summary](validators/summary.json), [TAP log](validators/node-tests.log) |
| Mainnet start rehearsal | `SUCCESS`; one call, four inputs, 24 hours; exact transaction kind preserved | [Unsigned packet](mainnet/unsigned-packet.json), [simulation response](mainnet/simulation.json) |
| Estimated start gas | 100,553 MIST / **0.000100553 SUI**; simulation only | [Mainnet summary](mainnet/summary.json) |
| Actual signatures / submitted transactions | **0 / 0** | [Driver](../../season-test/check-live.mjs), [request record](mainnet/summary.json) |
| Actual gas spent / funds deposited | **0 SUI / 0 SUI** | [Mainnet summary](mainnet/summary.json) |
| Actual Registry after rehearsal | Season ID `0`, start `0`, pool `0`, treasury `0`; all creation fields and table identities unchanged | [Final public read](mainnet/after.json) |
| Administrator and legacy state | Settlement AdminCap, UpgradeCap, legacy Registry and legacy AdminCap references, ownership, types and contents unchanged | [Preflight read](mainnet/inputs.json), [final read](mainnet/after.json) |
| Application / contract / deployment changes | None in this test step; the website retains its published read-only release | [Prior release handoff](../new-seasons-20261031/README.md) |

The successful Move run completed on **October 31, 2026 at 12:22:51 a.m. CDT**
(`2026-10-31T05:22:51.836166Z`). The final mainnet check completed at
**12:27:58 a.m. CDT** (`2026-10-31T05:27:58.595Z`). Its final actual-state
observation is checkpoint **340028868**, timestamp **2026-10-31T05:27:56.614Z**.
That checkpoint is later than the actual Clock used by the simulation,
**2026-10-31T05:27:55.440Z**. These are recorded observations, not guarantees
about subsequent chain state.

The indexer initially lagged the simulation full node. The driver saved
[observation 1](mainnet/after-observation-1.json),
[observation 2](mainnet/after-observation-2.json) and
[observation 3](mainnet/after-observation-3.json), then selected the third.
The validator requires the final checkpoint to be at least the simulation
observation's checkpoint and its timestamp to be at least the simulation's
actual execution Clock. A call made afterward without that time check is
insufficient evidence of later chain state.

## What the contract tests establish

The earlier payout suite started from an already-active fixture. These new
tests start from an empty Registry and invoke the real start entrypoints. They
verify immediate 30-day and 24-hour starts, accepted duration boundaries,
rejection of zero or excessive duration, capability binding, administrator and
version checks, replay rejection and rejection of inconsistent first-start
state. They separately assert the actual `SeasonStarted` event time and the
backdated stored start used by a shortened season.

One lifecycle case uses the deployed test prices and actual entrypoints for
both planting paths, buying and applying a Watering Boost, funding the pool,
watering, direct rewards, archiving, starting season 2 and claiming the remaining
season-1 archive allocation. All money and inventory in these tests are
synthetic Move VM fixtures.

| Synthetic lifecycle quantity | Verified amount |
| --- | ---: |
| Two plant payments | 0.01 SUI each |
| Watering Boost payment | 0.02 SUI |
| Pool deposit | 0.013 SUI |
| Total synthetic input | 0.053 SUI |
| Pool available for rewards | 0.041 SUI |
| Treasury-wallet transfers | 0.0112 SUI |
| Developer-wallet transfers | 0.0008 SUI |
| Registry treasury field | 0 SUI |
| Seed weights after care | 31 GP and 10 GP |
| Direct reward | 0.031 SUI |
| Archived reward after season 2 starts | 0.010 SUI |

The archive keeps its original deadline. Its pool is fully consumed by the two
claims, and the new season's pool remains empty. The test exercises the actual
minimum watering interval of **21.6 hours**; selecting a 24-hour season does not
shorten that rule. The [Move coverage document](../../season-test/move/README.md)
and [test fragment](../../season-test/move/first-season-tests.move.inc) identify
the assertions and reproduction commands.

## Finding: a second Registry does not isolate test inventory

Two passing characterization cases demonstrate the deployed v12 behavior:

- `season_test_tool_bought_in_another_registry_is_accepted_current_behavior`
  buys a Tool through Registry A and successfully applies it to a Seed in
  Registry B.
- `season_test_crate_bought_elsewhere_opens_against_unstarted_registry_current_behavior`
  buys a Crate through Registry A and successfully opens it against Registry B
  while B has never started a season. It produces a version-compatible Tool.

The current Tool and Crate types carry a version but no originating Registry or
purchase-price provenance. This means a new Registry alone cannot prevent
inventory bought at temporary test prices from being used later under the same
module/version. The passing tests document this behavior; they do not correct
it or demonstrate a production isolation guarantee.

Starting the current unpaused Registry would open its on-chain test-price
actions to callers. The website's read-only guards would continue to protect
that interface, but do not disable direct calls to an active contract. Therefore
the next live-test prerequisite is a concrete inventory/version/economy
isolation design, verified against these entrypoints and the intended
production transition. A second Registry without such a boundary is
insufficient. No contract policy change or production migration was made in
this step.

The [production price schedule](../../../economy-review/decisions.json) is
already approved; its implementation remains separate. This finding does not
request another pricing approval. Legacy inventory and any compensation also
remain separate from the new Registry.

## Exact mainnet rehearsal

| Identity | Verified value |
| --- | --- |
| Network | Sui mainnet; genesis `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` |
| v12 package / settlement type origin | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Bound AdminCap | `0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835` |
| Administrator / proposed sender | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Confirmed setup transaction | `87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp` |
| Function | `settlement::start_season_for_duration` |
| Duration argument | `86400000` milliseconds |
| Unsigned transaction kind | 258 bytes; SHA-256 `6c89e6e0c74aa30a0b258194805566947469a3ed4fc1cfef97e4d9ecc71922f1` |

The four arguments are the exact owned AdminCap reference, the mutable shared
Registry with initial version `986499448`, the read-only shared Clock and the
duration. The new packet is built from current objects. The earlier setup
transaction and its simulated identities are not reused.

The request sets `checksEnabled:true` and `doGasSelection:true`. It validates
the returned full transaction bytes, sender and gas owner, positive budget and
price, exact kind, actual unchanged Clock input, single `SeasonStarted` event,
and all output object and balance changes. The resolved address-balance gas
mode uses a mainnet-bound `ValidDuring` expiration for epochs 1297–1298 with an
execution nonce. It selects no gas coin objects. This resolution is checked
separately from the unsigned proposal, which has no final gas or expiration.

The predicted result changes only the existing Registry and owned AdminCap
metadata. The Registry's only content changes are season ID `0` to `1` and the
stored start; the AdminCap's contents and owner remain unchanged. No protocol
object, Seed, reward funds or treasury funds are created. The only predicted
balance change is the administrator's estimated gas debit. The simulated
budget is **200,553 MIST**; it is an observed resolver value, not an authorized
spending limit or future fee guarantee.

The simulated Clock is `1793424475440` ms, the shortened season's stored start
is `1790918875440` ms, and its predicted cutoff is `1793510875440` ms. The claim
deadline is seven days after that cutoff; ordinary reset readiness is one day
after cutoff. These values describe a past unsigned simulation. **There is no
live season schedule or confirmed start transaction.**

## Evidence and limits

The [test tools](../../season-test/README.md) document reproduction. The Move
runner uses the pinned compiler/framework, an empty keystore, loopback-only
client configuration and blocked network proxies. The mainnet driver uses
credential-free public GraphQL reads and one checked simulation per run, with
bounded read-only indexer catch-up. It contains no execution or signing path.

The saved final run records every public request and both verification-source
hashes. During development, earlier requests exposed the endpoint's field and
payload limits; earlier simulations also revealed automatic gas-expiration
resolution and indexer lag. The final record is not a claim that only one
simulation was attempted during the whole test step. None of those attempts
requested a signature, executed a transaction or incurred a gas payment.

The 30 offline validator tests accept the captured real proof and packet, then
reject altered network/authority, mixed proof and simulation data, stale or
nonempty state, changed table identities, extra calls, wrong duration, sender
or gas owner, insufficient budget, inconsistent gas references, missing or
wrong-chain expiration, altered Clock/events/outputs/balances, and premature
post-observation timestamps. The [suite](../../season-test/start-core.test.mjs)
disables `fetch` and checks that it was never called. The validator summary
preserves the earlier 29/30 run's test-expectation correction; the reused
receipt validator had already correctly rejected the changed capability.

The [combined verification record](verification-summary.json) pins the saved
evidence and source files by SHA-256 and records the unchanged application
baseline. The current test step adds verification tools, results and handoff
documentation only. Its result is separate from the prior website release's CI
and browser checks; no claim of a new all-green repository CI run is made.

This evidence establishes contract VM behavior, exact source-to-publication
identity, the checked mainnet prediction and unchanged real objects at the
final checkpoint. It does not establish a real Slush signing journey, a paid
player transaction, a live first season, production-price isolation or a new
website deployment. The published application remains source
`20271661083263cc2e87bbaae2c9f5bf93973382`, deployment
`6ae57602f4f0e531f67877e7`, from the preceding read-only release.
