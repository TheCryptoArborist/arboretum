# Arboretum Pre-Live Contract Fixes

This package includes the revive/reset contract update plus the final pre-live fixes found during review.

## Contract changes

- `claim_reward` now matches the current front-end call shape: `Registry`, `Seed`, `Clock`.
- `reset_season` is blocked until the 100-day season plus a 7-day claim grace window has passed.
- `apply_tool` now honors Tool `charges` and returns the Tool with one fewer charge when charges remain.
- `revive_seed_with_tool` now consumes only one Revival Kit charge and returns the Tool when charges remain.
- Regular `apply_tool` calls are blocked when a Seed is already dead by drought timing.
- `seed_state_live` now respects an active Bottomless Can expiry instead of showing the Seed as dead during protected time.
- Added season view helpers for season end and claim deadline timestamps.

## Verification

- `sui move build` passed.
- `sui move test` passed. The package currently has 0 Move unit tests.

## Front-end note

The matching front-end package should use `revive_seed_with_tool` directly for crate-purchased Revival Kits on dead Seeds. Do not use the old workaround sequence of `apply_tool -> water_seed -> revive_seed`.
