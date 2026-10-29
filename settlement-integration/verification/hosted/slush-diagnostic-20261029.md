# Slush warning: change history and classification mechanism

Investigation date: **October 29, 2026, America/Chicago**. Status: **cause unresolved; support request pending email verification**.

## Principal finding

The investigation now identifies a concrete reason that earlier successful testing and a later warning can coexist: the inspected Slush extension distinguishes an existing connection to one origin from a fresh connection to a different preview origin. Fresh connection approval requests a remote security assessment. In this inspected version, the blocking warning screen is driven by an issue returned by that assessment. This mechanism is consistent with the user's screenshot, but the user's installed version is not established.

This explains a possible mechanism, **not this alert's proven cause**. The preview's application build also changed. Neither the current extension nor the recorded screenshots exposes the classification rule, first-flag time, classifier inputs, or affected scope. The installed Slush version during the user's earlier tests is unknown.

The two subsequent code corrections addressed legitimate review defects, but both defects existed in the earlier accepted build. Their correction has not cleared the warning. They should not be described as a diagnosis of its onset.

## Recovered baseline and timing

The [October 19 gameplay record](https://github.com/TheCryptoArborist/arboretum/blob/bff42fba07f21aefb9d004d5ea4b7c5eceb0e2ba/gameplay-verification/README.md) records the owner's statement that the tester had already used the preview and was ready to proceed. It identifies accepted checkpoint **`bea71961a1ec9c1b0fec63535c90c6eb941a8c03`**, PR #12, and preview **`6ac0807da3e616e086ee118c`**.

This is a user-accepted testing baseline, not an instrumented last-successful Slush session. It establishes that Netlify preview hosting was already used; merely using `netlify.app` is not a newly introduced condition.

| Evidence | Established timing and limit |
|---|---|
| Earlier accepted preview | Source and URL are recorded; exact last successful Slush action, extension version, and time are not. |
| First recorded flagged build | Source `1dc540414d0e4060343ee68a005cecb16e404991`, deploy `6ad6eb2abca3f4d4579e6522`. Source upload began October 19 at 11:16 p.m. Chicago time, October 20 UTC. |
| Earlier warning screenshot | Supplied October 23; this is not proof that the warning first began that day. |
| Corrected current preview | Source `a3096b4f4e0d6b357949505f706b4afe88f85009`, deploy `6ae37c04102ccbfac41d20b4`, ready October 29 at 12:02 p.m. Chicago time. The later user screenshot still shows the warning. |

Current complete Alert ID: **`6e50192e-9671-4050-8a8c-6461c2a62980`**. The [warning observation](https://github.com/TheCryptoArborist/arboretum/blob/6b078c2dbf6b2eccda411935c6dc017fcdae3bf1/settlement-integration/verification/hosted/slush-warning-20261029.json) records the screenshot's limits. Historical deployment evidence remains separate: [October 20](https://github.com/TheCryptoArborist/arboretum/blob/6b078c2dbf6b2eccda411935c6dc017fcdae3bf1/settlement-integration/verification/hosted/netlify-preview-20261020.json) and [October 29](https://github.com/TheCryptoArborist/arboretum/blob/57fe2f7f6d0a89ce02ed89dcf455a455ce143489/settlement-integration/verification/hosted/netlify-preview-20261029.json).

## What changed in Arboretum

Complete recursive Git trees were compared for accepted checkpoint `bea71961…` and flagged source `1dc540…`; both API responses reported `truncated: false`. The comparison did not rely on GitHub's limited aggregate changed-file listing.

The corresponding tree objects are [accepted `e878be0d…`](https://api.github.com/repos/TheCryptoArborist/arboretum/git/trees/e878be0dc79df59c2f07745a05a6d92dff4084a5?recursive=1) and [flagged `93c57a98…`](https://api.github.com/repos/TheCryptoArborist/arboretum/git/trees/93c57a9867099e0533f2ea0ab1ad22d0c89caa1a?recursive=1).

### Earlier defects were already present

The [accepted game source](https://github.com/TheCryptoArborist/arboretum/blob/bea71961a1ec9c1b0fec63535c90c6eb941a8c03/index.html) already contains the NFTree helper URL, dynamic loader, and mint invocation. Its entire Git blob is identical in the September 28 release, October 1 production source, accepted tester checkpoint, and first flagged source. Removing the helper closed a transaction-disabled review gap; it did not remove a newly introduced dependency.

The [accepted wallet](https://github.com/TheCryptoArborist/arboretum/blob/bea71961a1ec9c1b0fec63535c90c6eb941a8c03/wallet.js) already had the requested-wallet fallback and saved-account fallback later corrected. Its connection routine uses `standard:connect`. The first settlement-review transform did not modify connection selection or session restoration.

An unchanged third-party URL does not prove its remotely served contents never changed. Contemporaneous copies of that helper from the successful testing period were not recovered. No maliciousness finding about the helper is established.

### Actual transition

[Commit `bff42fba…`](https://github.com/TheCryptoArborist/arboretum/commit/bff42fba07f21aefb9d004d5ea4b7c5eceb0e2ba) changed `wallet.js` to confirm submitted transaction outcomes and require positive reward receipts. It did not change the connection routine. This new confirmation work runs after submission, making it a weaker runtime explanation for a connection-stage warning; static classification remains a separate possibility.

[Commit `326895b9…`](https://github.com/TheCryptoArborist/arboretum/commit/326895b9ab5f140be1b3e6e60566cb6a2d48fda9) introduced the settlement-review build. Its [wallet transform](https://github.com/TheCryptoArborist/arboretum/blob/1dc540414d0e4060343ee68a005cecb16e404991/settlement-integration/build_wallet.py) switches the emitted wallet from `sui-sdk.bundle.js`/`SuiClient` to a newly built `settlement-sdk.bundle.js`/`SuiGrpcClient`, adds local reader/model modules, and rejects transaction submission. The [builder](https://github.com/TheCryptoArborist/arboretum/blob/1dc540414d0e4060343ee68a005cecb16e404991/settlement-integration/build-review.mjs) emits this SDK and transforms the game. A branch-specific Netlify command selects that build.

The new build and a different immutable preview hostname arrived together. Their individual contribution to classification has not been isolated.

### Exact input comparison

These selected inputs were compared between accepted checkpoint `bea71961…` and flagged source `1dc540…`; only the wallet row changed:

| Path | Git blob comparison |
|---|---|
| `index.html` | `7757bfb2695c822d20752ded16eb0048f753bcd7` |
| `wallet.js` | Changed: `de725c9fe0db18d35e41232f7ad96406de086168` → `bc7218064f185ebc05887713cdbd9d4e7a3aa394` |
| `package.json` | `26a2d28759a35785c46cbd1c29239489ba452d8f` |
| `package-lock.json` | `af0b0f3b20c35282b7e17e9c22d4fdb17a121d02` |
| `sui-sdk.bundle.js` | `f2b6431c5d530f52abd2d7bd32f2e85514fe045a` |
| `garden.js` | `b83ccafe659873bfc554fdad2803394484f55fa6` |
| `netlify/edge-functions/tester-gate.ts` | `ca55f4d11cd5a5965e43f42282a9dd4a5aa6c314` |
| `netlify/edge-functions/public-player-guide.ts` | `e36ab12504cc18b58b5cee898a948b7fb01bc671` |
| `netlify/functions/calendar-reminder.js` | `9e16e9f4173e4eefdfe109550cefab8c44b5e7ab` |

The lockfile retains `@mysten/sui` 2.19.0 and `@mysten/wallet-standard` 0.21.1. Unchanged dependency versions do not mean identical emitted SDKs: the review uses different entry points. The existing fullnode and GraphQL hostnames were retained. No new tester-gate source or dependency-version change was found at this transition.

## What the official Slush extension reveals

Read-only static inspection used the Google-distributed extension associated with the [official Chrome Web Store listing](https://chromewebstore.google.com/detail/slush-%E2%80%94-a-sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil), extension ID `opcgpfmipidbgpenhmajoajpbobppdil`. The inspected manifest identifies **26.21.6 (`e2be7f2`)** and Google's `https://clients2.google.com/service/update2/crx` update endpoint. The listing showed October 27 as its update date. Inspection evidence was collected October 29 at 20:53 UTC. The extension was not installed or executed.

The inspected client implements these distinct steps:

1. Existing connected accounts are looked up by `scriptContext.origin`. A silent connection request or an origin with existing accounts can return without opening connection approval.
2. Fresh approval requests `dAppInteraction`, passing network and application URL. Its response includes `securityScan`, `scanId`, and issues with level, title, and subtitle.
3. An issue with level `BLOCK` produces the blocking overlay. Missing issues follow an unverified classification. The displayed title/subtitle come from the returned issue, and `scanId` appears as **Alert ID**.

Evidence locations in this exact distribution: `background.js` near character 3,568,978; UI bundle modules 6689–6695 near characters 12,551,851–12,560,327. Message-signing and transaction-approval flows also scan; the connection-restoration behavior does not establish that earlier usage never underwent assessment.

| Inspected artifact | Bytes | SHA-256 |
|---|---:|---|
| Official distributed CRX | 11,381,271 | `c2df3d863cfec4a2cbd743bdf3780846fa1bd8b34d8595fbf7ad89d5384abd71` |
| `background.js` | 3,579,831 | `c77639f8e7b18cc929d695d245751cc3f45cb02442336a538e934bf97745fa0f` |
| UI `index-4bcf7ee5c1f43c7dd6413090949b8918.js` | 13,724,594 | `e0df3392028d11f318d6ebfd9fa80ae8777737095a2fa0c71a672f9c854ec463` |

All three byte counts and hashes were independently rechecked. No extension bundles, account data, or large copied code excerpts accompany this report.

**Inference:** a new deploy-ID hostname can take a fresh approval/assessment path even if an earlier hostname worked. That is plausible here, not proven. No Slush-specific blanket Netlify rule, attribution of this alert to Blockaid, or public rule-level diagnosis was established. The listing's October 27 update postdates the first recorded October 23 warning and does not establish its cause; the user's installed version is unconfirmed.

## Support status and next discriminating evidence

The authorized official support form's Submit button was clicked once with the approved attachment and contact details. Its resulting page explicitly requires email-address verification before automatically submitting the request. **Email verification is pending; successful ticket creation and a ticket number are not confirmed.** This is not a completed support submission or a Slush clearance.

The useful next evidence is specific:

- Complete the service's email-verification step, then establish actual ticket acceptance.
- Ask Slush to resolve the complete Alert ID to the classification rule, flagged resource, first-flag time, and scope: exact origin, site family, URL, or script/content finding.
- Ask whether that assessment was fresh or cached, and what evidence is required to distinguish the accepted preview from the flagged preview without bypassing protection.
- Obtain the user's installed extension version if needed for a version-matched comparison. Do not attribute onset to a release merely because its date is recent.

No new runtime tests, deployment, wallet connection, signing, or protection bypass was performed for this investigation. Existing functional and deployment checks establish behavior and provenance; they do not establish the correctness or cause of Slush's remote classification.
