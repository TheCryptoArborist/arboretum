# BOOM revenue: transaction-grounded findings

Prepared September 12, 2026. This is an analysis report, not a change to Arboretum.

## Scope and evidence

Requested wallet: `0x18d72fc2a3df6d92d0806da3b04d92be056e2d6d35882a56c16ddb25f48d35d6`.
Primary data: public Sui GraphQL at `https://graphql.mainnet.sui.io/graphql`, retrieved September 12, 2026, approximately 20:06–20:14 UTC. Decoded transaction inputs, successful execution effects, balance changes, events, and current configuration objects were compared.
The scan retrieved the wallet's latest 1,200 sent transactions, spanning July 3, 2026 17:19:51.028 UTC to September 12, 2026 19:48:28.967 UTC. Older history remains; this is not a lifetime spending total. It also sampled the latest 50 outgoing transactions from each site-labeled project wallet and the latest 30 open_box transactions across buyers. The nine payment receipts reported below have complete balance-change and event pages and decoded successfully. Unrelated swaps, LP operations and transfers were excluded.
BOOM metadata independently confirms 6 decimals and coin type `0x3766e534b5dc6cdb7defd998debf19f72565f4a7b8224e36b050f690b71a8819::boom::BOOM`. SUI amounts use 9 decimals.

## Wallet labels and their evidentiary limits

The current BOOM frontend labels these addresses:
- Auto-Pay: `0x5077e43c411dec5ef5464ae9b337c2644d0300140b9caecad860a14fd7a22711`.
- Treasury: `0xd27e48a5973c33e70504393e97fe1a935780c8f780dfb8dcd1b12f7a0a8a6946`.
- Dev: `0xa113c79db53d1b8a040d7091381e633f8598daa480026968ab8f8b07cd3fa69a`.
- Prize Pool: `0x05d34e318fd9501a70ef16c0db6cae4e0f392f6b87f24573f42830c07448c3eb`.
The zero address is the 32-byte all-zero Sui address.
Labels identify the platform's stated roles, not independently proven beneficial ownership or restricted custody. Balance changes prove receipt, not subsequent operating expenditure or profit.

## 1. User crate purchase: 80% Auto-Pay, 20% zero address

Digest: `jwqre5FuLdSEDNVf8RrqAFg5XG3BQvyvkracerumpXX`.
Time: August 31, 2026 00:54:52.556 UTC. Execution SUCCESS.
Call: `0x2181ed994caf30b30878d16a7309c79fa36b3a25e35b3a973cd2c9a6bc615d9a::lootbox::open_box` with BOOM coin type.
BoxOpened records price 550000000000 base units, buyer matching the requested wallet, weapon `0xfbb983b852be44bba6b7c1414d972d1bd00c213dda3b9dcc9366fe22496901da`, kind 1, rarity 0, serial 96.
Actual BOOM balance changes: buyer -550,000; Auto-Pay +440,000; zero address +110,000.
Net network gas: 0.002840256 SUI. No non-gas SUI price or separately paid developer/treasury fee in this receipt.

## 2. User mining-rig mint: same 80/20 split

Digest: `CWPN4DVAq9nU7syuVXHjBdB6c9vryt6jz6EAYQurTWzb`.
Time: September 2, 2026 02:00:48.800 UTC. Execution SUCCESS.
Call: `0x283ec22de8e5a2c998f71e818a1583d76791bcb64a7bc42eecd22ee99eb6b3e2::foundry::mint`.
RigMinted records buyer, price 1000000000000 base units and rig `0x4458e73804b4b802d8e9b2dab68009b8965fdc0697096d917690c0bba4fbaf01`, serial 24.
Actual BOOM changes: buyer -1,000,000; Auto-Pay +800,000; zero address +200,000.
Net network gas: 0.007259352 SUI. No non-gas SUI payment in this receipt.

## 3. Six additional 20,000 BOOM payments

Each successfully transferred 20,000 BOOM out of the user wallet, with 16,000 to Auto-Pay and 4,000 to the zero address:
- `GKZcf6voo7Nj1wym426cduP7pQEoE8XVJaVi1scSwzjy` — September 2, 2026 01:16:49.902 UTC.
- `HAiqKHTZKYzGrHyiZuV6nLFze3N215orUsLaxkMGaMjb` — September 6, 2026 20:56:50.377 UTC.
- `GaxM7ZFwJndHhk5THdqCJExo9UKnV8FfYQTV1en8Dpjx` — September 6, 2026 20:57:20.461 UTC.
- `CEybLFnMFmowZ1juo3WhhD558WFgjeFkUeQ4o85zUUqh` — September 6, 2026 21:46:02.075 UTC.
- `5dffa2kwa4s6tVA4pZbipC5BeuCn8fze42qs2BqzDRWy` — September 6, 2026 22:14:19.104 UTC.
- `BjqkD6hKpNuSTWr2fwb5qtuzSV2NMvVWepKMdwWBRTgq` — September 6, 2026 22:36:05.133 UTC.
Aggregate: 120,000 BOOM paid; 96,000 Auto-Pay; 24,000 zero address. The payment shape matches the frontend's upgrade payment helper, but these are plain coin-transfer transactions with no on-chain item/stat event. Classify them as upgrade-style service payments, not a verified purchase of a particular named upgrade. Exact in-game purposes cannot be established from these receipts alone.

