# Archived-season partner accounting — hosted review

## Status
The read-only Partner Chest Revenue panel is deployed to a separate branch preview, not to production. PR #12 remains draft and unmerged. This document supersedes the earlier offline/local-only descriptions for the features below, not the unresolved launch-economy gates.

Preview: https://6abf3e0f98877b551f673293--arboretum-sui-forest.netlify.app/tester-access
Branch alias: https://partner-season-preview-20261002--arboretum-sui-forest.netlify.app
Preview deploy: `6abf3e0f98877b551f673293`, branch-deploy context.
Original deployed application source: `dccfd1f687445fa208525aafa829c72dcd47946c`.
Verification runner source: `fe5f4938c23e1b3ef21e648037fb2a8431cc540c`. Only verification scripts changed between these revisions; all six hosted runtime modules matched the runner's source bytes.
Production remains `6abe81174b61a8e3dd53b333`; main remains `84b08fdb4bc0ec0417ced7be21f29aae914939f7`.

## Added
- Load seasons and a planting-season selector inside the existing Admin Console's Partner Chest Revenue panel.
- Current-registry seasons and discoverable archive objects are handled separately. A cleared active-season start does not prevent a valid archive being selected.
- Archive creation and season opening must be bound to the configured registry and supported package, successful transaction, and matching immutable fields. Missing proof produces an explicit review issue, not a guessed season.
- Purchase windows use verified opening evidence, the stored cutoff, and any earlier finalization. Opening dates and later-season purchases do not reattribute earlier sales.
- JSON/CSV preserve selected season, archive identity, read checkpoint, coverage qualifications, and incomplete flags. Switching seasons clears prior results; failed refreshes disable exports. A snapshot can attach only a matching-season report and retains stale/partial status.
- No new wallets, fund lock, automated swap, fee transfer, price activation, claim, archive, reset, or season start.

## Genuine live read
The hosted browser read at `2026-10-02T05:23:37.743Z`, checkpoint `329316342` (`05:23:35.580Z`), returned testing season 3 in the current registry. No selectable archive was returned by the discovery query; no archive was created to test the feature.

The supported receipts found were one BOOM and one Victory purchase, each 0.01 SUI gross and 0.0028 SUI treasury credit. These are NOT certified full-season totals. The exact query's guaranteed history began `2026-09-05T06:58:47.030Z`, after the actual season opening `2026-09-02T21:13:09.893Z`; the cutoff was `2026-10-01T00:00:06.247Z`. Status remains `PARTIAL_TEST_RECEIPTS_REVIEW_REQUIRED`, with `complete=false` and `finalForSeason=false` despite reaching the end of the available pages.

All testing acquisition-budget fields remain null: these receipts do not fund the forthcoming production partner policy. Pool/developer columns are routing-model allocations, not a full historical pool audit. Individual reward eligibility, payout success, actual token spend and acquired-token balances were not audited by this work.

## Verification
- 139 Node tests passed locally and in GitHub, zero failures/skips. New tests cover archive provenance, historical duration decoding, early closeout, cleared registry, unavailable proofs, rollover, pagination and partial coverage.
- Initial workflow `36968010435` built and deployed the preview; HTTP integrity checks passed. Its browser script stopped because it had not opened the existing Admin modal. This was a test setup error, not a reason to bypass checks.
- Workflow `36968543206` corrected the test setup by opening the original Admin modal and reverified the SAME deployment without redeploying. It completed successfully with 38 HTTP/integrity checks and 73 browser assertions at 1440, 768, 390 and 320 pixels.
- Genuine native tester login, rejected wrong code, Secure/HttpOnly cookie, anonymous denial, logout and the original game scripts were exercised. Positive Admin identity and archived-season UI states used explicit in-memory test doubles: no real owner wallet connected and no signature submitted. Owner-wallet confirmation remains pending.
- Current testing-season discovery and receipt reads were genuine network queries. Archived selection was verified with synthetic transaction/unit fixtures and controlled hosted UI states, not a newly created live archive.
- Public homepage and guide content, wallet.js, garden.js, SDK and existing season-status code were preserved; game.html matched the expected additive report overlay. Production bytes and main were checked unchanged afterward. The existing calendar-reminder function remained present; no scheduled functions were added.
- Artifact `11211100323` SHA256 `7189272d838e94508fc33df2301c8a6064b773b02b100b18c667c74c372e5f44` was downloaded and checked. Actual test logs, live-read JSON and screenshots were inspected. Screenshot capture inside the scrollable Admin modal clips long reports; the hosted page remains scrollable.

## Owner review path
Open the preview's Tester Access page using the unchanged tester code. Connect the usual admin wallet through the existing game interface, open Admin Console, scroll to Partner Chest Revenue, select Load seasons, choose the planting season, then Read on-chain receipts. Export JSON/CSV as needed. These report buttons do not submit blockchain transactions; do not use the separate season-management buttons to test this report.

## Remaining before production
Owner-wallet hosted confirmation; live archive evidence when one legitimately exists; production-economy package/policy binding and complete sales coverage; final partner/Supply Drop prices; and separate transaction-evidenced spending reconciliation. The approved 10% of each partner chest's treasury proceeds, single-treasury arrangement, and separate NFTree-to-TREE funding are unchanged. Approving or publishing this read-only report is not an instruction to activate the game economy or move funds.

Guidance checked live: MystenLabs README.md; accessing-data/SKILL.md, graphql.md, archival.md; frontend-apps/SKILL.md, limitations.md, non-react.md; official Sui GraphQL documentation and actual endpoint schema; Netlify edge-function guidance and official deployment API documentation.
