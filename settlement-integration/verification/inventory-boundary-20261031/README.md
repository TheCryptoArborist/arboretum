# Verified test-to-production inventory boundary

**The production candidate is implemented and verified: all 67 focused Move
tests passed, and Sui accepted the exact bytecode in a checked unsigned mainnet
upgrade simulation.** The candidate separates cheap version-1 test inventory
from production version-2 item effects and purchases. It has not been published
or activated; no real SUI was spent in this step.

This work follows the [first-season tests](../season-test-20261031/README.md),
which showed that same-version Tools and Crates can cross Registry boundaries.
The owner requested the next step. The approved price record is retained
unchanged; this work implements those prices only in a separate candidate.

## Selected boundary

| Property | Current test economy | Production candidate |
| --- | --- | --- |
| Package revision | Real published v12 | Predicted v13 if later upgraded; no new deployed package exists |
| Settlement object / inventory version | 1 | 2 |
| Registry | Existing confirmed test Registry | A fresh version-2 Registry, created later through the existing capability-gated factory |
| Paid acquisition | Existing test prices | Approved production prices from the first purchase |
| Old Tools and Crates | Continue using v1 paths | Rejected when consumed as v2 items |
| Existing Seeds, claims and history | Remain with their original v1 Registry/archives | No import or conversion |

Package revision and inventory version are different counters. The candidate
changes the contract's `VERSION` constant to 2. A compatible package upgrade
would advance the current package revision from 12 to 13; it would not change
existing object versions or create a production Registry automatically.

The design adds **no migration or item-conversion function**. A separate v2
Registry protects the production economy because both old and new entrypoints
already check their required object versions. The tests use the actual frozen
v1 implementation to demonstrate that old cheap purchase and care calls cannot
operate on v2 objects. New code rejects v1 Tools/Crates before they can provide
production item effects.

Official [Sui upgrade guidance](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)
confirms that old package versions remain callable and that existing version
fields can restrict shared-object access. A frontend-only restriction or new
Registry retaining version 1 would not establish this boundary.

## Exact candidate change

The [source](../../inventory-boundary/production/settlement.move),
[review patch](../../inventory-boundary/production/settlement.patch) and
[manifest](../../inventory-boundary/production/candidate.json) are separate from
the frozen published v12 source. Only 14 numeric constants change: the inventory
version and these 13 approved prices.

| Product | Production SUI |
| --- | ---: |
| Planting, either supported path | 10 |
| Seedling crate | 5 |
| Grove crate | 10 |
| Canopy crate | 25 |
| Ancient crate | 50 |
| Mythic crate | 100 |
| BOOM chest | 30 |
| Victory chest | 30 |
| Watering Boost | 2 |
| Mulch | 4 |
| Rain Barrel | 5 |
| Drought Shield | 10 |
| Revival Kit | 15 |

These amounts come from the final [approved economy decisions](../../../economy-review/decisions.json),
including the October 2 approval that superseded earlier unresolved-price
prose. No new pricing approval is requested. The current website and on-chain
test prices remain unchanged.

The fixed planting referral remains **0.001 SUI**. The approval changed the
planting price but did not authorize scaling that fixed referral. Shop referral
remains 1% of the required purchase amount, deducted first; 70% of the remainder
goes to the reward pool, 2% to the existing developer wallet and the exact
remainder to the existing treasury wallet. Overpayments are refunded.

No function body, object layout, fee destination, loot probability, tool charge,
growth rule, season timing, challenge fee, reward formula or claim deadline is
otherwise changed. The legacy module stays byte-identical. Partner accounting
remains a separate allocation of 10% of the respective chest's actual treasury
proceeds, with no automatic token purchase or partner transfer added.

## Contract and bytecode verification

| Verification | Result | Evidence |
| --- | --- | --- |
| Production-version behavior | 23 tests passed | [v2 test record](offline/v2-tests.json), [log](offline/v2-tests.log) |
| Approved prices, refunds and routing | 29 tests passed | Same v2 record; literal approved prices are used in assertions |
| Old-code rejection and preserved v1 purchase behavior | 15 tests passed | [v1 test record](offline/v1-tests.json), [log](offline/v1-tests.log) |
| Total focused contract tests | **67 passed, 0 failed** | [Offline summary](offline/summary.json) |
| Offline upgrade-evidence validators | **25 passed, 0 failed or skipped**; zero network attempts | [Validator summary](validators/summary.json), [TAP log](validators/node-tests.log) |
| Source scope | Only the exact 14 constants plus comments/whitespace differ; all 137 source-function token sequences match | [Source inspection](offline/source-scope.json) |
| Existing settlement layouts and signatures | **39 layouts and 85 public/entry ABIs preserved**; no new structs or functions | [Bytecode inspection](offline/bytecode-scope.json) |
| Production instruction structure | All 118 functions retain metadata, opcode structure and instruction counts; only 61 approved u64 constant loads differ | Same bytecode record |
| Frozen v12 identity and legacy preservation | Rebuilt baseline matches the real published v12 modules after only the original self-address binding; candidate legacy bytes are identical | [Candidate build](offline/candidate-build.json) |
| Pinned framework verification | 89 reference modules match; 238 framework source files unchanged | [Offline summary](offline/summary.json) |

