# Published Season 2 release — November 8, 2026

The owner test is live at <https://www.treegrow.xyz/admin/season-two/>.
Netlify published it at **2026-11-08T14:34:33.427Z** (8:34 AM America/Chicago).
The release used one journaled source ZIP submission, followed by authenticated
asset/backend verification, anonymous HTTP checks and a live browser review.

| Item | Verified value |
| --- | --- |
| Netlify site | `d425445d-4980-49be-8ab2-12e7527ba281` / `arboretum-preview` |
| Published deployment | `6af08867e808541bad23b5b2` |
| Build | `6af08867e808541bad23b5b0` |
| Exact deployed source | `ed128b295e80701067a0f74c66e6a1ae3e6b709b` |
| Source tree | `27b58ad8371191c2fe2c2c6ee79fb57e06476665` |
| Archive size | 45,702,474 bytes |
| Archive SHA-256 | `093a21fb747215ed94d5cd3a6f5886ae1ab7fb1d45617b0a5faf0d9ef9d4c5e9` |
| Application inventory and raw assets | 106 of 106 matched |
| Previous application files | 103 of 103 unchanged |
| New runtime files | Season 2 HTML, CSS and bundled JavaScript only |
| Public HTTP checks | 24 of 24 passed |
| Existing function | `calendar-reminder`; digest and runtime configuration preserved |
| Edge functions | `public-player-guide` and `tester-gate` |
| Function schedules | None |
| Original `arboretum-sui-forest` deployment | Still `6abe81174b61a8e3dd53b333` |

## Evidence

- [Candidate](candidate.json) pins the exact source, configuration and all application files.
- [Preflight](preflight-before-submit.json) records the authenticated baseline and preservation checks immediately before submission.
- [Submission](submission.json) records the single attempt, archive identity and returned deployment/build IDs.
- [Required CI](ci.json) records successful push and pull-request **Settlement app integration review** runs for the deployed source. Other legacy repository workflows are outside this claim.
- [Hosted assets](hosted-assets.json) records the ready publication, complete authenticated inventory, raw asset hashes, backend configuration and original-site preservation.
- [Public HTTP](hosted-http.json) records anonymous access, fixed entrance redirects, rejected direct writes, retained public pages and the calendar download. Public HTML has only the documented Netlify anchor URL rewrites; raw deployed assets matched exactly.
- [Browser summary](browser/browser-summary.json), [rendered page text](browser/hosted-page.md) and [desktop screenshot](browser/hosted-desktop.png) record the actual hosted page.

The CI evidence copy retains the exact source/run facts from the preparation
journal. Its old waiting-for-login status has been omitted because publication
is separately recorded above. The earlier `local-validation.json` and local
browser failure records remain unchanged as evidence of their original stage.

The archive itself is reproducible with `git archive --format=zip` from the
exact source commit and is not duplicated in this evidence commit. The
release journal's candidate/archive hash chain was independently reproduced
and matched after publication. This evidence-only commit does not change the
deployed application source.

## Browser result and limits

The production page displayed **Mainnet verified** and **Ready for Season 2**.
Its Refresh status action returned a newer mainnet checkpoint and the
**Season status refreshed** message. No tester code prompt appeared. The
1348 CSS-pixel desktop viewport had a matching 1348-pixel scroll width, and
the full-page screenshot showed the expected four steps and schedule.

This browser had no Slush extension. The readiness and submit actions stayed
disabled, as expected without a wallet. No wallet connection, signature or
Sui transaction was requested or submitted. The page itself logged no
application errors; the recorded errors came from the browser's own extension.

Mobile visual checking is **unverified**: Chrome displayed an organization
policy blocking DevTools, and no attempt was made to bypass it. This record
does not claim an observed mobile viewport or a completed Season 2 wallet
transaction. Wallet testing continues in the owner's normal Slush browser.

## Owner's next actions

Connect Slush using the fixed owner ending `45c4`, run **Check start season 2**,
review the current transaction and fee, then approve **Start Season 2 in Slush**.
The 48-hour season begins at its confirmed on-chain execution. Follow the
same page to plant one Seed promptly for 0.01 SUI plus the network fee.
First watering opens 21 hours, 36 minutes after planting. The page verifies
when watering and the later reward claim become available.

The live Mysten skills README and `frontend-apps/SKILL.md`,
`frontend-apps/non-react.md`, `frontend-apps/transactions.md`,
`accessing-data/SKILL.md` and `accessing-data/graphql.md` were rechecked during
publication. The main Season 2 README records the broader implementation
guidance used before this deployment.
