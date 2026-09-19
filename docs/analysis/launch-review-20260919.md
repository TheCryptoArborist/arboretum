# Arboretum launch review — September 19, 2026

This records a bounded read-only inspection, not a completed security audit or a production change. Public Sui GraphQL responses and website bytes were read at approximately 22:09:52 UTC. The original evidence archive SHA-256 is cefa2a98f8e92dc02b20c6a7ae9acb952c007c1c1a917e1fa0e85d8b6d9623d0. The private conversation attachment contains the raw responses and deployed module disassembly; no transaction was signed, submitted or simulated.

## Actual rewatering result

Transaction `5ZXvEJcDuWFfmMF3WeoNAQAWyrdPVDnh8awB99Kgnb5d` succeeded at 2026-09-19T22:04:18.916Z. Sender was the previously provided wallet ending `d35d6`. The query returned six transactions calling the configured Arboretum module for this wallet, with no older page remaining for that filter; this is not all wallet activity or activity using older packages.

Two SeedWatered events and complete input/output object changes confirm:
- Seed `0x40555d5215a01b4fc1b2bb197b5e8a2fe1bef9858a84d1e91868b7b3773193cd`: 134 to 146 Growth Points; stored streak 1 to 1; alive state 0 to 0.
- Seed `0xf515d865a8880b741b7e06add0be08f2620cc1f1f5b768ae1e5097c7adc4c028`: 134 to 146 Growth Points; stored streak 1 to 1; alive state 0 to 0.
- Combined player point field: 268 to 292. Registry point field: 2118 to 2142 within this transaction. Other later activity must not be confused with this transaction's delta.
- Both stored last-watered timestamps changed from 1789346077494 to 1789855458916: an elapsed 5 days, 21 hours, 29 minutes and 41.422 seconds.
- Both input Seeds had zero queued boosted waterings, no doubling, zero permanent bonus and no timed protection.
- Existing points were retained; each Seed received one normal 12-point watering, not missed-day catch-up points. The stored streak was already 1 before this transaction; it did not drop from a higher stored value today.

The deployed watering code restarts the streak at 1 after two full dry days and uses 7/10 full dry days as wilt/death thresholds. With no other effects, 10 base points plus 2 streak points explains the observed +12. The ordinary interval is 77,760,000 ms (21h36m). From this transaction, the next ordinary watering is at or after 2026-09-20T19:40:18.916Z, assuming no intervening timer-changing action. These are current inspected rules, not recommended new penalties.

## Release state

GitHub main remains `2338affe1dd984f5bc676cec7f3763d1f37a90cf`. Netlify's project reader identifies `6aa4e0bdc5c59a631ddc1db9` as the current production deployment. The live site and guide returned HTTP 200 through the read-only runner. The live wallet.js is byte-identical to the saved checkpoint, with SHA-256 e75087b0cfad4857932205f1aa827812d7ea06b4c9d833a062ab2ed3c1f08e17. The live guide hash is 885a34075dc8aebe919e1f49854c1b82df1f8cc884f3e6e5654eddc1e7659b89, matching the published v0.2 guide.

The wallet configures package `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`. Its deployed module was retrieved as disassembly via GraphQL, not inferred from the saved Move file. The module contains the BOOM and Victory purchase entry points. A reproducible full source-to-package equivalence check remains unfinished.

The inspected buy_crate function permits tiers 0 through 6; every price branch uses constant 35 = 10,000,000 MIST (0.01 SUI). BOOM/Victory delegate to this function. This purchase path has no qualifying NFT input or holder-bonus issuance. The proposed production prices and holder privileges are therefore not supplied by this route.

## Technical launch gates

The previously identified protection/point-timing concern is present in the configured deployed bytecode, not only the old repository source. Treat it as a priority correction before public reward competition. No abuse transaction was executed and no exploit recipe is published here. Technical instruction-level evidence is retained in the owner review attachment.

The inspected apply_tool implementation also lacks the proposed shared instant-point cooldown and the proposed two-application seasonal Forest Heart cap. These remain candidate changes, not enabled controls.

The direct claim path checks dryness at claim time; the archived claim path differs. Test season-end entitlement, delayed claims, archive timing, post-cutoff state changes, double claims and rounding against the intended Season 1 specification before public launch. This review executed no claims and did not certify payout correctness.

## Design versus implementation

The Season 1 Ruleset v1 attachment is an owner-review specification and local Python model, not deployed Move code. It proposes SUI-funded purchases, Ancient/Mythic holder privileges, targeted tool limits, treasury-funded TREE acquisition after player allocations, and a clean test/production boundary. Preserve that scope. Do not revive TREE-only or mixed crate checkout or remove rarity benefits from the first production season.

Recommended next step: implement the isolated Season 1 candidate starting with watering/protection regression tests and legacy-path isolation, then holder grants, prices, complete payout tests and the inventory transition. A successful ordinary watering does not certify the full economy or public launch readiness. Final price-weighted multiplayer simulation and partner loot-table verification remain pending.

Only an isolated diagnostic branch and read-only workflow were used. No main merge, production deploy, contract upgrade, wallet transaction, price change, inventory reset, pause or treasury action was performed.
