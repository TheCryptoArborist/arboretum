# First-season test tools

These verification tools exercise the first season from the real empty v12
Registry. The completed results, raw observations and production-transition
finding are in the [October 31 test handoff](../verification/season-test-20261031/README.md).

The tools do not activate the application, connect a wallet, request a signature,
execute a transaction, deposit funds or deploy a website. The production Move
sources, pricing and current read-only application remain unchanged.

## Offline contract lifecycle

The [Move runner](run-move-tests.py) compiles the unchanged sources and checks
their exact identity against the confirmed v12 publication before appending
test-only code to an isolated copy. It then runs 19 focused entrypoint cases,
including the first paid lifecycle using synthetic test coins.

See [Move coverage and reproduction](move/README.md) for the pinned public
toolchain, commands and inventory-provenance cases.

## Unsigned mainnet rehearsal

The [rehearsal core](start-core.mjs) builds exactly one
`settlement::start_season_for_duration` call for 86,400,000 milliseconds. This
24-hour duration is a rehearsal choice, not an approved live schedule. The call
uses the actual Registry, bound AdminCap, read-only Clock and current ownership
proof. It leaves final gas selection and expiration unset in the proposal.

The [public-data driver](check-live.mjs) reads the confirmed upgrade/setup proof
and fresh object state, requests one checked unsigned simulation, and verifies
the exact effects. It performs at most ten follow-up public reads, with
one-second inter-read delays when necessary, to wait for the indexer to reach the simulation's actual
Clock. It never automatically repeats the simulation. Every response is saved;
`after.json` is an exact copy of the selected sufficiently recent observation.

From the repository root, with the existing locked dependencies installed:

```bash
node --use-env-proxy settlement-integration/season-test/check-live.mjs \
  /tmp/arboretum-first-season-mainnet-new-run
```

The output directory must not exist. The driver uses only the fixed public
mainnet GraphQL endpoint, with normal TLS and no credentials. It captures the
full queries, variables, raw responses, unsigned transaction kind and source
hashes. A failure preserves those observations and does not submit anything.

Immutable receipt proof and mutable live inputs use separate queries to stay
within the endpoint's field limit. The validator joins only the already
confirmed receipt fields, checks network identity and observation freshness,
and retains the existing confirmed-setup verification. The SDK and GraphQL
parser are from the existing lockfile; no dependency is upgraded.

Automatic address-balance gas selection may add a chain-bound `ValidDuring`
expiration to the resolved simulation transaction. The validator requires its
mainnet chain, current/next epoch window and valid nonce; an empty payment list
cannot bypass that check. The resolved transaction kind must still match the
exact unsigned proposal. Normal gas-coin inputs, if returned, must match the
resolved payment list and the administrator's ownership.

## Offline evidence-validator regressions

```bash
node --test --test-isolation=none --test-reporter=tap \
  settlement-integration/season-test/start-core.test.mjs
```

The suite replays the saved public observations with their captured validation
time. It accepts the real packet/effects and rejects changed identity, authority,
state, timing, calls, gas resolution, events and balances. It replaces `fetch`
with a throwing implementation and asserts that no network call is attempted.
It makes no fresh simulation request and spends no SUI.

The saved unsigned packet is a verification artifact. It is not a current
wallet-signing request and must not be reused as a live transaction without a
new review of current objects, duration, inventory isolation and the exact call.
