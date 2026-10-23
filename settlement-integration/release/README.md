# Unsigned settlement upgrade and setup review

The exact candidate upgrade **passed a mainnet simulation with transaction checks
and automatic gas selection enabled** on October 20, 2026 at 01:36 UTC
(October 19, 8:36 p.m. Central). It preserved the legacy module and added the
separate settlement module. No transaction was signed or submitted.

The complete result is in
[simulation-summary.json](evidence/20261020-initial/simulation-summary.json), backed by
the [raw simulation](evidence/20261020-initial/upgrade-simulation.json),
[fixed-checkpoint inputs](evidence/20261020-initial/chain-inputs.json), and
[post-simulation public state](evidence/20261020-initial/post-simulation-state.json).

## Verified release inputs

| Item | Observed value |
| --- | --- |
| Network | Sui mainnet, chain identifier `35834a8a`, verified from checkpoint 0 |
| Input checkpoint | `335949689`, October 20, 2026 01:32:27.884 UTC |
| Simulation checkpoint | `335950620`, October 20, 2026 01:36:10.019 UTC |
| Post-simulation checkpoint | `335951288`, October 20, 2026 01:38:48.613 UTC |
| Package being upgraded | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`, version 11 |
| Original package | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` |
| UpgradeCap | `0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5` |
| UpgradeCap object reference | Version `990522281`, digest `AL8rz2UmVAVijA5KiDufAKsn4VbYjDMFaYyHQ8kzPB22` |
| Existing policy | `0`, compatible; this packet does not restrict or otherwise change the capability policy |
| UpgradeCap and legacy AdminCap owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Legacy AdminCap | `0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3` |
| Legacy Registry | `0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50` |
| Dependency package IDs | `0x1` and `0x2` |
| Dependencies selected by the simulation | MoveStdlib version 25; Sui framework version 60 |

The compiled candidate used the previously verified Sui framework version 59.
The current framework is version 60, and the simulated upgrade successfully
linked against that current version. The evidence therefore covers a current
mainnet upgrade attempt as well as the earlier offline build/tests.

## Exact transaction 1: upgrade

The [unsigned packet](evidence/20261020-initial/unsigned-upgrade.json) contains
exactly three commands:

1. `0x2::package::authorize_upgrade` borrows the recorded UpgradeCap, with policy
   `0` and the verified package digest.
2. `Upgrade` supplies the recorded 18,034-byte `arboretum` and 22,221-byte
   `settlement` modules, dependencies `0x1` and `0x2`, the current package ID,
   and the ticket from command 1.
3. `0x2::package::commit_upgrade` consumes the receipt from command 2 and updates
   that same UpgradeCap.

It contains no pool deposit, reward claim, registry mutation, capability
transfer, setup call, or season start. The only object input is the UpgradeCap.
The wallet will select gas when a later release is approved and signed.

| Byte identity | SHA256 or digest |
| --- | --- |
| Legacy prepublication module | `2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1` |
| Settlement prepublication module | `b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531` |
| Sui package digest (Blake2b-256) | `a4f84de8007a0d8b8f79ab9d0fa8bdb03a1926dc954b1d72d626783be04c29df` |
| Unsigned transaction-kind SHA256 | `1b62257103c3a67c36607a7471180cee64159115274b774149282da1d7b443e0` |

The exact 40,617-byte transaction kind is stored as
[upgrade-kind.b64](evidence/20261020-initial/upgrade-kind.b64). It deliberately
omits a final gas payment, budget, and expiration; it is a review/simulation
artifact, not a signed transaction. Refresh chain inputs before producing the
final wallet request. Changes to the recorded capability owner, policy,
package version, source bytes, or module hashes fail validation.

The package digest implementation follows the official Sui implementation:
hash each module with Blake2b-256, sort those hashes together with the 32-byte
dependency IDs, concatenate, and hash with Blake2b-256 again. As an independent
control, it exactly reproduces the digest inside the successful version-11
upgrade transaction `HZRUsU9xNybZ5qSsPZV5wP1PvCEgbdsVJHur4ifFXnbw`.
The future setup helper's BCS decoding was also checked against that real
transaction. The [historical control result](evidence/20261020-initial/historical-upgrade-bcs-control-result.json)
records the recovered three-command upgrade and its exact legacy-module hash.

## What the simulation established

The simulated version 12 contains exactly `arboretum` and `settlement`.
Publication changes each module's zero self-address to the original package's
runtime address. Apart from that specific 32-byte address binding, both modules
match the reviewed prepublication bytes. The resulting legacy module matches
every currently deployed byte.

All **32 legacy type origins** are preserved. All **39 newly introduced
settlement type origins** point to the new package created by the simulated
upgrade. In a real deployment, their type origin must be read from the actual
new package. The legacy original package ID is not their type origin.

The simulation updates only the UpgradeCap and creates the package. Its sole
balance change is the simulated gas debit. Net gas was **338,028,763 MIST
(0.338028763 SUI)**, calculated as computation plus storage minus storage rebate.
This is an estimate for the recorded simulation, not a fixed fee or gas budget.