The production constant pool changes from 86 to 89 entries because the compiler
deduplicates equal constants: formerly equal crate prices become distinct.
Every constant is referenced by an instruction checked by the verifier. The
independent source-token gate pins which named constants changed, preventing
another same-valued operand from being changed under the numeric allowance.

The v2 suite invokes the **actual factory** and verifies an empty shared
Registry, owned bound AdminCap, version 2, zero funds/counts, all six empty
tables and no automatic season start. A real first-start entrypoint then
succeeds in the VM. The sole added legacy capability helper is `#[test_only]`
and exists only in an isolated test copy, never in candidate production bytes.

Other cases exercise paid crate opening and tool use, remaining charges,
revival, version mismatches across item/Seed/Registry/capability paths, every
crate and Supply Drop's price with and without referral, overpayment refunds,
both partner wrappers, old-price rejection and both planting paths. All coins
and inventory in these tests are synthetic VM fixtures.

The complete offline run finished on **October 31, 2026 at 12:44:31 a.m. CDT**
(`2026-10-31T05:44:31.727383Z`). An earlier run passed 50/52 v2 cases: two economy
fixtures incorrectly expected 10 eligible cutoff GP for an untouched Seed at
the start of a full 30-day season. The unchanged death-at-cutoff rule correctly
returned 0 eligible GP while gameplay GP remained 10. Only the fixture
expectations were corrected. Candidate production code did not change.

## Checked native mainnet compatibility

The [unsigned packet](mainnet/unsigned-upgrade.json) contains exactly three
commands: `authorize_upgrade`, the upgrade carrying the two verified modules,
and `commit_upgrade`. Its only owned protocol input is the current UpgradeCap.
It contains no setup, Registry mutation, season start, funding, transfer of
upgrade authority or inventory conversion.

| Native rehearsal check | Observed result |
| --- | --- |
| Sui execution with checks and automatic gas selection | **SUCCESS** |
| Unsigned transaction kind | 40,647 bytes; SHA-256 `8fcee48655a164ab66fb7552179654ebb1af09190566b57f4d298c72122bf406` |
| Package upgrade digest | `1985543a00f6de289e170a0d16547b2a6cf709481ecb59bec7c85152393cfba9` |
| Predicted new package | One immutable package at revision 13; both module bytes match exactly |
| Existing type origins | **All 71 preserved**, including the 39 settlement origins anchored at v12 |
| Framework linkage | Observed standard library revision 25 and Sui framework revision 60 |
| UpgradeCap | Same object, owner and policy; predicted package/version commit only |
| Other protocol effects | No Registry, inventory, funds, season or gameplay event created |
| Predicted net gas | **338,227,763 MIST / 0.338227763 SUI** |
| Actual signatures / submitted transactions | **0 / 0** |
| Actual gas / funds deposited | **0 SUI / 0 SUI** |

The [raw simulation](mainnet/simulation.json) and [mainnet summary](mainnet/summary.json)
record these results. The resolved simulation uses mainnet-bound `ValidDuring`
address-balance gas for epochs 1297–1298 and no gas-coin objects. Its observed
budget is 338,327,763 MIST. The validator checks the chain, epoch window, nonce,
gas owner, exact transaction kind, positive in-budget gas debit, exact package
bytes, current framework links and complete object/event/balance inventories.
The fee and budget are simulation observations, not future fee guarantees or
authorized spending limits.

The predicted package address exists only in the saved simulation evidence.
It is deliberately not placed in any deployment configuration. No actual
production package ID or Registry ID is claimed.

## Actual state after the rehearsal

The final [public observation](mainnet/after.json) is checkpoint **340033169**, at
**2026-10-31T05:45:21.513Z**. This is 423 milliseconds after the simulation
response capture time of **2026-10-31T05:45:21.090Z**. The driver waited through
three indexed observations and selected the third; all are retained. It
requires both an adequate checkpoint sequence and a timestamp at or after the
completed simulation request.

