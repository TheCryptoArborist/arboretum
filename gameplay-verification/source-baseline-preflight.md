# Deployed-source preflight — 19 October 2026

## Outcome

**The saved production source is not yet reconciled with the configured deployed
package.** This bounded check identifies concrete differences and the next
implementation work. It does not certify a source-to-bytecode match or change
reward policy.

The tester-preview milestone remains complete as reported by Peter. The next
engineering deliverable is a separate, tested season-payout correction built on
a verified reconstruction of the deployed game. The proposed reward rules and
their unresolved economic choices are recorded in
[payout-remediation.md](payout-remediation.md).

## Comparison inputs

| Input | Recorded identity |
|---|---|
| Repository checkpoint | `bff42fba07f21aefb9d004d5ea4b7c5eceb0e2ba`, PR #13 |
| Saved Move source | [`contract/sources/arboretum.move`](../contract/sources/arboretum.move) |
| Source Git blob | `c3f95993bc29efa1cc52f31ca9bb9e4594359e5a` |
| Source SHA-256 | `f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2` |
| Configured deployed package | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`, version 11 |
| Deployed object digest | `G55ZRNKoCDhAgunVDzHgqeiVHgdofsq4FjJuBp984iia` |
| Saved disassembly SHA-256 | `2e7dd587e996abe010106d822099b8194bf61f7357a79fc558d42521eef39604` |

The immutable deployed comparison input is the saved October 19
[package response](deployed-probe/deployed-module-20261019.json) and
[full module disassembly](deployed-probe/arboretum-deployed-disassembly.txt).
This follow-up used those saved inputs; it did not repeat the mainnet simulations.

The checked source history contains one modifying commit for the production
source: `b57b6d73f4ee9364d86f47535f006a02fa047184`, “Initial Arboretum production
source.” The same source blob is present in the checked PR #13, PR #4,
September 19 analysis, and production-economy candidate trees. None of those
checked candidates establishes a reconciled version-11 production baseline.

## Confirmed differences

The saved file contains 112 function names, including 18 test-only functions and
helpers absent from deployed code. Its 94 production function names are all
present among the 96 deployed functions. The two additional deployed names are
the partner purchase wrappers below.

| Function | Saved source | Saved version-11 deployment |
|---|---|---|
| `buy_boom_chest` | Absent | Delegates to `buy_crate` with tier 5 |
| `buy_victory_chest` | Absent | Delegates to `buy_crate` with tier 6 |
| `buy_crate` | Accepts tiers 0–4 and selects among five prices | Accepts tiers 0–6 and includes seven price branches |
| `send_promo_crate` | Accepts tiers 0–4 | Accepts tiers 0–6 |
| `open_crate` | Five standard crate paths | Adds BOOM/Victory paths and partner tool distributions |

These are confirmed gaps, **not an exhaustive comparison of all function bodies**.
Matching names or adding the two missing wrappers does not establish equivalent
signatures, layouts, accounting, or execution behavior.

## Existing candidates and build provenance

[PR #3](https://github.com/TheCryptoArborist/arboretum/pull/3) contains useful
partner wrappers and bounded reconstruction of `open_crate`. At its checked
head, `89db32d6aec5a4877bac3917e8aa94ed1d3c323e`,
`scripts/read-season1-partner-evidence.py` verifies the deployed `open_crate`
slice and selected constants. It does not compare the whole module.

The Season 1 preparation script deliberately introduces separate changes to type
origins, layouts, signatures, receipts, and prices. Its generated source, and the
PR #4 candidate built on it, therefore cannot serve as a drop-in reconstruction
of current production behavior. Reuse only behavior independently checked against
the deployed comparison input.

The saved [`Published.toml`](../contract/Published.toml) records version 10,
compiler 1.78.1, published package
`0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914`,
and original package
`0xcc0ddce744b32314fd69ea6f842ea2e6e37c2fc8be7591cde468a56842f64f62`.
Those package addresses differ from the configured version-11 package and its
deployed module self-address. This metadata does not establish version-11 build
provenance.

The saved mainnet framework revision is
`367fd808279bed26f7c64fc63160062a2ee29ab7`. The previously working compiler 1.79.1
and framework `58386edc269ef88ff0f40ab0a9d50e87cba80ca8` used for characterization
tests establish a test environment, not the compiler/dependency pair used to
publish version 11.

## Next implementation sequence

1. Reconstruct the deployed source separately, starting with the saved production
   functions and the five confirmed partner-related gaps. Preserve observed
   deployed behavior while resolving package identity and build inputs.
2. Compare all 96 functions, ordered struct layouts and abilities, signatures,
   constants, type origins, and package lineage. Resolve references to constants
   and handles; stripping their numeric indices can hide meaningful differences.
   Record every remaining mismatch before calling the reconstruction verified.
3. Prepare the payout correction against that baseline. The recommended design
   fixes eligibility at the season cutoff and finalizes the eligible points total
   before claims, using common entitlement rules for direct and archived claims.
   Residuals, deadlines, ineligible shares, and already processed claims still
   require a concrete policy proposal for review before activation.
4. Verify claim-delay and claim-order invariance, direct/archive consistency,
   conservation, and prevention of duplicate payment using synthetic Move tests
   and unsigned validation. Present the resulting candidate and its policy
   effects for review before an upgrade is signed.

This checkpoint adds documentation only. It does not modify production Move
source, wallet code, package configuration, prices, or on-chain state. The prior
wallet/build test results remain results for their recorded code checkpoint;
this source preflight is not a new gameplay test run.

## Guidance checked

Current MystenLabs guidance was read for this follow-up:
[README](https://github.com/MystenLabs/skills/blob/main/README.md),
[sui-publish](https://github.com/MystenLabs/skills/blob/main/sui-publish/SKILL.md),
and [sui-build-test](https://github.com/MystenLabs/skills/blob/main/sui-build-test/SKILL.md).
The relevant requirements are to establish package/build identity, preserve
upgrade compatibility, and execute meaningful tests before publication.