## 4. User marketplace purchase: 95% seller, 5% Auto-Pay

Digest: `C9qTTZyXuDfifH68rfzrN6APF5mdRRhZNsVwsQxm1eXx`.
Time: September 2, 2026 01:59:50.437 UTC. Execution SUCCESS.
Call: `0xd78f10cc26f66ae62d78bc42df54433b7c0c6bfb44370d34d6b0d0456fee99e3::market::buy`.
Sold event identifies buyer, price 190000000000 base units, item `0x3b6df6e2b78369606263b7c5a4001e0be399a68c542fef99882efce3e10e070c`, and seller `0xe5a894a8785c508724a17ff439b09d002a975eaa35af46e74490ec27c8adf5fe`.
Actual BOOM changes: buyer -190,000; seller +180,500; Auto-Pay +9,500. No zero-address BOOM transfer in this receipt.
The full 190,000 is marketplace sale value; only 9,500 is the platform fee. Its destination is the prize-paying wallet, not a separate operational treasury allocation. The item was later equipped by the user as a Commander in transaction `F8gSCip23wduxrEAU8CwZWLkq9v6FsawbtwnAtzvXwZe`.
Net network gas: 0.000248352 SUI.

## 5. Reconciliation of the nine identified outgoing payments

Total user BOOM paid: 1,860,000.
Auto-Pay received: 1,345,500 BOOM.
Zero address received: 334,000 BOOM.
Marketplace seller received: 180,500 BOOM.
These destinations sum exactly to 1,860,000 BOOM. Net SUI gas across these nine transactions: 0.024337032. All nine had zero non-gas SUI payment. Neither separate purchases of BOOM on a DEX nor liquidity-position activity are included.
This is the identified sample, not the user's all-time BOOM activity or platform-wide revenue.

## 6. A confirmed direct treasury revenue source: Trading Post fee

Digest: `ERTxCwxcnnicVZnJDmvxk3VysD3t4FK2h2Bxpi9Cj5PA`.
Time: September 8, 2026 13:50:47.557 UTC. Execution SUCCESS.
The user called the Trading Post accept functions. Accepted event: trade `0x65a79fd8277a165f158e0af6a95ef08187bfcaac6ad0e69ece3f68c9de089a0c`, maker `0x35b36d88783f7b638a3d92cd0bd1d459f2e4fb78d6cadeb707842f7cf05e852f`, taker equal to requested wallet, fee 25000000000 BOOM base units.
Treasury balance increased by exactly 25,000 BOOM. The user did NOT pay an additional 25,000 BOOM from their balance in this acceptance transaction; the fee was released from the proposal's escrow.
Current on-chain Trading Post registry `0xccee9ba1f2173e5582d7a45a11200affc7401c6eac180e2d8874da72147ead66` independently sets BOOM as fee_type, fee 25000000000, and fee_recipient equal to the Treasury address above.
This proves a direct treasury fee inflow on completed trading activity. It does not establish net profit or where that treasury later spends it.

## 7. BOOM NFT royalties and subsequent 95%-sized buybacks

