# Arboretum prelaunch homepage — production release

## Released scope

The owner confirmed the tester code worked and authorized the next publishing step on September 28, 2026 at 01:03:37 UTC. This approves the website introduction and tester gate, not public gameplay, a Season 1 contract cutover, a season reset or treasury activity.

The approved rewards-led homepage is now published at https://treegrow.xyz/.
Tester entrance: https://treegrow.xyz/tester-access. The existing tester code is unchanged and is intentionally not recorded in this public document.

Netlify production deploy: `6ab9bfabfb745b0ff61e07f6`.
Published at: `2026-09-28T01:15:43.942Z`.
Site ID: `a344fb31-10b4-4eea-9562-067d90a39607`.
Previous production deploy: `6aa4e0bdc5c59a631ddc1db9`.
Release execution source: `8cb09994a3efc662e613f6837b6c4358bdfb81e5`.
Approved application revision: `51c3a571fb340fbd6b32b0c1dde47673280244c1`.

The release script verified that application files still matched the approved revision, and that original game HTML, wallet/Garden/SDK code, calendar function source and Move source matched the prior production baseline. Only production-specific indexability and server-side environment configuration differ from the reviewed preview. The public landing shows the 10% direct-plant and 1% direct-crate referral descriptions supplied by the owner, the actual garden graphic and clearly planned NFTree holder privileges. It has no wallet or transaction scripts.

## Completed evidence

GitHub Actions run `36365107973` completed successfully, including:
- 47 retained access-control tests and 13 page/content tests: 60 passed, 0 failed.
- TypeScript validation and production-mode build.
- 32 production HTTP/acceptance checks, all passed.
- 65 hosted Chromium assertions across desktop, tablet and mobile layouts, all passed.

Production checks confirmed: public landing and referral cards; indexable marketing metadata and sitemap; blocked anonymous game, guide and script requests; retained native-form Origin behavior; rejection of a wrong code; successful login with the existing code; byte-identical original game HTML and wallet/Garden/SDK responses; unchanged protected guide; authenticated calendar download; logout and denial afterward. Default Netlify-host and www.treegrow.xyz aliases were also checked for the marketing page and denied private-script access.

Browser checks covered the real native login form, incorrect-code retry, authenticated reload, guide access and logout. Authenticated game JavaScript was intentionally disabled in these browser sessions, so no user wallet was connected, no blockchain transaction was signed, and this is not a full wallet or October 1 administration test. The user's successful tester access is additional owner acceptance, not evidence of completed Season 1 security work.

Downloaded artifact `10947456340`:
`Arboretum_Prelaunch_Production_Verification_2026-09-28.zip`
SHA-256: `ba9f25dec3ae48a8f94adb111d6bcca1a227b4246cf24ca5f7fc3ebed88799fe`.
The downloaded archive digest, JSON reports and test totals were checked locally. Plaintext tester credentials and the production signing secret were absent from the report files. Screenshots were preserved.

## Configuration and rollback

Production-only Functions-scope tester credentials were configured; a separate production signing secret is used. The existing preview context was not replaced. The production build approval flag was set in Builds scope. Secrets are not in source or browser assets. The encrypted, run-specific deployment handoff was consumed and removed from the branch.

A rollback source archive of baseline `2338affe1dd984f5bc676cec7f3763d1f37a90cf` was prepared before publication. No rollback was needed. The guarded release workflow requires an explicit release marker and the old expected main baseline, so it is not a standing automatically authorized publishing job.

## Boundaries that remain

This is a public introduction with invited-tester website access. The live game's contract targets, testing prices, Seeds, tools, Growth Points, claims and treasury behavior are unchanged. The separate Season 1 contract PRs are not part of this release. October 1 remains the owner's season-ending test plan, not a public gameplay launch date.

The current website gate does not retroactively protect historical deployment permalinks or copies of public source, and it cannot restrict public blockchain calls or fix the known live timing concern. No historical deployments or existing claim rights were deleted. The new contract's snapshots/claims, safe transition and real-wallet acceptance remain separate release work.

Existing referral attribution is still handled by the original game code; this website publication displays the approved referral descriptions but does not implement a new referral signup or change referral accounting. No new referral campaign link-generation flow was certified during this release.

## Current guidance

Consulted live: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; docs.sui.io/skills; Netlify edge-function coding context; official Netlify createSiteBuild production semantics and Functions-scope environment-variable deployment guidance. Authentication remains server-side and no Sui SDK migration was introduced for this website release.
