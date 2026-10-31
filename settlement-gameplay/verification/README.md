# First test Seed: verification and release record

## Current handoff

The actual first test season is confirmed on Sui mainnet. The next owner action
is one paid NFTree-backed planting in the same version-1 Season 1. The protected
entrance is <https://www.treegrow.xyz/tester-access?next=gameplay-test>.

This source snapshot is prepared for publication. The deployment, hosted checks
and exact-source CI results will be recorded in an evidence-only follow-up after
the saved source is published. No real planting was executed during development
or verification. Only the owner can approve that transaction in Slush.

## Actual season-start receipt

The user's transaction
`HEKxugzt8jjFK3bVxdxzBDkWaiRwefawMQb9PtuNy9uW` was independently read and
validated, including its transaction digest, commands, inputs, events, Registry
transition, execution Clock and gas effects. The saved public evidence is in
[`../../settlement-season/verification/confirmed-20261031/`](../../settlement-season/verification/confirmed-20261031/).

| Confirmed fact | Value |
| --- | --- |
| Test season / inventory version | 1 / 1 |
| Actual start | October 31, 2026, 4:57:28.277 p.m. CDT |
| Growing cutoff | November 1, 2026, 3:57:28.277 p.m. CST |
| Claim deadline | November 8, 2026, 3:57:28.277 p.m. CST |
| Actual start network fee | 0.000100553 SUI |
| Reward pool / treasury after start | 0 / 0 SUI |
| Seeds / total GP / eligible GP after start | 0 / 0 / 0 |

The growing period is exactly 24 hours. The local clock moves back overnight.
The actual start and stored contract start differ by the contract's test-season
offset; all eligibility checks use the confirmed real cutoff.

## Checked planting prediction

`mainnet/` contains the fixed actual start proof, complete current inputs, the
reviewed dynamic transaction packet, the one successful checked unsigned
simulation, and a strictly later observation of the real chain. The source and
SDK reference identities are in `mainnet/final-validation.json`.

The administrator owns **1,077 matching NFTrees across 22 pages**. Pagination is
bounded and pinned to one checkpoint. It rejects incomplete inventories, changed
checkpoints, malformed cursors and duplicate object IDs. The owner must select
the exact NFTree; there is no automatic selection.

The reviewed transaction splits 10,000,000 MIST from gas and makes exactly one
`settlement::plant_seed_with_nftree` call with that NFTree, the existing Registry,
no referral and the shared Clock. The NFTree's contents and ownership remain
unchanged. The predicted Seed is version 1, Season 1, alive, already watered,
with watering streak 1, **10 GP** and **10 cutoff GP**.

| Payment or effect | Checked amount |
| --- | ---: |
| Gross planting payment | 0.010000000 SUI |
| Test reward pool contribution | 0.007000000 SUI |
| Existing treasury-wallet transfer | 0.002800000 SUI |
| Developer return to the administrator | 0.000200000 SUI |
| Predicted network fee | 0.011151182 SUI |

The page obtains a fresh estimate before the owner's approval. The 0.05-SUI
review ceiling limits accepted predictions; it is not an imposed gas budget or
permission to spend that amount. Slush supplies its final gas and expiration.

Validation covers every object and event, all four deterministic dynamic-field
records, exact Registry deltas, the Seed's fields, NFTree input and output,
treasury and developer coins, gas coins and all balance effects. The successful
simulation used an official address-balance gas reservation together with one
ordinary gas coin. Its version-zero reference is checked against the installed
`@mysten/sui` 2.19.0 format and exact mainnet/owner derivation, positive amount,
epoch and magic bytes. There is no general version-zero exception.

`mainnet/earlier-attempts.json` retains the development history: an initial read
stopped on partial pagination; the next request hit the GraphQL field/fragment
limit before simulation effects; the subsequent request produced the sole
successful simulation. Its captured result was validated offline after adding
the SDK's official gas-reservation validation. The successful simulation was not
repeated. There were **zero actual signatures, submissions or SUI spent**.