The site-labeled Dev wallet executed withdraw_collection_royalty with the actual BOOM NFT type `0x54e007d4ef30e94dbefae73bba7605c9b0a5c49d6030449d35cff62641db47c0::boom_bots_ai::Nft`.
Example A: royalty withdrawal `5aaXz6a8A28reE8mj78JwBvRDnWNw8xUxRuekoVmtbTs`, September 9, 2026 11:59:04.362 UTC, delivered 2.5 SUI before 0.000172276 gas. The subsequent swap `EPjAfZeZh93V2n6ewWPAZ4BUq7L1nFhknnWhYtpQNmk6`, 12:23:25.570 UTC, spent 2.375 SUI excluding 0.000537204 gas and acquired 57,948.705585 BOOM for that wallet. 2.375 / 2.5 = 95%; arithmetic remainder 0.125 SUI before gas.
Example B: royalty withdrawal `9nYXdpMiDkmRqGb1iD1LyBkbKfYphtz5n3CdBgbEn1do`, September 9, 2026 18:50:38.038 UTC, delivered 6.7 SUI before 0.001150396 gas. Subsequent swap `d2jmiFGRhWKSSbGosk8sAWatfoHjwyNdC2KVayg8h6Q`, 18:51:23.146 UTC, spent 6.365 SUI excluding 0.000528564 gas and acquired 155,544.165266 BOOM. 6.365 / 6.7 = 95%; arithmetic remainder 0.335 SUI before gas.
Combined receipts 9.2 SUI; subsequent BOOM purchases 8.74 SUI; difference 0.46 SUI before gas. Chronology and exact ratios are consistent with the site's advertised 95% royalty buyback policy. This pairing is an inference, not a contract-enforced linkage. It does not prove that the 5% is net profit, permanently retained, or the destination of all royalties. Bought BOOM was initially received by the Dev wallet; no claim is made that these exact coins were already passed to the prize wallet.

## 8. Auto-Pay demonstrably pays prizes, not simply idle treasury

Transaction `2sfgNkMgTeNcE6s89ENMkig7oAZWbtB1j71BGnEXQmAN`, September 10, 2026 00:01:20.564 UTC: Auto-Pay spent 1,220,266.096206 BOOM; a winner received 1,098,239.486586 BOOM and zero received 122,026.609620 BOOM (90/10 subject to base-unit rounding). The platform's public prize-history API identifies this exact digest and recipient as the September 9 nightly prize, bot #109.
Further sample payouts on September 11 and September 12 match the same pattern and public prize-history digests. These examples corroborate the wallet's operational prize-paying role. They do not prove every receipt into it is segregated or eventually paid as prizes.

## 9. Current configuration and SUI checkout source: different evidence levels

Current lootbox Config `0x843198e25751c9f196d1612b77c8164535eed9f0e0500397042edf09a5453632`, read at version 997790094, has burn_bps 2000 and treasury equal to Auto-Pay. Its prices map at retrieval contains BOOM, with a current configured price of 446915340834 base units; this must not be substituted for the 550000000000 price in the historical user receipt.
The current frontend's Economy page describes crate/upgrade/repair payments as 80% prize-paying wallet and 20% zero-address routing, and claims SUI/XP purchases are converted into BOOM. The open_box frontend constructs a conversion to BOOM for a non-BOOM choice, then calls open_box<BOOM>. Therefore its documented SUI direction is SUI -> BOOM, not BOOM -> SUI.
However: the nine user payment receipts and the 30 additional recent open_box receipts examined here all directly debited BOOM. This investigation did NOT observe an executed SUI-funded crate transaction. The upgrade helper also has a direct-XP transfer path, so the Economy page must not be treated as proof every payment category converts XP universally.
Public source assets retrieved: https://boombotsai.wal.app/assets/index-B9s9mwZb.js ; https://boombotsai.wal.app/assets/Economy-DosXJj7X.js ; https://boombotsai.wal.app/assets/upgrades-BzX1DBzN.js ; https://boombotsai.wal.app/assets/payments-BNDwkeGX.js . Site asset hashes are preserved in the audit manifest.
Public prize corroboration: https://boombots-production.up.railway.app/prize-history/ . Treat this API as platform-provided classification, not an independent chain source.

## Interpretation

Confirmed purchase routes differ by product. Primary crate/rig receipts route 80% to a reward-paying wallet and 20% to zero; a secondary item purchase pays 95% to its seller and 5% to that reward wallet; a completed Trading Post fee goes directly to Treasury. BOOM NFT royalty withdrawals also provide SUI receipts to the Dev wallet, with two subsequent 95%-sized BOOM buybacks observed.
Do not call the full shop receipt or full marketplace sale profit. There is no separate developer payment visible in the cited crate/rig transactions. Direct Treasury fee receipts and the 5% arithmetic remainder on sampled royalties are more relevant evidence of funds outside the immediate prize allocation. Operating costs, platform-wide totals, later use of those funds and audited net profit remain unknown.
The zero-address transfers are the mechanism the site calls burning. This report does not equate those transfers with a Move coin::burn supply reduction.
The important comparison for Arboretum is BOOM-denominated rewards versus the user's required SUI-denominated Growth Pool. Native BOOM can directly fund BOOM payouts. This does not solve preserving SUI pool contributions while retaining all TREE without sale.

No blockchain transaction was signed or submitted. No wallet was connected. All chain access was read-only. Only this isolated analysis branch and temporary read-only workflows were used; no main, deployed-site, pricing or contract modifications were made.
