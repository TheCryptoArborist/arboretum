# Legacy Season 3 reconciliation — 20 October 2026

## Result

The frozen Sui mainnet evidence confirms **0.20972 SUI in the legacy Season 3
reward pool, 2,498 recorded Growth Points, and 20 Seeds belonging to seven
addresses**. Every one of those Seeds was read separately at the season cutoff.
Their count and GP reconcile to the historical Registry, and their versions,
digests, owners and contents are unchanged at the current frozen checkpoint.

**No Season 3 pool payout has occurred.** The 62 successful Registry mutations
from Season 3 setup through its latest update form an unbroken version-and-digest
chain. Gross positive pool movements total 209,720,000 MIST; gross negative pool
movements are zero. There are no claim calls in that chain, no later Registry
transactions between cutoff and the frozen checkpoint, and no Season 3 archive.
The earlier reported removal of **188 GP remains an unsigned simulation result**;
the examined Seed still holds its 188 GP.

This package completes the historical evidence review and presents an explicitly
unapproved allocation scenario. It does not implement compensation, authorize
payments, migrate inventory, change a season, or submit a transaction.

## Fixed checkpoints and identities

| Item | Value |
| --- | --- |
| Network | Sui mainnet |
| Chain identifier | `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` |
| Frozen current checkpoint | **335949688**, `2026-10-20T01:32:27.619Z` |
| Current checkpoint digest | `45VhpiT1QrSSSDdH5MdyBqyyzmqL2FHxkhF8t6sj4ugE` |
| Recorded season start field | `1788220806247` — `2026-09-01T00:00:06.247Z` |
| Deployed legacy duration | 2,592,000,000 ms / 30 days |
| Exact season cutoff | **1790812806247** — `2026-10-01T00:00:06.247Z` |
| Final checkpoint at/before cutoff | **328848276**, `2026-10-01T00:00:06.086Z` |
| That checkpoint's digest | `CWdYgJ2XCPZxuPK8BGxVGui8eG8RBSahKzY3spN4dMND` |
| Immediately following checkpoint | **328848277**, `2026-10-01T00:00:06.299Z` |
| Following checkpoint digest | `EgiX354FTTR6NvetGpweAf3hMHxiWMLJGiRcofmroJ3Q` |
| Registry | `0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50` |
| Registry version at both snapshots | **995549548** |
| Registry digest at both snapshots | `K2JR2TKipKopbuExH9tUScW2rYN7xa2WcRK8jiQHybf` |

The cutoff was bracketed using actual checkpoint timestamps, not an assumed
checkpoint rate. It falls between two adjacent checkpoints. The historical
object lookup therefore uses the final checkpoint whose Clock was no later
than cutoff. The policy calculation itself uses the exact cutoff millisecond.

The `start_season_for_duration` transaction occurred on September 2 and encoded
the stored September 1 start field. That distinction is preserved: the stored
field plus the verified deployed 30-day duration defines the October 1 cutoff.
The transaction's actual execution date is not rewritten as September 1.

## How historical completeness was established

1. Captured all 149 indexed Registry transaction references through the frozen
   checkpoint, with complete pagination. Fetched detailed receipts for the 76
   references dated September 1 or later, the Registry's first indexed reference,
   and three additional older `SeedDied` receipts discovered by event queries:
   **80 detailed receipts in total**. Every receipt includes status, checkpoint,
   transaction inputs/commands, events, object input/output states and balance
   changes. Every selected events/object-changes connection is complete.
2. Isolated the **62 successful Registry mutations whose output season is 3**.
   Each mutation's input version, digest and contents exactly match the previous
   mutation's output. This supplies a continuity proof even where an indexed
   historical search by itself would leave retention uncertainty.
