# Item Shop and Growth Pool previews

Requested by the owner for the public prelaunch page at treegrow.xyz. Baseline: f688cd8c7e07fba1b46b8d34cc9d5998eb1306b3; existing production: 6ab9bfabfb745b0ff61e07f6.

Two static, read-only sections are added before the community call to action. Item Shop uses the five original standard-crate images and labels from index.html, with a compact optional explanation of BOOM, Victory and Supply Drop. No testing prices, drop probabilities or buy actions are exposed.

The SUI Growth Pool panel previews the reward structure from the existing Rewards Hub: eligible player points / total eligible points = pool share; share multiplied by the claimable funded pool determines the reward under the season rules. The 10% share illustration is explicitly an example, not a payout forecast. No live balance, invented SUI amount, personal estimate, countdown or claim button is shown. It is an explanatory UI preview, not a screenshot of a connected wallet or a live feed.

Authentication logic and secrets are unchanged. The only edge-handler change is adding five exact public stylesheet/artwork paths. Private game, guide and non-public resources stay gated. Original game HTML, wallet, Garden, SDK, Move source, calendar function and existing marketing copy/CSS are unchanged. Existing NFTrees, test prices, points, claims, treasury balances and the October 1 test plan are unaffected.

Tests: 10 new checks added to retained gate, native-Origin and content suites. In-memory Chromium renders passed at desktop, tablet, 390px and 320px before publication. Hosted preview verification must pass before this workflow publishes the requested page; post-publication verification checks both previews, art bytes, private-route denial and native login/guide/logout. Authenticated browser tests disable game JavaScript and do not execute wallet or blockchain actions. A failure during publication triggers restoration of the prior gated source, not the formerly ungated site.

Current guidance read: MystenLabs/skills README.md, frontend-apps/SKILL.md, frontend-apps/limitations.md; Netlify current edge-function context. The data-access skill was consulted while evaluating live balances; this version deliberately introduces no on-chain queries. Results and actual publication status are recorded separately after execution.
