# Season 1 owner claim verification

**Live at [the claim tester entrance](https://www.treegrow.xyz/tester-access?next=claim-test).**
Source `c298d5a8bd0a47cd3e971ca3d89a428f1b888644` was published as deployment
`6aebf7959ad6e90b6714ca15` on **November 4, 2026 at 9:27 p.m. CST**
(`2026-11-05T03:27:36.144Z`).

The candidate passed local validation on November 4, 2026, America/Chicago
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

## Published verification

The [hosted inventory record](hosted/hosted-assets.json) verifies all **103
application files** by hash and size, with **37 protected runtime files** also
compared as raw deployed bytes. The archived source, candidate inventory and
source tree match the reviewed commit. The existing calendar bundle/runtime,
both edge functions, empty schedule list and original site's published identity
are retained. The three new claim assets and two navigation-only additions
match the locally reviewed output.

All **15 [anonymous hosted checks](hosted/hosted-http.json)** pass. They cover
the claim document variants, fixed tester return, protected runtime assets,
retained owner routes, public landing and public guide. The
[native browser observation](hosted/browser-entrance.json) confirms that
`/admin/claim-test/` reaches
`https://www.treegrow.xyz/tester-access?next=claim-test` with **Continue to
season reward**. No tester password was entered. Authenticated runtime bytes
were checked through the deployment API, not through an authenticated browser
session.

Both required exact-source **Settlement app integration review** runs pass:
[push](https://github.com/TheCryptoArborist/arboretum/actions/runs/41961506998)
and [pull request](https://github.com/TheCryptoArborist/arboretum/actions/runs/41961514140).
The [complete CI record](hosted/ci.json) also records five older preview workflow
failures. Their workflow/build/test scripts are unchanged from the watering
release. Economy and Partner show the same detailed failures; Garden season
and both Reward-first workflows stop at the same retained-baseline stages.
The latter three redirected assertions were not individually compared. No new
substantive regression was identified in the observed patterns, and deployment
steps were skipped in all five. This is not a claim that every repository
workflow passed.

The [final mainnet read after publication](hosted/mainnet-state-after-publication.json),
completed at `2026-11-05T03:30:23.264Z`, verifies checkpoint **341780170**:
the Seed remains **10 GP**, its reward remains **unprocessed**, and **0.007
SUI** is available inside the fixed claim window. Website publication did not
execute a claim. The owner can now follow the page's explicit Slush review and
approval flow.

The publication evidence is saved in a documentation-only follow-up commit;
the deployed application source remains the reviewed commit identified above.
