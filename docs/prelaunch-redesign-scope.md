# Rewards-led prelaunch redesign — September 27, 2026

Implements the owner's approved landing-page direction in actual HTML and CSS, replacing the earlier understated preview. This is preview-only work on feature/prelaunch-gate / draft PR #5. It does not authorize or perform a production promotion, main merge or Season 1 contract activation.

## Content and authentic graphics

The hero and forest use existing repository assets. The garden image is a crop of the owner's real tester screenshot, not generated gameplay. Crop rectangle (51,137,823,436) from the supplied 832 x 691 screenshot yields 772 x 299 pixels; encoded AVIF SHA-256 is 15cbeb1b0ee0f8466e3e8202c71843bd63dbd793c9f8bd1040edcfc533c6a782. It is labeled as a historical tester snapshot, not current wallet or pool data. On narrow screens the screenshot can be horizontally scrolled without shrinking its card details or overflowing the page.

The supplied referral language is retained: Direct Plants — Earn 10%; Crate Buys — Earn 1%. These are conditional direct-referral activity rates, not returns on holdings. This marketing implementation does not independently refresh or change the on-chain referral economics. NFTree premium-crate privileges are explicitly planned for launch; no automatic victory, free-to-play, guaranteed-return or fixed public opening date claim is introduced. October 1 remains the owner's season-end testing plan.

The page uses three reasons to participate, the two referral cards, one real gameplay preview, three short daily-play explanations and expandable starting requirements. All headings, rates, buttons and disclosures are HTML, not lettering embedded in an image. Community calls to action are public; game and Player Guide retain tester access requirements.

## Scope and safety

The corrected native-form login Referrer-Policy remains same-origin; strict Origin/Fetch Metadata checks, signed cookies and secrets are unchanged. Only the exact new screenshot path is added to the public allowlist. Game HTML is preserved under game.html and wallet.js, garden.js and the SDK remain byte-identical. No changes to private contract types, prices, inventory, points, claims, balances or treasury actions.

Build protection still refuses an unapproved production deployment. The dedicated redesign workflow runs the retained gate suite, 13 new content/access assertions, TypeScript validation, the original build and production guard. Its optional preview-only upload uses a short-lived authorized Netlify proxy encrypted to a run-specific public key; no plaintext code or proxy URL belongs in source/artifacts. Hosted HTTP and native-browser results must be read before calling deployment verified.

Browser coverage: public pages with JavaScript enabled at desktop, tablet, mobile and small-mobile widths; actual native tester login, wrong-code retry, original game reload, Player Guide and logout with game JavaScript disabled. This prevents test sessions from invoking wallet/chain logic. These are not funded-wallet or full gameplay acceptance tests. Existing deployments and public blockchain calls remain outside this gate's protection.

Guidance read live: MystenLabs/skills README.md, frontend-apps/SKILL.md, frontend-apps/limitations.md; current Netlify edge-function coding context. No Sui SDK migration is part of this marketing change. Final deploy ID and successful test results are to be recorded separately after execution.
