# Season 1 owner claim verification

The candidate passed local validation on **November 4, 2026, America/Chicago**
(November 5 UTC). This record distinguishes actual public mainnet reads,
unsigned simulations, synthetic receipt tests, and the disconnected browser
preview. No real wallet was connected and no blockchain transaction was
submitted during implementation or verification.

## Actual mainnet state and unsigned claim

The [fresh validated simulation](validated-mainnet-simulation-20261105.json)
reads the original Seed at checkpoint **341772943**, builds the exact single
`settlement::claim_reward` transaction, and validates its checked simulation
at checkpoint **341772956**. The observation completed at
`2026-11-05T03:01:07.435Z`.

The actual Seed still had **10 GP**, streak 1 and `reward_processed:false`.
The Registry held **7,000,000 MIST**, with 10 eligible GP across its one Seed.
No watering had occurred. The successful unsigned simulation predicts:

| Quantity | MIST | SUI |
| --- | ---: | ---: |
| Reward paid to the owner | 7,000,000 | 0.007000000 |
| Estimated network fee | 1,575,051 | 0.001575051 |
| Net owner balance increase | 5,424,949 | 0.005424949 |

The claim finalizes the settlement, emits the exact entitlement and payment
events, creates one reward coin for the owner, and marks the Seed processed.
Its GP becomes zero because that entitlement has been consumed. The fixed
deadline is **November 8, 2026, 3:57:28.277 p.m. CST**, inclusive on-chain.
The simulation does not establish an actual payment or deployed reward coin.

The [original unsigned capture](initial-mainnet-simulation-20261105.json)
is also retained as an unmodified fixture. The validated capture records the
claim core's SHA-256 and transaction-kind hash, tying the review to the code
and exact proposed command. The core has remained unchanged since that check.

## Local validation and independent review

[Local validation](local-validation.json) records all passing final checks:

- **60 claim tests:** 35 core tests and 25 controller tests.
- **32 tester return/authentication tests**, including the new fixed claim
  destination and its incorrect-code retry behavior.
- **26 read-only view/build policy tests**.
- The existing model, reader, wallet, release, reconciliation, administrator,
  planting and watering test groups, plus lint and the complete protected build.
- A source comparison confirms that the existing contracts, wallet dependencies,
  general game inputs, calendar function, public guide handler and deployment
  configuration retain their previous bytes.

The first build-policy run preceded creation of the new build module and failed
two guard checks at import time. Once implementation was complete, the final
run passed all 26 checks without changing those guards.

Core tests cover deadline inclusivity, eligibility at cutoff rather than later
health, original or already finalized settlement, 10/24-GP state, zero rewards,
exact BCS and typed events, payout plus gas, current/historical receipt binding,
and verified failed-receipt recovery. Controller tests cover explicit provider
and account choice, changed review acknowledgement, stale reads, expired
windows, unknown outcomes, receipt recovery and the held recovery lock.
Confirmed receipts in these offline tests are synthetic and prove no on-chain
payment.

Independent review found no outstanding blocker in the core, controller or
release utility. A closed-season message was corrected so the page does not
promise receipt verification after the Registry changes season or is archived,
which is outside this isolated page's scope.

## Desktop and mobile preview

The [browser record](visual-qa-20261105.json) documents a local preview compiled
from the real controller with a disconnected wallet stub and public mainnet
status reads. The disposable harness cannot sign, execute or simulate a wallet
transaction; the production origin check remains intact.

Both desktop and mobile showed **0.007 SUI**, **10 GP**, **10/10 eligible GP**,
**Ready to claim** and a current mainnet checkpoint. Claim checking and wallet
approval stayed disabled without an explicitly selected account. All three
image elements loaded. Desktop width/scroll width were 1363/1363 CSS pixels;
the 390-pixel mobile iframe's document width/scroll width were 375/375, so
neither view had horizontal overflow. The mobile fee, approval and recovery
controls were also visually inspected.

- [Desktop preview](claim-desktop-20261105.jpg)
- [Mobile reward view](claim-mobile-20261105.jpg)
- [Mobile fee and recovery controls](claim-mobile-controls-20261105.jpg)

Sampled console errors came from the browser metadata extension rather than the
application. This preview does not establish a genuine Slush signing session or
native tester login. Those require the owner's own browser and wallet.

## Release boundary

The [live preflight](preflight-20261105.json) verified the dedicated
`www.treegrow.xyz` site and all 100 application files in the previous watering
release. [Candidate preservation](preservation-20261105.json) verifies exactly
**98 unchanged application files**, **two navigation-only HTML additions**, and
**three new claim runtime files**, for **103 application files** in total.

The release utility binds the source archive and candidate inventory to a clean
Git commit, journals before the sole submission, and rejects uncertain repeats.
It verifies the existing calendar function and runtime, both edge handlers,
empty schedule list, disconnected Git deployment and retained original site.
Hosted source/asset/HTTP and exact-source CI results are added after publication.
