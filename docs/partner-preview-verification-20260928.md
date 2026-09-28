# BOOM and Victory preview — verified September 28, 2026

Public section: https://treegrow.xyz/#partner-chests
Production deploy: `6ab9e6f36eda285b562f5b2f`, published `2026-09-28T04:03:18.215Z`. Netlify get-project confirms this deploy is current and ready.
Application source: `38f22a037981452bb4deb42bead22ccd2a6a3723`, based on `e84ccdc87d5f62242fa9101b469afec90c79832a`.

## Requested changes

BOOM and Victory now have visible partner chest cards under the five standard Item Shop crates. The cards use the original game PNGs, not generated replacement artwork. BOOM is described as growth-focused; Victory as protection-focused, with recovery among bonus possibilities rather than guaranteed revival. Cards sit side by side on desktop and stack on small screens. The public handbook chest section is linked directly.

Removed the public homepage's Enter the Garden button. View Player Guide is now its main action; the separate Tester access links remain. The Growth Pool panel's old tester-access label was corrected to describe the public handbook as open to everyone. No prices, odds, checkout or claim actions were introduced.

## Verification

Release workflow `36375865612` passed: 127 automated tests (115 retained and 12 targeted), TypeScript checks and Python compilation. Both preview and production passed 30 HTTP checks, 40 homepage browser assertions and all 74 retained public-handbook/native-login browser assertions. Desktop, tablet, 390px and 320px layouts were exercised; production homepage and partner-card screenshots were visually inspected.

Public artwork bytes match the two original PNGs. Public guide HTML/CSS/JS, private tester reference, game HTML and wallet/Garden/SDK responses match prior-production bytes (preview guide comparison accounts only for its noindex metadata). Login, wrong-code retry, logout, anonymous handbook access and private game denial were checked. Gameplay JavaScript was disabled during authenticated browser tests; no wallet was connected and no chain transaction was signed.

The first local test attempt had one overbroad text assertion that matched the handbook heading Before you enter the garden. It was corrected to inspect actual link/button labels, without changing that handbook prose. The final 127 tests passed; the failed attempt was not described as passing and never published.

Artifact `10951505254` downloaded and verified SHA-256: `b52e2e08a584f4067e2005769089ce86f67e0832c3d4648c29b2f26b8ee36e25`. Reports, assertion counts and screenshots checked locally. Text artifacts were scanned for the real tester code, deployment token and private key; none were present. Consumed encrypted handoff removed from the branch.

## Scope and guidance

Only the homepage, showcase styles, two artwork copies, exact public artwork allowlist entries and their tests/release documentation changed. Tester authentication and handbook routing are preserved. No game rules, prices, loot tables, Move source, inventory, Growth Points, claims or treasury changes. No separate Season 1 contract release or October 1 administration test is implied.

Live guidance consulted: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; Netlify edge-function coding context and declarations.
