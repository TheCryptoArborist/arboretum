# Empty rewards Registry setup

The owner authorized this next step after the confirmed version-12 upgrade. The protected route is **https://www.treegrow.xyz/admin/settlement-setup/**, with a direct tester entrance at **https://www.treegrow.xyz/tester-access?next=settlement-setup**. The owner gives final transaction approval in the Slush browser extension.

This page handles one exact transaction: `settlement::create_settlement_registry` in package `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a`. It creates an empty shared Registry and a new Registry-bound administrator capability. The season remains unstarted. No funding, legacy import, compensation, claim, or gameplay activation is included.

## Published and verified — October 30, 2026, 11:19 p.m. CDT

Source **`c4789ec647e522857f4166021a3f9d3220e4cf7c`** is published as Netlify deployment **`6ae56c55b4f726c32698bd38`**, at **2026-10-31T04:19:49.905Z**, on the dedicated `arboretum-preview` project. The [hosted record](verification/hosted-20261031.json) confirms all **19 deployed application asset hashes** and **23 HTTP checks**. The 11 accepted game assets and three old upgrade signing assets are unchanged; the old upgrade HTML now links to setup. Both edge functions and the unchanged calendar bundle/output are verified. The existing tester code, session policy, and retained original Netlify project are preserved.

The final build passed **38 core/controller tests**, **67 synthetic browser checks**, **14 return-routing tests**, **47 gate-policy tests**, **10 form-origin tests**, and **9 build-policy tests**. The 28 existing upgrade tests also passed. The final synthetic browser record pins setup JavaScript SHA-256 **`1213be20c09eabd9a2ef9cff33d85439d06730576f32c0a103f2dce3f32255ef`**. The [local test record](verification/local-checks-20261031.json) and [browser record](verification/browser-review-20261031.json) describe their scopes.

The [offline native-login regression](verification/tester-return-browser-offline-20261031.json) passed 20 checks. The [hosted native-browser check](verification/tester-return-browser-hosted-20261031.json) passed 12 checks at desktop and mobile widths, including real external-link navigation, Strict-cookie behavior, incorrect-code retry, and the final setup heading. Normal HTTPS certificate validation remained enabled. Page JavaScript was disabled for this login-only check; wallet behavior was tested separately with isolated synthetic providers.

