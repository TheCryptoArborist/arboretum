# Player Guide visual polish — September 28, 2026

The requested presentation update is published at https://treegrow.xyz/player-guide. Tester authentication is still required. The existing tester code, gate logic, gate allowlist and session settings are unchanged.

Production deploy `6ab9d41e08b0ba53890c73bf` was published at `2026-09-28T02:42:53.132Z`; Netlify reports ready production context with its edge function present. Source commit `730619230ce301b6482c0d558b4f30822f1cf37e` on `style/player-guide-polish`; base main `cf01641d11edc9171be73d125cd9ef04cc6449b6`. Subsequent commits remove the consumed encrypted handoff and record this report, not change the published design.

## What changed

The existing Player Guide now has a branded forest/guardian cover, the actual Arboretum logo, original standard-crate and partner-chest artwork, clearer typography and spacing, numbered desktop contents, mobile chapter navigation, and rarity-accented expandable tool cards. Crate comparison tables have keyboard-focusable horizontal scroll regions. Existing search, category filtering, expand/collapse, direct tool links and print-state behavior are retained and tested. Back to game now opens the actual protected game rather than the marketing homepage. Netlify normalizes the source `/game.html` link to `/game`; both resolve to the unchanged game document.

## Content and scope preserved

This is a visual/navigation update, not a mechanics revision or new audit. A checked post-build transform requires the exact original v0.2 guide hash and verifies preservation of all original semantic text, source notes, dates, amounts, warnings, 20 tool entries, ID anchors and inline scripts. Original content organization and source-based/pending-verification labels remain intact. Older mechanics are not silently replaced with the unmerged Season 1 proposals.

Original guide SHA-256: `885a34075dc8aebe919e1f49854c1b82df1f8cc884f3e6e5654eddc1e7659b89`.
Polished guide SHA-256: `263268db650d27b42530ba40081ac5f1dcfa71ffd72cf88a3eebbcfef5e8a988`.

Original homepage (including Item Shop and Growth Pool previews), game HTML, wallet.js, garden.js, SDK, Move source, calendar function, gate and prior build scripts are unchanged. The netlify.toml build command appends the isolated presentation pass; the new stylesheet at `/guide/guide.css` stays behind the existing gate.

No wallet transactions, contract publication, economic allocations, price changes, inventory resets, Growth Point changes, claims or treasury actions occurred. October 1 season-ending testing remains a separate task.

## Completed checks

Actions run `36370662765` completed successfully, including every workflow step:
- 80 retained automated content/access/Origin tests passed; zero failed.
- Guide content, original-script and anchor-preservation checks passed.
- 23 hosted HTTP checks passed on the separate preview and another 23 on production.
- 88 hosted Chromium assertions passed on the preview and another 88 on production, at 1440, 768, 390 and 320 pixel viewport widths.

Browser checks used native login forms, rejected an incorrect code, loaded the actual guide JavaScript, checked images and document overflow, tested chapter navigation, empty search results, category filtering, expand/collapse, deep-link filter reset, print disclosure-state restoration, authenticated reload, Back to game and logout. Game JavaScript was deliberately disabled during navigation tests: these are not actual-wallet gameplay, calendar-subscription or October 1 administration tests. Print events were exercised; no assertion of complete printer/PDF pagination is made.

The guide, stylesheet and private game resources were rejected without authorization. Authenticated game and wallet/Garden/SDK responses matched the prior hosted bytes exactly; production homepage bytes were unchanged. All guide words and scripts matched the previous hosted guide after excluding decorative elements.

Artifact `10947979773` was downloaded and hash-verified locally: `2044f3b60066478dfae65e9cffb70e92c0ff3f873874c4e27682aafc3a968ea8`. Reports were read and desktop/mobile guide, tools and crate screenshots inspected. No plaintext tester code or deployment capability was present in the downloadable artifact.

## Earlier checks and recovery

The first preview check stopped before publication because it expected a literal `/game.html` href while hosting normalized it to `/game`. The correction validates same-origin destination and exact unchanged game bytes, not merely a successful status.

A later attempt passed all preview checks but did not finish the final small-mobile production return-navigation step. It was treated as failed, not reported as passing, and the prior gated source was restored in deploy `6ab9d28bee525741320c52a2`. The final test waits for the destination DOM rather than unrelated game-image loads and retains sanitized failure diagnostics. All final production assertions completed successfully. No gameplay source or authentication rule was weakened to obtain that result.

## Guidance read live

MystenLabs/skills `README.md`, `frontend-apps/SKILL.md` and `frontend-apps/limitations.md`; official Sui skills page and Netlify edge-function coding context. The guide is wallet-free and secrets remain server-side. This cosmetic release does not certify the guide's historical source-based mechanics or the unmerged Season 1 contracts.
