# Season 1 — Step 1: watering and tool controls

Status: isolated implementation candidate. No mainnet package published or upgraded, no production deployment, no inventory migration, and no price/payment/treasury change. This is not a public-launch approval.

## What is implemented

The generator patches the pinned saved Arboretum module into a separate local Move package. It tests the actual corrected `water_seed` function and the actual tool implementation used by `apply_tool`, not a Python transcription of those effects.

- Earning waterings require a full 77,760,000 ms (21h36m) interval regardless of protection.
- A separate earning clock is maintained for each NFT ID + season. Rain Barrel, Timeless Seed and revival may refresh the survival timestamp but cannot reset or backdate this earning clock. A survival refresh does not conceal missed streak days.
- Returning after five dry days preserves prior points and awards one current watering, not catch-up points. The regression uses the elapsed duration and 134 -> 146 result observed on September 19, with synthetic objects only.
- A successfully rewatered, living wilted Seed is stored as alive.
- Growth Tonic, Sunstone and Ancient Bark share one rolling instant-point allowance per NFT ID + season per 21h36m. Their individual +20/+30/+50 effects are retained.
- Forest Heart has two accepted applications per NFT ID + season, giving at most +10 permanent base points before multipliers. Each application remains +5.
- The persistent line table is not removed with an abandoned Seed. The same NFT and season reuse cap history across replacement Seed IDs or a changed owner identity. New seasons and different NFT IDs have separate allowances.
- Miracle Grow, Double Dose and Crystal Water are rejected when a doubling is already queued. The whole composite item is rejected rather than silently wasting its doubling component.
- Protection refreshes use `now + duration` only when it extends the existing expiry. A no-extension/shortening application is rejected before consuming a use.
- Boost queues add future waterings, not percentages. Overflow is explicitly rejected. The existing double-then-50% calculation remains.
- Read helpers expose next earning time, instant-tool availability and Forest Heart usage for later UI integration.

## Structure and reproduction

- `controls.move.inc`: persistent state and enforcement helpers.
- `regression-tests.move.inc`: new Move regression tests.
- `../../scripts/prepare-season1-step1.py` (repository path `scripts/prepare-season1-step1.py`): checked generator, no network access or writes outside the generated package/results. It refuses source drift, preserves existing tests, and verifies payment/claim/admin routines are unchanged.
- `scripts/check-season1-regression.py`: builds a negative control from the original source and requires exactly the protection regression to fail. A build error does not count as reproduction.
- `.github/workflows/season1-step1.yml`: pinned compiler, actual Move VM tests, read-only repository permissions, no publish command. Final execution uses an empty keystore and a non-serving localhost RPC setting, with an assertion that no keys were created. GitHub is used only to fetch compiler/framework dependencies.

From the repository root, with the pinned Sui compiler available:

```sh
python3 scripts/prepare-season1-step1.py
sui move test --path contract/season1-step1/generated
python3 scripts/check-season1-regression.py
```

Use the CI's isolated empty-keystore setup when no client configuration exists; do not connect or use a funded wallet. All functional tests run in the local Move VM. No testnet deployment is required.

Source baseline: `2338affe1dd984f5bc676cec7f3763d1f37a90cf`, SHA-256 `f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2`.
Official compiler archive: mainnet-v1.79.1, SHA-256 `547b3091e975b8a6b4078473a3868d86e985156b6715a8c4afb7fd7313a36abf`.
Framework source dependency: `58386edc269ef88ff0f40ab0a9d50e87cba80ca8`.
The first completed candidate run passed 36 new tests and all 4 existing tests (40 total). See the latest CI artifact for the authoritative result and generated-source hash.

## Deliberate behavior changes to explain to players

Protection, Rain Barrel and Timeless Seed preserve/refresh survival state but do not postpone the separate next point-awarding opportunity. Conversely, they do not count as a completed point-awarding watering or preserve a streak through missed earning intervals.
After revival, a Seed can receive one ordinary watering immediately only when the independent interval has actually elapsed. Revival itself gives no points. This is a candidate rule, not a description of current production behavior.

A single `Holder Growth Boost` and the NFTree rarity schedule remain next-stage features; this step does not issue or change any holder bonuses.

## Critical deployment and test limitations

1. **Not a drop-in upgrade.** The candidate adds a field to Registry. Existing Sui layouts cannot be changed in place. The generated manifest deliberately contains no live `published-at` and uses address 0x0. Integration must use fresh/versioned game-state types or another explicitly reviewed migration architecture. It must not remint or alter the existing NFTree collection.
2. **Old code stays callable.** Updating a website or adding new checks in a new package does not disable legacy functions on old objects. There is no live mitigation or old-package shutdown in this work. A production cutover must prevent old points, cheap legacy tools, mint paths or unverified NFT proofs from entering the new competitive state.
3. **Saved source is not the full deployed source.** The saved module does not reproduce all partner behavior found in the configured deployed package. This test result does not certify byte-for-byte equivalence, upgrade compatibility, partner loot tables or all live entry points.
4. **Canonical NFT and provenance checks remain mandatory.** The baseline generic NFT planting path is retained for this core-only test and is not accepted as production validation. Stable-ID cap tests assume an authentic NFT/line; arbitrary IDs or alternate registries must not be allowed to manufacture production eligibility. Require canonical NFT ownership and approved production issuance before release.
5. **Bottomless Can:** only the saved timed-protection effect is exercised here. Background auto-watering is not established, added or certified. Do not silently market this as completed autonomous watering.
6. **Claims and inventory:** claim functions are deliberately unchanged, not certified. Snapshot/cutoff, delayed claims, rounding, replay, valid existing claims and test-inventory separation remain pending. No test objects or earned claims have been removed.
7. **Scope of tests:** recreation and changed-owner state are tested with synthetic fixtures. These are not end-to-end marketplace transfers, package migration or real-wallet signing tests. Pricing/rarity bonuses, multiplayer balance and browser flows remain separate work.

The safe next integration is version-isolated Season 1 state/provenance together with the recovered deployed contract functions, then holder grants and the planned purchase/claim tests. Do not merge an unreviewed generated candidate into production or change live prices based on these tests alone.

References: Sui package-upgrade guidance explains immutable layouts and callable old versions (https://move-book.com/programmability/package-upgrades/). Sui build/test documentation explains local compilation and Move tests (https://docs.sui.io/getting-started/onboarding/hello-world). The owner's Season 1 Ruleset v1 and September 19 read-only evidence are the design and observed-rewatering inputs.
