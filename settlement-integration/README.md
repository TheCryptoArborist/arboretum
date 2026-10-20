# Settlement app integration review

This is the next draft after [PR #15](https://github.com/TheCryptoArborist/arboretum/pull/15) for [treegrow.xyz](https://www.treegrow.xyz/). It combines the app integration, a complete legacy Season 3 reconciliation, and the exact unsigned upgrade review. It does not activate the new protocol.

## Review behavior

The build produces an **Existing garden** route using the verified legacy deployment. **New seasons** remains unavailable because the actual upgrade package, new Registry, and new AdminCap do not exist yet. Those IDs must be taken from real confirmed deployment effects and type origins; a URL parameter, browser global, local-storage entry, or simulated package cannot configure the route.

Every generated review wallet refuses transaction submission before requesting a signature. Wallet connections and public Sui reads remain available. The review keeps the accepted Garden, Rewards, guide, and partner-accounting context while replacing the reward presentation with explicit states:

| State | What the review shows |
| --- | --- |
| Legacy Seed | Recorded GP and an amount under review; no retroactive entitlement is inferred |
| Before cutoff | An explicitly labeled current estimate, calculated per Seed in integer MIST |
| After cutoff | Fixed cutoff GP and the original eligible-GP denominator and pool |
| Verified zero | Zero-value processing, distinguished from a positive payment |
| Already processed | Processed status; payment amount remains unavailable without the matching receipt |
| Paid or processed with zero | A matching typed transaction receipt is required to establish the amount |
| Expired | The fixed deadline has passed; the original allocation is not shown as claimable |
| Failed or incomplete read | Unavailable; no fallback to a zero balance, zero GP, or an empty inventory |

New-season claims use the fixed cutoff and seven-day claim window. Later gameplay drought and gameplay pause do not rewrite that cutoff entitlement or extend its deadline. Current-Registry and archived claims share the permanent processed marker. Direct and archived positive/zero processing are verified against the exact event type, Registry, Seed, owner, season, eligible GP, and MIST amount.

New funding calls include the required Clock argument. Legacy call signatures remain separate. New types are anchored to the future package that first introduces the settlement module; they are not assigned the original legacy type origin.

## Current data access and preservation

The generated app uses the current Sui GraphQL and gRPC clients. Reward views pin the Registry, Clock, owned Seeds, and matching archives to one checkpoint. Every inventory is paginated to completion; duplicate identities, incomplete pages, and inconsistent fields fail explicitly. Observed payout totals are scoped to indexed receipts, with provider-history limits disclosed.

The existing Wallet Standard connection and transaction-confirmation adapter are retained. This bounded integration does not change the application's wallet framework. Original production HTML, wallet, Garden, SDK, Move sources, access gate, and calendar-reminder function are preserved and hashed by the review builder.

The public landing and public guide keep their accepted build output. New application assets remain behind the existing tester gate. Source code, reconciliation records, release bytes, and verification evidence are excluded from the website's published assets.

## Verified legacy Season 3

The [reconciliation report](legacy-reconciliation/README.md) is backed by a fixed checkpoint, individual cutoff reads for all 20 Seeds, 80 detailed transaction receipts, and an unbroken chain of 62 successful Registry mutations.

| Quantity at checkpoint 335949688, 2026-10-20 01:32:27.619 UTC | Verified value |
| --- | ---: |
| Remaining Season 3 pool | 209,720,000 MIST / **0.20972 SUI** |
| Recorded Growth Points | **2,498** |
| Season 3 Seeds | **20** |
| Owner addresses | **7** |
| Season 3 pool payouts | **0 MIST** |
| Sampled Seed GP | **188**, unchanged |

The exact cutoff was **2026-10-01 00:00:06.247 UTC**. The current and cutoff Seed records match. The previously reported 188-GP removal happened only in an unsigned simulation.

The historical report includes a concrete **unapproved allocation scenario** applying the proposed cutoff arithmetic: 10 Seeds / 1,848 GP qualify, 650 GP are excluded, and per-Seed integer rounding leaves six MIST. These figures are not approved compensation, an old-contract entitlement, or an available claim. No compensation transaction builder is included. The existing Season 2 archive and all legacy native inventory remain separately identified.

## Exact unsigned release review

The [release packet](release/README.md) contains the exact three-command upgrade: authorize, upgrade, commit. It passed a checked mainnet simulation against the current framework. Net simulated gas was **0.338028763 SUI**, an observation rather than a fixed fee or budget.

The simulation preserved every deployed legacy module byte and all 32 legacy type origins; the 39 new settlement type origins bind to the newly introduced package. Subsequent public reads found the capabilities and legacy Registry unchanged, and the simulated package absent on-chain.

The [setup helper](release/prepare-setup.mjs) requires a real confirmed upgrade first. It checks the exact reviewed transaction-kind hash and actual package bytes/type origins before producing the single unsigned call that creates an empty settlement Registry and its bound AdminCap. It neither starts a season nor imports legacy money, GP, or inventory.

## Build and verification

From the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-isolation=none --test-reporter=tap \
  settlement-integration/model.test.mjs \
  settlement-integration/reader.test.mjs \
  settlement-integration/wallet.test.mjs
node settlement-integration/build-review.mjs
```

The builder accepts local review, branch-deploy, and deploy-preview contexts and rejects production. It requires REVIEW_ONLY to stay true, emits the exact module import graph, checks every inline script, verifies source preservation, and records asset hashes in [verification/build.json](verification/build.json).

Validation includes **149 app tests** (22 model, 62 reader, 65 generated-wallet), **50 existing wallet-confirmation tests**, **19 release-input/packet tests**, and **14 legacy reconciliation tests**. Test fixtures never request a real wallet signature or submit a transaction. The [app test log](verification/model-wallet-reader.log) records all named cases. The new GitHub workflow rebuilds the candidate and stores its exact review distribution as an artifact.

The [offline browser review](verification/browser/README.md) passed **75 of 75 checks** at 1440px and 390px widths. Eight final screenshots were visually inspected. The exact compiled wallet connected a synthetic provider, displayed the legacy reward state, cleared stale results when a read failed, recovered after refresh, and kept New seasons unavailable. No signature, transaction, simulation, uncaught page exception, or missing compiled asset was observed. These checks use intercepted fixture reads and establish local UI behavior; authenticated Netlify access and real wallet execution remain unverified.

## Hosted preview and release boundary

The Netlify connector currently provides deployment inspection but no preview-build/upload operation. The attempted Netlify browser-control session timed out. A newly hosted integration preview has therefore not been verified by this package. The current production deploy remains **6abe81174b61a8e3dd53b333**; the previously accepted tester preview is a different, earlier build.

A preview deployment must run this builder and include the unchanged Netlify edge functions and calendar-reminder function. A static-only upload does not establish tester access control. Production publication, signing the real upgrade, creating and activating the new Registry, and deciding legacy compensation remain separate release actions.

Current implementation guidance was read from MystenLabs/skills at commit e31b38016723e2dcee36161d59c50e028e13b52a, including frontend-apps, accessing-data, ptbs, sui-publish, and installed version-matched SDK documentation. See the linked reconciliation and release reports for exact reference files and captured evidence.

