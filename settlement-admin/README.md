# Approved settlement upgrade administration

This isolated page implements the owner's approved Arboretum Sui mainnet version-11 to version-12 upgrade. The owner authorized proceeding after reviewing the [exact unsigned release](../settlement-integration/release/evidence/20261031-review/REVIEW.md). Wallet approval remains an explicit action in the owner's Slush extension.

The canonical route is **https://www.treegrow.xyz/admin/settlement-upgrade/**, behind the existing tester gate on the dedicated `arboretum-preview` Netlify project (`d425445d-4980-49be-8ab2-12e7527ba281`). The route will not initialize its wallet controller on another origin. The existing game review continues to disable gameplay transactions.

## Published handoff — October 30, 2026, America/Chicago

The page is deployed from source commit `c20c181b5651c1818aa02e1cccbd3058cdcac4d6` as Netlify deployment `6ae5576912763ca45cca5a76`, published at **2026-10-31 02:50:37 UTC / October 30, 9:50 p.m. CDT**. The [hosted verification record](verification/hosted-20261031.json) confirms all 15 raw deployed asset hashes, including the 11 accepted gameplay assets, the published file inventory, 13 public/access-denial checks, both edge functions, and the calendar function inventory. The original Netlify project remains unchanged.

All [28 focused core/controller checks](verification/local-checks-20261031.json) and [46 synthetic browser checks across 13 scenarios](verification/browser-review-20261031.json) passed. The [live GraphQL queries and browser CORS check](verification/live-query-check.json) passed, including the successful checked simulation at **0.337998763 SUI**. The two Settlement app integration CI runs passed. Five older preview workflows remain red on unchanged baseline/scope assertions; their exact causes and skipped deployment stages are recorded in [the CI triage](verification/ci-20261031.json).

The final [read-only mainnet observation](verification/final-chain-state-20261031.json), checkpoint **339991221** at **2026-10-31 02:55:22 UTC**, still records version 11 and the original reviewed UpgradeCap reference. **No real signature or upgrade transaction has been submitted by this work. The next action is the owner's explicit Slush approval through the deployed page.**

The existing tester password is a Netlify write-only secret. Its API value is masked and cannot authenticate, so a fresh authenticated browser login and calendar invocation were not repeated. No credential, session setting, or gate was changed or bypassed. The previous owner-confirmed tester session remains the accepted login checkpoint. Netlify generated a new calendar bundle digest; its source and runtime are unchanged, but this record does not claim byte-identical bundles or a new authenticated function-output test.

## Scope

The page reconstructs one exact reviewed transaction kind, with the following three commands:

1. `0x2::package::authorize_upgrade`
2. Upgrade the package with the reviewed `arboretum` and `settlement` module bytes.
3. `0x2::package::commit_upgrade`

The exact kind SHA-256 is `1b62257103c3a67c36607a7471180cee64159115274b774149282da1d7b443e0`. Its sender and upgrade-capability owner must be `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4`. It preserves compatible upgrade policy, every legacy module byte, and all 32 legacy type origins, while introducing 39 settlement types at the new package.

The route contains no setup, funding, claiming, season activation, compensation, or arbitrary transaction builder. The SDK leaves gas selection and budget to the wallet. A fresh simulation must estimate no more than 0.40 SUI; that review ceiling is not a transaction gas budget or a promised final fee. Any change in the displayed estimate requires the owner to acknowledge the new estimate before opening Slush.

## Owner flow

1. Enter the existing tester code at `/tester-access`, if needed. The login returns to the garden; reopen the administrator URL afterward.
2. Connect the Slush browser extension, explicitly select the required administrator account, and choose **Use selected account**.
3. Choose **Check upgrade readiness**. The page verifies fresh mainnet inputs and simulates the exact approved kind without requesting a signature.
4. Read the current fee, acknowledge the release, and choose **Review upgrade in Slush**. The page checks the chain and simulates again, then makes at most one wallet request with the explicitly selected account and mainnet network.
5. Approve in Slush. The page waits for inclusion and independently verifies the actual transaction bytes, digest, package/module bytes, type origins, capability ownership, and legacy administrator/Registry identities.
6. Retain the confirmed digest and package ID for the separately prepared empty Registry setup.

The page does not turn a simulation's package ID into deployment configuration. Only a verified real receipt can display **Version 12 is published**. A transaction digest alone is insufficient.

## Duplicate request and recovery behavior

An exclusive browser lock protects the request across tabs. Before wallet handoff, a local journal records the unresolved request; it contains public metadata only. Unknown wallet/network errors, a failed onchain transaction, unavailable storage, malformed journal data, or an unresolved request disable another submission. Reloading retains that block.

An explicit wallet rejection clears only the matching request without a returned digest, and requires a new readiness check. Other outcomes use the receipt verification form or a read of the current UpgradeCap. A still-version-11 capability does not by itself clear an uncertain submission. A version-12 capability disables another upgrade and triggers verification of its actual previous transaction.

## Implementation and verification

- `upgrade-core.mjs`: pure exact-byte, live-input, simulation-effect, and actual-receipt validation; no network or signer calls.
- `upgrade-constants.mjs`: immutable reviewed legacy/type inventory.
- `admin.mjs`: the isolated Slush connection, explicit account selection, readiness review, single wallet handoff, journal, and receipt flow.
- `build.mjs`: compiles the route and copies only the approved kind packet into published assets.
- `upgrade-core.test.mjs`: adversarial packet, network, identity, effects, gas, and real-receipt validation cases.
- `browser-review.py`: synthetic browser checks with intercepted network traffic; never broadcasts a transaction.

Runtime dependencies preserve the existing preview's locked packages. The new interface uses `@mysten/dapp-kit-core` 1.6.1 with the existing `@mysten/sui` 2.19.0, rather than upgrading the accepted game's SDK as part of this work. Built-in web Slush registration, automatic connection, and burner wallets are disabled; the owner selects the installed Slush provider explicitly.

```sh
node --test settlement-admin/*.test.mjs scripts/build-policy.test.mjs
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
python3 settlement-admin/browser-review.py
```

The browser review uses a runtime-owned Playwright install. Set `ARBORETUM_REVIEW_CHROMIUM` to an installed Chromium executable when Playwright's default browser is unavailable; the accepted run used Playwright 1.62.1 and Chromium 156.0.8078.4.

The full source build must retain both existing edge functions and `calendar-reminder`; a static-only deployment is insufficient. The published administrator assets contain the exact runtime kind packet, not the release evidence directory. No private keys, tester code, session secret, or provider tokens belong in source, build output, or verification records.

The local browser review uses synthetic wallets and controlled responses. It cannot establish the owner's real Slush approval or a live mainnet upgrade. Hosted route and artifact checks are recorded separately from onchain confirmation.
