# October 1 season-expiry verification and My Garden UX

## Verified live read — no transactions
Read-only GitHub workflow `36878060647`, artifact `11169583827` (SHA-256 `8fb9419a9970f66a76e81f3213547c0e6723b5ebb4512bdfed3f32ee607ce61a`), queried the Sui mainnet GraphQL endpoint. Retrieved 2026-10-01T14:39:40.814953Z; checkpoint 329081628 at 2026-10-01T14:39:38.656Z.

Registry `0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50`, version 995549548:
- Current testing season ID: 3.
- `season_start_ms`: 1788220806247.
- Existing contract duration: 2592000000 ms.
- Calculated cutoff: 1790812806247 = 2026-10-01T00:00:06.247Z = September 30, 2026, 7:00:06.247 p.m. CDT.
- Sui Clock timestamp: 1790865578656, later than the cutoff.
- `paused`: false.
- Test reward pool: 209720000 MIST (0.20972 SUI); not public-launch reward funding.
- Stored total Growth Points: 2498; stored Seed count: 20. These are not assertions of individual claim eligibility.

The reported package matches `wallet.js` PACKAGE_ID `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`. Source `contract/sources/arboretum.move` defines `E_SEASON_ENDED = 6`. `assert_season_active` rejects elapsed >= duration before water_seed changes the Seed. The September 19 retained deployed disassembly shows this exact function aborting with 6 at instruction 24, matching the screenshot. The immutable package is the same target; no upgrade was performed.

## Claim status must not be invented
The current source claim_reward permits the current-season claim time after the cutoff, checks paused/ownership/season/Seed state and points, then computes the share in the transaction. It is not an automatic background calculation service. claim_archived_reward separately checks the archive, Seed, swept state and deadline (inclusive). The watering failure does not verify reward calculations or successful payment. No user wallet was connected, no transaction was simulated or signed, and no claim/archive/reset was submitted in this investigation.

The existing player path is **Rewards → Monthly Pool → Claim Reward**, select an eligible Seed, review and confirm the wallet request, repeat for other eligible Seeds. Do not announce a particular player's reward as ready or paid just from a date. The existing archive lookup is browser/configuration-dependent; absence of an archive in this session is not proof that no archived rewards exist.

## Prepared UI scope
A review-only presentation pass has been prepared locally against exact current main `ab5e0fa0e70ede69af6450658c79591e7364dbaa`:
- My Garden panel with network-derived countdown, exact cutoff in local time and UTC, ended/paused/unknown/no-active-season states, and a read-only View season rewards navigation button.
- Visible claim instructions using the existing flow; no auto-claim and no new payout function.
- Disable single and batch watering after expiry. Recheck season state before either existing watering handler proceeds.
- Translate only MoveAbort 6 in the configured package's `arboretum::assert_season_active`. The same numeric error in claim_reward or another module is NOT treated as a watering-expiry error.
- Missing/stale/failed reads do not imply claim readiness. Refresh when returning to the page. Countdown progresses from the Sui Clock, not a guessed calendar boundary.
- Current-season pause and optional configured archive deadline explained separately.

Local full website build passed. The new pass preserves public homepage/guide, wallet.js, garden.js, SDK and tester reference hashes; only gated game presentation and its new read-only assets change. 41 unit/build/preflight checks passed and 64 offline fixture-browser assertions passed at 1440, 768, 390 and 320 pixels. Desktop/mobile panel screenshots inspected. Browser checks isolate the new panel inside actual game markup and intentionally remove existing wallet/game scripts; they are NOT hosted wallet-integration or payout certification. Production remains unchanged. This branch currently records the read-only investigation; the local review bundle contains the implementation and tests, pending review and a separately verified release.

Suggested ended copy: **Season 3 ended. The growing period is over. Watering is closed for this season. Open Rewards → Monthly Pool to check your eligible Seeds and claim available rewards.**

Live guidance reviewed: MystenLabs/skills README.md; sui-move/SKILL.md and move.md; ptbs/SKILL.md and troubleshooting.md; accessing-data/SKILL.md and graphql.md; frontend-apps/SKILL.md. Existing frontend limitations and claim-handling constraints retained. No economics, contract deployment, admin action, treasury movement, inventory reset or Growth Point modification.
