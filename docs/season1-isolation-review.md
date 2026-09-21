# Arboretum Season 1 — isolated state and purchase provenance

## Verified result

At commit `f71df2e1a3ad8efdba16d44d28f54d8aa17b1526`, GitHub Actions run `35563344423` completed successfully. The integrated contract passed **68 Move tests: 40 retained core tests plus 28 new isolation tests, with zero failures**. Five additional negative compilation checks rejected old Tool, Crate, Seed and Registry types and a borrowed NFT argument for the owned-input planting entry. The clean non-test build also passed with only the expected root module and no fixture dependencies.

Artifact `10622908331` was downloaded and its SHA-256 verified: `a15e7b79bb0c4152ed5ca749070cdf43c65eac17feec57dd6053c246be274471`. Generated candidate source SHA-256: `7057176001bfef8e27fb831a34b622178462d18c0797192cf2ace8545bf887d6`. Raw logs, the verification report, partner evidence and reproduction files are preserved in that artifact.

## Scope

This is a review candidate built on Step 1 at `d18ed4420f60375c453e25f3f045d0135af5a66e`. It is not a deployed package, live upgrade, migration, or launch approval. No existing NFTree, player inventory, claim, payment, treasury balance, or deployment was changed.

The generated contract uses a fresh package/type origin and a paused-by-default Registry. This design intentionally offers no old-item importer. A future deployment must retain that fresh-origin boundary, identify its authoritative Registry and package explicitly, and undergo independent review.

## Implemented boundary

- The versioned Registry binds Seeds and issuance receipts to its object ID and economy version. Private point-writing paths verify that domain, rather than trusting which page a player visited.
- Gardening and planting validate the exact canonical NFTree type, not a label, name, image URL, arbitrary object ID, or caller-supplied rarity. Active gardening also requires the NFTree matching that Seed.
- Public gardening transactions take the NFT as an owned value and return the same object unchanged. The corresponding frontend must be updated before this candidate can be used; a merely borrowed NFT does not satisfy the signature. This is not a remint or metadata update. Kiosk/marketplace custody and wallet-specific use remain integration tests, not proven by mock fixtures.
- New planting enforces the eight-active-Seed limit per wallet and season. Persistent line controls preserve the Step 1 timing and caps.
- A paid crate or direct tool carries its Registry/economy/receipt origin. The private receipt writer is called after the exact candidate SUI price is taken and routed. Opening a crate validates its product and consumes its receipt once; resulting tools inherit that paid origin.
- Applying a tool or using a Revival Kit checks that it is from a recognized, opened paid receipt in the same economy. Ordinary valid tool transfers preserve origin and uses; transferring an old item cannot manufacture production eligibility.
- Legacy free Sapling mint/plant and free promo crate entry points abort. The candidate does not exchange old/test items for new ones and does not interpret issuance date alone as proof of a paid production purchase.
- The existing payment split and referral deduction order are retained. Recommended Season 1 prices are used only in the generated candidate to test rejection of cheap legacy payments. Nothing enables those prices on the live site.

Positive tests exercise the actual purchase, opening, planting and watering functions. The no-referral 25 SUI Ancient fixture adds 17.5 SUI to its test pool; the eligible-referral fixture adds 17.325 SUI and records a 0.25 SUI referral. A real test-scenario planting returns the same NFT object; subsequent watering requires the matching NFT. A bought Supply Drop tool retains its receipt and remaining use after transfer between fixture owners. No real SUI was spent.

## Recovered partner chest rules

The immutable configured package `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724` was read through public GraphQL. Its `open_crate` disassembly matches the prior September 19 evidence at SHA-256 `f602180c86c7acb2e9a00662b9cc04f75e96bc779b5e03b354031c847fda49ca`. Its constant table was also checked.

| Chest | Three fixed tools | Fourth tool |
|---|---|---|
| BOOM | Ancient Bark (1 use), Sunstone (1), Double Dose (2) | Forest Heart (1) at a 10% roll, otherwise Growth Tonic (2) |
| Victory | Drought Shield (2), Rain Barrel (2), Mulch (2) | Bottomless Can (1) at a 25% roll, otherwise Revival Kit (1) |

Both always issue four tools. The integrated helper is called by the real opening function and tested over all 100 roll values. The standard five crate tables retain their previous quantities and rolls. This is bounded function/constant recovery, not proof that the entire saved source equals the deployed package. It does not prove that the 20 SUI candidate partner price is commercially optimal, nor that Bottomless Can performs autonomous watering.

## Test methodology and reproduction

All functional tests execute locally in the Sui Move VM using the pinned mainnet-v1.79.1 compiler and framework revision `58386edc269ef88ff0f40ab0a9d50e87cba80ca8`. The official compiler archive SHA-256 is `547b3091e975b8a6b4078473a3868d86e985156b6715a8c4afb7fd7313a36abf`. `--build-env mainnet` selects the build dependency context; it does not submit anything to mainnet. The test runner has an empty keystore, no active address, and a non-serving local RPC setting. Public GraphQL reads are a separate read-only evidence step.

Canonical, counterfeit and legacy fixtures live in separate local test dependencies. The canonical fixture uses the specified nominal type identity to exercise the unchanged runtime type guard; it is not the real collection implementation. The legacy fixture uses old nominal type identities to exercise rejection; it is not a whole-package source reconstruction.

Negative compilation checks deliberately attempt old Tool/Crate/Seed/Registry substitutions and a borrowed NFT argument. Genuine type/ability diagnostics are required; a generic compiler, setup or network error does not count as isolation success. Test-only adapter functions are not production entry points. Early CI iterations exposed fixture setup and diagnostic-matching issues; the successful final run includes the actual rejection checks, not just the positive test count.

After tests, fixture dependencies are removed, the build directory is cleared, and a non-test build succeeds with only the expected root arboretum.mv module. Compiler warnings about unused parameters in deliberately disabled legacy functions remain; this is not a claim of warning-free compilation.

From repository root with the CI's empty-keystore configuration and pinned Sui compiler:

```sh
python3 scripts/check-season1-regression.py
python3 scripts/read-season1-partner-evidence.py
python3 scripts/check-season1-isolation.py
```

Use the checker rather than directly running tests on the generator output: it constructs isolated test dependencies and then restores the clean production manifest. Do not publish the fixture packages or candidate package. No publish, upgrade, transfer, or launch command is provided.

## Release gates still outstanding

The live old game is untouched: this isolated branch does not patch, pause, or disable its known timing issue. Existing claims and funds must be assessed and preserved before any explicitly authorized cutover.

This work is not a full security audit. Required remaining work includes trusted rarity mapping and paid holder-bonus issuance; complete cutoff and deterministic reward/archived-claim tests; old-claim and test-inventory transition approval; Bottomless Can's promised behavior; price-weighted multiplayer balance; actual-wallet and browser integration; verified production bytecode; deployment/upgrade authority policy; and a reviewed launch procedure. Fresh package and nominal type separation do not replace those checks.

No new TREE checkout, buyback execution, burn, reward multiplier, or NFT metadata change is introduced. SUI-funded gameplay and separately approved treasury-funded TREE acquisitions remain the agreed economic direction. The next feature stage is paid NFTree holder grants on this receipt-protected foundation, alongside the planned season-end tests—not public activation.
