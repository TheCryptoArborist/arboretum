# Deployed Arboretum gameplay probe — 19 October 2026

## Result

Two unsigned simulations against the configured mainnet package established a
specific reward-claim issue. Watering is rejected after the current season ends.
A claim for the examined Seed completes successfully at the Move execution level,
but emits `SeedDied`, removes that Seed's 188 Growth Points, and pays no reward.

These were simulations with transaction validation enabled. No wallet was
invoked, signature created, transaction submitted, or fee actually paid. A
subsequent mainnet read confirmed that the examined Seed and Registry were
unchanged, including their versions, digests, and contents.

## Exact deployment and inputs

- Configured package: `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`.
- Package version: **11**; digest `G55ZRNKoCDhAgunVDzHgqeiVHgdofsq4FjJuBp984iia`.
- Registry: `0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50`.
- Examined Seed: `0x0055f786810a6094e0d4231968d4b546f3c5e3177d2e71253ef38f8e6ea2dffc`.
- Address owner and stored Seed owner both match
  `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4`.
- Data endpoint: `https://graphql.mainnet.sui.io/graphql`.

The package was fetched using `object(address).asMovePackage` to inspect that
exact immutable package object. Its full bytecode, disassembly, and the selected
function signatures are saved in `deployed-module-20261019.json`.

## Why the claim matters

The deployed constants and instructions establish the following calculation:

| Quantity | Verified value |
|---|---|
| Current season | 3 |
| Season start | 1 September 2026, 00:00:06.247 UTC (`1788220806247`) |
| Season duration | 2,592,000,000 ms / 30 days (deployed constant 47) |
| Season cutoff | 1 October 2026, 00:00:06.247 UTC (`1790812806247`) |
| Examined Seed's last watering | 27 September 2026, 22:27:02.735 UTC (`1790548022735`) |
| Complete drought days at cutoff | 3 |
| Complete drought days at probe clock | 21 |
| Death threshold | 10 complete days (deployed constant 8) |
| Bottomless Can expiry | 0 / no current protection |

Applying the deployed drought formula to the Seed's stored last-watered time
**at the cutoff** gives three complete days, below both the seven-day wilt and
ten-day death thresholds. This is a derived interpretation of the current stored
timestamps. It is not a historical snapshot proving every eligibility condition
at the cutoff and does not establish an owed payout amount.

The deployed `claim_reward` calculates drought using the **current Clock**.
Its death branch calls `mark_seed_dead` and returns before reaching
`RewardClaimed` or creating a reward coin. This was observed in the unsigned
simulation, independently of the local Move source.

| Simulation | Move status | Observed result |
|---|---|---|
| `water_seed` | `FAILURE` | Abort 6 in `assert_season_active`, instruction 24; no events. |
| `claim_reward` | `SUCCESS` | `SeedDied` event; Seed state 0 → 2; Seed GP 188 → 0; Registry GP 2,498 → 2,310; reward pool remains 209,720,000 MIST; no `RewardClaimed`. |

The simulated balance change for the owner was only the simulated gas debit
(-100,765 MIST), with no positive reward transfer. This amount was not charged.
**Successful VM execution must not be presented to the player as a reward payout
unless the expected reward event/effects are present.**

The subsequent mainnet read at checkpoint **335821829**, timestamp
**2026-10-19T17:21:55.901Z**, confirmed Registry version **995549548** and Seed
version **995549547** unchanged, with the Seed still at **188 GP / state 0** and
the Registry still at **2,498 GP / 209,720,000 MIST reward pool**.

## Receipt-query validation

The immutable package's `typeOrigins` table was queried to establish exact event
identities for receipt matching:

| Event | Defining package | Event fields |
|---|---|---|
| `arboretum::RewardClaimed` | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` | `owner`, `amount_mist` |
| `arboretum::SeedDied` | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` | `seed_id`, `owner` |
| `arboretum::ArchivedRewardClaimed` | `0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940` | `archive_id`, `season_id`, `owner`, `seed_id`, `amount_mist` |

`SeasonArchive` and `SeasonArchived` also originate in the latter package. The
`struct.fullyQualifiedName` field names the queried module's package address;
it is not the canonical type origin. The authoritative mapping and field schemas
are preserved in `claim-event-type-origins-20261019.json`.

The public GraphQL endpoint successfully returned the known Victory chest
transaction `GPXAb93pyvhRtSCQn6cRB1YcxR2hGp8iqmYQNyPVhNNB`:

- Status `SUCCESS`, no execution error.
- Checkpoint **319586398**, **2026-09-06T22:20:12.959Z**.
- One `CratePurchased` event, tier **6**.
- Created Crate
  `0x8faa3bbb9ac7a9c2d92bb16acc4f9b8bed64a2bf01140a6fbdc4ada5cb0b1073`.
- Five object changes, including explicit `idCreated` flags.

The exact replacement `TRANSACTION_CONFIRMATION_QUERY` extracted from `wallet.js`
was also accepted with both event/object details enabled and with only object
details enabled. The conditional query responses and their full request payloads
are preserved in `wallet-confirmation-full-20261019.json` and
`wallet-confirmation-objects-only-20261019.json`.

One simulation response returned an inconsistent structured
`executionError.module.package.address` (the Registry address), while its error
message named the configured package correctly. Preserve the raw error message;
do not treat that particular nested address field as independent identity proof.

## Evidence and reproduction

| File | Purpose |
|---|---|
| `summary-20261019.json` | Machine-readable result and exact cutoff calculation. |
| `deployed-module-20261019.json` | Exact immutable package, selected signatures, bytecode, disassembly. |
| `arboretum-deployed-disassembly.txt` | Full decoded deployed module. |
| `deployed-reward-water-excerpt.txt` | Relevant instructions and constants. |
| `owned-seeds-20261019.json` | Bounded initial Seed/Registry/Clock read. |
| `*-unsigned-input-20261019.json` | Unsigned request construction and enabled validation flags. |
| `*-simulation-20261019.json` | Complete simulation query, variables, and response. |
| `post-simulation-state-20261019.json` | Confirmation that live objects did not change. |
| `known-chest-confirmation-20261019.json` | Recovered historical transaction receipt. |
| `claim-event-type-origins-20261019.json` | Canonical event origins and fields for precise receipt matching. |

`probe.py metadata` sends three fixed read-only queries. `build-simulations.mjs`
uses the installed Sui SDK to build two unsigned single-command requests offline.
`probe.py simulate` sends only `Query.simulateTransaction`, with
`checksEnabled: true` and `doGasSelection: true`. `summarize.py` derives the report
from saved evidence offline. No execution, admin, publication, or signing API
exists in these scripts. Network access is required only for the probes.

The offline construction helper uses the installed SDK's internal
`transactionToGrpcJson` conversion, so that helper is verification tooling tied to
the recorded installed version, not production application code.

## Scope and guidance

Only the first eight Seed objects belonging to the known owner were queried; one
current-season Seed was selected for the two simulations. The first page reports
more objects, which were not fetched. This does not claim full player coverage,
all gameplay verification, or historical payout completeness.

The current MystenLabs README was rechecked during this work. Relevant guidance
read live from `MystenLabs/skills`:

- `accessing-data/SKILL.md`, `accessing-data/graphql.md`, and `accessing-data/grpc.md`.
- `ptbs/SKILL.md`, `ptbs/building.md`, and `ptbs/commands.md`.
- `sui-ts-sdk-backend/SKILL.md` (routing and current SDK conventions).

The installed `@mysten/sui` GraphQL schema and transaction serialization code were
also inspected for exact request and result shapes. No deprecated JSON-RPC
endpoint was used by these probes.