| Real mainnet value | Verified result |
| --- | --- |
| Current package revision | **12** |
| Current Registry inventory version | **1** |
| Season ID / start | **0 / 0** |
| Reward pool / Registry treasury | **0 SUI / 0 SUI** |
| Existing Registry and settlement AdminCap | References, ownership, types and contents unchanged |
| UpgradeCap, legacy Registry and legacy AdminCap | References, ownership, types and contents unchanged |
| Predicted package address | **Absent on-chain** |

The entire mainnet verification completed at **12:45:23 a.m. CDT**
(`2026-10-31T05:45:23.613Z`). These values describe the saved checkpoint. The
driver performed one unsigned simulation in this run, with no signing or
execution path and no automatic simulation retry.

The 25 offline validator tests replay these exact public captures at their
recorded time. They reject modified candidate bytes/dependencies/digest,
additional commands, altered resolved transaction bytes, wrong authority or
gas resolution, changed type origins/framework links, foreign object or
balance changes, false confirmed-receipt labels, and premature or inconsistent
post-read state. The [suite](../../inventory-boundary/upgrade-rehearsal-core.test.mjs)
blocks `fetch` and verifies that no network attempt occurred. All 25 passed on
the first executed run; no additional mainnet simulation was needed.

## Precise guarantees and remaining release work

The verified boundary excludes old cheap **item effects and purchases** from
the production version. It deliberately retains these existing behaviors:

- Version-2 production items can be used across version-2 Registries. This is
  safe only while v2 paid acquisition consistently uses the approved economy;
  a future discount/version change needs its own boundary review.
- Administrator-only promotions can create free v2 crates. Tests preserve the
  sender/capability/pause checks. `CratePurchased` is also emitted for a promo,
  so that event alone is not evidence of payment or partner-accounting revenue.
- The generic NFT-reference planting path can reference an old key object,
  including an old Tool. It charges the full 10-SUI price and creates a fresh
  v2 Seed with base GP and no inherited charges, bonuses or reward state. The
  old item remains version 1. This path is not an NFTree type allowlist.

The current v1 Registry can remain the isolated **test economy** for the planned
owner-wallet gameplay test. Its first live start, transaction-enabled testing
interface and test funding still need their own concrete preparation and
wallet confirmation; this step did not start that test season. It does not
require making a cheap version-2 production season.

For a later production release, use the verified candidate in a separately
reviewed actual upgrade, verify the real receipt, then create and verify a fresh
v2 Registry/capability through the upgraded factory. The production frontend
must use the actual new call package, keep the existing v12 settlement type
origin, and explicitly validate both Registry identity and inventory version.
Type-based ownership queries can return both v1 and v2 objects. The current
v12 receipt/setup helpers assume the earlier single-Registry setup and must
not be reused unchanged as production-v2 validators.

The current website remains the preceding read-only deployment
`6ae57602f4f0e531f67877e7`, source
`20271661083263cc2e87bbaae2c9f5bf93973382`. No wallet, signing, SDK, website
deployment or application-activation change occurred in this step. The existing
v12 source, previous signed receipts and historical test records remain intact.

## Reproduction and saved artifacts

The [tooling guide](../../inventory-boundary/README.md) gives exact reproduction
commands. The offline runner pins the public compiler/framework, uses an empty
keystore, loopback-only client configuration and blocked network proxies, and
preserves every earlier run by requiring new output directories. The mainnet
driver uses credential-free GraphQL queries, normal TLS and the existing locked
SDK. Current Mysten Labs [publishing guidance](https://github.com/MystenLabs/skills/blob/main/sui-publish/SKILL.md)
and [Move testing guidance](https://github.com/MystenLabs/skills/blob/main/move-unit-testing/SKILL.md)
were consulted; no SDK upgrade or wallet integration change was made.

The saved `candidate-build.json` contains the complete exact module bytes in
each module's base64 field, with identical binary files retained in
[offline/bytecode](offline/bytecode). The source and bytecode scope reports,
raw compiler/VM logs, full public mainnet captures,
unsigned packet and subsequent real-state observations are retained here.
This step's focused evidence is separate from historical website CI/browser
results and makes no claim that all repository workflows are green.

The [combined verification record](verification-summary.json) records the
candidate's scope, exact results, unchanged real state, and SHA-256 hashes of
all saved source, evidence and handoff files. Independent code and raw-evidence
reviews found no remaining blocker in this candidate/test step.
