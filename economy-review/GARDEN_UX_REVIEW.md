# My Garden usability review — October 3, 2026

## Current checkpoint

My Garden's focused usability pass is implemented on draft PR #12 and staged as a protected, non-production preview. It is ready for Peter's screen review, not yet approved for Telegram distribution. The previous Admin screenshots and CSV/JSON checks remain recorded as complete; they are not being requested again.

Preview: https://6ac077566d5c684276a2c6c3--arboretum-sui-forest.netlify.app/tester-access
Deployed application source: `71e160b035744f1862d09cdd357d3f8d8cfb12fe`.
Successful workflow: https://github.com/TheCryptoArborist/arboretum/actions/runs/37093378502
Deployment: `6ac077566d5c684276a2c6c3`, branch `garden-ux-preview-20261003`, context `branch-deploy`, published_at null.
Production remains `6abe81174b61a8e3dd53b333` on treegrow.xyz. Main remains `84b08fdb4bc0ec0417ced7be21f29aae914939f7`. No merge or production publication occurred.

## Implemented scope

1. Season-aware primary Garden Check, next-move and growth advice; reminders close when growing is ended, paused, scheduled, inactive or unknown. Unverified or stale inventory does not authorize care controls. Wilting Seeds are prioritized before dead Seeds. Legacy secondary care suggestions and the dry alert are hidden while care is unavailable, rather than displaying conflicting 'ready to water' advice.
2. Separate Ready now, Waiting, Auto-protected, Wilting and Dead summary labels. Per-Seed status/timer text remains visible on NFTree artwork cards. Waiting and protected Seeds cannot use the card's manual Water control. The existing Water All action is labeled with the ready count. Unknown timestamps are not treated as ready.
3. Ready-to-water filter plus no-match guidance and Show All. Filtering hides cards without passing a reduced list into the slot renderer. Seed object IDs retain their display slot labels through filtering and result reordering within a browser session. These are display positions, not on-chain slot IDs or a promise of permanent numbering across a new session. Filtered-out Seeds are never replaced by apparent planting space. Closed-season empty slots say Planting unavailable.
4. Garden Check moved above the board, longer season details collapsed, and secondary controls grouped under More garden actions. Existing Plant, Plant All, Water All, Check Wallet and Mint controls are retained there subject to existing eligibility and the review guards. NFTree artwork remains; card text and touch controls are larger, focus outlines are visible, and reduced-motion preferences are honored.
5. Persistent loading, refreshed, stale and failure states with Refresh Garden. An initial failed read is not an empty garden. A failed later read retains the last inventory with an explicit warning and disables care until refreshed. Read tickets and captured wallet identity reject old responses; overlapping refreshes coalesce, and a timeout releases retry controls. This is UI admission control, not new on-chain authorization.
6. Visual growth thresholds keep the existing progression calculation but explain streak-days OR GP requirements instead of presenting score distance as calendar days. The final visual milestone is explicitly separate from reward eligibility.

Seed Details and Recent Activity remain deferred. No new game challenges, reward mechanics, prices, rates, wallet addresses, automatic swaps or partner-purchase journal activation were added.

## Exact verification

Final workflow passed 229 Node tests (195 retained plus 34 focused Garden tests), 17 Python deployment-helper tests (13 retained plus 4 Garden staging tests), and 184 offline Chromium browser assertions at 1440, 768, 390 and 320 pixels wide. The browser fixture covers five distinct populated Seed states, actual original parsing/navigation flows, filters, reordered reads, all season phases, failed reads, retries, empty inventory, stale-response admission and non-admin display. No signing, simulation or blockchain submission was attempted.

Artifact `11263542902` was downloaded and SHA256 checked: `4ab9700af9972126a435f5cfafa9e3ea96157b69823ba0c284807095cb8d2143`. Actual logs, checks, build manifest, source archive, gate records and representative desktop/mobile images were inspected. All nine implementation/workflow files match the locally prepared byte hashes. Compiled game SHA256 is `f3d31988b4b0330e062ee2ffd3f3052806dc326eb84863105822340455af2433` and generated season reader SHA256 is `dfd2fcc650ca474ebb67c6c6030b77846f0cdffb0d0e8d09fcc6012f76ead134`.

The preview transformation is opt-in and rejects production or unexpected input HTML. It changes the generated gated game and adds a read-only season-view accessor/event; it preserves wallet.js, garden.js, the SDK bundle, public homepage/guide and both partner-report runtime modules. The tracked original game source, contract and access-gate sources were not modified.

The deploy passed the eight existing public-gate/preservation checks and three additional anonymous denial checks for the new Garden modules/styles. Connected Netlify reads before and after staging confirmed unchanged production publication. The existing calendar-reminder function package digest and no-schedules configuration were preserved. No tester credentials were retrieved or reset; the consumed run-bound encrypted deployment envelope was removed from the branch.

An earlier candidate also passed 228 Node and 184 browser assertions; visual inspection found a leftover legacy secondary Watering card during the ended phase. The final CSS hides that secondary block, stale care kicker and dry alert when care is unavailable, with an additional regression guard. The candidate at 6ac0754e6d5c683786a2c5fb is superseded by the current preview above.

## Limits and owner check

Browser requests were intercepted and fulfilled with local files or synthetic data, or aborted. The synthetic Wallet Standard provider could not sign. Repeated hero art in fixture screenshots is fixture imagery, not replacement of real NFTree artwork. No real wallet connected during automation; these results do not certify hosted wallet-extension behavior, the genuine tester login/logout flow, on-chain transaction success or every browser/device. The container browser's local navigation was blocked by its managed environment, so the full browser runs took place in GitHub Actions. No managed browser policy or hosted tester gate was bypassed.

The eight gate checks and three asset denials are not authenticated hosted-byte verification. The owner still needs to open this exact preview with the existing tester code, connect an ordinary wallet and review My Garden, filters, More garden actions, refresh feedback and navigation. Prior Admin export verification need not be repeated. Genuine non-admin login/reconnection and tester logout/re-entry remain required before the Telegram readiness notice.

The supplied prior mainnet report marked Season 3 ended. Do not create, reset, archive or fund a season merely to review the UI. This is a Sui mainnet preview: ordinary approved gameplay transactions may spend SUI and change objects. None is required for the screen/filter/refresh check.

## Guidance

Live MystenLabs/skills README, frontend-apps/SKILL.md, frontend-apps/non-react.md, frontend-apps/limitations.md; accessing-data/SKILL.md and accessing-data/graphql.md. Existing GraphQL-backed timing/reads are reused without a new SDK or chain-interface migration. Netlify edge coding context and the existing scoped branch-staging implementation were reviewed and preserved.
