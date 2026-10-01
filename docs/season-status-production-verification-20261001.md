# My Garden season status — published and verified October 1, 2026

## Owner approval and live release
The owner approved the local panel and asked to proceed with hosted integration and publication on October 1, 2026. The existing website was not altered until hosted preview verification passed.

- Site: https://treegrow.xyz
- Tester entrance: https://treegrow.xyz/tester-access
- Netlify site ID: a344fb31-10b4-4eea-9562-067d90a39607
- Previous production: 6abbe7b634a0e3e47818988a
- Verified preview: 6abe80da5c0cd5bb132b34fe, branch garden-season-status-20261001
- Production: **6abe81174b61a8e3dd53b333**, published **2026-10-01T15:49:58.908Z**
- Netlify project and deployment tools independently confirmed current, ready, production context.
- Published source: **8e55d37b2dd8500141ddb12b361b99567cfab33d**
- Successful release workflow: **36886723335**
- PR: https://github.com/TheCryptoArborist/arboretum/pull/11

## Player experience
My Garden now displays a permanent Season Status & Rewards panel with a network-derived countdown during an active season, an exact cutoff in local time and UTC, and distinct ended, paused, ended-and-paused, inactive and unavailable states. It refreshes while visible and when returning to the tab. A stale or unsuccessful read does not invent claim readiness.

At the production browser read, the Sui Clock was 2026-10-01T15:50:05.150Z; the registry remained season 3, paused false, season_start_ms 1788220806247. The resulting cutoff was 2026-10-01T00:00:06.247Z. The panel correctly showed **Season 3 ended** and **Watering closed**.

Single and batch watering controls are disabled outside the active unpaused season. Both existing inline watering handlers also recheck network season state before proceeding into the original eligibility and transaction path. The specific configured-package MoveAbort code 6 in arboretum::assert_season_active is translated into an understandable season-ended message. Code 6 in claim_reward, another package, or a different function is not misclassified.

**View season rewards** opens the existing **Rewards → Monthly Pool** tab. It does not claim or sign anything. The expandable help describes the existing **Claim Reward** action, selecting an eligible Seed, reviewing and confirming the wallet request, and repeating for other eligible Seeds. Claims remain manual and subject to eligibility and applicable archive deadlines. The panel never claims an automatic background reward-calculation process exists.

## Measured verification
The final release passed:

- 117 retained baseline tests.
- 118 reward-first/public/gate checks. These overlap the baseline suite, not 235 unique cases. The existing two obsolete wording assertions remain superseded by the previously published reward-first audience checks.
- **47 focused season model, error mapping, build and watering-preflight tests**, passing for both the branch and production build.
- Node syntax checks, Python compilation, exact source-boundary checks and the production approval guard.
- **33 HTTP/integration checks on the hosted preview, then 33 on production**.
- **105 season-panel browser assertions on the hosted preview, then 105 on production**.
- **74 retained handbook/native-login browser assertions on each deployment**.

Browser widths: 1440, 768, 390 and 320 pixels. The new integration checks loaded the actual game and wallet scripts with no connected wallet. They first verified the real network season state, original script availability, the panel layout, visible manual claim instructions, and the existing Rewards/Monthly Pool navigation. The ended/active/paused/inactive/unavailable transitions and cutoff boundary were then tested with explicitly controlled read responses. Existing write methods were blocked and counted during those fixtures; no write attempts occurred. No wallet identity was impersonated.

Actual browser form submission covered wrong-code rejection, successful tester login, HttpOnly/Secure cookies and logout. New season-status assets are blocked without tester authorization and after logout. The public guide remains readable after logout. Original guide search/filter/disclosures/deep links/printing and no-JavaScript reading passed the retained suite.

Production screenshots of the full desktop garden and the desktop/mobile season panel were visually inspected. They retain the approved panel design and fit within the tested viewports. These are viewport tests, not a claim of physical-device testing.

## Exact preserved boundaries
The production public homepage, Player Guide, checked styles/scripts and original artwork match the previous production bytes. Original index.html game source, wallet.js, garden.js, SDK files, Move source, both edge-function sources and calendar-reminder function source remain unchanged. The original private tester reference remains unchanged.

The built **game.html intentionally changes**, but its hosted response must equal the previous hosted game with only the exact approved panel, asset includes, preflight checks and scoped friendly-error insertion applied. Three new assets under /season-status remain gated. No public asset allowlist or authentication/session logic was changed.

One existing calendar-reminder function and two existing edge functions remain deployed. There are no scheduled functions. Production calendar-reminder digest remains 93fb365b6b730a884e29f2d63957ea1966c88bcfacdf450e16ea07823dc11bf1.

The dedicated Builds-scope production flag ARBORETUM_SEASON_STATUS_APPROVED=2026-10-01 enables this approved presentation pass. Unapproved production builds refuse. The current release identity was confirmed through the Netlify project connector; the runner uses only the deployment capability's permitted build POST and individual-deploy GET paths. Current public and private responses were compared with the pinned prior production permalink and checked again immediately before publication.

## Prior failed or superseded checks
An initial release attempt stopped before deployment because the script requested a site-level read through a build-scoped capability. Netlify's official MCP source confirms that capability only permits build creation and individual deployment reads. The current-project check was moved to the authorized project connector, retaining exact pinned/live source and response comparisons. A pending diagnostic attempt was superseded without supplying deployment credentials.

The first hosted preview then caught a fixture timing issue: error translation intentionally starts an asynchronous refresh, and the next controlled scenario could join that older in-flight read. The test now drains the coalesced read and requires a fresh response for the selected fixture, without changing the app or loosening the state assertions. That unsuccessful preview was never promoted. Final release passed without rollback.

## Evidence and limits
Artifact **11174149185**, SHA-256 **d1c195715e26f30b6221090a0504e741b89ab389ff82ea8da06111d9523b737c**, contains measured reports, live read responses, screenshots, implementation and focused tests. The digest was verified locally. All reported check arrays contain passing results. A scan of 33 text files found no real tester password, deployment capability URL or private key. The consumed encrypted handoff was removed from the branch.

**No wallet connection, signing, blockchain transaction, payout, claim, archive/reset administration, inventory change, Growth Point change, price change, contract publication or treasury action was performed.** This is hosted UI integration, not certification of successful reward payment or full season settlement. The existing tester code is unchanged.

Live references used: MystenLabs/skills README.md; frontend-apps/SKILL.md, limitations.md and non-react.md; accessing-data/SKILL.md and graphql.md. Netlify edge coding context, official ZIP-build documentation, and netlify/netlify-mcp src/tools/deploy-tools/deploy-site.ts and netlify/edge-functions/proxy.ts informed deployment checks. The prior season diagnosis consulted sui-move and PTB troubleshooting guidance separately.
