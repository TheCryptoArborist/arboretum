# Arboretum settlement upgrade: current unsigned review

Prepared October 30, 2026 at 9:27 p.m. America/Chicago
(October 31 at 02:27 UTC), from repository source
`ee9f680157d3bd720dd1e293353265c5ec8714d5`.

**Status: the exact unsigned upgrade is prepared and its current mainnet
simulation passed. No signature or transaction submission occurred.**

## Accepted application checkpoint

The owner confirmed that Slush connects at
<https://www.treegrow.xyz/tester-access>, the displayed wallet address matches
the selected Slush account, and the existing garden, NFTree holdings, and season
information load correctly. Those checks are complete. The current hosted
preview is Netlify deployment `6ae53e7c96ded9882ad844c8` on project
`d425445d-4980-49be-8ab2-12e7527ba281`.

See the [current domain handoff](../../../../docs/dedicated-preview-domain.md)
and [hosted verification](../../../verification/hosted/www-preview-20261031.json).
Earlier warnings on the old Netlify hostname remain historical evidence; they
do not replace the accepted result on the requested www hostname.

## Transaction for review

| Field | Verified value |
| --- | --- |
| Network | Sui mainnet, chain identifier `35834a8a` |
| Upgrade | Existing Arboretum package version 11 to version 12 |
| Current package | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724` |
| Original legacy package | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` |
| Required administrator wallet | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| UpgradeCap | `0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5` |
| UpgradeCap version and digest | `990522281`; `AL8rz2UmVAVijA5KiDufAKsn4VbYjDMFaYyHQ8kzPB22` |
| Upgrade policy | Compatible (`0`), preserved |
| Ordinary object inputs | The UpgradeCap only |
| Candidate modules | Existing `arboretum`, plus new `settlement` |
| Dependencies | MoveStdlib `0x1` and Sui framework `0x2` |
| Simulated net gas | **0.337998763 SUI** |

The three commands, in order, are:

1. `0x2::package::authorize_upgrade`, using the verified UpgradeCap, policy `0`,
   and reviewed package digest.
2. `Upgrade`, using the two verified module byte arrays, dependencies, current
   package ID, and the ticket from command 1.
3. `0x2::package::commit_upgrade`, committing the receipt from command 2 back
   to the same UpgradeCap.

The upgrade adds the settlement implementation and advances the existing
UpgradeCap to the new package. It preserves the existing game code, legacy type
origins, capability owner, and compatible policy. Its only simulated SUI debit
is gas. Registry setup and season activation remain later transactions.

## Exact packet identity

| Item | Identity |
| --- | --- |
| Transaction-kind size | 40,617 bytes |
| Transaction-kind SHA-256 | `1b62257103c3a67c36607a7471180cee64159115274b774149282da1d7b443e0` |
| Package digest, Blake2b-256 | `a4f84de8007a0d8b8f79ab9d0fa8bdb03a1926dc954b1d72d626783be04c29df` |
| `arboretum` module SHA-256 | `2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1` |
| `settlement` module SHA-256 | `b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531` |

The transaction kind is identical to the earlier reviewed packet. The current
capture refreshes the evidence supporting it; it does not alter the candidate.

- [Unsigned packet and simulation payload](unsigned-upgrade.json)
- [Exact BCS transaction kind](upgrade-kind.b64)
- [SDK Transaction JSON for a later wallet handoff](wallet-transaction.json)
- [Verified current inputs](verified-inputs.json)
- [Simulation summary](simulation-summary.json)
- [Full simulation evidence](upgrade-simulation.json)
- [Live-state check after simulation](post-simulation-state.json)

The SDK JSON was restored with `Transaction.from(...)` and rebuilt offline.
Its transaction-kind hash and sender match the reviewed packet. The wallet JSON
is unsigned and leaves gas price, budget, payment, and expiration unset. It is
an SDK transaction representation, not an assertion that Slush has a JSON-file
import feature. The deployed review application has no administrator upgrade
signing page and still refuses transaction submission.

## What the current verification establishes

| Observation | Result |
| --- | --- |
| Input checkpoint | `339984267`, `2026-10-31T02:27:05.933Z` |
| Simulation observation checkpoint | `339984357`, `2026-10-31T02:27:28.149Z` |
| Post-simulation observation checkpoint | `339984414`, `2026-10-31T02:27:42.208Z` |
| Transaction checks and automatic gas selection | Enabled; simulation succeeded |
| Existing game bytecode | Matches deployed legacy module after the documented self-address binding |
| Legacy type origins | All 32 preserved |
| New settlement type origins | All 39 bind to the simulated new package |
| Simulated ordinary object changes | One package creation and one UpgradeCap update |
| Capability owner and policy | Preserved |
| Legacy Registry, AdminCap, and UpgradeCap after simulation | Identical to the captured live inputs |
| Simulated package on the live chain | Absent |
| Signatures / submitted transactions | 0 / 0 |

The simulation does not establish a real deployment or new object IDs. Any
`simulatedPackageIdNeverDeployed` value is evidence only and must never be used
in application configuration. Simulation success also does not establish
end-to-end gameplay against a deployed settlement Registry.

## Remaining release sequence

1. Review this specific version-12 upgrade. Its live publication remains
   separate from the authorization to prepare and simulate this packet.
2. Prepare an administrator wallet request on the accepted www origin, refresh
   the UpgradeCap reference and simulation, and require the exact owner above.
   Slush must select final gas and present the actual transaction for approval.
   Do not request seed phrases or private keys.
3. After the owner approves and signs, verify the real successful transaction,
   package module bytes, type origins, and updated UpgradeCap. Record actual
   deployment IDs from those effects.
4. Use `prepare-setup.mjs` with that real confirmed upgrade digest to prepare and
   simulate the single empty settlement Registry setup transaction. Review and
   sign setup separately.
5. Configure the real confirmed IDs and continue the controlled transaction
   tests. Season activation, funding, and legacy compensation are separate
   decisions.

The gas estimate above is an observation, not a fixed charge or a gas ceiling.
The present files deliberately stop before wallet signing and execution.

## Guidance consulted

Current MystenLabs skills were checked at commit
`97340218523a4c3cb0f3f34fa177b5101cf36676`:

- `sui-publish/SKILL.md`
- `ptbs/SKILL.md`, `ptbs/building.md`, `ptbs/commands.md`
- `sui-ts-sdk-backend/SKILL.md`, `sui-ts-sdk-backend/publishing.md`
- `sui-sdks/SKILL.md`, `sui-sdks/typescript.md`, `sui-sdks/llm-docs.md`
- `accessing-data/SKILL.md`, `accessing-data/graphql.md`
- `frontend-apps/SKILL.md`, for the wallet handoff boundary

Transaction serialization uses the unchanged repository builder and locked
`@mysten/sui` 2.19.0. The installed `docs/llms-index.md`,
`transactions/reference.md`, `transactions/basics.md`, and
`transactions/offline.md` were checked for the version-matched API.
