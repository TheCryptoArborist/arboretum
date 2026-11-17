# Season 3: focused owner watering test

This page prepares the next controlled mainnet cycle at
<https://www.treegrow.xyz/admin/season-three/>. Its purpose is to verify one
actual watering, persistence of that result after refresh, and a subsequent
reward claim that processes 24 Growth Points.

The completed Season 2 page remains at
<https://www.treegrow.xyz/admin/season-two/>. Publishing this new page does not
start or reset a season. The owner personally reviews and approves every
transaction in Slush.

## Confirmed starting point

Season 2's claim is
[`EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB`](https://suivision.xyz/txblock/EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB),
confirmed at checkpoint **343802393**, on **November 10, 2026, at 12:24:29 PM
America/Chicago**. It processed **10 GP**, paid **0.007 SUI**, used
**0.001575051 SUI** in net network gas, and increased the owner's SUI balance by
**0.005424949 SUI**. The Seed is marked reward processed, with zero remaining
GP. The Registry's 7,000,000-MIST pool is fully paid.

The new page independently validates that fixed claim's transaction bytes,
digest, successful checkpointed effects, objects, events, payout, and gas. It
also verifies current deployment authority, ownership, and the predecessor
state. A known digest or browser storage entry alone does not authorize the
next operation.

The untouched read-only responses and exact requests are in
[`verification/mainnet/`](verification/mainnet/). The capture records observed
chain state, not simulated Season 3 results.

## Timing and owner steps

The existing contract's ordinary `reset_season` path becomes available at the
previous growing cutoff plus 24 hours: **November 11, 2026, at
08:45:27.707 AM America/Chicago** (`1794408327707` milliseconds). Before that
instant the page shows a waiting state and cannot prepare or submit a rollover.
This test uses that ordinary path and does not invoke the separate early
archive entry point.

1. **Start Season 3.** After the ordinary reset gate opens, review the fully
   paid Season 2 archive and start a 48-hour season in one atomic transaction.
   The 48 hours begin at actual execution, not publication or the earliest
   allowed start time.
2. **Plant one Seed promptly.** Reuse the same fixed NFTree for the existing
   0.01-SUI test charge plus network gas. The NFTree remains in the wallet.
   Planting begins with 10 GP.
3. **Return for one watering.** Readiness opens 21 hours and 36 minutes after
   the actual planting. The page displays the exact time and offers a calendar
   download based on the verified receipt. Water before the growing cutoff.
   The expected first watering changes 10 GP to 24 GP and streak 1 to 2, with
   consistent owner and Registry accounting. Watering has no application fee;
   the network fee is reviewed separately.
4. **Claim after the growing cutoff.** Check the current entitlement, review
   network gas and net payout, and personally approve the claim. The claim
   window lasts seven days after the cutoff. The focused test is complete only
   when a real watering and a 24-GP claim are verified.

A missed watering does not forfeit the original 10-GP claim. That claim can
still be completed, but it does not establish that watering was tested.

All transaction preparation uses fresh mainnet state. Countdown display alone
cannot enable an action. Simulated results remain estimates, and receipt
recovery checks actual checkpointed transactions. Wallet gas selection stays
with Slush. Pending or ambiguous submissions remain locked until their outcome
is verified.

## Fixed scope

| Item | Value |
| --- | --- |
| Network and allowed origin | Sui mainnet; `https://www.treegrow.xyz` |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Bound AdminCap | `0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835` |
| Previous Seed | `0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2` |
| Reused NFTree | `0x04a937cd60e0cbcfc315b15d2dd08187d3f180ebb925d588223303ea52afbcc7` |
| Inventory version | 1 |
| New season | 3 |
| Growing duration | 172,800,000 milliseconds / 48 hours |
| Supported new Seeds | One |

Both processed Seeds from Seasons 1 and 2 remain accounted for. Planting must
append the third Seed to the owner index and advance the per-owner season and
NFTree season markers from 2 to 3. The existing `player_growth` value can stay
10 when the first new Seed is planted; the verifier retains the previously
implemented exact unchanged-runtime-reference and historical-object proof.
Watering must change that field from 10 to 24.

## Build and deployment boundary

The release adds only:

- `admin/season-three/index.html`
- `admin/season-three/admin.css`
- `admin/season-three/admin.mjs`

The baseline is Netlify deployment `6af09274b50143d105dbb63a`, built from
`1062f33c881939de53ca10529ef81b5d8dbabc89`. All **106 existing application
files** must remain byte-identical, producing **109 application files** in
total. The source modules, test fixtures, and evidence are not published as
application assets.

The target is `d425445d-4980-49be-8ab2-12e7527ba281`, `arboretum-preview`, at
`www.treegrow.xyz`. The existing calendar function, both edge functions,
absence of schedules, source configuration, and original site's published
deployment are preserved. The direct Season 3 route uses the existing
dedicated-site access policy without requiring a tester code.

The release requires exact saved source, successful required push and PR
integration checks, a protected build, preservation verification, and an
authenticated preflight. One source-build submission is durably journaled
before it is sent. An uncertain submission outcome cannot trigger an automatic
second submission.

The general Garden remains read-only. This work does not change contract code,
publish the prepared version-2 production candidate, create a production
Registry, or establish public-launch readiness. Multiple-wallet reward
allocation and the ordinary public Garden remain separate validation work.

## Current guidance

The live Mysten Labs skills README was checked on November 10, 2026. Relevant
files consulted for this work include:

- `frontend-apps/SKILL.md`, `transactions.md`, and `queries.md`.
- `accessing-data/SKILL.md` and `graphql.md`.
- `ptbs/SKILL.md`, `building.md`, and `commands.md`.
- `sui-move/SKILL.md` and `move.md`.
- `move-security/SKILL.md`, `best-practices.md`, and `access-control.md`.

The Netlify deployment skill and current coding context were also consulted.
Publication and final verification results are recorded separately after the
checks finish; this design description is not evidence of an executed Season 3.
