# Reward-first website production release — September 29, 2026

The owner approved the working homepage and Player Guide on September 29 with: "That looks good. It's approved." This release publishes that approved presentation, not public gameplay.

## Published pages

- Homepage: https://treegrow.xyz/
- Public Player Guide: https://treegrow.xyz/player-guide
- Existing tester entrance: https://treegrow.xyz/tester-access
- Production deploy: `6abbe7b634a0e3e47818988a`
- Published: `2026-09-29T16:31:03.130Z`
- Verified context: `production`, state `ready`; Netlify get-project confirmed this deploy is current.
- Published application source: `b5b393bdd32c8b13617fe5cc55aee445477ddc61`.
- Previous production: `6ab9e6f36eda285b562f5b2f`, main baseline `781caf03d17bda0d4c618cdf486e1c77756d8e6a`.
- Owner-approved preview: deploy `6abbdf055fd66d9f0cd32cd6`, source `43d0b00b7f7dd72a4eb84723df3e33f78d9680fd`.

## Approved content and original artwork

Both pages lead with the season-end SUI reward and explain point share before purchases and tool instructions. Garden expansion and tool timing are presented as ways to create point opportunities, not guaranteed payout multiples or returns. The 1,000 SUI calculation is explicitly an example, not a live balance, committed funding or expected earnings. The season duration is described as planned; public opening, final prices and claim terms are not invented.

The original supplied Arboretum logo, guardian, garden screenshot, six Item Shop designs including Supply Drop, and the correct BOOM explosion and Victory horse-emblem chests are used directly. The original artwork was not AI-redrawn. All 20 guide tools and the handbook interaction script remain. The public Enter the Garden CTA remains removed; separate tester access stays. Eligible direct-referral descriptions remain 10% planting and 1% crate purchases.

## Production activation

The reward-first build now requires `ARBORETUM_REWARD_FIRST_APPROVED=true` for the production context. The owner's approval flag was set only in Netlify's production Builds scope. The existing prelaunch production approval remains. Production homepage and guide use index/follow metadata; the public guide remains in the sitemap and robots allow rules. Non-production previews remain noindex. No tester password or session signing secret was changed.

The new release workflow compares 18 production output paths against the exact approved hosted preview. All matched byte-for-byte after the intentional noindex-to-index metadata substitution on the homepage and guide; the styles, script and images were unchanged. No visual redesign was introduced during publication.

## Final measured verification

Final release workflow `36597821208`, job `109507178440`, completed successfully at source `b5b393bdd32c8b13617fe5cc55aee445477ddc61`.

- Baseline suite: 115 passed, zero failed.
- Candidate suite: 118 passed, zero failed.
- Production suite: 117 passed, zero failed, plus explicit production-approval, indexing, sitemap and protected-file hash assertions.
- These are overlapping suites, not 350 distinct tests. Historical release-specific assertions superseded by current-baseline equivalents are documented in the workflow; authentication checks were retained.
- TypeScript validation, Python compilation, full build pipeline and refusal without explicit production approval passed.
- 53 live HTTP/integration checks passed.
- 104 live reward-first browser assertions passed.
- 74 retained handbook/native-login browser assertions passed.

Coverage includes 1440/768/390/320px layouts, original assets, reward navigation, public guide aliases without cookies, search/filter/disclosures/deep links/print restoration, reading without JavaScript, correct and incorrect native form login, foreign-Origin rejection, private reference access and logout. Main, www and default Netlify domains were checked for approved homepage content and rejection of private scripts without a session. Production homepage desktop/mobile, guide mobile and Item Shop desktop screenshots were visually inspected after download.

Current production and approved preview private responses were compared before publication. After publication, the game HTML, wallet.js, garden.js, sui-sdk.bundle.js, tester-guide.html and guide/guide.css responses matched the previous production bodies exactly. Source-boundary checks additionally confirm the original game, wallet/SDK, Move, calendar and handbook source files were not changed.

## Pre-publication guard correction

The first release attempt, workflow `36597099559`, stopped before publication when a raw generated game HTML comparison did not match Netlify's served representation. Inspection identified hosted link normalization and HTML attribute rendering, also present in the already-approved preview. The final check compares current and approved hosted private responses, keeps source and build-hash guards, and requires exact previous-production private response bytes after release. This was not a gameplay change or an acceptance of arbitrary differences. The final release passed without recovery or rollback.

## Evidence and cleanup

Downloaded artifact `11048036344`, `arboretum-reward-first-production`, SHA-256:

`6d3a9e2425b5d6f904a7040a80beb832346c84f2132648f44e8498d72f61c068`

The artifact reports and checksum were checked locally. Text artifacts were scanned for the real tester code, deployment capability and private keys; no matches were found. The run-bound encrypted capability was consumed and its ciphertext file removed from the branch after completion. Plaintext credentials were not committed or placed in browser assets.

## Scope and remaining boundaries

Website publication only. No wallet connection or signing, blockchain transaction, Move publication, testing-price activation, inventory reset, Growth Point change, reward claim or treasury action. Authenticated browser checks disabled gameplay JavaScript; this is not certification of gameplay or October 1 season-ending administration. The separate Season 1 contract branches are not included. Historical deployment URLs and public blockchain entry points are not retroactively made private by the website gate.

Live guidance used during this release: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; Netlify edge-function coding context and official createSiteBuild ZIP/production semantics.
