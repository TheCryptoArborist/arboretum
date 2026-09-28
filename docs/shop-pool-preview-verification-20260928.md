# Item Shop and SUI Growth Pool previews — published verification

The owner requested both previews on the public prelaunch homepage. They are now published at https://treegrow.xyz/#item-shop and https://treegrow.xyz/#growth-pool.

## Published release

- Source commit: `c20d7c356c00651fde6e87c95c079a7536a65d82`.
- Base main: `f688cd8c7e07fba1b46b8d34cc9d5998eb1306b3`.
- Verified branch preview: `6ab9cae4cdaaa043f0c5f60e`.
- Production deploy: `6ab9cb0bc9d95d525c521d23`, published at `2026-09-28T02:04:09.449Z`.
- Previous gated production: `6ab9bfabfb745b0ff61e07f6`.
- Netlify get-project and get-deploy confirmed the new production release, with the edge gate present.

## Visitor-facing additions

The Item Shop preview uses the five original in-game crate images: Seedling, Grove, Canopy, Ancient and Mythic. Cards scroll horizontally on narrow screens. An expandable section describes BOOM, Victory and Supply Drop. Testing prices and public purchase actions are not shown. The existing tester entrance is retained.

The SUI Growth Pool preview explains the reward-share structure: eligible player Growth Points divided by total eligible Growth Points, then the share applied to the funded claimable SUI pool under the season rules. A 10% share illustration is explicitly labeled as an example, not a payout forecast. The panel does not display a live pool balance, personal reward estimate, invented SUI amount, countdown or claim button. It is an explanatory preview, not a live Rewards Hub feed.

Both additions use readable HTML and the existing page styling. The approved headline, referral descriptions and prior garden preview remain in place.

## Completed checks

GitHub Actions run `36368201743` completed successfully, including:

- 80 automated tests passed, zero failed: 47 original gate tests, 10 native-Origin tests, 13 existing redesign tests and 10 new showcase tests.
- TypeScript validation and the page build passed.
- 26 hosted checks on the isolated preview and 26 on production passed. Each set includes the browser-run result, public content/assets, anonymous denial, authenticated exact-file comparisons and logout.
- 49 Chromium assertions on the preview and 49 on production passed. Public layouts were checked at 1440, 768, 390 and 320 pixels. Native login, incorrect-code retry, authenticated reload, protected guide access and logout were checked at desktop and mobile sizes.
- The evidence artifact was downloaded and its SHA-256 verified: artifact `10948311062`, digest `ca4b8dfd7ccd8aa0e483b0cdc42f137fd432d15e75f4b7fdc19da81e153a0e98`. JSON reports were inspected, and hosted desktop Shop/Pool screenshots and local mobile renders were visually reviewed.

Authenticated browser sessions deliberately disabled gameplay JavaScript. No wallet was connected and no transaction was signed. These are website/access checks, not full gameplay, financial-account, contract-security or October 1 administration tests.

## Preserved behavior and honest scope

Original game HTML, wallet, Garden, SDK, Move source and calendar function source remain unchanged. The game, guide and scripts served on both new deployments match the authenticated prior-production response bytes exactly. The existing tester code and authentication logic were not changed; only five exact public CSS/artwork paths were added to the allowlist.

The first release attempt stopped before creating a deployment because it tried a site-metadata GET outside the limited deploy proxy's supported endpoint scope. Site metadata was then read through the supported Netlify connector; in-run drift checks use the exact live homepage digest and GitHub main commit. The second attempt stopped on the branch preview because it compared hosted game HTML to raw local dist HTML. Existing hosted game HTML already has a different digest from local dist. The final verifier captures the authenticated prior release and enforces exact hosted-to-hosted equality, while retaining untouched-source checks. No mismatch was accepted as successful, and no production change occurred until preview verification passed.

No contracts, live game prices, inventory, Growth Points, claims or treasury funds were changed. There were no on-chain balance reads or wallet transactions. The October 1 testing plan remains separate. The temporary encrypted handoff was removed from the branch after use; production credentials are not included in source or evidence. This website release does not make legacy deployments or public blockchain calls private.

## Guidance used

Live MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; current Netlify edge-function guidance. accessing-data/SKILL.md was consulted when considering a live balance, but this release deliberately introduces no on-chain queries. Existing Item Shop and Rewards Hub sections in the main game are the content basis.