Both exact-source **Settlement app integration review** CI runs passed: [push](https://github.com/TheCryptoArborist/arboretum/actions/runs/41168065064) and [pull request](https://github.com/TheCryptoArborist/arboretum/actions/runs/41168068968). Five older preview workflows still fail their separate byte-equality or additive-only scope guards, including the intentional administrator-return gate changes. Their deployment stages were skipped; the [exact-source triage](verification/ci-legacy-triage-20261031.json) records the causes. This release does not claim every repository workflow is green.

The [final read-only mainnet check](verification/mainnet-20261031/summary.json) passed at **04:12:47 UTC**, with simulation checkpoint **340010293**, no existing settlement Registry, and an estimated fee of **0.005632932 SUI**. All public queries and CORS checks passed, and the real upgrade receipt was correctly rejected as a setup receipt. These are time-stamped observations; the page repeats them before signing. **No real setup signature or transaction was created by this implementation or verification.** The owner's Slush approval is still the next action.

## Owner flow

1. Open the setup tester entrance and enter the existing code if requested. The login button says **Continue to setup review** and returns to **Set up the rewards system.**
2. Connect the Slush browser extension. Explicitly select the administrator ending in **45c4**, then choose **Use selected account**.
3. Choose **Check setup readiness**. This reads mainnet and runs a checked simulation; it requests no signature.
4. Review the current network fee and the empty-setup acknowledgement. Choose **Review setup in Slush**.
5. Review and approve the single setup transaction in Slush. The page verifies the actual transaction digest, bytes, event, effects, new Registry, and bound capability.
6. Use **Copy receipt** to retain the actual transaction, Registry ID, administrator capability ID, and package ID for the next separately reviewed step.

The fee is refreshed immediately before the wallet request. Any change requires another acknowledgement. An estimated fee above **0.01 SUI** stops the review; this threshold is not a transaction gas budget or a promised final charge. Slush selects gas and shows its final review.

## Exact reviewed inputs

| Item | Value |
| --- | --- |
| Network | Sui mainnet, verified against its full genesis digest |
| Required sender | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Confirmed v12 upgrade | `GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU` |
| Single input | Legacy AdminCap `0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3` |
| Input object version | `986499447` |
| Input digest | `36Cg64NBM7Pa2NEageUkzgZ8MZydWD4BtKavLb3ZgqWN` |
| TransactionKind size | 154 bytes |
| TransactionKind SHA-256 | `2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b` |

The [reviewed packet and checked simulation](../settlement-integration/release/evidence/20261031-empty-registry-review/REVIEW.md) record the original review. The browser rebuilds and validates the exact kind; sender is fixed, and gas/expiration remain unset for the wallet.

## Checks before wallet approval

The page checks the real upgrade receipt, the approved module bytes and type origins, the current version-12 UpgradeCap and policy, and the legacy administrator and Registry identities. The exact legacy AdminCap reference must still be current. The new global Registry and AdminCap inventories must both be complete and empty.

Sui's global object inventory has no historical-checkpoint parameter. Each input request reads its current checkpoint and both inventories in one request snapshot, while also binding the preceding tip check to the requested checkpoint. Stale, inconsistent, incomplete, or errored data disables signing.

Simulation must succeed with transaction checks and automatic gas selection enabled. Its effects must be exactly one empty Registry, one owned and bound AdminCap, six wrapped empty table IDs, and the legacy AdminCap's metadata version advance. Legacy capability identity, type, owner, and contents remain the same. The only balance movement is the administrator's gas debit. A successful simulation does not create those objects on chain; simulated IDs never become deployment configuration.

## Duplicate request and receipt recovery

The contract permits more than one Registry, so the page checks global absence before readiness and again before handoff. An existing Registry disables creation in a fresh browser as well. Multiple, incomplete, or conflicting inventories fail closed.

An exclusive Web Lock and a separate persistent setup journal protect the wallet handoff across tabs. The journal is written before the single wallet call. Reloading, unknown wallet errors, missing receipts, malformed storage, and failed transactions do not authorize another submission. Only a definite, typed wallet rejection clears the matching request without a digest, while the same lock is still held; a fresh review is then required.

**Check an existing setup** is available without connecting a wallet. It only reads mainnet. A Registry's previous transaction may be later activity, so a candidate digest remains editable and is never saved as an authoritative wallet receipt. A known digest actually returned by Slush remains pinned. Verification can recover the original setup IDs after later legitimate Registry activity, while clearly distinguishing the historical empty creation from current state.

Actual receipt validation recomputes the full transaction digest and exact kind, verifies the sender and gas owner, checks the creation event and all effects, and derives object versions from the actual inputs and gas-payment references. It validates the current Registry/capability relationship and rejects version rollback or contradictory same-version data. Actual gas and output versions are not copied from simulation.

## Implementation

- `setup-core.mjs`: pure packet, mainnet, authority, inventory, simulation, and actual-receipt validation.
- `admin.mjs`: explicit provider/account selection, fresh review, journal, lock, wallet handoff, and receipt recovery.
- `build.mjs`: emits only the four protected setup assets and pins the reviewed kind and installed SDK versions.
- `check-live.mjs`: read-only public-mainnet query and simulation verification; it has no signing or execution method.
- `setup-core.test.mjs`, `admin.test.mjs`, and `browser-review.py`: adversarial validator/controller checks and isolated browser wallet fixtures.

The locked SDK remains `@mysten/sui` 2.19.0 and the toolkit remains `@mysten/dapp-kit-core` 1.6.1. Built-in web Slush, automatic connection, and burner wallets remain disabled. The existing game and upgrade signing code are preserved; the upgrade receipt has a navigation link to this separate setup page.

```sh
node --test --test-isolation=none settlement-setup/*.test.mjs
node --test --test-isolation=none scripts/test-tester-return.mjs
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
python3 settlement-setup/browser-review.py
python3 scripts/test-tester-return-browser.py --review setup --baseline-ref 2e24a6cbc831332fce4ce71e0781ab5d947b1c39
node --use-env-proxy settlement-setup/check-live.mjs /tmp/arboretum-setup-fresh-check
```

The live-check output directory must not already exist. Hosted source/deployment identity and final verification results are recorded separately in this directory's `verification` records. No test signs or broadcasts a real transaction.