The later public read found the UpgradeCap, legacy AdminCap, and legacy Registry
identical to their recorded input state. The simulated package ID does not exist
on-chain. Fields named `simulatedPackageIdNeverDeployed` in the evidence must
never be copied into application configuration. The actual new package,
Registry, and AdminCap IDs remain `null` in the review manifest.

## Exact transaction 2: create the empty settlement Registry

Setup requires a real successful upgrade first. Its sole Move call will be:

```text
<actual confirmed new package>::settlement::create_settlement_registry(
    immutable reference to legacy AdminCap
)
```

`TxContext` is supplied by Sui. The call creates a shared settlement Registry
and transfers its new, registry-bound AdminCap to the signing administrator.
The Registry has season ID 0, no start time, no Seeds, zero Growth Points, zero
pool, zero treasury, and no settlement. It does not import legacy assets,
historical points, claims, or money. Starting and funding a new season are
separate later actions.

[prepare-setup.mjs](prepare-setup.mjs) prepares that exact unsigned call after a
real upgrade. The helper reads the actual confirmed transaction, verifies its
transaction-kind hash equals the reviewed upgrade, checks the real package's
module hashes and type origins, verifies the current UpgradeCap and refreshed
legacy AdminCap, and rejects an already-created settlement Registry. It then
emits the setup kind and unsigned review packet. It has no signing or execution
method. It has been unit tested with explicit synthetic fixtures; it has not
been run against a real version-12 transaction because no such deployment was
performed in this work.

After a separately approved upgrade exists, the development workflow is:

```bash
node --use-env-proxy settlement-integration/release/prepare-setup.mjs \
  settlement-integration/release/evidence/20261020-initial \
  ACTUAL_CONFIRMED_UPGRADE_DIGEST \
  /tmp/arboretum-setup-review
```

The actual setup output must then be simulated and reviewed before signing.
After it succeeds, read `SettlementRegistryCreated` and the created object
types from its real effects to obtain the new Registry and AdminCap IDs. Setup
replay protection is operational here: the contract permits creating another
empty Registry, so the helper refuses to prepare another when one of this new
type already exists.

## Reproduce the current review

Run these from the repository root. Captures require a new output directory and
never overwrite a prior on-chain observation:

```bash
python3 settlement-integration/release/capture_inputs.py --output /tmp/arboretum-release-fresh
python3 settlement-integration/release/verify_inputs.py --capture /tmp/arboretum-release-fresh
node settlement-integration/release/build-upgrade.mjs /tmp/arboretum-release-fresh
python3 settlement-integration/release/simulate_upgrade.py --capture /tmp/arboretum-release-fresh
python3 settlement-integration/release/verify_simulation.py \
  --capture /tmp/arboretum-release-fresh --capture-post-state
```

`capture_inputs.py` and `simulate_upgrade.py` send only explicit GraphQL
queries. Neither accepts a private key or signature. The Node upgrade builder
is entirely offline and uses the repository's installed `@mysten/sui` 2.19.0.
It uses the installed API's `upgrade({ package: ... })` parameter, verified
against the version-matched documentation and source.

Offline verification passes **11 Python tests and 8 Node tests**, covering
wrong network, changed owner/policy/package, modified source/module bytes,
incomplete inventory, digest control, transaction command/data flow, rejection
of simulation IDs as deployment evidence, and the future setup route:

```bash
python3 -m unittest discover -s settlement-integration/release -p 'test_*.py' -v
node --test --test-isolation=none --test-reporter=tap \
  settlement-integration/release/release-packet.test.mjs
```

## Guidance and sources

The current MystenLabs skill repository was read at commit
`e31b38016723e2dcee36161d59c50e028e13b52a`:

- `sui-publish/SKILL.md`: compatible upgrades, explicit setup, type anchoring, simulation.
- `ptbs/SKILL.md`, `ptbs/building.md`, `ptbs/commands.md`: transaction composition and offline kind construction.
- `accessing-data/SKILL.md`, `accessing-data/graphql.md`, `accessing-data/grpc.md`: current public data surfaces.
- `sui-sdks/SKILL.md`, `sui-sdks/typescript.md`, `sui-sdks/llm-docs.md`: installed version-matched SDK guidance.
- Installed `node_modules/@mysten/sui/docs/llms-index.md`, `transactions/basics.md`, `transactions/reference.md`, and `transactions/offline.md`.

Official references: [package upgrades](https://docs.sui.io/develop/publish-upgrade-packages/upgrade),
[PTBs](https://docs.sui.io/concepts/transactions/prog-txn-blocks),
[GraphQL RPC](https://docs.sui.io/concepts/data-access/graphql-rpc), and
[the package digest implementation](https://github.com/MystenLabs/sui/blob/mainnet-v1.78.1/crates/sui-types/src/move_package.rs).

This completes the unsigned upgrade review packet. Deployment authorization,
the real upgrade, setup simulation/signing, economic activation decisions, and
any legacy compensation remain separate from this verified preparation.
