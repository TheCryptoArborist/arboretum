# Public Player Handbook — September 28, 2026

## Published result

The owner clarified that the Player Guide is for prospective players, not onboarding the pre-selected testing team, and authorized the correction.

Public handbook: https://treegrow.xyz/player-guide
Private tester reference: https://treegrow.xyz/tester-guide (existing tester session required)
Private game entrance: https://treegrow.xyz/tester-access

Production deploy `6ab9e01839e44cd50bf1273a` published at `2026-09-28T03:34:03.030Z`. Netlify's deploy read confirms ready, production context, published_at, and two edge functions. Prior production deploy: `6ab9d41e08b0ba53890c73bf`.

Release source: `d6a4aa84c724bb4341662a766851d8426dbcef87`, based on main `779f8789089db5da3f81e6d955f5d7a5b1515633`. Later commits only remove the consumed encrypted capability envelope and document the outcome.

## Audience and content

The public handbook opens with **Welcome to Arboretum** and retains the approved dark forest/teal design and original game artwork. It explains what to buy first, daily care, all 20 searchable tool designs, timing/combinations, crates/Supply Drops, direct-referral rewards, the SUI Growth Pool formula, clearly planned NFTree holder privileges and practical FAQs.

The public page no longer contains “Read this before testing,” tester-onboarding tasks, transaction-feedback templates, audit checkpoint prose, or the internal developer/treasury allocation breakdown. One opening notice establishes that public gameplay is not open yet and final prices/balancing/rules will be announced before opening.

The tool summaries retain supported effects from the existing guide and identify the section as prelaunch tool designs; they do not turn uncertain protection automation, future application limits, provisional odds or claim deadlines into confirmed launch rules. The holder table comes from the separately isolated draft PR4 and is explicitly planned, not activated. No market/supply/holder-count figures were refreshed or added.

The prior polished tester guide is preserved separately. Hosted `/tester-guide.html` response bytes matched the prior hosted `/player-guide.html` exactly. Its original reference material, source dates, technical warnings and scripts remain available behind tester access.

## Public/private boundary

Five exact paths are publicly served by a dedicated read-only handler: `/player-guide`, `/player-guide.html`, `/player-guide/`, `/guide/player-guide.css`, `/guide/player-guide.js`. There is no public `/guide/*` wildcard. GET/HEAD only; canonical same-site trailing-slash redirect; no authentication cookie is required or issued by the handbook. The guide CSP permits its local stylesheet/script/artwork but denies connection APIs, frames and forms.

The original tester gate changes only those exact route exclusions. The password, signing secret, native Origin check, session behavior and login implementation remain unchanged. The old `/guide/guide.css`, tester reference, game, wallet/Garden/SDK files and calendar function remain gated.

The generated homepage changes only the access note to **Player Guide: open to everyone. Garden: invited testers only.** Production robots/sitemap include the public handbook, not the tester reference.

## Completed verification

Final Actions run `36374003889` completed successfully:

- **115 automated tests passed, 0 failed**: 80 retained handler/content/Origin tests and 35 public-handbook routing/content tests. The retained handler tests exercise the original function directly; new tests additionally check the exact deployment route exclusions and public-handler dispatch.
- TypeScript validation, Python compilation, original-guide preservation and full build passed.
- **34 hosted HTTP checks passed on preview; 35 on production**, including anonymous guide aliases/resources, public security headers, no session requirement, exact original protected-file comparisons, private-reference denial and production sitemap.
- **74 hosted Chromium assertions passed on each of preview and production** at 1440/768/390/320px: anonymous access, artwork, no horizontal overflow, search/category filter, no-results state, deep-link filter reset, expand/collapse, print-state restoration, no-JavaScript disclosure, native tester login/retry, private-reference access, logout, and continued anonymous handbook access.
- Handbook JavaScript executed during browser checks. Authenticated game checks used a JavaScript-disabled browser context. There was no wallet connection, signature or blockchain transaction.

Preview deploy `6ab9dff3db1348a288b52e7e` passed before production was submitted. Its branch alias is https://public-handbook-20260928--arboretum-sui-forest.netlify.app. No rollback was needed in the completed release.

Artifact `10949987962`, `arboretum-public-player-handbook`, downloaded and verified SHA-256:
`47ea958ca6c2e98df89d753b5893ea1b541013dfac535acd468c54fd76694e2d`.

The archive's JSON reports and test totals were checked locally; production desktop/mobile and crate screenshots were visually inspected. No plaintext tester code, deployment proxy capability or private key was present in the scanned text artifacts. The one-use encrypted capability envelope was removed after completion.

## Scope and limitations

This is a website/documentation change, not a mechanics audit or activation of public gameplay. Original game HTML and wallet/Garden/SDK responses matched the prior hosted release exactly. No Move package publication, price activation, inventory reset, Growth Point modification, claim or treasury action occurred. The October 1 season-ending test plan and separate Season 1 contract PRs are unchanged. Historical deployment URLs and already-public blockchain entry points are not retroactively protected by this website boundary.

Guidance read live: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; official Sui skills resources and Netlify edge-function coding/declaration guidance. Source basis: existing guide and tool metadata at main 779f878, plus expressly planned holder design in draft PR4. The guide does not silently substitute unmerged contract behavior for currently deployed gameplay.
