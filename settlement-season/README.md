# First owner-wallet test season

The protected owner review starts the first **24-hour, inventory-version-1 test season** in the existing confirmed Registry. Enter through <https://www.treegrow.xyz/tester-access?next=season-test>. After the existing tester login, the page at `/admin/season-test/` says **Start the first test season.**

The [verification handoff](verification/README.md) records publication status and exact results. Publishing the page does not start a season. The administrator explicitly reviews the duration and fee and approves the transaction in Slush.

## Owner flow

1. Open the fixed tester entrance and use the existing access code if requested.
2. Connect the Slush browser extension. Select the administrator ending in **45c4**, then choose **Use selected account**.
3. Choose **Check test-season readiness**. This verifies the confirmed setup and current empty Registry and runs an unsigned simulation.
4. Review the estimated end and network fee. Acknowledge that approval opens a **24-hour test season at transaction execution**, with zero reward funding.
5. Choose **Review test start in Slush**, then review the single start call in the wallet. A changed fee requires another page acknowledgment first.
6. After approval, wait for **The first test season is confirmed.** Use **Copy receipt** to retain the real digest, actual start, cutoff, claim deadline and object IDs.

## Exact operation

| Item | Reviewed value |
| --- | --- |
| Network | Sui mainnet |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Bound AdminCap | `0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835` |
| Required sender | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Function | `settlement::start_season_for_duration` |
| Duration | `86400000` milliseconds / 24 hours |
| Transaction kind | 258 bytes; one Move call; four inputs |
| Kind SHA-256 | `6c89e6e0c74aa30a0b258194805566947469a3ed4fc1cfef97e4d9ecc71922f1` |
| Wallet-ready gas and expiration | Unset; final selection belongs to Slush |

This transaction includes no funding, purchase, upgrade, Registry creation, item migration or compensation. General gameplay remains read-only. The prepared production candidate is reserved for a later fresh version-2 Registry.

The contract stores a backdated start for shortened seasons. The page uses the actual `SeasonStarted` event/Clock time and adds 24 hours for the growing cutoff. The claim deadline is seven days after cutoff; ordinary reset readiness is one day after cutoff. Watering retains its normal **21-hour, 36-minute interval**. The short season does not accelerate care.

The simulation estimate must be at most **0.01 SUI**. This is a review ceiling, not a gas budget or final charge. The October 31 unsigned check estimated **0.000100553 SUI**; the page refreshes the estimate before handoff.

## Wallet and receipt safeguards

The route preserves the locked SDK and established explicit Slush-extension account-selection pattern. It has no automatic connection, web-wallet registration, burner wallet or secret-key handling. Wallet initialization is restricted to `https://www.treegrow.xyz`.

A separate first-season journal and exclusive Web Lock cover the handoff. The journal is written before the sole wallet action. Reloads, other tabs, unknown wallet errors, failed receipts and missing digests cannot authorize a second request. Only a definite typed rejection clears its matching unresolved request while the lock is held.

An already-started Registry blocks another first-start request even in a fresh browser. **Check the current test season** and receipt verification work without connecting a wallet. An object's previous transaction is only an editable recovery candidate; a digest actually returned by Slush remains pinned.

Receipt validation recomputes the full transaction digest and exact kind and verifies the sender, gas owner, bound capability, actual input versions, output Lamport version, Registry transition, execution Clock, one event and gas-only balance effects. Simulation cannot establish confirmation. Historical first-start receipts remain recoverable after legitimate later activity, with current state distinguished from the original receipt.

## Reproduction

```sh
node --test --test-isolation=none --test-reporter=tap settlement-season/*.test.mjs
node --test --test-isolation=none scripts/test-tester-return.mjs
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
python settlement-season/browser-review.py
python scripts/test-tester-return-browser.py --review season-test --baseline-ref 2c0991b45e840caa9b875f37376306691c268e6d
node --use-env-proxy settlement-season/check-live.mjs /tmp/arboretum-owner-season-fresh-check
```

The live driver requires a new directory. It makes fixed public reads, one checked unsigned simulation, a negative control using the real setup receipt, and later unchanged-state observations. It never signs or executes. Offline browser checks use synthetic providers and blocked external networking. The separate `check-hosted-browser.py` takes the existing tester code only through stdin and verifies published assets and read-only mainnet rendering with normal TLS; it never connects a wallet or simulates a start.
