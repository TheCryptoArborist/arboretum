# Read-only New seasons review

## Release scope

This update connects **New seasons** to the actual v12 settlement Registry created by transaction `87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp`. The protected entrance is **https://www.treegrow.xyz/tester-access?next=new-seasons**, with the application at **https://www.treegrow.xyz/settlement-game.html**.

The source and local verification are ready. Hosted publication and its actual source/deployment identities will be recorded here after the reviewed source build finishes.

The view reads the real Registry without requiring a wallet. A successful read displays its season state, reward pool, treasury, planted Seeds, Growth Points, checkpoint and network time. The confirmed empty setup displays **No active season** and **The new garden is empty**. Wallet connection is optional and is used only to review owned Seed records. Existing garden remains the separate legacy route.

## Read-only boundary

The source-pinned configuration uses `reviewEnabled:true`, `enabled:false` and `REVIEW_ONLY:true`. Read-only route availability and settlement activation are separate, mutually exclusive modes. The route model computes and freezes `READ_ONLY:true`; browser globals, URL parameters, local storage and environment values cannot activate it.

All 30 wallet transaction entry points reject before reads, transaction construction or wallet access. The signing boundary checks the same restriction independently. This includes planting, care, purchases, crate opening, rewards, funding, season administration and challenges. The two separately approved administrator receipt routes retain their existing compiled assets and completed-transaction protections.

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

The final application browser record pins the released HTML SHA-256 `f22e57baff3ec614b2991348af38c3b2b530644a75ddc6ffbca5754fcb06651e`, wallet SHA-256 `712901808debd5f36965b9fbc1e0d7ca3d2c26911c16e92b2c486ad8f3367ace`, and season helper SHA-256 `e25886590696cd29017a0e9d338661303d7dc4aaf12ce265c5bc7f0986dc728c`. Desktop/mobile journeys, delayed inactive state, failed and wrong-identity reads, inventory failure, legacy navigation and transaction guards passed. The intentionally rejected testnet connection's existing handled `WRONG_NETWORK` console message is recorded separately; normal application journeys had no console/page errors. The decorative inline SVG leaf renders correctly in the inspected screenshots.

The UI validation record retains the hash tested before that cosmetic icon change; controller behavior, layout and text are unchanged. The final build, browser record and exact-source CI cover the released HTML. Raw logs not separately saved are identified explicitly in their corresponding records.

No test connects a real wallet, requests a signature or submits a blockchain transaction. Offline browser fixtures use synthetic providers and captured public object shapes. Hosted verification will separately establish real mainnet rendering, access controls, deployed bytes, edge functions and the retained calendar function.

## Subsequent work

This release starts no season and deposits no funds. The new Registry's first season still needs its own reviewed start transaction and chosen timing/duration. The deployed v12 contract retains test prices; the approved production schedule in [economy decisions](../../../economy-review/decisions.json) needs implementation before a production launch. Legacy inventory, season history and any compensation remain separate from this new Registry.
