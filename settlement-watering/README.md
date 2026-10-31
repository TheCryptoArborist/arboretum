# First watering owner test

This is the next step after the owner's confirmed first Seed planting. The
protected page is `/admin/watering-test/`; its fixed tester entrance is
<https://www.treegrow.xyz/tester-access?next=watering-test>.

## Confirmed starting point

| Item | Value |
| --- | --- |
| Planting transaction | `FM5QeE2Eb2tQwQeSsTKz8s4a81mZVqde5kF2HAEmyisB` |
| Seed | `0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d` |
| Owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Season / inventory version | 1 / 1 |
| Seed at first planting | 10 Growth Points; watering streak 1; no tools |
| Existing reward pool | 0.007 SUI |

The live observation at checkpoint 340292145 on October 31, 2026 confirms the
Seed and Registry still point to that planting transaction. This is a dated
observation; the page reads fresh state before preparing a review.

## Exact watering window

All local times below use **America/Chicago**, including the November 1 clock
change.

| Event | Local time | UTC |
| --- | --- | --- |
| Planted | October 31, 2026, 5:40:41.252 p.m. CDT | `2026-10-31T22:40:41.252Z` |
| First watering opens | November 1, 2026, 2:16:41.252 p.m. CST | `2026-11-01T20:16:41.252Z` |
| Growing closes | November 1, 2026, 3:57:28.277 p.m. CST | `2026-11-01T21:57:28.277Z` |

The minimum watering interval is 77,760,000 milliseconds (21 hours, 36 minutes).
The first watering window is **1 hour, 40 minutes, 47.025 seconds**, with an
exclusive closing boundary. The transaction must execute before closing.

## Owner flow

1. Open the watering tester entrance with the existing tester code.
2. Read the current Seed, Growth Points and live countdown. Reading requires no
   wallet connection. The page refreshes the state from mainnet.
3. Once the window is open, connect the Slush browser extension and explicitly
   choose the owner account ending **45c4**.
4. Check watering and review the current gas estimate and expected result.
5. Acknowledge the review, then select **Review watering in Slush** and approve
   the exact transaction in the wallet.
6. Retain the confirmed watering receipt after the successful effects are read
   from mainnet.

The one transaction calls `settlement::water_seed` with the existing Registry,
the pinned Seed and the Clock. It transfers no watering payment and requires no
NFTree, referral or administrator capability argument. **Only network gas is
charged.** With the current unmodified Seed, its streak becomes 2 and its Growth
Points become **24**, an increase of 14 (base 10 plus streak bonus 4). A simulation
is a prediction; only an actual successful transaction establishes that result.

A current checked unsigned simulation correctly rejects an early watering with
contract abort code 5. A successful live watering simulation cannot be completed
before the cooldown ends. Future eligible execution is covered by deterministic
tests; the real owner flow simulates again after eligibility.

## Scope and verification

The page uses the repository's existing locked Sui SDK and Slush selection
pattern. Each submission is tied to the reviewed provider, account, Seed and
transaction. A persistent journal and browser lock protect an uncertain request
from duplicate submission. The receipt verifier checks actual execution success
and the expected Seed transition. A transaction digest alone is not treated as
confirmation.

The prior planting page gains a link to this next step. The remaining prior
application assets, ordinary garden transaction guards, other owner operations,
contract source, test Registry and production version-2 plan retain their scope.
Release verification checks the exact current dedicated-preview site, backend
identities, access gate and published file inventory.

Current Mysten Labs guidance was read at commit
`97340218523a4c3cb0f3f34fa177b5101cf36676`: `README.md`,
`frontend-apps/SKILL.md` with `transactions.md` and `non-react.md`,
`ptbs/SKILL.md` with `building.md` and `commands.md`,
`sui-sdks/SKILL.md` with `typescript.md`, and `accessing-data/SKILL.md`.
The installed SDK's version-matched documentation and types resolve API details.
