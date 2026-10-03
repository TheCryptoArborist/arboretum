# Regular-player preview checks — October 3, 2026

## Current handoff

The updated Admin display and CSV/JSON export review are complete based on the owner's screenshots and supplied downloads in the continuation conversation. The new offline regular-player browser suite now passes. The genuine hosted non-admin-wallet and tester logout/re-entry checks remain pending. Do not declare the Telegram tester milestone complete yet.

This record supersedes the owner-display/export pending language in STAGED_RECONCILIATION_REVIEW.md, not its remaining authenticated delivery or player-readiness qualifications. No extra Admin screenshots or repeated export downloads are requested.

- Existing gated preview: https://6ac0626c410eb1cc74e44602--arboretum-sui-forest.netlify.app/tester-access
- Preview application source: `96845880a7ea75f345a515a1182eea14fd368f26`.
- Test-runner source: `6eb18340d1476c2fa495bebc3bbc8978251ad5d9`.
- Successful push workflow: https://github.com/TheCryptoArborist/arboretum/actions/runs/37090271758
- Production remains deploy `6abe81174b61a8e3dd53b333`; main remains `84b08fdb4bc0ec0417ced7be21f29aae914939f7` at the reads for this continuation. PR #12 is still draft/unmerged. No hosting workflow was enabled for these test-only commits.

## Results actually inspected

195 retained Node tests passed, 13 Python staging-helper tests passed, and all 124 offline browser/integrity assertions passed. Browser checks ran in Chromium at 1440, 768, 390, and 320 pixels wide. The actual test logs, per-check results, connection diagnostics, network records, and representative desktop/mobile screenshots were inspected.

Artifact `11262217439` from the successful run was downloaded and its SHA256 matched `9c0d45a91e3d9a6e5a256af135c3d937c7d6fc1dee47672bd2879c277e0adea8`. Its archived test helper matches the locally prepared correction byte-for-byte. Its generated game.html, wallet.js, garden.js, SDK, original partner report module and reconciliation status module match the previously staged-source build bytes. This is a build/source comparison, not a newly authenticated download of every hosted asset.

Checks exercised the original wallet connection and navigation code using a synthetic Wallet Standard provider with signing disabled. They covered disconnected and non-admin UI states; report-access refusal before discovery; My Garden, Item Shop, Strategy, Rewards and Leaderboard navigation; My Items; page-width overflow at four sizes; empty inventory and the ended-season display; restoring a synthetic session; disconnect clearing both storage locations; wrong-network and rejected-connection recovery. No unhandled page exception, missing local static asset, signing attempt, transaction submission or simulation attempt was recorded in the tested paths.

## First-run failure retained and explained

Initial run `37089967033` recorded 116 passed and eight failed browser assertions. The failures were the two connection-error assertions repeated at each of four widths. The original test compared rendered `innerText` with the mixed-case literal `Connect Wallet`; existing CSS uses `text-transform: uppercase`, yielding `CONNECT WALLET`.

A minimal local Chromium reproduction confirmed the difference. The corrected test uses underlying textContent and also checks the disconnected address, cleared local/session state, removed loading/connected classes, enabled button, specific error toast, and exactly one provider connection call per scenario. All those conditions passed in the second CI run. Diagnostics retain both `buttonText: Connect Wallet` and `renderedText: CONNECT WALLET`. No application or wallet code was changed to make the tests pass.

The initial artifact was also downloaded and SHA256-checked: `11262276733`, `37bd831ed77a504538084b0c83bbb16f0c94e0537a434c12c2723585e177cb9b`.

## Scope and limits

All browser requests were intercepted and answered from local build files or synthetic fixtures, or aborted. Read-method calls to the legacy RPC surface were deliberately answered with unavailable-method errors to exercise existing fallbacks; this is not adoption of JSON-RPC for a new network implementation. The optional referral API was deliberately modeled as unavailable. Its fixture 404s are recorded separately and do not establish a problem with the hosted referral API. External fonts/resources were not fetched, so rendered-font/layout findings are limited to this offline environment.

No real wallet connected. These results do not certify a browser-extension integration, Netlify authentication, populated gardens, live balances or transaction success, on-chain authorization, or every device/browser. The earlier local attempt to navigate the fixture origin was blocked by the execution environment; the successful full suite ran in GitHub Actions instead. The hosted tester gate was neither removed nor bypassed.

The current uploaded report marks the testing season ended. An ended-season/watering-closed screen is expected for this interface review; do not reset/archive/start a season to make a navigation test pass. This preview still uses Sui mainnet. Gameplay transactions may spend real SUI and affect existing objects; no such transactions are part of this test step.

## Owner display/export evidence

The owner supplied both expanded reconciliation cards. They show Not configured for canonical token identity/shared journal and Not reconciled for spending/token totals/remainder. This is still a status overlay, not a functional shared purchase journal.

The latest CSV and JSON, retrieved `2026-10-03T02:07:53.842Z` through checkpoint `329637621`, matched across all 25 CSV columns for each of two partner rows. One observed BOOM and one Victory test receipt each report 0.01 SUI gross and 0.0028 SUI treasury credit. Partial-history flags and null/blank unconfigured budget/spending fields are preserved. These are not certified final-season totals or production purchase allocations.

JSON SHA256: `5fb2027286ac723b35f345df2d24e8fba21edd51abb031a127ec13c2d13ade45`.
CSV SHA256: `0f68e74f8e1c166599460fbb9d1ba7da2f6fd9af3a85e58470daf7344ebfd841`.
No new independent on-chain audit is claimed from these downloaded reports.

## One remaining hosted player pass

1. In the existing preview, disconnect the admin through the site's wallet menu, then connect an existing non-admin Sui account. Do not top up or buy assets just for this navigation check. Confirm the Admin link is absent. Use a normal browser with its wallet available; no private key or recovery phrase is needed.
2. Open My Garden, Shop, Strategy/My Items, Rewards and Leaderboard, then reload. Confirm navigation and ordinary wallet reconnection work, with no unexpected transaction request. Report empty/eligibility/ended-season messages as shown rather than buying an NFT or starting a new season to clear them.
3. Disconnect the wallet, visit the preview's tester-access page and choose End this browser's tester session. Revisit game.html and confirm protected access requires the tester code again. Re-enter the existing code and confirm login succeeds. Wallet disconnect and website tester logout are separate checks.

A simple pass/fail report is sufficient; screenshots are needed only for an error. Do not deposit, buy, plant, water, open a crate, claim, archive or start a season for this step. The readiness watch should remain silent until this genuine player/access result and any outstanding blockers are resolved.

## Guidance used

Current MystenLabs README.md, frontend-apps/SKILL.md, frontend-apps/non-react.md and frontend-apps/limitations.md; official Playwright Python network mocking documentation; Netlify edge coding context. Only review-test, workflow and documentation files were changed. Production code, on-chain packages, prices, treasury rules, credential settings and the hosted preview were not changed by this continuation.
