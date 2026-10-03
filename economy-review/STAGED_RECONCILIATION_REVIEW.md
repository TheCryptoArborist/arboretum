# Reconciliation preview — staged, authenticated review pending

## Current checkpoint — October 3, 2026 UTC

The updated, gated review preview has been deployed successfully. It is ready for the owner's authenticated review, NOT yet approved for the Telegram tester group. Staging success is not tester-readiness approval or a production release.

- Preview: https://6ac0626c410eb1cc74e44602--arboretum-sui-forest.netlify.app/tester-access
- Deploy: `6ac0626c410eb1cc74e44602`; context `branch-deploy`; state `ready`; `published_at` is null.
- Isolated branch: `partner-reconciliation-preview-20261003`.
- Deployed source: `96845880a7ea75f345a515a1182eea14fd368f26`.
- Successful push workflow: https://github.com/TheCryptoArborist/arboretum/actions/runs/37088318876
- PR #12 remains a draft; nothing was merged into main.

## What this preview adds

The previous Partner Chest Revenue report is retained. Its BOOM and Victory cards include a collapsible Purchase reconciliation status section. Canonical token configuration and a shared journal remain unavailable; spending, token receipt and remainder fields deliberately remain Not configured / Not reconciled. This is a status overlay, not a functional purchase journal or completed reconciliation integration. It contains no purchase, signature or transaction controls.

The owner confirmed the OLDER Partner Chest Revenue preview and exported CSV/JSON on October 2. That closes the old owner-review checkpoint only, not authenticated checks of this updated deployment. The uploaded export recorded 0.0028 SUI treasury credit per observed 0.01-SUI BOOM/Victory test purchase. History remains partial, and test receipts do not create production budgets.

## Verified in this continuation

The source completed 195 Node tests and 13 Python staging-helper tests with no failures. Actual CI logs and archived sources were inspected; both new staging-helper source files match the locally tested bytes. The review build completed and preserved its protected wallet, garden, SDK, homepage and guide files while applying the additive admin overlay to game.html.

Artifact `11261675934` was downloaded and its SHA256 verified as `16c594912492fd5e8df6924936f087033907ad2b82597bf89dfd5431c50373b8`. The source SHA, build report, tests, staging record and eight HTTP/preservation checks were inspected. The eight checks passed: anonymous denial for game.html, wallet.js and both report modules; configured tester form present; invalid tester code rejected; public production pages unchanged; main unchanged.

The connected Netlify deployment reader independently confirmed the new deploy is an unpublished branch deployment with the existing calendar-reminder function and edge functions. Its calendar-reminder package digest matches the pinned production package. No function schedules were added.

Connected project reads immediately before capability delivery and after staging both confirmed production still uses deploy `6abe81174b61a8e3dd53b333`. The runner independently checked main remains `84b08fdb4bc0ec0417ced7be21f29aae914939f7` and hashes of the public homepage, player guide and tester entrance remain unchanged. This is not a fresh authenticated byte audit of the protected production game.

## Deployment recovery and boundaries

The original full hosted run `37080496100` expired waiting for an undelivered encrypted capability. The first stage-only run `37087876493` received and decrypted its capability but stopped before build submission because a site-metadata read was outside the deploy capability's permitted API scope. Official Netlify MCP source permits only build POSTs and deployment GETs. The corrected runner respects those limits; publication metadata is verified separately through the connected project reader. No permission bypass was attempted.

A fresh, source/run/attempt-bound encrypted deployment capability was delivered for the successful run. It contained no tester password. The consumed envelope was subsequently removed from the branch; private keys were ephemeral. Existing tester credentials and gate configuration were not reset or exposed. The original full hosted-review.py positive-login verification path was left unchanged.

## Still pending — do not mark tester-ready

Genuine login/logout with the existing tester code; authenticated delivery/integrity of the updated runtime modules; the owner's admin-wallet view of the new BOOM/Victory reconciliation sections; and the remaining relevant gameplay/wallet smoke checks. A local browser check attempted in this continuation was blocked by the execution environment before assertions; no new browser pass is claimed.

Owner path: open the new tester-access URL, enter the existing website tester code, connect the usual admin wallet, open Admin Console, load seasons, select a season, read receipts, and expand Purchase reconciliation under both partner cards. Expected fields stay Not configured / Not reconciled. Confirm the section can be opened and read, then confirm existing CSV/JSON exports still work. Do not use deposit, purchase, claim, archive, reset or start-season controls for this report check. Cancel any unexpected transaction-approval prompt.

No blockchain transactions, token purchases, treasury movements, season actions, production publication, Move updates or live price activation were performed. The preview still references Sui mainnet; ordinary game transactions are not free or risk-free merely because the website is a preview. The accounting report remains read-only.

## Guidance consulted

Current MystenLabs/skills README.md, frontend-apps/SKILL.md and frontend-apps/limitations.md; Netlify edge coding context, official branch ZIP-build documentation, and netlify/netlify-mcp src/tools/deploy-tools/deploy-site.ts plus netlify/edge-functions/proxy.ts. This continuation changed only review deployment/test/documentation files; it did not migrate the app's wallet or chain-data interfaces.
