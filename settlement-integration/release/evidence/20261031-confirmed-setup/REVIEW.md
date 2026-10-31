# Confirmed empty settlement Registry — Sui mainnet

The owner approved the exact empty-Registry setup in Slush. The transaction succeeded at **2026-10-31T04:27:02.091Z / October 30, 2026, 11:27 p.m. CDT**, checkpoint **340013815**. Its actual net fee was **5,632,932 MIST / 0.005632932 SUI**.

## Actual deployment identities

| Item | Confirmed value |
| --- | --- |
| Setup transaction | [`87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp`](https://suiscan.xyz/mainnet/tx/87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp) |
| Version-12 package and settlement type origin | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Shared settlement Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Bound settlement AdminCap | `0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835` |
| Administrator, sender and gas owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Registry initial shared version | `986499448` |
| Actual wallet gas budget | `5,732,932 MIST` |

These are actual transaction effects and current objects, independently read from public mainnet GraphQL. No simulated object ID is used. The [confirmed deployment record](../../confirmed-deployment.json) pins these identities and all 39 actual settlement type origins.

## Receipt and current-state verification

The [primary verification](verification.json) recomputed the full transaction digest and the approved **154-byte TransactionKind**, SHA-256 `2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b`. It contains exactly one call to `settlement::create_settlement_registry` in the confirmed v12 package, with the reviewed legacy AdminCap reference and no additional commands.

The actual receipt contains the expected creation event and nine setup effects: one shared Registry, one owned and bound AdminCap, six wrapped empty table IDs, and the legacy AdminCap metadata advance. The only balance movement is the administrator's actual SUI gas debit. The capability's owner matches the Registry administrator, and its `registry_id` equals the actual new Registry.

The live read at checkpoint **340014341**, **04:29:09.722 UTC**, confirmed:

| Registry field | Observed value |
| --- | --- |
| Schema version | `1` |
| Current season ID / season start | `0 / 0` — no season has started |
| Reward pool / treasury | `0 / 0 MIST` |
| Seeds / total GP / eligible GP | `0 / 0 / 0` |
| Settlement | `null` |
| Six internal tables | All empty |
| Pause flag | `false`; a positive season start is still required |
| Global Registry / AdminCap inventory | Exactly one of each; complete inventories |

The legacy AdminCap retains its ID, type, owner and contents. Its reference advanced to version **986499448**, digest **`9pPCr7P5WhSzdFJFHynGq1yJemck8Z8purxuDyDVtfLo`**. The reviewed setup input is now spent. **Do not repeat setup or use its old packet for another Registry.** The existing setup page detects the confirmed Registry and offers read-only receipt recovery.

The UpgradeCap still identifies the approved version-12 package and compatible policy `0`; both published module hashes, all 32 legacy type origins and all 39 settlement origins match the reviewed upgrade. The [independent verification](independent-verification.json) reached the same result from a separate public capture at checkpoint **340014319**. The [raw receipt](receipt.json), [current inputs](inputs.json), [tip](tip.json) and [preflight state](state.json) preserve the primary observations. Receipt fields named `gasEstimateMist`/`gasEstimateSui` in the reused validator result are derived from the actual confirmed effects here; the deployment record names them `actualSetupGasMist`/`actualSetupGasSui`.

## Application preparation and remaining work

The actual IDs are recorded in the [application configuration](../../../deployment-config.mjs), with `enabled:false` and `REVIEW_ONLY:true`. This prepares the binding without opening a new-season route or enabling gameplay transactions. No website deployment accompanies this receipt handoff; the accepted setup deployment remains `6ae56c55b4f726c32698bd38`, source `c4789ec647e522857f4166021a3f9d3220e4cf7c`.

The [application binding verification](binding-verification.json) used the existing GraphQL reader and route model against mainnet checkpoint **340015724**, **04:34:44.685 UTC**. It verified the full genesis digest, all 39 settlement type origins, Registry sharing, AdminCap ownership/binding, and normalized inactive season 0 with zero start time, pool and GP. The saved runtime route remains unavailable. All **31 focused tests** passed: 22 model tests and nine build-policy tests, with zero failures or skips; the [test output](binding-focused-tests.log) records that scope. The [repeatable verifier](verify-bindings.mjs) accepts only public-read queries and refuses to overwrite existing evidence.

```sh
node --use-env-proxy settlement-integration/release/evidence/20261031-confirmed-setup/verify-bindings.mjs /tmp/new-binding-verification.json
node --test --test-isolation=none settlement-integration/model.test.mjs scripts/build-policy.test.mjs
```

The next interface change can expose the new Registry for read-only review and show **no active season**. The current dedicated-preview build policy requires settlement route enablement to remain false, so that change must explicitly distinguish read-only route availability from transaction activation and retain the wallet guard.

Starting the first new season remains a separate owner transaction. The deployed contract supports an immediate 30-day start or an immediate duration of up to 30 days; it does not accept a scheduled future start or fund the pool as part of starting. Any later funding needs an explicit amount and an active season. See [settlement.move](../../../../contract-payout/source/settlement.move).

The deployed v12 module still contains test prices. The approved production schedule in [economy decisions](../../../../economy-review/decisions.json) has not been implemented or activated by this setup. A production launch therefore needs that pricing and transition work before a production season begins. No launch timing, duration, funding amount, legacy import or compensation is chosen in this handoff.

All assistant verification in this handoff used public reads: **zero signature requests and zero transaction submissions**. The real setup transaction above was approved and submitted by the owner through Slush.
