# First owner-wallet test: review page verification

**The protected 24-hour first-season review is published and verified at `www.treegrow.xyz`.** Source [`5c1b45dca0ccd87fd53f0c82053cf0c508029909`](https://github.com/TheCryptoArborist/arboretum/commit/5c1b45dca0ccd87fd53f0c82053cf0c508029909), tree `61a080dde18383c0c413fd5ac0aba72d3ffdfdc6`, was uploaded as a full-source build. Netlify deployment **`6ae58697bc817a22d602d1be`** published at **2026-10-31T06:11:53.168Z** (October 31, **1:11:53 a.m. CDT**). The [source upload](deployment-source-20261031.json) and [published status](deployment-status-20261031.json) record the exact source archive and deployment.

Owner entrance: <https://www.treegrow.xyz/tester-access?next=season-test>. The page says **Start the first test season.** See the [owner flow and exact transaction](../README.md).

## Hosted release verification

| Check | Confirmed result | Evidence |
| --- | --- | --- |
| Authenticated HTTP and access controls | 49 checks passed | [Hosted API/HTTP record](hosted-20261031.json) |
| Exact raw application/administrator assets | All 28 match the tested build | Same hosted record |
| Complete application file inventory | All 94 match; the 90 prior files are preserved | Same hosted record; source `netlify.toml` is a separately verified platform addition |
| Native external-link login and retry | 12 checks passed at 1440px and 390px | [Hosted native login](native-hosted/summary.json) |
| Actual JavaScript and live public mainnet reads | Eight checks passed at 1440px and 390px | [Hosted browser](browser-hosted/summary.json) |
| Backend preservation | Both edge functions and the exact calendar bundle retained; no schedules | Hosted API/HTTP record |
| Browser HTTPS validation | Normal TLS throughout; temporary named runtime trust entry removed and prior listing restored | [Trust cleanup](browser-trust-cleanup-20261031.json) |

The hosted JavaScript check used fresh browser contexts with no wallet provider. It verified exact JavaScript, CSS and packet bytes, then selected only **Check the current test season**. Its only blockchain requests were the fixed public proof and input queries; it made no simulation, wallet connection, signature or submission. The native-login check separately ran with JavaScript disabled to verify real Strict-cookie behavior and rejected-code retries.

The latest hosted observation was checkpoint **340040015**, at **2026-10-31T06:13:06.274Z** (October 31, **1:13:06 a.m. CDT**). It again verified the actual version-1 Registry at **season 0**, empty, unpaused and unfunded. Deployment did not start the season. The owner must review the duration/fee and approve the actual call in Slush.

## Pre-publication verification

| Check | Result | Evidence |
| --- | --- | --- |
| Pure first-start and actual-receipt validation | 34 tests passed | [Combined test log](local/administrator-season.log) |
| Wallet/controller behavior | 19 tests passed | Same log; [local results](local/summary.json) |
| Final compiled desktop/mobile behavior | 68 checks across 20 isolated contexts passed | [Browser record](browser/summary.json) |
| Fixed return routing | 22 tests passed | [Routing record](routing/summary.json) |
| Existing gate and native-form origin policies | 47 + 10 tests passed | Same routing record |
| Native browser login | 20 checks passed at 1440px and 390px | [Native login](native-login/summary.json) |
| Existing integration CI commands, run locally | All eleven command groups passed | [Local results](local/summary.json) |
| Existing published files | All 90 preserved byte for byte; four new page assets | [Preservation](preservation-20261031.json) |
| Checked unsigned mainnet first-start simulation | Succeeded; estimated 0.000100553 SUI | [Mainnet results](mainnet/summary.json) |
| New confirmation query against real setup receipt | Rejected as a first start with `PACKET_MISMATCH` | [Negative control](mainnet/confirmation-control-result.json) |

The packet contains one `start_season_for_duration` call for 86,400,000 milliseconds, using the existing version-1 Registry, bound capability and read-only Clock. There is no funding or paid player action. Readiness requires fresh mainnet authority, exact empty creation state and successful simulation. Handoff also requires explicit account selection and acknowledgment of the duration and current fee.

## Real state after the unsigned check

At checkpoint **340037436**, timestamp **2026-10-31T06:02:39.203Z** (October 31, **1:02:39 a.m. CDT**), the package remained **v12**, inventory version **1**, season **0**, with zero pool, treasury, Seeds and Growth Points. Registry, capability, upgrade authority and legacy object references, owners, types and contents were unchanged. This observation follows the completed simulation response; preceding indexed observations are retained.

The driver made **one unsigned simulation**, requested **zero signatures**, submitted **zero transactions**, spent **zero SUI** and deposited **zero funds**. The simulation's times are predictions. The owner's confirmed transaction determines the real 24-hour window.

## Coverage and precise limits

The build preserves Sui SDK 2.19.0 and dApp Kit Core 1.6.1. Existing game, upgrade, setup and New seasons application bytes remain unchanged. Global gameplay activation stays disabled.

Tests cover account/provider/network changes, stale state, changed or excessive fees, rejection, duplicate clicks/tabs, uncertain results, reloads, storage failures, already-started discovery, wrong receipt candidates and historical receipt recovery. Actual receipt verification supports the locked SDK's ordinary gas-coin and mainnet-bound address-balance expiration forms. The wallet receives a Transaction instance with final gas and expiration unset.

Confirmed times use the real event time, not the 29-day-backdated storage value. Browser checks verify the displayed cutoff is exactly 24 hours later. The normal 21-hour, 36-minute watering interval is visible before acknowledgment.

Browser screenshots are marked **synthetic offline review**. They establish compiled behavior with fixtures, not a real connected wallet or started season. A final visual pass corrected spacing below the connected-wallet button; the browser suite was rerun against the final stylesheet. Earlier fixture-expectation and browser-startup failures remain in separate run directories. Unit-test source snapshots precede that CSS-only spacing correction; executable controller/core code did not change afterward.

## Publication scope

The target is existing site `d425445d-4980-49be-8ab2-12e7527ba281` (`arboretum-preview`), previously at deployment `6ae57602f4f0e531f67877e7`. A [fresh preflight](deployment-preflight-20261031.json) verified the custom domain, disconnected Git continuous deployment, and unchanged retained original project.

The release uses a full committed-source build. It preserves edge functions `tester-gate` and `public-player-guide`, the existing `calendar-reminder` function and absence of schedules. The tester code and host-only Secure, HttpOnly, SameSite=Strict session remain unchanged. Only the fixed `season-test` return marker is added.

The runtime addition is four protected files under `/admin/season-test/`: HTML, CSS, bundled JavaScript and the reviewed unsigned kind packet. No contract, production candidate, price, general wallet integration or previous administrator signing file changes.

All local workflow groups passed. The [exact-source CI record](ci-20261031.json) confirms that both **Settlement app integration review** runs passed: [push 41175518064](https://github.com/TheCryptoArborist/arboretum/actions/runs/41175518064) and [pull request 41175522845](https://github.com/TheCryptoArborist/arboretum/actions/runs/41175522845). The PR checkout tree matches the reviewed source exactly. Across all **12 current runs for this commit, 7 passed and 5 failed** on historical scope or source-baseline guards; those five runs skipped their deployment steps. This is not an all-green repository CI result.

Independent core, controller, UI and release-helper reviews found no remaining blocker. Only an owner-approved and verified wallet receipt can establish that the first test season has begun.
