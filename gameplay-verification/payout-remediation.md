# Next implementation: consistent season reward settlement

**Implemented follow-up:** The separate
[`contract-payout` candidate](../contract-payout/README.md) now implements and
tests fixed cutoff eligibility and common direct/archive settlement for new,
versioned objects. It preserves the deployed legacy module byte for byte and
documents a separate treatment for existing seasons and processed claims. The
policy below is realized as a review candidate; no on-chain activation or
legacy payout migration has occurred.

## Problem established by execution

The current direct claim can reclassify a Seed as dead after the season has ended
and remove its Growth Points without a payout. Care actions are already closed.
The deployed unsigned simulation establishes that behavior directly.

The accepted saved source also pays differently through the direct and archived
paths, and removes ineligible points lazily during claims. The actual local VM
tests show that this changes another player's payout based on claim order.
Changing only the frontend's success message does not correct either payout rule.

## Recommended settlement design for review

Use the season's recorded cutoff as the time for determining final eligibility,
including drought and protection expiry, then finalize the eligible denominator
before allowing rewards to be claimed. Direct and archived claims should consume
the same finalized entitlement rules and accounting record.

The following policy details need an explicit project decision before an upgrade
implements them. These are design choices with economic consequences, not
permissions needed to continue ordinary code investigation:

1. Whether drought/protection eligibility freezes at the season cutoff. This is
   the recommended rule because players cannot continue watering after cutoff.
2. Whether points from Seeds ineligible at cutoff are excluded before anyone can
   claim, redistributing the pool among eligible points, or whether those shares
   remain unclaimed under a documented residual-funds rule.
3. Claim deadline, rounding/residual handling, and treatment of any already
   processed claims. Existing paid amounts must not be silently recalculated.

An immutable denominator alone is insufficient if it includes points intended to
be excluded. A cutoff-only drought fix also leaves the current lazy-denominator
behavior unresolved. Establish both eligibility and the denominator before claim
execution, with bounded processing that fits actual on-chain object/gas limits.

## Source reconciliation comes first

**Completed follow-up:** [the verified reconstruction](../contract-reconstruction/README.md)
reproduces the version-11 upgrade's exact module bytes and all linked framework
modules. Use `contract-reconstruction/source/arboretum.move` with its pinned build
inputs as the reference for the separate payout candidate. The historical saved
production source/manifests described below remain unchanged. Seven Move tests on
the reconstructed baseline now reproduce the original characterization results.

The configured deployed package is version 11 at
`0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`.
The accepted repository's Move source/manifests do not establish a reproducible
whole-package match to that deployment. Existing Season 1 candidate PRs contain
separate proposed changes and historical tests; they are not proof of current
deployed behavior or an already approved upgrade baseline.

Recover or reconstruct the authoritative source and lock dependencies/compiler;
compare its bytecode, struct layouts, type origins, public entry signatures,
upgrade lineage, and current package configuration against the immutable deployed
package. Verify the proposed upgrade against that source before it is offered for
signing. The current characterization harness deliberately leaves every saved
production function unchanged.

## Acceptance criteria for the correction

- A Seed with the same final eligibility receives the same entitlement through
  direct and archived claim paths.
- Delaying a claim within its allowed window does not change eligibility or
  entitlement after care has closed, if cutoff freezing is the selected policy.
- Reordering eligible and ineligible claims does not change any player's share
  except an explicitly approved bounded rounding policy.
- Total paid plus remaining/residual funds equals the funded settlement pool;
  a completed claim cannot be paid again.
- Paused state, archive transitions, claim deadlines, zero-point/zero-pool cases,
  protection at the cutoff, wrong owners, and wrong seasons have explicit outcomes
  and meaningful executable tests.
- Wallet results distinguish execution failure, unresolved confirmation, and
  confirmed positive payout. A `SeedDied`-only execution never becomes a payout
  success notification.

Prepare this as a separate contract candidate with synthetic tests and unsigned
validation first. Starting or archiving the current mainnet season is not a
substitute for correcting and reviewing settlement behavior.
