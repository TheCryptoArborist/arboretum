# Independent source and test review

Reviewed candidate source SHA256:
`91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb`.

Reviewed test fragment SHA256:
`404a4808f62b4fa1291153257918e75dc5674557d94916595e2955b9a1bcecbc`.

The implementation, test authoring, and verification tooling were reviewed as
separate workstreams. This records the source and test review; the executable
results are in [evidence](evidence/verification-summary.json). It is not a third
party audit, a frontend test, or an on-chain deployment simulation.

## Production paths reviewed

The review traced every production write to GP, death state, watering time, and
protection. Both planting routes, watering after its timestamp change, each
tool's final state, death, both revivals, and abandonment synchronize the
prospective eligible contribution. No missing synchronization path remained in
the reviewed source.

Both payout routes use the same settlement helper. The original eligible
denominator and funded pool remain fixed, the processed marker is checked
before a Seed's points are cleared, and positive transfers reconcile cumulative
paid amounts with the remaining balance. Archived claims use the same moved
settlement state after direct claims. Multiplication uses `u128`.

The review checked version guards, Seed/Archive Registry binding, capability
binding, Clock gates on funding, cutoff finalization, fixed claim deadlines,
zero-value processing, and the deliberate separation of gameplay pause from
earned reward claims.

## Issue identified and corrected

The first candidate bound AdminCap to a Registry but also required challenge
administration to match the administrator address captured when the
ChallengeBook was created. Transferring AdminCap and updating Registry.admin
could strand the existing book: the old administrator lacked the cap and the
new cap holder did not match the old snapshot.

The corrected candidate authorizes challenge administration by possession of
the correctly versioned, Registry-bound cap. Archived sweeping follows the same
principle. The saved address remains provenance. Actual transaction-scenario
tests cover administrative transfer followed by use of an existing book and
sweeping an existing archive.

## Test review

The final fragment contains 71 added tests, including 44 expected failures.
Together with four retained Canopy tests in each module, the verifier expects
79 named VM results.

The all-order test executes real direct claims for every permutation of three
Seeds, checks each Seed's fixed pool delta, checks the original pool and
denominator after each claim, and checks the residual. It does not merely call
an isolated copy of the payout formula.

The direct-to-archive lifecycle test calls the real reset entry point, receives
the resulting shared Archive, and retrieves actual 400-MIST and 600-MIST Coin
transfers from a 1,001-MIST pool, leaving 1 MIST. The late-archive test retrieves
a 400-MIST direct payment and 601-MIST treasury sweep, reconciling both to the
original 1,001 MIST.

Replay fixtures assert the first claim and processed accounting before the
forbidden second call. Expected-failure helpers end with a distinct
`abort 0xC0FFEE`, which cannot satisfy the expected contract guard codes. The
review found no matching cleanup-abort path that could produce a false pass.

Counter, cutoff, protection, owner, Registry, version, deadline, and funding
fixtures combine compact constructed states with real lifecycle and transfer
scenarios. No additional payout defect or test requirement remained after the
reviewed correction.

## Integration observations retained

- `seed_state_live` remains a wall-clock gameplay view. After cutoff, payout
  status must use the recorded cutoff contribution and processed marker.
- New native inventory types differ from legacy inventory; no conversion or
  legacy compensation is implemented in this draft.
- Generic NFTree parameters can borrow another module's object as an opaque
  identity. Type isolation applies to typed mutation and payout paths, not to
  every possible generic object-ID borrow.
- The unchanged legacy module remains callable for legacy objects and retains
  its historical behavior. The new module protects new objects and new funds.
