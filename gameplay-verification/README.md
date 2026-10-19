# Gameplay verification — 19 October 2026

## Current checkpoint

Peter reported: **“The tester's already used the preview. I think we're ready to press forward.”**
This advances the project beyond the invited tester preview milestone. It is
recorded as user-reported completion, not an assistant-observed session or proof
of any particular paid transaction. The earlier owner acceptance of the compact
Garden controls and the accounting display/exports remains complete.

Accepted preview:
https://6ac0807da3e616e086ee118c--arboretum-sui-forest.netlify.app/tester-access

Accepted review branch checkpoint:
`bea71961a1ec9c1b0fec63535c90c6eb941a8c03`, PR #12.

The October 19 work moves into transaction and reward verification. It fixes
incorrect success reporting and establishes two reward-settlement problems.
**The passing characterization tests reproduce problems; they do not certify
the payout contract for release.**

## What changed

The shared wallet transaction helper previously returned results without checking
the transaction's execution status. Errors from its former confirmation wait were
swallowed, and callers could display a successful action or mark a daily goal even
when execution failed or remained unconfirmed.

The corrected helper confirms the submitted digest using the current Sui GraphQL
point-query API, checks explicit execution success and checkpoint inclusion, and
loads the event and object-change details expected by existing gameplay callers.
Confirmation is bounded in time and pagination. Failed, mismatched, incomplete,
and unconfirmed responses return a clear error with the available digest. Waiting
for a receipt never signs or submits the action again.

Reward claims also require a matching positive payout receipt before returning to
the UI's success path. The original `RewardClaimed` event and the later
`ArchivedRewardClaimed` event have different defining package addresses; the guard
uses the deployed package's verified type origins. A confirmed transaction that
only emits `SeedDied` cannot be reported as a successful reward payout.

All wallet changes are contained in `wallet.js`; the original game HTML, Garden
layout, transaction targets, prices, contract source, and access controls are
preserved. The build verifier rebuilds the accepted accounting and compact Garden
overlays with the corrected wallet and verifies that the tested wallet bytes and
their dependencies are present in the publish directory.

## What the deployed checks established

The fresh mainnet read found Season **3** still ended, with a stored pool of
**209,720,000 MIST** and **2,498 Growth Points**. The deployed 30-day duration and
season start give a cutoff of **2026-10-01T00:00:06.247Z**. This work did not start,
reset, archive, pause, fund, or otherwise change the season.

Two unsigned simulations used transaction validation and gas selection:

| Check | Observed outcome |
|---|---|
| Water one current-season Seed after the cutoff | Execution failure, abort 6 in `assert_season_active`. |
| Claim the examined Seed after the cutoff | Execution success, but only `SeedDied`; Seed GP 188 → 0; Registry GP 2,498 → 2,310; no reward event or payout. |

The examined Seed's stored last watering was September 27. Applying the deployed
drought formula at the October 1 cutoff gives three complete days; applying it at
the probe clock gives 21. The deployed claim uses the current Clock, even though
watering has closed. The cutoff calculation is derived from current stored fields;
it is not a historical proof of every eligibility condition or an owed amount.

A subsequent read verified unchanged versions, digests, and contents of the live
Seed and Registry. **No actual transaction, signature, or gas payment occurred.**

See [the deployed probe report](deployed-probe/README.md) and its complete request,
response, bytecode, and unchanged-state evidence.

## What the local Move VM established

Three focused tests executed in Sui **1.79.1-808640d9b49a**, using the unchanged
accepted contract source and synthetic state/funds:

| Characterization | Reproduced result |
|---|---|
| Equivalent Seeds below the death threshold at cutoff (nine dry days), claimed two days later | Direct claim pays 0; archive claim pays the full 1,000-MIST synthetic pool. |
| Eligible Seed has 40 GP; another has 60 GP and is time-dead at claim | Eligible claimant receives 400 or 1,000 MIST depending on which claim is processed first. |
| Partial direct payout followed by archive | 400 + 600 MIST conserves the 1,000-MIST pool; attempting an archived claim for the Seed already paid directly aborts with `E_NO_SEEDS` (7). |

