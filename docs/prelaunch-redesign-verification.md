# Prelaunch redesign — verified September 27, 2026

## Working preview

https://prelaunch-preview-20260926--arboretum-sui-forest.netlify.app

The redesigned homepage is deployed, not merely an image mockup. Netlify deploy `6ab9857f6eda28dac92f5b18` is ready with context `branch-deploy`, an edge function present, and `published_at: null`. The public production address was not switched.

Application commit: `b57a2852bb33b191d447b8986574d2f866d15eae`, branch `feature/prelaunch-gate`, existing draft PR #5. Later commits only remove the consumed encrypted deployment envelope and record verification.

## What changed

- Real HTML headline: Plant. Grow. Compete for the SUI Growth Pool.
- Original repository TREE hero, forest and logo rather than invented game assets.
- Three concise participation benefits: SUI competition, direct referrals and clearly labeled planned NFTree holder privileges.
- Prominent supplied referral cards: Direct Plants — Earn 10%; Crate Buys — Earn 1%, each with its qualifying activity description.
- One crop of the owner's actual garden screenshot, labeled as a past tester session. Small screens can scroll the crop horizontally without shrinking the cards to illegibility or overflowing the document.
- Working section navigation, tester entrance, protected Player Guide destination, public Telegram calls to action and expandable starting requirements. No wallet code or transaction script loads on the public homepage.

Referral percentages are the user's supplied marketing terms for eligible activity, not a new independent audit or change to live payment calculations. No testing prices, fixed public launch date, free-to-play or guaranteed-profit claims were introduced.

## Completed checks

Push workflow `36350352108` completed successfully, including deployment and hosted tests. The corresponding PR redesign workflow `36350355062`, Player Guide workflow `36350355068`, and retained prelaunch workflow `36350355072` also completed successfully for the application commit.

The downloaded artifact records:
- 47 retained gate tests passed, zero failed.
- 13 new content and access tests passed, zero failed.
- TypeScript validation, original build and production-build guard passed.
- 21 hosted HTTP checks passed, including public content, crop hash, private-route rejection, same access code, authentication, logout and unchanged game-script hashes.
- 65 hosted Chromium browser assertions passed across desktop 1440px, tablet 768px, mobile 390px and small-mobile 320px. Public renders had no missing images, horizontal page overflow or JavaScript errors. Native-form login, wrong-code retry, authenticated reload, Player Guide and logout passed at desktop and mobile sizes.

Authenticated browser sessions intentionally disabled game JavaScript so that no wallet or on-chain logic ran. This is website/access verification, not full gameplay, real-wallet or security-audit certification. Calendar subscriptions and October 1 admin transactions were not exercised.

Evidence artifact `10941858135` SHA-256: `628d1bb129c7f16b08a9f511a8dbafc4b893bdea8376398fdf78b2dca24b33a0`. Downloaded source files match their recorded hashes. Hosted screenshots and reports were inspected. The access code and temporary deployment capability do not appear in the evidence.

The gate differs from the corrected baseline only by its exact new public screenshot path. Removing that allowlist entry reproduces baseline blob `1b64ab97d121098c272abdd58a55cbfafff36de4`. Strict native-login Origin validation and the same-origin form Referrer-Policy are retained; the existing access code is unchanged.

## Production and game unchanged

After deployment, GitHub main still returned `2338affe1dd984f5bc676cec7f3763d1f37a90cf`; Netlify's project reader still identified production deploy `6aa4e0bdc5c59a631ddc1db9`. No main merge, production promotion, contract target change, pricing activation, inventory reset, point adjustment, reward claim or treasury transaction occurred. October 1 remains the owner's separate season-ending test plan.

Historic deployment URLs and public on-chain entry points are not retroactively protected by this webpage. Production promotion still requires owner review and the remaining access/acceptance checks.

Technical references checked live for this implementation: MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; current Netlify edge-function coding context. Secrets remain server-side and existing Sui wallet integration was not migrated as part of the marketing redesign.