At checkpoint **340278131**, **2026-10-31T22:09:00.071Z**, after the successful
simulation completed at 22:06:37.349Z, the real Registry still had zero Seeds,
zero GP, zero pool and zero treasury. The checked authority, Registry and chosen
NFTree references and contents remained unchanged.

## Watering handoff

Planting initializes the first watering time. The next normal watering becomes
eligible **21 hours, 36 minutes after the actual plant** and must execute before
the cutoff. Plant before **October 31 at 7:21:28.277 p.m. CDT** to leave a later
watering window. A later plant is still possible before cutoff, with explicit
acknowledgment that no further watering fits in this season.

After the owner approves and the actual receipt verifies, **Copy receipt**
provides the Seed, NFTree, payment, actual fee, real planting time and next-water
eligibility. This page contains no watering operation. Its lock, journal and
receipt recovery prevent uncertain requests or existing first-plant activity
from enabling another first-Seed purchase.

## Automated and browser verification

- **50/50** combined core/controller tests passed, zero skipped or failed:
  `local/gameplay.tap` and `local/summary.json`.
- **27 core cases** cover transaction, proof, pagination, payment, effects, gas
  reservations, actual digest, receipt recovery and historical-state checks.
- **23 controller cases** cover explicit provider/account/NFT selection,
  identity changes, fresh reviews, reacknowledgment, submission uncertainty,
  duplicate prevention and recovery.
- All **12 required local CI command groups** passed. Ten existing groups are
  logged under `local/`; the return-policy group is under `routing/`; the new
  gameplay group is the combined 50-case run.
- Return routing **26/26**, existing tester gate **47/47**, and native form
  origin **10/10** passed. Suites use separate processes because their synthetic
  global Netlify contexts would otherwise collide.
- Offline native-browser tester-return checks passed **20/20**, including
  desktop/mobile, Strict-cookie external entry, bad-code retry and the fixed
  gameplay destination. Evidence is under `native-login/`.
- The final compiled desktop/mobile flow passed **58 checks across 17 isolated
  contexts**. Results, screenshots and exact source/bundle identities are under
  `browser/`. The final desktop and mobile readiness screenshots were also
  visually reviewed by the release owner.

Browser runtime provenance is in `browser-runtime-20261031.json`. The isolated
browser uses official stable Chrome 156.0.8078.80. Neither SDK nor Playwright
dependencies were changed. Synthetic wallet tests are labeled and do not
establish a real mainnet transaction.

## Build and deployment boundary

The final full build passed at **2026-10-31T22:11:24Z**. Every one of the **94
previously published application files** is preserved byte for byte. Exactly
three files are added under `/admin/gameplay-test/`, yielding **97 application
files**. See `preservation-20261031.json` and `build-final-20261031.log`.

| Added file | SHA-256 |
| --- | --- |
| `admin.mjs` | `2af356dbadf893778dd6e1f267b07a5f40678cd290b3c23ce5dd826cba323235` |
| `admin.css` | `97ca629f0b47b6fb7fe2de138f60213c253028a9d9ff6647f84749a908009bd3` |
| `index.html` | `b6fbe1d1483cb23f029905b64eb0f812d71806bf4ab5a1a4aa9052acc0c9ab3b` |

Publication targets the existing `arboretum-preview` site
`d425445d-4980-49be-8ab2-12e7527ba281` at `www.treegrow.xyz`, with Git continuous
deployment disconnected. `release.py` journals a single source-build request
from a saved, clean Git commit. It checks the current published deployment,
retained original project, calendar function digest and runtime, edge-function
names and empty schedules before publication and again afterward.

The global garden remains read-only with general gameplay activation disabled. Earlier admin
pages, contracts, SDK locks, the approved production economics and separate
version-2 candidate are unchanged. Hosted verification checks native login,
actual JavaScript loading, complete public inventory and exact deployed bytes
without a wallet, simulation, signing or execution. Tester credentials are
supplied through stdin and are excluded from files and reports.
