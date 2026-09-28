# Prelaunch preview verification — September 26, 2026

Review URL: https://prelaunch-preview-20260926--arboretum-sui-forest.netlify.app
Netlify deploy: 6ab80d492c4a388d8f76e319. Context: branch-deploy. published_at: null. An edge function is deployed. The production address was not promoted or switched.

Application source commit: f553a6cae2a2f3a5dd87343b84165eb001aef1b9. GitHub Actions run 36262165101 completed successfully, including 47 local edge-handler tests, TypeScript checks, original guide build, prelaunch build, production-build guard and the hosted access test. Later changes remove the consumed encrypted envelope and record this report; they do not change deployed application code.

The hosted result artifact 10912907028 was downloaded and its SHA-256 verified: cc8dcd212d49acd096f62f320a621b8bfe94a328c02f989a8772c3eec731f376.

All 17 hosted checks passed:
- Public landing served successfully without scripts.
- Eight unauthenticated routes rejected: /game.html, /wallet.js, /garden.js, /player-guide, /player-guide.html, /sui-sdk.bundle.js, /sdk-entry.js and /.netlify/functions/calendar-reminder.
- Invalid code rejected without a session; valid code issued a Secure/HttpOnly cookie.
- Authenticated original game was served.
- Wallet, Garden and SDK response bytes matched their unchanged repository sources.
- Logout expired the cookie; the next private-script request was denied.

The source game and scripts were not redesigned, and no wallet was connected or transaction signed. The preview still uses the existing testing contract, not the unmerged Season 1 candidate. Actual wallet approvals, calendar subscriptions, guide return-navigation and October 1 admin flows remain owner/browser acceptance checks before promotion.

A separate in-memory Chromium layout check passed at 1440, 390 and 320 pixels with no missing images or horizontal overflow. Those renders are not described as hosted browser tests. Hosted testing above is actual HTTP access testing on the Netlify branch deployment, not a complete security audit.

The access code and session signing secret were set only for the Netlify branch-deploy context and Functions scope. They are not committed or bundled into the page. The owner receives the preview code privately; the signing secret is not distributed. This is shared invite-code access, not per-user identity. The temporary upload capability was encrypted to a run-specific key; the consumed ciphertext was removed from the branch.

No production approval variable is enabled. Before advertising a gated main address, obtain owner approval, verify the production configuration and review historical Netlify deployment permalinks, which are not retroactively protected by this new edge function. Existing blockchain entry points also remain public and the previously identified on-chain timing issue remains a separate release concern.

Guidance read live for this implementation: MystenLabs/skills README.md; frontend-apps/SKILL.md; frontend-apps/limitations.md; Netlify edge-function coding context and official createSiteBuild branch semantics. No Sui SDK, Move source, economic allocation or price was changed by this website work.
