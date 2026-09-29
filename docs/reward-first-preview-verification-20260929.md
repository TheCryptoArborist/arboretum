# Reward-first website preview — verified September 29, 2026

## Review links and release boundary

Homepage: https://reward-first-preview-20260929--arboretum-sui-forest.netlify.app
Player Guide: https://reward-first-preview-20260929--arboretum-sui-forest.netlify.app/player-guide

Netlify deployment `6abbdf055fd66d9f0cd32cd6` is ready in `branch-deploy` context, branch `reward-first-preview-20260929`, with `published_at: null`. Source is `43d0b00b7f7dd72a4eb84723df3e33f78d9680fd`. Later commits remove the consumed encrypted handoff and record this evidence; they do not alter the deployed application.

Production was not changed. Netlify get-project still reports `6ab9e6f36eda285b562f5b2f` as the current production deployment. GitHub main remains `781caf03d17bda0d4c618cdf486e1c77756d8e6a`. The hosted verification compared both live public page responses before and after the preview and confirmed exact equality. PR10 remains a draft for owner review; do not merge or promote. The candidate build refuses production context.

## What the owner is reviewing

The homepage leads with "Grow more than a garden. Compete for SUI." and explains the season-end SUI reward before purchasing and tools. The public handbook follows the same order: reward, point-building choices, starting requirements, then the detailed gameplay chapters. The full 20-tool directory, filters, disclosures and original handbook interaction script are retained.

The reward example is explicitly hypothetical: a 1,000 SUI distributable pool with example point shares of 1%, 2% and 5% produces gross rewards of 10, 20 and 50 SUI. These are not a live balance, committed launch funding, expected player shares, profit estimates or guarantees. A planned 30-day season is labeled as planned. Public opening is to be announced; final launch prices, dates and claim terms are not fabricated. More maintained Seeds and useful tool timing are connected to point-building opportunities, not a guaranteed payout multiple.

The correct original logo, guardian, garden screenshot, Seedling/Grove/Canopy/Ancient/Mythic/Supply Drop artwork and BOOM/Victory chest artwork are used directly. BOOM carries the original gold $BOOM explosion; Victory carries the original blue/purple horse emblem. The supplied 1254x1254 logo and the repository logo have identical decoded RGB pixels; their PNG byte hashes differ because of encoding/alpha representation. No artwork was AI-redrawn.

The 10% eligible direct-plant and 1% eligible direct-crate referral descriptions remain. The public Enter the Garden CTA stays removed. There are no public checkout controls or temporary testing-price offers. Website tester access remains available separately with the same code.

## Completed verification

Final GitHub Actions run `36593183820` completed all job steps successfully:

- Baseline suite: 115 tests passed, 0 failed.
- Reward-first candidate suite: 118 tests passed, 0 failed.
- These suites overlap; 233 is not a count of unique tests.
- Python compilation, TypeScript validation, complete original builds and production-refusal guard passed.
- 38 hosted HTTP/integration checks passed, including anonymous pages, exact artwork bytes, private-route denial, login/logout, original protected response bytes, and unchanged production/main.
- 104 reward-first Chromium assertions passed across 1440, 768, 390 and 320 pixel widths.
- 74 retained public-handbook/native-login Chromium assertions passed.
- Guide scripts run during guide tests; authenticated gameplay checks use a JavaScript-disabled context. No wallet was connected and no blockchain transaction was submitted.

The browser checks cover reward CTA navigation, public reading without cookies, clear example labeling, six original shop designs plus two partner chests, all images loaded, overflow checks, guide reward ordering, tool filtering, no-results behavior, tool deep links, print-state restoration, native login/retry, protected tester-reference access, logout and continued public-guide availability after logout.

Final hosted desktop, mobile, shop, reward-panel and guide screenshots were inspected. A mobile headline line-break issue discovered during visual review after an earlier passing run was fixed before this final deployment. Earlier failed handoff/readiness checks are not represented as successful. The website Content Security Policy was not relaxed to fix the browser-test readiness routine.

## Preserved scope

Original game HTML, wallet.js, garden.js, Sui SDK bundle and private tester reference match the prior production responses. The guide interaction script is preserved. Only one exact public artwork URL, `/prelaunch/supply-drop.jpg`, is added to the existing gate allowlist; authentication/session logic and public-guide dispatch are unchanged. No wildcard private-resource access was added.

No Move publication, economic setting, price activation, inventory transition, Growth Point modification, claim, treasury action or season-ending administration occurred. October 1 testing and the isolated Season 1 contract changes remain separate. Existing historical deployment links and public blockchain entry points are not retroactively protected by this preview.

## Evidence integrity and references

Artifact `11044818048` from final run was downloaded and SHA-256 verified: `522739878fe5e9bc6401d841b7ae908c3fba9dfc815af9de6d0ddac94addb305`. Reports confirm all stated check counts. A scan of 24 text artifact files found no actual tester code, private key or Netlify deployment capability. The run-bound encrypted handoff was removed from the branch after use.

Live guidance consulted for the resumed work: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; Netlify edge-function coding context and official edge declaration documentation. Local in-memory layout renders were supplementary only; the checks reported above ran against the hosted branch preview.