These are actual VM outcomes from a test-only copy of the accepted source, not
calculations standing in for execution. They establish baseline inconsistencies
and one conservation/replay boundary. They do not establish full equivalence
between this saved source and the newer deployed package.

See [the contract test report](contract-tests/README.md), executable harness,
compiler/source identities, and raw VM output.

## Verification and remaining work

The recorded local run completed **159 named Node tests, with zero failures or
skips**: 50 wallet/payout checks, 47 season-status checks, 34 Garden UX checks,
and 28 ended-Garden checks. The nine-step review build passed. Both reports
identify the same corrected wallet SHA-256:
`ce600b052fcb87098ec001ebb57e33709d676d8d0562d7092e5d5081b295119f`.

Reproduce the build with `node gameplay-verification/verify-review-build.mjs`,
then run `python3 gameplay-verification/verify_offline.py` after installing the
locked dependencies. The runner requires individual test counts;
a single process-wrapper pass cannot stand in for the underlying suite.

- `scripts/test-wallet-transactions.mjs` exercises the actual wallet helper and
  relevant existing UI callbacks with a synthetic non-signing wallet and injected
  responses. It covers failure propagation, pending/failed reads, bounded receipt
  loading, the live-confirmed GraphQL shape, and payout receipt identity.
  Timeout errors are injected in these tests; actual browser abort timing was
  reviewed in code, not exercised against a hanging public request.
- `verify-review-build.mjs` builds the accepted gated review and checks the
  shipped wallet, required modules, and existing overlays. Its report is
  `evidence/build-verification.json`.
- `.github/workflows/gameplay-verification.yml` runs the focused wallet regressions,
  review build, and relevant season/Garden integration checks with read-only GitHub
  permissions. It has no deployment or on-chain execution step.
- Existing successful historical browser results remain historical. The October 19
  checks do not claim a new real-wallet hosted-browser pass.

The immediate engineering follow-up is
[consistent season reward settlement](payout-remediation.md). Resolve the
authoritative deployed source and the eligibility/denominator policy before
preparing an upgrade. Another test of the already accepted interface will not
resolve these contract behaviors.

The subsequent [deployed-source preflight](source-baseline-preflight.md) identifies
two missing partner purchase functions and three partner-related body differences
in the saved source. It records the reconstruction and comparison work required
before preparing the payout correction; whole-module equivalence remains unverified.

No production publication, new preview deployment, merge, price activation,
treasury allocation, payout, or on-chain administrative operation is part of this
verification change. A connected Netlify read on October 19 still identified
`6abe81174b61a8e3dd53b333` as the published deployment at `treegrow.xyz`.

## Guidance used

The current `MystenLabs/skills/README.md` was checked for this request. Applicable
live guidance included:

- `frontend-apps/SKILL.md`, `frontend-apps/non-react.md`,
  `frontend-apps/transactions.md`, `frontend-apps/queries.md`, and
  `frontend-apps/limitations.md`.
- `accessing-data/SKILL.md`, `accessing-data/graphql.md`,
  `accessing-data/grpc.md`, and `accessing-data/archival.md`.
- `ptbs/SKILL.md`, `ptbs/building.md`, `ptbs/commands.md`, and
  `sui-ts-sdk-backend/SKILL.md`.
- `sui-build-test/SKILL.md`, `move-unit-testing/SKILL.md`,
  `move-security/SKILL.md`, `move-security/access-control.md`, and
  `move-security/best-practices.md`.

Exact installed Wallet Standard and Sui SDK code and the current GraphQL schema
were inspected where request/response shapes matter. The new confirmation and
deployed probes do not use the retired public JSON-RPC interface.
