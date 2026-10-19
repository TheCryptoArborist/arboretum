# Deployed v11 shop-source reconstruction

## Scope and status

`source/arboretum.move` starts from the saved `contract/sources/arboretum.move`
and restores the five known shop differences in the configured version-11
package. The subsequent non-test build and
[complete comparison](evidence/bytecode-comparison.json) now establish exact
18,034-byte identity with the submitted upgrade module, including all 96
production functions and 32 struct definitions. This restores the deployed
baseline; payout remediation remains separate work.

The original saved file is unchanged. Its SHA-256 is
`f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2`.
Of its 112 function bodies, 109 remain textually identical, including the 18
test-only functions/helpers. The three modified bodies are `buy_crate`,
`send_promo_crate`, and `open_crate`; the two additions are `buy_boom_chest`
and `buy_victory_chest`. This gives 96 production functions and 18 test-only
functions/helpers in the candidate.

## Authoritative evidence

- Configured package: `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`,
  version 11.
- Saved chain response: `../gameplay-verification/deployed-probe/deployed-module-20261019.json`.
- Full disassembly: `../gameplay-verification/deployed-probe/arboretum-deployed-disassembly.txt`.
- Disassembly SHA-256:
  `2e7dd587e996abe010106d822099b8194bf61f7357a79fc558d42521eef39604`.

The existing PR #3 partner tool table was cross-checked at commit
`89db32d6aec5a4877bac3917e8aa94ed1d3c323e`, file
`contract/season1-isolation/isolation.move.inc`, blob
`3d25efb4eeb349133818f151844572c11cd00238`. Only its bounded partner behavior
was used as a secondary comparison. Its new layouts, origins, prices,
`ItemSpec` abstraction, and added validation are not part of this candidate.

## Reconstructed behavior

| Function | Reconstruction from deployed instructions |
| --- | --- |
| `buy_crate` | Accept tiers 0 through 6; retain the seven-arm price selection and 10,000,000 MIST for every tier. The referral, pool/treasury routing, change, event, and transfer code remain unchanged. |
| `send_promo_crate` | Accept tiers 0 through 6, preserving the existing admin and pause checks and recipient event/transfer behavior. |
| `buy_boom_chest` | Private entry wrapper calling `buy_crate` with the tier-5 constant and unchanged argument order. |
| `buy_victory_chest` | Private entry wrapper calling `buy_crate` with the tier-6 constant and unchanged argument order. |
| `open_crate` | Preserve existing tiers 0 through 3, give Mythic an explicit tier-4 branch, add tier-5 BOOM, then preserve the deployed final Victory branch. |

The new tier constants follow `CRATE_MYTHIC` in source order. This corresponds
to constant-pool entries 59 (`u8: 5`) and 60 (`u8: 6`) in the deployed module.
All seven price constants have the same value and resolve to deployed
constant-pool entry 35 (`u64: 10000000`). The new wrapper functions follow
`send_promo_crate`, matching the deployed function order.

### BOOM: `open_crate` instructions 334–381

The calls execute in this order:

| Tool | Charges | Rarity | Selection |
| --- | ---: | ---: | --- |
| Ancient Bark | 1 | 2 | Fixed first tool |
| Sunstone | 1 | 1 | Fixed second tool |
| Double Dose | 2 | 2 | Fixed third tool |
| Forest Heart | 1 | 3 | Fourth tool when a uniform `u8` roll from 0 through 99 is less than 10 |
| Growth Tonic | 2 | 0 | Fourth tool otherwise |

### Victory: `open_crate` instructions 382–424

The calls execute in this order:

| Tool | Charges | Rarity | Selection |
| --- | ---: | ---: | --- |
| Drought Shield | 2 | 2 | Fixed first tool |
| Rain Barrel | 2 | 1 | Fixed second tool |
| Mulch | 2 | 1 | Fixed third tool |
| Bottomless Can | 1 | 3 | Fourth tool when a uniform `u8` roll from 0 through 99 is less than 25 |
| Revival Kit | 1 | 2 | Fourth tool otherwise |

Both branches create exactly four tools. The fourth item is a choice between
two outcomes, not an additional fifth tool. The random draw occurs after the
first three tool-mint calls, as in the deployed instructions. Each mint uses
the existing `mint_crate_tool` function, preserving its event and transfer
behavior.

The deployed `open_crate` function has no separate `tier <= 6` assertion. Its
final branch is unconditional after testing tiers 0 through 5. The candidate
preserves that structure to support reconstruction; it does not introduce a
new invalid-tier rule. Crate creation through the two existing purchase/promo
paths remains constrained to tiers 0 through 6.

## Guidance consulted

Current MystenLabs guidance was read on 2026-10-19: the repository README,
`sui-move/SKILL.md`, the relevant first part of `sui-move/move.md`,
`onchain-randomness/SKILL.md`, `onchain-randomness/usage.md`, and
`sui-build-test/SKILL.md`. The reconstruction keeps `open_crate` private
`entry`, creates its generator locally, keeps helper calls private, and
preserves the deployed source style and resource handling. Broader
randomness redesign and payout changes belong in subsequent, separately
reviewable work.

References:

- https://github.com/MystenLabs/skills/blob/main/README.md
- https://github.com/MystenLabs/skills/blob/main/sui-move/SKILL.md
- https://github.com/MystenLabs/skills/blob/main/onchain-randomness/usage.md
- https://github.com/MystenLabs/skills/blob/main/sui-build-test/SKILL.md

## Completed validation and next work

The [build evidence](evidence/build-result.json),
[complete bytecode comparison](evidence/bytecode-comparison.json), and
[provenance record](provenance.json) establish the reconstructed module's exact
identity, publication address rewrite, and matching linked dependency modules.
There are no remaining bytecode differences in the verified reconstruction.
The seven Move tests preserve the original Canopy checks and reproduce the
existing payout issues. A payout correction and its upgrade-compatibility checks
remain the next separate implementation.
