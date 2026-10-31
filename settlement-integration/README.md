# Settlement app integration review

This is the next draft after [PR #15](https://github.com/TheCryptoArborist/arboretum/pull/15) for [treegrow.xyz](https://www.treegrow.xyz/). It combines the app integration, a complete legacy Season 3 reconciliation, and the exact unsigned upgrade review. It does not activate the new protocol.

## Current handoff — October 30, 2026, America/Chicago

The accepted preview is now **[www.treegrow.xyz/tester-access](https://www.treegrow.xyz/tester-access)**,
on the dedicated preview project. The accepted gameplay checkpoint was
deployment `6ae53e7c96ded9882ad844c8`; the administrator page is now deployed as
`6ae55e069ac28a1658ed0d65` from source `5abbe0930fd61639c37addd7a7a745b57a12db32`,
with all 15 application assets from the initial administrator release unchanged,
including the 11 accepted gameplay assets. The owner
confirmed successful Slush connection, the selected wallet address, and correct
loading of the existing garden, NFTree holdings, and season information. See
the [current domain handoff](../docs/dedicated-preview-domain.md).

The **[current unsigned upgrade review](release/evidence/20261031-review/REVIEW.md)**
contains refreshed public inputs, the exact three-command version-12 upgrade,
wallet-ready SDK JSON, and a successful checked simulation with estimated net
gas of **0.337998763 SUI**. The live contract and Registry remain unchanged.
The owner has authorized proceeding with this exact upgrade. The deployed isolated
**[administrator signing route](../settlement-admin/README.md)** adds explicit
Slush approval and actual receipt verification at
`https://www.treegrow.xyz/admin/settlement-upgrade/`. Gameplay transaction
submission remains disabled. The empty Registry setup is a later step that
requires the real confirmed upgrade digest. The final mainnet check at checkpoint
339991221 still records version 11; no real signature or upgrade has been submitted.
The [administrator handoff](../settlement-admin/README.md) records the passing
28 upgrade unit checks, 46 synthetic upgrade browser checks, 10 return-routing tests,
20 native return-regression checks, 12 live native-browser checks, 15 deployed asset hashes, both successful
exact-source Settlement CI runs, and 21 passing authenticated hosted checks.
Open **[the upgrade tester entrance](https://www.treegrow.xyz/tester-access?next=settlement-upgrade)**
and choose **Continue to upgrade review**. The corrected gate preserves that
destination through login and a wrong-code retry. The earlier masked-secret
authentication limitation is historical; the existing tester code has now been verified.

The October 29 Netlify-hostname warning/deployment sections below are preserved
historical observations. Their statements about paused testing and the old
current hostname do not supersede the later accepted www-domain checkpoint.

## Historical preview security review and deployed correction — October 29

**The mint-helper and wallet-selection corrections are deployed and verified. Slush still displays a malicious-site warning on the current preview.** Source commit `a3096b4f4e0d6b357949505f706b4afe88f85009` is live at [the current tester entrance](https://6ae37c04102ccbfac41d20b4--arboretum-sui-forest.netlify.app/tester-access). The deployment completed on October 29, 2026 at 12:02 p.m. America/Chicago (17:02 UTC). Production remains unchanged. The current build includes both the earlier mint-helper correction and the October 29 wallet-selection follow-up below.

The earlier screenshot identified a **Slush wallet** warning over the October 20 preview in Brave. A new user screenshot supplied on October 29 shows the same warning on the current preview at `https://6ae37c04102ccbfac41d20b4--arboretum-sui-forest.netlify.app/game.html`: “Malicious website” and “This site has been flagged for malicious behavior.” The complete visible Alert ID is **`6e50192e-9671-4050-8a8c-6461c2a62980`**. The screenshot shows Brave, a Slush window, and the review banner indicating transactions are disabled. Its capture timestamp and the installed extension version are not visible.

The [October 29 Slush warning observation](verification/hosted/slush-warning-20261029.json) records this user-provided screenshot evidence separately from the earlier functional and source-provenance checks. It does not establish account approval, a signature, a transaction, or submission of scan feedback. The classification trigger remains unknown; no Slush clearance or false-positive determination has been received. The user authorized the support request and screenshot, and the form's Submit button was clicked once on October 29. Slush initially required email verification and stated that the request would submit automatically afterward. **The user reports completing that verification on October 29; the request is awaiting ticket acknowledgement or a support response.** A subsequent browser check showed the public Slush help homepage without a ticket confirmation. Email verification and backend ticket creation have not been independently confirmed; no ticket number or provider diagnosis is available. No additional submission was attempted. Testing beyond the warning remains paused.

The [October 29 causal investigation](verification/hosted/slush-diagnostic-20261029.md) compares the accepted tester checkpoint with the first recorded flagged build and examines the current official Slush extension. The mint helper and wallet fallback defects predated the warning. The new emitted settlement build and a new preview origin remain material changes. Current Slush code requests a remote security verdict during fresh connection approval, but the exact classification rule and onset remain unknown.

The investigation found a separate review-build gap: the original NFTree mint action can load an external wallet helper and call it directly, outside the generated Arboretum wallet's submission guard. Reconstructing `game.html` from the October 20 deployed source produced SHA-256 `4db760c6bb5500a17f6d1a6ba0c702367894bd9d706000ad3d7952e72c236e78`, matching the [October 20 authenticated artifact record](verification/hosted/netlify-preview-20261020.json), and confirmed that this path survives in that old deployment. This is not evidence that the helper is malicious or caused the warning.

The follow-up change disables that mint action in the review-only HTML transform and removes its external loader. A regression invokes the generated action with a mock connected wallet and checks that no helper, network, or wallet call occurs. Original production source is preserved.

**Historical mint-helper verification:** the October 26 build's `game.html` had SHA-256 `c89fd7de0f7e0aee642d3e64b6bc177e29c058a9e11065e02e4ea258c274a5c0`, matching its reviewed source. The [October 26 record](verification/hosted/netlify-preview-20261026.json) preserves that evidence. The current October 29 build retains the absent external helper URL, loader, and helper calls, and the review-only action guard remains present. Its updated game and wallet hashes are recorded below. This establishes the code corrections; it does not establish the cause or resolution of the Slush warning. No production deployment, real signature, or blockchain transaction is part of these changes.

## Wallet selection correction — October 29, 2026

The earlier review could silently select a different wallet when the registry order changed or a requested wallet disappeared. Saved-session restoration could also substitute another available account for the saved account. These cases were reproduced with synthetic Wallet Standard providers; they are not established as the cause of the Slush warning.

The review transforms now require the selected wallet and account to remain available:

- The picker retains the provider represented by each displayed card instead of resolving its index against a later registry list.
- Explicit selection rejects a missing or ambiguous wallet, including a different provider replacing the displayed provider under the same name. It never falls back to another extension.
- Missing, invalid, and stale picker choices require a fresh selection instead of automatic wallet selection.
- Saved sessions restore only the uniquely named saved wallet and its exact saved account. An absent saved account leaves the application disconnected.
- Automatic selection remains available when it is explicitly requested without a particular wallet choice.

The regression tests exercise the generated review wallet and generated picker functions with synthetic providers, including registry reordering, provider replacement, removed accounts, and valid reconnection. Original production inputs, NFTree access requirements, and the review transaction guard remain unchanged.

**Local verification:** all 94 named generated-wallet tests pass, including 26 new selection/restoration regressions, with zero failures or skips. A fresh review build passes its source-preservation, module, and inline-script checks. Independent code review also reproduced and verified the same-name replacement fix. No real wallet, signature, or transaction was used for these checks.

**CI verification:** all eight GitHub workflow runs passed for source commit `a3096b4f4e0d6b357949505f706b4afe88f85009`, including the [complete settlement integration review](https://github.com/TheCryptoArborist/arboretum/actions/runs/40912478480).

**Deployment status:** this follow-up is deployed as protected branch preview `6ae37c04102ccbfac41d20b4`. The [October 29 hosted verification record](verification/hosted/netlify-preview-20261029.json) verifies its source ZIP, deployed asset bytes, inventory, and access controls. The deployed `game.html` SHA-256 is `9394c623eff8b4d9cf23941a861a0a2b2d27477672b3144592a97968b7ff88fa`; the deployed `wallet.js` SHA-256 is `6e8f7a6a52cb8a85efa47e8285a50849db4fe09864bde2dba9f88e0469c6d2b3`. The subsequent user screenshot confirms the Slush warning on this deployment. An approved hosted wallet session and Slush clearance remain unverified; testing beyond the warning is paused.

## Review behavior

The build produces an **Existing garden** route using the verified legacy deployment. **New seasons** remains unavailable because the actual upgrade package, new Registry, and new AdminCap do not exist yet. Those IDs must be taken from real confirmed deployment effects and type origins; a URL parameter, browser global, local-storage entry, or simulated package cannot configure the route.

Every generated gameplay review wallet refuses transaction submission before requesting a signature. The separately approved administrator route accepts only the exact reviewed upgrade. Wallet connections and public Sui reads remain available. The gameplay review keeps the accepted Garden, Rewards, guide, and partner-accounting context while replacing the reward presentation with explicit states:

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

The existing Wallet Standard framework and transaction-confirmation adapter are retained; the review transforms add strict wallet selection and account restoration. Original production HTML, wallet, Garden, SDK, Move sources, access gate, and calendar-reminder function are preserved and hashed by the review builder.

The public landing and public guide keep their accepted build output. New application assets remain behind the existing tester gate. Source code, reconciliation records, and verification evidence are excluded from the website's published assets. The isolated administrator route includes one exact approved transaction-kind packet as a protected runtime asset.

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

The builder accepts local review, branch-deploy, and deploy-preview contexts. Production context is allowed only for the exact dedicated preview project with `NETLIFY=true`; it remains rejected on the original or unknown projects. It requires REVIEW_ONLY to stay true, emits the exact module import graph, checks every inline script, verifies source preservation, and records gameplay and isolated administrator asset hashes in [verification/build.json](verification/build.json).

The exact `feature/settlement-app-integration-20261020` branch context in `netlify.toml` selects this builder and Node 24. The default production build command is unchanged. The existing `dist` publish directory and `netlify/functions` directory still apply; both edge functions retain their inline route declarations. A branch context selects build configuration but does not itself enable Netlify branch deployments.

The original integration validation records **149 app tests** (22 model, 62 reader, 65 generated-wallet), **50 existing wallet-confirmation tests**, **19 release-input/packet tests**, and **14 legacy reconciliation tests**. The earlier mint-helper correction added three focused mint-path regression cases. All eight CI runs passed for that October 26 deployment's source at `9d8514ffb86c591c80faa51db84de4f798810468`, including its [complete settlement integration review](https://github.com/TheCryptoArborist/arboretum/actions/runs/40006219263). The October 29 follow-up adds 26 wallet-selection/restoration regressions, bringing the named generated-wallet tests to 94; all eight CI runs for the current source passed as linked above. Test fixtures never request a real wallet signature or submit a transaction. The original [app test log](verification/model-wallet-reader.log) remains historical evidence; the GitHub workflow rebuilds each candidate and stores its exact review distribution as an artifact.

The [offline browser review](verification/browser/README.md) passed **75 of 75 checks** at 1440px and 390px widths. Eight final screenshots were visually inspected. The exact compiled wallet connected a synthetic provider, displayed the legacy reward state, cleared stale results when a read failed, recovered after refresh, and kept New seasons unavailable. No signature, transaction, simulation, uncaught page exception, or missing compiled asset was observed. These checks use intercepted fixture reads and establish local UI behavior. Hosted HTTP and artifact verification is recorded below; that verification did not perform a genuine tester login or hosted wallet interaction. The later user screenshot records the Slush warning, without establishing an approved wallet session or gameplay beyond it.

## Hosted preview and release boundary

**Current protected deployment:** [Tester access](https://6ae37c04102ccbfac41d20b4--arboretum-sui-forest.netlify.app/tester-access).

The exact corrected source at commit **a3096b4f4e0d6b357949505f706b4afe88f85009** was deployed as Netlify branch deploy **6ae37c04102ccbfac41d20b4**, build **6ae37c04102ccbfac41d20b2**. Netlify reports the build ready at **2026-10-29T17:02:17.128Z**, the explicit `feature/settlement-app-integration-20261020` branch, `branch-deploy` context, and no production publication timestamp. The production deploy remains **6abe81174b61a8e3dd53b333**.

The [current hosted verification record](verification/hosted/netlify-preview-20261029.json) records:

- **30/30 public and anonymous-access checks passed** on the exact immutable preview host. The native tester form is configured; game and settlement assets are gated; HTML game navigation redirects to tester access; the public homepage and handbook retain their reviewed hashes.
- **All 11 critical emitted files plus `netlify.toml` match their reviewed SHA-256 hashes**, including the corrected game, transformed wallet, settlement SDK, panel, configuration, model, and reader. These bytes were read through Netlify's authorized per-deploy file API without a tester cookie or password. The corrected game has no external NFTree mint helper.
- All 85 deployed inventory records are accounted for: 81 review distribution files, the exact committed Netlify configuration, and three Netlify-generated internal edge artifacts. The inventory lists `backgroundA.jpg` with lowercase casing; its bytes match. All ten listed exclusions are absent, including the disabled settlement wallet and internal source/evidence files.
- The two deployed edge functions are `tester-gate` and `public-player-guide`. The only serverless function is `calendar-reminder`; no function schedules are deployed.
- The downloaded source ZIP matches the exact submitted Git archive: SHA-256 `7701d71e52abdba828f79c69e7c8dc8014c98c7e25154bbf8c8dd81395215b81`, 30,626,605 bytes. No signatures or blockchain transactions were requested.

The immutable URL above is retained as deployment evidence. Netlify's generated branch alias has a 65-character first hostname label and did not resolve through the network during the previous verification. The alias was not rechecked in this run; the new immutable deploy URL passed all checks.

A genuine tester login and interactive hosted wallet/gameplay checks were not exercised by the functional/provenance verification. The protected asset bytes were independently verified through Netlify's authorized admin API, and the existing offline browser review remains the local visual/UI evidence. The [subsequent Slush warning record](verification/hosted/slush-warning-20261029.json) documents the user's warning on this exact hosted build. The earlier Netlify verification record remains unchanged as evidence of its own checks and limits. Slush clearance remains unresolved, testing beyond the warning is paused, and New seasons remains unavailable.

The [October 20 verification record](verification/hosted/netlify-preview-20261020.json) remains historical evidence for deploy `6ad6eb2abca3f4d4579e6522` and source `1dc540414d0e4060343ee68a005cecb16e404991`. Those checks did not exercise the independent NFTree mint path, and that old immutable deploy still contains the original build. Use the current tester entrance above for the corrected preview. The follow-up documentation/evidence commit does not change the deployed source.

The [October 26 verification record](verification/hosted/netlify-preview-20261026.json) remains historical evidence for deploy `6adea7f6c988a798a41ea3e2`, build `6adea7f6c988a798a41ea3e0`, and source `9d8514ffb86c591c80faa51db84de4f798810468`. That immutable build contains the mint-helper correction but predates the October 29 wallet-selection and account-restoration correction. Its original asset and source ZIP hashes remain in that record.

Production publication, signing the real upgrade, creating and activating the new Registry, and deciding legacy compensation remain separate release actions.

Current implementation guidance was read from MystenLabs/skills at commit e31b38016723e2dcee36161d59c50e028e13b52a, including frontend-apps, accessing-data, ptbs, sui-publish, and installed version-matched SDK documentation. See the linked reconciliation and release reports for exact reference files and captured evidence.