3. Verified the first transition starts Season 3 from a cleared prior season,
   with zero GP and zero pool. Its transaction is
   [`5CVNRZN9AP6c6x8FP4BTTpaFeL68KBFL31LhDx6tE7L2`](https://suiscan.xyz/mainnet/tx/5CVNRZN9AP6c6x8FP4BTTpaFeL68KBFL31LhDx6tE7L2),
   checkpoint **318013167**, `2026-09-02T21:13:09.893Z`, input Registry version
   **986499446**, output version **986499447**.
4. Verified the final mutation reaches the exact frozen Registry. Its transaction
   is [`Bwu4YX4eBEBsHoMTMS15rDCdhYHkYnfvCq9H3aF24k2d`](https://suiscan.xyz/mainnet/tx/Bwu4YX4eBEBsHoMTMS15rDCdhYHkYnfvCq9H3aF24k2d),
   checkpoint **328132170**, `2026-09-29T03:27:45.115Z`. No Registry mutations are
   returned after the October 1 cutoff. The independent Registry point reads at
   cutoff and the current checkpoint are identical.
5. Discovered Seed IDs from the complete current native-object list and from
   historical transaction input/output states, including deleted objects that a
   current-only search would miss. Read **48 known Seed IDs at cutoff**:
   **45 existed** and three old abandoned Seeds did not. Exactly **20 existing
   Seeds are Season 3**. Their IDs exactly match the Season 3 creation receipts,
   the current Season 3 roster, and the Registry's count. Their GP sum is 2,498.
6. Verified every Season 3 Seed's address owner matches its stored owner, and its
   version, digest and contents match between historical and current snapshots.
   This includes GP, watering time, raw state, protection, revival charges,
   permanent bonus and ownership. There is no inferred restoration of lost GP.

The full chain, 20-row Seed review and seven-address summary are in
[`summary.json`](summary.json), [`season3-seeds-review.csv`](season3-seeds-review.csv)
and [`season3-owners-review.csv`](season3-owners-review.csv). All integer quantities
remain exact; MIST amounts are never calculated with floating-point arithmetic.

### Public API retention behavior

The public GraphQL service rejected historical **whole-object-set pagination**
at the October 1 checkpoint with `Request is outside consistent range`. It did
serve the historical Registry and individual Seed point lookups. The current
whole-object set was pinned using `checkpoint(sequenceNumber).query` and paginated
to completion; the historical roster was recovered with those point reads and
the receipt/Registry continuity checks above.

The service's reported filtered transaction/event retention ranges begin around
September 22 even though some explicit type-filtered searches returned older
events. Empty reward-event searches are therefore treated as supporting evidence,
not a standalone proof of lifetime payout absence. **Season 3's entire post-cutoff
claim period is within the reported range**, and the unbroken mutation chain plus
unchanged state independently establishes the Season 3 conclusion. No claim is
made here that the older Seasons 1 and 2 have been fully settled or audited.

The unsuccessful object-list queries and retention responses remain in
`evidence/`; their limitations are recorded rather than converted into zero
objects or zero historical activity.

## Confirmed legacy claims and the 188-GP question

| Evidence | Result |
| --- | --- |
| Season 3 pool decreases | **0 MIST** |
| Season 3 direct claim calls in the complete Registry chain | **0** |
| Registry activity after cutoff through the frozen checkpoint | **0 transactions** |
| RewardClaimed event search | No results; supporting evidence with retention limits above |
| ArchivedRewardClaimed event search | No results; supporting evidence with retention limits above |
| Existing Season 3 archive | None |
| Historical SeedDied events found | Three, dated July 6, July 6 and August 20; not the sampled Season 3 Seed |

The sampled Seed is
`0x0055f786810a6094e0d4231968d4b546f3c5e3177d2e71253ef38f8e6ea2dffc`.
At both cutoff and the frozen current checkpoint it has version **995549547**,
digest `3R8AifzywfyG1f1kxWm6K3woT7FqPuCRhWkSg49KhWWE`, raw state **0**, and
**188 GP**. The previous [deployed probe](../../gameplay-verification/deployed-probe/README.md)
records its simulated change to zero and the immediate subsequent unchanged live
read. This new historical/current comparison corroborates that no actual 188-GP
loss occurred in that probe. No replacement simulation was needed or performed.

The verified deployed legacy claim still evaluates drought at claim time; this
review does not change that contract. A recorded unclaimed balance does not mean
the existing claim entry point will pay the proposed cutoff-based amount.

## Unapproved cutoff-allocation scenario

The separate [settlement candidate](../../contract-payout/legacy-transition.md)
uses a fixed cutoff. To make the legacy treatment decision concrete, the review
applies **only its eligibility and proportional-allocation arithmetic** to the
historical data. A Seed with ten complete dry days is excluded unless protection
reaches cutoff; protection equality counts, and raw dead state stays excluded.
All present records have sufficient historical fields and matching owners.

This scenario retains **10 Seeds / 1,848 GP** and excludes **10 Seeds / 650 GP**.
The full 2,498 GP remain recorded on the legacy chain. No points were changed.

| Owner address | Seeds | Recorded GP | GP under proposed cutoff rule | Confirmed legacy Season 3 payout | Unapproved scenario allocation |
| --- | ---: | ---: | ---: | ---: | ---: |
| `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` | 8 | 1,504 | 1,504 | 0 SUI | **0.170681208 SUI** |
| `0x18d72fc2a3df6d92d0806da3b04d92be056e2d6d35882a56c16ddb25f48d35d6` | 2 | 344 | 344 | 0 SUI | **0.039038786 SUI** |
| `0x8a5270527fe5ea46e883934758636c51a13636c87066f597bfbe50b527f16016` | 3 | 464 | 0 | 0 SUI | 0 SUI |
| `0xd27e48a5973c33e70504393e97fe1a935780c8f780dfb8dcd1b12f7a0a8a6946` | 2 | 100 | 0 | 0 SUI | 0 SUI |
| `0x956624f2fbbdf16bb5e334b550efd975ff7677e34bbd4e18cb6f485756af6c08` | 2 | 44 | 0 | 0 SUI | 0 SUI |
| `0x0de00c55730739622b2f7acc92ca571d3c344b219e7c0d63a3660d58774c83f1` | 1 | 22 | 0 | 0 SUI | 0 SUI |
| `0xc0242d8a62364aec26a2b533dc80995ba6cd80df1a2ae9cba19737349cdf98fe` | 2 | 20 | 0 | 0 SUI | 0 SUI |
| **Total** | **20** | **2,498** | **1,848** | **0 SUI** | **0.209719994 SUI** |

Each Seed's illustrative amount is individually rounded down in MIST:

`floor(209720000 × eligible_seed_GP ÷ 1848)`

The eight 188-GP Seeds each produce **21,335,151 MIST**; the two 172-GP Seeds each
produce **19,519,393 MIST**. The six remaining MIST are rounding residue.

These amounts are **not approved compensation, currently claimable rewards,
wallet payment instructions, or an entitlement under the old contract**. The
new protocol's seven-day claim window is not retroactively applied here. The
legacy transition document requires separately reviewed treatment and, if
approved, separately funded compensation with a single-use claim record. No
compensation implementation, new funding, sweep, archive or transfer is included.
The CSVs leave approved-compensation amounts blank rather than presenting these
illustrations as approved payouts.

## Existing inventory remains distinct

At checkpoint 335949688 the native type-origin queries returned:

| Native object type | Count | Treatment in this review |
| --- | ---: | --- |
| Seed | 45 | 20 Season 3; 25 from earlier seasons |
| Tool | 109 | Owner, kind, charges and rarity preserved in raw evidence |
| Crate | 3 | Owner and tier preserved in raw evidence |
| Sapling | 0 | No current native Sapling object returned |
| Registry | 1 | The legacy Registry above |
| AdminCap | 1 | Recorded object; not used |
| SeasonArchive | 1 | **Season 2**, not Season 3 |

The existing Season 2 archive is
`0x46836041fba4d740d76e740443846775204f9936d2ab0ff6692d7ffffb5a9e5d`.
It records **145,950,000 MIST**, **698 GP**, and **13 Seeds**, with `swept:false`.
It is kept separate from the Season 3 pool and this review assigns no disposition
to its balance. Its detailed fields are captured in `summary.json` and the raw
native-object evidence.

This inventory covers the verified legacy Arboretum type origins used by this
package lineage. It is not a wallet-wide asset inventory, an external NFTree
ownership census, or a conversion entitlement. The new settlement setup does
not accept or automatically recreate legacy native inventory.

## Reproduction and validation

Offline re-derivation and meaningful failure controls, from the repository root:

```sh
python3 settlement-integration/legacy-reconciliation/derive.py
python3 -m unittest discover -s settlement-integration/legacy-reconciliation -p 'test_*.py' -v
```

The **14 tests pass**. They include removal of an intermediate receipt, incomplete
pagination, changed snapshots, missing fields, mismatched owners, the exact
ten-day boundary, protection equality, raw dead state, a future watering time,
forbidden write/simulation query shapes, repeated/missing cursors, and altered
aggregate evidence. Re-derivation verifies **185 captured response hashes** and
binds aggregate Registry, object, transaction, event and Seed data to those
actual raw responses before producing the summary and CSVs.

Network collection uses only the public GraphQL endpoint:

```sh
python3 settlement-integration/legacy-reconciliation/reconcile.py collect
python3 settlement-integration/legacy-reconciliation/reconcile.py details
```

Existing successful captures are reused only when request bodies and response
hashes match. This makes the current package a frozen review; a future-date
reconciliation must use a separate evidence/output set rather than overwriting
the basis of this one. Failed captures retain their query and errors and can be
retried. The collector rejects mutations and simulations before issuing network
requests and has no key store, wallet, signer or transaction-construction path.

Primary implementation guidance was read from the current MystenLabs skills at
commit `e31b38016723e2dcee36161d59c50e028e13b52a`:

- `accessing-data/SKILL.md`
- `accessing-data/graphql.md`
- `accessing-data/archival.md`
- `accessing-data/use-cases.md`

The live GraphQL schema was inspected for exact fields, checkpoint scoping,
historical point lookups and pagination. GraphQL RPC and the Archival Store are
generally available; operator retention limitations are handled explicitly.
No deprecated JSON-RPC API was used.
