# Arboretum — approved price record and seasonal revenue accounting candidate

**Status: review-only implementation, not an activated economy or a live-sales dashboard.**

The owner approved the middle-ground standard-crate prices and said NFTree revenue will fund TREE purchases. This step records those decisions and implements a tested, read-only seasonal accounting engine. It does not change the existing game, payment transactions, Move packages, website deployment, or funded test-season claims.

## Decision record

| Product | SUI | Status |
|---|---:|---|
| Plant one Seed | 10 | Approved price; not activated |
| Seedling | 5 | Approved price; not activated |
| Grove | 10 | Approved price; not activated |
| Canopy | 25 | Approved price; not activated |
| Ancient | 50 | Approved price; not activated |
| Mythic | 100 | Approved price; not activated |
| BOOM | 30 | Provisional partner target |
| Victory | 30 | Provisional partner target |

Direct Supply Drop prices remain unresolved. The earlier 1.5 / 3 / 3 / 6 / 8 SUI proposal is retained as a comparison, not silently adopted. Crate contents, NFTree rarity entitlements and planting referral eligibility are not redesigned in this pass.

**Revenue separation:** project-received NFTree revenue funds TREE purchases. A proposed share of BOOM chest treasury proceeds funds BOOM; a proposed share of Victory chest treasury proceeds funds VICTORY. No game-revenue TREE allocation is introduced, and no portion of the Growth Pool is available to this accounting module for token purchases.

**Still pending:** the NFTree allocation percentage is unspecified; the suggested 25% of partner-chest treasury proceeds is a scenario only. BOOM and VICTORY canonical coin types and purchase destination/execution rules are not configured. Null means unresolved—not zero authorized spend or a promise to allocate 100% of NFTree receipts.

## Implemented now

- Exact integer MIST arithmetic for the retained shop allocation order: applicable 1% referral first, then 70% of the remainder to the pool, 2% developer allocation, and treasury remainder. This function does not implement planting's separate fixed referral or NFTree revenue routing.
- Separate season/product totals for paid chest count, gross sales, referral, pool, developer and treasury amounts. Both normalized per-purchase allocations and frozen season prices must reconcile.
- One receipt per paid chest. A batch is several distinct receipts in the same transaction. Duplicate ingestion is ignored; contradictory duplicates stop the report.
- Attribution uses each purchase's supplied confirmed-checkpoint timestamp within the reviewed season's [start, end) window, not the current date or the chest's opening date. Out-of-season sales are shown separately as unassigned and flagged for review.
- Opening, resale/transfer, promo, test-inventory and NFTree-revenue records do not become new paid game sales. Failed, unknown and insufficiently evidenced transactions are distinguished. Foreign registry/package/economy records are excluded visibly.
- Missing evidence, payment mismatches and incomplete input coverage are reported—not silently assumed valid. A generic legacy CratePurchased event is not sufficient payment evidence.
- Budget projections are distinct from authorized budget, actually reserved SUI, executed spend and tokens received. All actual allocation/execution fields remain null. Changing a scenario percentage cannot reduce the player-pool allocation.
- JSON and formula-safe CSV export. Totals are decimal integer strings; the engine uses BigInt and never represents MIST with a floating-point Number.

## Important limits

This module has **no live chain reader, wallet, signing method, swap executor, fund custody, or admin-page integration**. Input fields describe what a future reviewed reader must supply; accepting an input is not independent evidence that it occurred on-chain. Both imported and fixture reports explicitly state that source verification was not performed. An imported all-pages-read flag is not a certification of coverage.

The 25% calculation is only a scenario. No SUI is actually reserved by generating a report. No token purchase, burn, liquidity position or token distribution is authorized. The example's 100 BOOM and 50 Victory sales are synthetic, not this season's sales. No package IDs in the example are production configuration.

This is JavaScript accounting testing, **not a Move VM test, paid-checkout test, demand forecast, or certification of season-end payouts**. A production connection remains blocked until the steps below are completed.

## Reproduce

Node.js 22 or later; no npm dependencies or wallet required.

```sh
node --test economy-review/ledger.test.mjs
node economy-review/example.mjs
node economy-review/report.mjs economy-review/example-output/synthetic-input.json /tmp/arboretum-report
```

`example.mjs` generates explicitly labeled synthetic JSON and CSV under `economy-review/example-output/`. The demo contains 100 BOOM purchases and 50 Victory purchases at the provisional 30 SUI price; 20% of each group have the eligible shop referral. At a hypothetical 25%-of-treasury allocation, the projections are 209.58 SUI for BOOM and 104.79 SUI for VICTORY. Neither figure is actual sales, reserved money or a trade.

## Next integration gates

1. Approve or amend the partner rate, finalize partner and Supply Drop prices, and record the NFTree policy separately. Do not turn the 25% scenario into a commitment by default.
2. Reconcile the pending Season 1 gameplay/holder/isolation work with current main; this branch does not replace or merge those candidates. Preserve legacy funded claims and exclude test-price inventory from the new competitive state.
3. Supply a reviewed GraphQL/gRPC reader or a new versioned paid-sale event. For each chest, bind the canonical origin, registry, economy version, receipt, successful transaction, checkpoint, season, product, actual charged price and exact deductions. Do not count openings or rely on a generic event name. Paginate completely and retain checkpoint watermarks, errors and reconciliation evidence.
4. For future seasons retain immutable price/allocation terms per receipt or season. The current isolated candidate's `validate_origin` compares receipts with `expected_receipt_price`; changing global constants without a versioned policy can invalidate older items. The read-side engine uses the frozen price of the purchase season. Contract carryover rules still need their separate review and tests.
5. Integrate the read-only report into Admin / Partner Chest Revenue and the season snapshot JSON/CSV. Do not label any unverified input report as live or finalized.
6. Only after explicit funding policy and execution authorization, design and test reservation/custody and spending reconciliation. Include actual token coin types, approved destinations, gas/route costs, quotes/minimum output, duplicate-execution protection and remaining budget. Keep transfers and swaps out of checkout and never use the Growth Pool. An accounting earmark alone does not lock funds.
7. Before activation, verify exact contract-enforced prices, wallet amounts, referrals, premium holder benefits, inventory provenance, season cutoff and claims; synchronize the public guide only with implemented behavior. No activation or season start follows merely from merging a specification.

## Evidence and guidance

Current main read: `84b08fdb4bc0ec0417ced7be21f29aae914939f7`.
The pending holder candidate was read at `3b57718a65023979808d8bdd7a5f83cf7b255be7`.

- Arboretum `contract/sources/arboretum.move`: existing shop split, referral function and event structures.
- Candidate `contract/season1-isolation/isolation.move.inc`: PaidReceipt / PaidIssuance contain product and amount but do not by themselves supply all season/deduction evidence required here.
- Live MystenLabs/skills `README.md`, `sui-move/SKILL.md`, `sui-move/events-coins.md`, `accessing-data/SKILL.md`, `accessing-data/graphql.md` were reviewed for this step.
- Official data-access guidance: https://docs.sui.io/develop/accessing-data/ . GraphQL RPC and gRPC are generally available. A live importer must verify the current endpoint/schema instead of copying a deprecated JSON-RPC query.
- The current skill file's statement that GraphQL lacks subscriptions is superseded by the official September 21, 2026 announcement: https://www.sui.io/blog/graphql-on-sui-now-supports-real-time-subscriptions . No subscription implementation is assumed or required by this offline engine.

Approval source: the owner's conversation, not an inferred financial-account record. No private credentials are included.
