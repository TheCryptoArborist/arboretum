# Season 1 Step 3 — holder-bonus review

Status: isolated candidate, not deployed or connected to the public website. No main merge, contract publication, live-price activation, inventory reset, claim modification or treasury transaction occurred.

## Verified result

Commit `ac781e5040df3285e7fe45292b6ed527ebaf8268`, Actions run `35655220056`: **107 Move tests passed, zero failed** (68 retained + 39 holder tests). Five additional input-type rejection checks and the non-test build passed. The test keystore remained empty.

Artifact `10664440169` SHA-256: `4393c0f625f6acf1127747eb2d5f638c2583364f8dcef8304c64699efabf6537`.
Candidate SHA-256: `8ed658a745960a37d5ae4a8ab59e0ded5d560d05026c1e96498a3e9d8774f626`.
Downloaded evidence was hash-verified and regenerated locally with an exact source match.

## Included benefit

| NFTree rarity | Ancient default | Mythic default |
|---|---:|---:|
| Common | 1 future boosted watering | 2 |
| Rare | 2 | 4 |
| Epic | 3 | 6 |
| Legendary | 4 | 8 |
| Mythic | 5 | 10 |
| One of One | 6 | 12 |

Each default is one Holder Growth Boost tool with one application, preparing the listed number of future +50% waterings on one Seed. It adds queue length, not a larger multiplier, and gives no instant points or automatic watering.

Instead of the default, choose one-use Miracle Grow when the default count is at least two, or one-use Double Dose when the default count is at least five. Exactly one selection is included per qualifying paid Ancient/Mythic purchase, not one per NFT owned. Other crate/chest tiers have no holder grant.

## Rarity and purchase verification

Rarity comes from the canonical NFT's own stored field. The candidate validates its type and reads its on-chain serialization using the verified original layout. The collection's field layout and public rarity getter were inspected as evidence; the candidate does not directly call that getter. No browser-provided rarity or administrator-maintained rarity list is accepted. Unknown labels are rejected.

The inspected module hash is `697344713a0f8fc2b3b52d11403ea18fda96b6c6064befbb85543bb4e7c48e21`. The 50-object read observed all six supported labels; it is a sample, not collection totals.

Checkout receives an owned NFT input and returns the same object unchanged. Existing NFTrees are not reminted and their traits are not modified. Future website integration must select the highest eligible NFT; the contract verifies the NFT actually submitted.

The receipt binds the one-time grant to its paid purchase and selected item. A holder tool may be used before opening its crate; the later opening issues ordinary loot only. Ordinary purchases do not qualify for retrospective grants. Permitted transfers preserve item origin and uses. A new NFT owner must make a new paid purchase to receive another bonus.

The usual payment-allocation routine is retained. A 25 SUI Ancient fixture adds 17.5 SUI to the test pool without a referral or 17.325 SUI with the applicable referral. Change is returned. These are synthetic funds. Each crate in a batch receives a distinct receipt and its own payment allocation.

## Limits and next work

Tests run locally in the actual Move VM/compiler with synthetic NFT/legacy fixtures and separate public read-only evidence. The non-test build has no fixture dependencies. These checks are not real-wallet, marketplace-custody or deployed-package testing and are not a complete security audit.

The live timing issue remains until a reviewed cutover. Next: deterministic season-end snapshots and claims, followed by actual frontend/wallet integration, accurate bonus display, approved inventory/old-claim treatment and final release review. Bottomless Can automation and full economic balancing remain open.

SUI-only gameplay and separately approved treasury-funded TREE acquisition remain the design direction. No public launch or financial action is performed by this candidate.
