# Arboretum prelaunch entrance — review candidate

This branch separates a public introduction from the existing tester game. It is not a Season 1 contract release and does not approve switching treegrow.xyz. Main baseline: 2338affe1dd984f5bc676cec7f3763d1f37a90cf; production deploy baseline: 6aa4e0bdc5c59a631ddc1db9.

## Public experience

The new public landing is static HTML/CSS, using existing Arboretum art. It introduces daily care, strategic tools and the funded SUI Growth Pool. NFTree rarity privileges are explicitly planned, not represented as live. Calls to action link to the existing https://t.me/cryptoarborist community and the tester entrance. There is no wallet connection, transaction code, countdown, launch date, testing-price table, tracker or email collection. October 1 remains a season-end testing session, not an advertised launch date.

## Tester access

The existing built game is copied byte-for-byte to /game.html. Wallet, Garden and SDK scripts and contract targets are unchanged. Existing relative guide/script/image links retain their root paths. Netlify's TypeScript edge handler runs on all paths and has a strict public-file allowlist. Every other resource requires a signed tester session, including direct JavaScript URLs, the existing guide, and function routes. This must be confirmed on the hosted preview, not inferred solely from local tests.

Two new Netlify Functions-scope environment variables provide a high-entropy access code and signing key: ARBORETUM_TESTER_PASSWORD (32+ characters) and ARBORETUM_SESSION_SECRET (64+ characters). Neither is bundled into browser code. Missing/invalid configuration fails closed. Sessions are host-bound, HMAC-signed, 12-hour HttpOnly/Secure/SameSite=Strict cookies. Login and logout require same-origin POSTs; request sizes, duplicate inputs, tampering and expiry are checked. Responses are not cached. The login page includes a logout action.

This is shared-code access for invited testers, not individual identity or per-user revocation. The code must be distributed privately. Rotating either secret and deploying the new environment revokes outstanding sessions. A production access/rate-limiting review is still needed. Existing calendar subscription compatibility must be tested before activation; the candidate intentionally does not leave function paths unauthenticated.

## Review and deployment

Run the existing guide build, then scripts/build-prelaunch.mjs. Static ZIP hosting alone does NOT deploy the gate. The edge function must be included in a Netlify build. Production builds refuse unless ARBORETUM_PRELAUNCH_APPROVED=true; this value is intentionally not set during preview work. Preview robots/meta stay noindex.

The optional [preview-upload] workflow path uses a short-lived authorized Netlify build proxy, encrypted to a run-specific RSA public key. The private key exists only in the runner temporary directory. Credentials, cookies and plaintext envelopes must never enter Git, artifacts or logs. The requested branch is prelaunch-preview-20260926, not main; hosted context must be branch-deploy. No production promotion is performed.

The local edge-handler suite currently has 47 passing cases. Desktop, 390px and 320px layouts were rendered in a browser in memory without horizontal overflow or missing images. These are distinct from hosted Netlify HTTP tests and from actual signed wallet tests. Test logs and hosted results identify their actual scope; no blockchain transaction is submitted by this work.

## Before switching the public address

Owner must review the landing and verify normal tester wallet/watering/tool/guide and October 1 administration access. Record the current deploy, explicitly approve the website change, and verify production gate routes after promotion. The historical Netlify deployment URLs and old HTML/browser caches are NOT retroactively protected by a new edge function; treat them as a separate access-control review. Leave existing test access unchanged until the approved switch. An accessible GitHub repository also means old frontend source is not confidential.

A website gate does not make an already-public blockchain contract private or repair the known live timing concern. The isolated Season 1 fixes, snapshots and claims, inventory transition, and final wallet testing remain separate launch gates.

## Guidance consulted live

MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md: no browser secrets, preserve existing wallet transaction integration rather than changing SDKs for a marketing page. Netlify edge-functions coding context and official API createSiteBuild documentation: authenticate before forwarding and use an explicit non-main branch for preview builds. No claims from historical token price/supply snapshots are displayed.
