# Test and production inventory boundary

This directory contains the verified **production inventory version 2
candidate**. It addresses the [observed v12 cross-Registry inventory behavior](../verification/season-test-20261031/README.md)
by separating the test and production economies using the contract's existing
version checks. It is not a deployed upgrade or an application activation.

The [canonical verification handoff](../verification/inventory-boundary-20261031/README.md)
records all contract tests, the checked unsigned mainnet upgrade rehearsal,
unchanged actual state, and the remaining live-test and release steps.

## Design

Keep the existing version-1 Registry and its inventory in the test economy.
Create a **fresh version-2 Registry** through the existing administrator-gated
factory when production is actually prepared. Version 2 uses the already
approved production prices from its first paid acquisition. Do not mint cheap
version-2 test items and later change only their prices.

The [candidate source](production/settlement.move) changes only `VERSION` from
1 to 2 and the 13 approved price constants, plus comments. The [exact patch](production/settlement.patch)
and [candidate manifest](production/candidate.json) make the changes reviewable.
There is no inventory conversion, Registry migration, new type, new field or
new production function. The existing fixed planting referral is preserved.

This is an economy-version boundary, not per-Registry item provenance.
Version-2 items remain usable between version-2 Registries. Administrator
promotions remain an explicit trusted capability. The existing generic
NFT-reference planting path accepts a key object as identity, charges the full
production planting fee and creates fresh Seed state; it is not an NFTree type
allowlist and does not import an old item's charges or bonuses.

## Reproduce the candidate and contract tests

From the repository root:

```bash
python3 settlement-integration/inventory-boundary/prepare-candidate.py

python3 contract-reconstruction/prepare_toolchain.py \
  --work-dir /tmp/arboretum-inventory-toolchain

python3 settlement-integration/inventory-boundary/verify-candidate.py \
  --toolchain /tmp/arboretum-inventory-toolchain/toolchain.json \
  --output /tmp/arboretum-inventory-offline-new-run
```

The first command verifies the checked-in candidate against the frozen v12
source and pinned approval record. `--write` can create missing candidate files
but never replaces a differing existing file. The source remains separate from
`contract-payout/source/settlement.move` and the current application.

The [verifier](verify-candidate.py) builds the frozen baseline and production
candidate independently, verifies published v12 identity and the exact source
change set, then compares layouts, ABIs, instruction structure and every
numeric constant load. It runs 52 v2 tests and 15 tests against the actual
frozen v1 implementation in isolated test copies. All outputs require a new
directory outside the repository.

The [legacy capability fixture](tests/legacy-admin-fixture.move.inc) is inserted
only into the v2 **test copy**. It exposes the existing private test helper so
the real Registry factory can be tested. It is absent from production bytecode
and from the frozen v1 test module.

## Checked unsigned upgrade rehearsal

With the existing locked Node dependencies installed and a successful complete
offline verification directory:

```bash
node --use-env-proxy settlement-integration/inventory-boundary/check-upgrade.mjs \
  /tmp/arboretum-inventory-offline-new-run \
  /tmp/arboretum-inventory-mainnet-new-run
```

The [driver](check-upgrade.mjs) requires all 67 contract tests to have passed
against the exact source and build hashes. It reads confirmed upgrade/setup
proof and current authority, builds the exact three-command upgrade, requests
one checked unsigned simulation, and verifies a later real-state observation.
It makes up to ten follow-up public reads with one-second inter-read delays
when the indexer needs to catch up. It never repeats the simulation
automatically. Every response is saved before validation.

The [pure validator](upgrade-rehearsal-core.mjs) pins the candidate bytecode,
dependency IDs and package digest; reconstructs the full transaction kind; and
checks resolved sender, gas, expiration, package bytes, all existing type
origins, capability owner/policy, events and balance changes. It requires the
predicted package to be absent on-chain in a snapshot whose timestamp is at or
after the completed simulation request. Public queries use normal TLS and no
credentials. Neither module contains wallet access, signing or transaction
execution.

Run the captured-evidence validator regressions offline:

```bash
node --test --test-isolation=none --test-reporter=tap \
  settlement-integration/inventory-boundary/upgrade-rehearsal-core.test.mjs
```

All simulated package IDs are evidence only. A future production release needs
its actual confirmed package ID, a fresh actual version-2 Registry/capability,
and a frontend that checks both the expected Registry and inventory version.
The historical v12 setup/receipt helpers must not be silently repurposed as
production version-2 validators.
