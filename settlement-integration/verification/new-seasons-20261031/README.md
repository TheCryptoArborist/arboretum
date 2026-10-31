# Read-only New seasons review

## Release scope

This update connects **New seasons** to the actual v12 settlement Registry created by transaction `87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp`. The protected entrance is **https://www.treegrow.xyz/tester-access?next=new-seasons**, with the application at **https://www.treegrow.xyz/settlement-game.html**.

The read-only view is published on the dedicated `arboretum-preview` project at **www.treegrow.xyz**. Source commit [`20271661083263cc2e87bbaae2c9f5bf93973382`](https://github.com/TheCryptoArborist/arboretum/commit/20271661083263cc2e87bbaae2c9f5bf93973382), tree `c86d71f3962770b1838612a37e3868de1c908b57`, was uploaded as a full source build. Netlify deployment `6ae57602f4f0e531f67877e7` was published at **2026-10-31T05:01:12.083Z**. See [source submission](deployment-source.json) and [deployment status](deployment-status.json).

The view reads the real Registry without requiring a wallet. A successful read displays its season state, reward pool, treasury, planted Seeds, Growth Points, checkpoint and network time. The confirmed empty setup displays **No active season** and **The new garden is empty**. Wallet connection is optional and is used only to review owned Seed records. Existing garden remains the separate legacy route.

## Read-only boundary

The source-pinned configuration uses `reviewEnabled:true`, `enabled:false` and `REVIEW_ONLY:true`. Read-only route availability and settlement activation are separate, mutually exclusive modes. The route model computes and freezes `READ_ONLY:true`; browser globals, URL parameters, local storage and environment values cannot activate it.

All 29 transaction helpers reject before reads, transaction construction or wallet access. The central signing boundary checks the same restriction independently: 30 guarded functions in total. This includes planting, care, purchases, crate opening, rewards, funding, season administration and challenges. The two separately approved administrator receipt routes retain their existing compiled assets and completed-transaction protections.

The new presentation exposes My Garden's public Registry summary and the owned-Seed Rewards reader. Economic and administrative controls inherited from the original application remain hidden. One compatibility advice button, `#garden-next-growth-action`, receives a handler from the retained garden module; browser checks establish that it remains invisible and cannot receive focus, while its economic APIs remain guarded. No mutation observer or global handler rewrite was added for this inaccessible node.

## Data and navigation behavior

The reader pins each Registry/clock snapshot to a single checkpoint and verifies the expected Registry type and identity. Missing, mismatched, failed, timed-out or stale reads clear totals and empty-garden claims to **Unavailable**. A disconnected wallet's inventory is not assumed to be empty. A wrong-network wallet is rejected while public mainnet status remains independently readable.

The tester gate recognizes only the fixed `new-seasons` return marker and directs successful login to `/settlement-game.html`. Incorrect-code retries preserve that intent. Duplicate, mixed, arbitrary and query-only markers cannot select a return URL. The host-only Secure, HttpOnly, SameSite=Strict session and existing origin checks remain unchanged. Upgrade, setup and ordinary garden entry keep their own destinations.

## Verification

| Scope | Result and evidence |
| --- | --- |
| Model and build policy | 24 model + 11 build-policy tests passed; [core validation](core-validation.json) |
| Generated wallet and picker behavior | 99 tests passed against the updated transforms; [final wallet record](wallet-final.json), [TAP log](wallet-final.log) |
| Public Registry controller and presentation | 15 tests passed; [UI validation](ui-validation.json) |
| Fixed login destinations and session/origin checks | 18 tests passed; [return-routing record](tester-return-tests.json) |
| Native desktop/mobile login | 20 offline checks passed; [native-browser record](native-login-offline.json) |
| Final application browser check | 38 checks passed across five isolated contexts; [browser record](browser-offline.json) |
| Final dedicated-preview build | Passed source preservation, module and inline-script parsing; [build log](build.log), [emitted hashes](../build.json) |
| Exact-source integration CI | Push and pull-request verification passed; [CI record and historical-workflow triage](ci.json) |
| Published files, HTTP routes and server functions | 24 raw asset hashes and all 90 application files matched; 32 HTTP checks passed; [hosted verification](hosted.json) |
| Hosted native desktop/mobile login | 12 checks passed with JavaScript disabled; [native-browser record](native-login-hosted.json) |
| Live JavaScript application and mainnet reads | 8 checks passed without a wallet; [hosted-browser record](browser-hosted.json), [public responses](public-mainnet-reads.json) |
| Exact hosted HTML transformation verifier | 5 checks passed, including unexpected script, whitespace and duplicate-anchor rejection; [verifier record](hosted-verifier-tests.json) |

The final application browser record pins the released HTML SHA-256 `f22e57baff3ec614b2991348af38c3b2b530644a75ddc6ffbca5754fcb06651e`, wallet SHA-256 `712901808debd5f36965b9fbc1e0d7ca3d2c26911c16e92b2c486ad8f3367ace`, and season helper SHA-256 `e25886590696cd29017a0e9d338661303d7dc4aaf12ce265c5bc7f0986dc728c`. Desktop/mobile journeys, delayed inactive state, failed and wrong-identity reads, inventory failure, legacy navigation and transaction guards passed. The intentionally rejected testnet connection's existing handled `WRONG_NETWORK` console message is recorded separately; normal application journeys had no console/page errors. The decorative inline SVG leaf renders correctly in the inspected screenshots.

The UI validation record retains the hash tested before that cosmetic icon change; controller behavior, layout and text are unchanged. The final build, browser record and exact-source CI cover the released HTML. Raw logs not separately saved are identified explicitly in their corresponding records.

Both exact-source Settlement app integration runs passed: [push 41170762067](https://github.com/TheCryptoArborist/arboretum/actions/runs/41170762067) and [pull request 41170767033](https://github.com/TheCryptoArborist/arboretum/actions/runs/41170767033). The PR merge tree matches the published source tree. Five older workflows remain failed: four encounter historical tester-gate/public-guide byte-equality assertions, and Economy accounting stops at its older additive-only scope guard. Their deployment steps were skipped. Exact-run logs and artifacts identify no new read-only runtime blocker; this is not an all-green repository CI result.

The complete deployed inventory accounts for the observed `backgroundA.jpg` to `backgrounda.jpg` path normalization and one additional `netlify.toml` whose bytes exactly match source. Both were also present on the preceding verified deployment. All eight compiled administrator assets, the public index and player guide, SDK bundle and typed reader match the preceding release. The calendar function retains its verified bundle digest; the only edge functions are `tester-gate` and `public-player-guide`. The retained original Netlify project is unchanged.

No test connects a real wallet, requests a signature or submits a blockchain transaction. Offline browser fixtures use synthetic providers and captured public object shapes. Hosted checks separately establish real mainnet rendering, access controls, deployed bytes, edge functions and the retained calendar function. The native login checks cover 1440px and 390px browser widths with JavaScript disabled; the live JavaScript mainnet check covers the desktop view. Responsive application behavior and synthetic wallet failures are covered by the separate offline browser record.

## Verified live state

The final hosted application check completed at **2026-10-31T05:09:05.797Z**. Its public getter read the exact Registry **`0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9`** at checkpoint **340024190**, network time **2026-10-31T05:09:00.221Z**:

| Value | Observed result |
| --- | --- |
| Season | No active season; ID/start/end `0` |
| Reward pool | `0` MIST / `0 SUI` |
| Treasury | `0` MIST / `0 SUI` |
| Planted Seeds | `0` |
| Growth Points | `0` |
| Read-only mode | `true` |
| Wallet connection | None; public status loaded independently |

The displayed empty state remained stable through periodic updates. The final browser recorded no console errors, page exceptions, forbidden network requests or unexpected wallet popups. Its screenshot was visually inspected. These values describe the recorded checkpoint, not a promise about future chain state.

The served HTML SHA-256 is `604113521ca6bfff974cc6e0eb8020352d7fd84aaa538ae7e16a22bb82c60c36`. The hosted document differs from the exact raw deployed HTML only through [seven observed anchor rewrites](served-html-link-rewrites.json): `.html` destinations become pretty paths and those anchors' attributes are reserialized. The hosted verifier requires each full source and served anchor exactly once, then compares every remaining byte. Wallet, panel, configuration, reader and model module bytes match the frozen build exactly.

The hosted-only verifier correction also limits body observation to the six required application assets, avoiding a login CSS/image body-observation race during navigation; failures reading required application bodies still fail the check. The final hosted harness SHA-256 is `4f03760bd58535c66f9b107f761d4233877abd6b4b5a3a5952a9b3559561541d`. This verification-only follow-up changes no deployed application bytes and requires no additional publication. The earlier offline record retains its original harness and results.

Normal TLS validation was used. The temporary entry for the runtime's existing trusted certificate was removed and the prior browser trust listing restored; see [cleanup record](browser-trust-cleanup.json). Tester credentials and cookie values were not written to evidence.

## Subsequent work

This release starts no season and deposits no funds. The new Registry's first season still needs its own reviewed start transaction and chosen timing/duration. The deployed v12 contract retains test prices; the approved production schedule in [economy decisions](../../../economy-review/decisions.json) needs implementation before a production launch. Legacy inventory, season history and any compensation remain separate from this new Registry.
