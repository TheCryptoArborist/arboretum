# Season 2 planting: unchanged Growth Points field

## Status

The source correction is validated locally and against a fresh unsigned Sui
mainnet simulation. Publication is pending; this record does not claim that
the correction is already hosted. A completed publication record will be
added in `hosted/` after the exact saved source passes required CI and deploy
verification.

The actual Season 2 rollover is
`9SqBoBCyVA4A1mWfmBid7dGxny4ba2tzCgVPLiRS77z4`. The season began on
November 8, 2026, at 8:45:27 AM America/Chicago and ends on November 10 at
8:45:27 AM. No new season is started by this correction.

## Cause and correction

The first Season 2 planting sets `player_growth` to 10. That owner field was
already 10 after Season 1, so the successful simulation reports it in
`effectsJson.unchangedLoadedRuntimeObjects`, with its original version, and
omits it from `objectChanges`. The previous validator required a changed
output and stopped with **The player_growth output is missing.**

The accepted exception is limited to this one field and value. It requires
an explicit unchanged runtime reference bound to the transaction digest,
success status, execution epoch and output Lamport version. The field must
have the correct derived ID, Table parent, owner key, Move type and value 10.
It cannot also appear as changed, and its original version must precede the
transaction's output version. The owner Seed index, season tracker and NFT-use
tracker must still have their required changed outputs.

For a confirmed planting receipt, the controller requests that exact
historical object ID and version. The final receipt verifier independently
checks the response. It cannot substitute a later current-state value, such
as 24 GP after watering. Missing or failed historical reads preserve the
existing transaction lock and allow read-only receipt recovery. The original
field reference is retained for the subsequent watering verification.

## Evidence and verification

- [`../../care-unchanged-growth-observed-20261108.json`](../../care-unchanged-growth-observed-20261108.json)
  contains the untouched public proof, actual rollover, checkpoint-bound
  fields and detailed unsigned simulation that reproduced the issue.
- [`mainnet/summary.json`](mainnet/summary.json) records the successful fresh
  live check at **2026-11-08 15:11:52 UTC**, using the corrected validator.
  Raw requests and responses sit beside it. The preview verifies one new
  Seed, 10 GP, a 10,000,000 MIST planting price, 7,000,000 MIST reward-pool
  share, 2,800,000 MIST treasury share and 200,000 MIST developer share.
  Estimated network gas was 2,959,058 MIST; the wallet will review a fresh
  estimate when the owner proceeds.
- The versioned historical field read succeeded for object
  `0xb873c363d5473ab8e9d97383dc1f24e17fa37212d23115274eaff9a5010662df`
  at version `1021418439`, exactly matching the observed field.
- All **114 Season 2 tests**, **56 gate/build-policy tests**, and **14 release
  tests** passed. [`validation.json`](validation.json) records commands and
  source hashes. The new regressions cover the actual reproduction, later
  receipt recovery, rejected altered proofs, and recovery after a failed
  historical read. The lint and protected production build passed.
- Offline hotfix preservation checks prove the exact existing 106-file
  inventory, with only the Season 2 JavaScript bundle changed and the other
  **105 files byte-identical**. The Netlify source configuration is unchanged.

These are unsigned simulations and read-only chain queries. Simulated Seed
IDs are not deployed Seed IDs. No wallet connection, signature, on-chain
submission or SUI expenditure occurred during this verification. An actual
successful Season 2 planting remains the owner's next Slush action.

## Release boundary

The fixed target is site `d425445d-4980-49be-8ab2-12e7527ba281` at
`https://www.treegrow.xyz`. The hotfix baseline is deployment
`6af08867e808541bad23b5b2`, source
`ed128b295e80701067a0f74c66e6a1ae3e6b709b`, tree
`27b58ad8371191c2fe2c2c6ee79fb57e06476665`. All original source/publication
evidence remains unchanged. No contract, dependency, HTML, CSS, backend,
edge-function or access-policy change is included.

Every hotfix release operation must include `--plant-fields-hotfix`. Before
submission, the external release journal must contain `ci.json` binding the
exact saved source commit and tree to successful push and pull-request runs
of **Settlement app integration review**. Submission durably records the
source archive and candidate before its sole build request; an unknown result
blocks automatic resubmission. Follow-up operations recheck the CI evidence.

## Current guidance

The live Mysten skills README was checked on November 8, 2026, at revision
`495528ab09a75480847f5b9668adc163817bb296`. Relevant guidance used:

- `accessing-data/SKILL.md`, `accessing-data/graphql.md` and
  `accessing-data/archival.md` for versioned, confirmed object reads.
- `object-model/SKILL.md`, `object-model/dynamic-fields-and-collections.md`
  and `object-model/ownership.md` for Table field identity and ownership.
- `frontend-apps/SKILL.md`, `frontend-apps/queries.md` and
  `frontend-apps/transactions.md` for wallet and transaction lifecycle checks.
- `sui-move/SKILL.md` for routing the contract-state review.

The current Netlify deployment skill and coding context were also checked.
