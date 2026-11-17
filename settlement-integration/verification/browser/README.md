# Offline browser review

The final review in [run-003/summary.json](run-003/summary.json) passed **75 of 75
checks** using Playwright **1.64.0** and Chromium **156.0.8078.4** at **1440px**
and **390px** widths. Eight final screenshots were visually inspected. No
blocking layout issue was observed in the tested Rewards states or disabled
New seasons page.

## What was checked

- The exact emitted wallet, panel, and dependent files matched the build
  manifest before testing and stayed unchanged throughout the run.
- A synthetic Wallet Standard provider connected through the application's
  existing wallet selection interface and remained classified as non-admin.
- One synthetic owned legacy Seed appeared with recorded Growth Points and
  **Under review** reward status. The three existing projection fields also
  displayed **Under review**.
- A deliberately unavailable owned-Seed read removed the previously shown
  Seed row and changed both the count and projections to **Unavailable**.
  Restoring the fixture and refreshing recovered the original view.
- Invoking the existing hidden claim handler displayed the review-only notice.
  The legacy claim zone remained hidden.
- New seasons stayed disabled in navigation. Opening its URL showed the
  awaiting-activation page with no scripts, wallet controls, or GraphQL reads.
- Neither viewport had page-width overflow. No wallet signature, transaction,
  simulation, or unexpected write request was attempted. No uncaught page
  exception or missing local asset was observed.

## Final screenshots

| State | Desktop | 390px |
| --- | --- | --- |
| Existing Seed under review | [Desktop](run-003/rewards-ready-1440.png) | [Phone width](run-003/rewards-ready-390.png) |
| Review-only claim notice | [Desktop](run-003/claim-review-notice-1440.png) | [Phone width](run-003/claim-review-notice-390.png) |
| Read unavailable | [Desktop](run-003/rewards-unavailable-1440.png) | [Phone width](run-003/rewards-unavailable-390.png) |
| New seasons disabled | [Desktop](run-003/new-seasons-disabled-1440.png) | [Phone width](run-003/new-seasons-disabled-390.png) |

## Scope and limits

Every browser HTTP request was intercepted. Local files and named GraphQL
fixtures were fulfilled in the test process; every other request was aborted.
An unreachable local proxy and blocked service workers supplied additional
network isolation. The only external requests observed were the Google Fonts
stylesheet, once per viewport; both were blocked, so screenshots use fallback
fonts.

The wallet, Seed ownership, balance, empty receipt history, and failure are
explicit synthetic fixtures. Registry content comes from the saved public
checkpoint observation identified and hashed in the result. This is an
offline UI check, not a hosted authentication/gate test, real wallet test,
live availability check, claim execution test, or mobile Safari test. New
settlement gameplay is unconfigured and was checked only as unavailable.

The hidden legacy claim handler was invoked directly because legacy claim
controls are intentionally absent from the visible review flow. The synthetic
provider throws and records a counter for every signing feature; its count
remained zero.

## Preserved run history

- `run-001`: 51/55 checks. The first harness incorrectly expected two removed
  legacy projection IDs and attempted to capture Rewards immediately after the
  established connection flow had switched to My Garden. The displayed reward
  values were already correct. This failed run is preserved.
- `run-002`: 75/75 checks after correcting those harness assumptions. Its
  screenshots caught a normal transient connection toast and the fixed mobile
  navigation at a scrolled document position.
- `run-003`: 75/75 checks, with final screenshots captured after the toast's
  normal expiry and at document scroll position zero. No app file or fixture
  was changed to obtain these final screenshots.

## Reproduce

First produce the review build with `node settlement-integration/build-review.mjs`.
Run the following with an isolated environment containing `playwright==1.64.0`
and its matching Chromium executable:

```bash
ARBORETUM_REVIEW_CHROMIUM=/path/to/chrome-headless-shell \
  /path/to/venv/bin/python settlement-integration/browser-review.py
```

The runner creates a fresh timestamped evidence directory by default. It does
not reuse browser profiles, connect a genuine wallet, contact a live provider,
or sign or submit a transaction.
