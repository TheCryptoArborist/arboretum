# Payout characterization in the Move VM

**Result on 2026-10-19: 3 tests executed, 3 passed.** These are characterization
tests: passing reproduces the accepted source's current payout behavior, including
route and claim-order differences. It does not approve a release or select a new
economic policy.

The tests run against a hash-checked copy of
[`contract/sources/arboretum.move`](../../contract/sources/arboretum.move) from commit
`bea71961a1ec9c1b0fec63535c90c6eb941a8c03`. The runner appends only test helpers and
tests inside the copied module. It verifies that removing the appended fragment
reconstructs the baseline exactly and that the repository source stays unchanged.
The repository contract has not been edited.

## Executed cases

Every amount below is a synthetic quantity in MIST. No wallet, real funds, or
deployed object was used in these tests.

| Case | Fixture and actual contract calls | Assertions confirmed by the VM |
| --- | --- | --- |
| Direct versus archived claim | Equivalent 100-GP seeds, 1,000-MIST pools, last watering nine days before cutoff. Both satisfy the baseline's not-dead-at-cutoff predicate. Compare direct claim two days after cutoff with `reset_season` at cutoff + 24 hours and archived claim at cutoff + two days. | Direct claim marks the seed dead, removes its GP, pays zero, and leaves all 1,000 in the pool. The archived route transfers a 1,000-MIST coin and drains its pool. |
| Claim order with a seed already dead by elapsed time | Each copy starts with 1,000 MIST, eligible seed A with 40 GP, and seed B with 60 GP whose last watering is eleven days before cutoff. Claims run two days after cutoff. | A-first pays A 400 and leaves 600 after B's death is processed. B-first removes B's GP before A claims, so A receives 1,000 and nothing remains. Paid amount plus remaining pool equals 1,000 in both orders. |
| Partial direct claim followed by archive and replay | Two eligible seeds with 40 and 60 GP share 1,000 MIST. A claims directly before reset; B claims from the resulting archive. Then A attempts an archived claim. | A receives 400, archive starts with 600 MIST and 60 GP, B receives 600, and the archive reaches zero pool and zero GP. A's replay aborts with `E_NO_SEEDS` (7). |

The tests call the actual `claim_reward`, `reset_season`, and
`claim_archived_reward` functions. They inspect transferred `Coin<SUI>` objects
through `sui::test_scenario`, as well as seed and pool accounting. The replay case
requires the specific expected abort; an unexpected successful return produces a
different sentinel abort and fails the test.

## Evidence and source locations

- [Exact test output](latest-move-tests.log).
- [Machine-readable execution record, hashes, and assertions](latest-result.json).
- [Three tests and synthetic fixture helpers](payout-characterization.move.inc).
- [Reproduction runner](run_payout_characterization.py).
- Baseline direct claim: `contract/sources/arboretum.move`, `claim_reward` at line 1493.
- Baseline archived claim: `claim_archived_reward` at line 1540.
- Mutable GP removal: `remove_seed_growth_points` at line 429 and `mark_seed_dead` at line 449.
- Archive creation: `reset_season` at line 579 and `archive_current_season` at line 595.

The exact compiler was **`sui 1.79.1-808640d9b49a`**. Dependencies were the local
Sui framework and Move standard library from revision
`58386edc269ef88ff0f40ab0a9d50e87cba80ca8`, matching the pinned PR #4 guidance.

| Input | SHA-256 |
| --- | --- |
| Accepted baseline source | `f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2` |
| Official compiler release archive | `547b3091e975b8a6b4078473a3868d86e985156b6715a8c4afb7fd7313a36abf` |
| Extracted compiler binary | `042b9fcaaeff95cef083795e577cc30b28f52bd9d71a0e38b2e51c38d2977d8b` |
| Framework source archive from the pinned commit | `37e674620b243a060a438e81987b4e392e3773bbefb1ee22b3a601aa3616ef49` |

Official inputs:

- [Sui mainnet-v1.79.1 Ubuntu x86_64 archive](https://github.com/MystenLabs/sui/releases/download/mainnet-v1.79.1/sui-mainnet-v1.79.1-ubuntu-x86_64.tgz).
- [Framework source at the pinned revision](https://codeload.github.com/MystenLabs/sui/tar.gz/58386edc269ef88ff0f40ab0a9d50e87cba80ca8).

## Reproduce

Use Python 3.11 or newer and the compiler release above on Linux x86_64. Download
the two official inputs and verify the listed hashes. Extract `sui` from the
compiler archive. From the source archive, extract these two directories into a
common `framework` directory, preserving their contents:

```text
crates/sui-framework/packages/sui-framework
crates/sui-framework/packages/move-stdlib
```

The result must contain `framework/sui-framework/Move.toml` and
`framework/move-stdlib/Move.toml`. The runner uses these local directories; it
requires the caller to supply the verified pinned framework tree.

From the repository root, run the following with absolute paths to those inputs
and a work directory outside the repository:

```bash
python gameplay-verification/contract-tests/run_payout_characterization.py \
  --compiler /absolute/path/to/compiler/sui \
  --compiler-archive /absolute/path/to/sui-mainnet-v1.79.1.tgz \
  --framework-dir /absolute/path/to/framework \
  --work-dir /absolute/path/to/payout-vm-work
```

The runner verifies the compiler version and the supplied release archive,
checks the source hash before and after execution, and selects exactly the three
`payout_` tests. It writes the latest log and JSON result beside this README. A
successful process exit requires all three tests to pass. Generated packages,
build output, and compiler configuration stay in the separate work directory.

`SUI_CONFIG_DIR` points to a local-only configuration with an empty keystore and
no active address. `MOVE_HOME` places the package cache in the work directory.
The `--build-env mainnet` flag selects the local compilation environment; this
test command does not submit transactions or require a live RPC connection.

## Remediation boundary

These fixtures establish what the source does. They do not decide who should be
eligible or how a forfeited share should be allocated. In particular:

- Eligibility at the season cutoff versus eligibility at the time of claim is
  an economic rule. Applying either rule consistently can change entitlements.
- A fixed season denominator versus redistribution after excluding dead seeds
  changes payment amounts. Removing dead GP immediately before a claim does not
  by itself make previous and subsequent claims equal under a common allocation.
- Handling already-paid claims, remaining balances, and the current deployed
  season requires an explicit migration or reconciliation decision.

Work that does not select those rules can proceed: report transaction effects
and actual reward events accurately, distinguish a successful zero-payment
death transition from a paid reward, retain these reproductions, and reconcile
source provenance before preparing a contract upgrade. Any contract correction
should state its chosen eligibility clock and allocation basis, use them across
direct and archived claims, and verify conservation and prevention of repeat
payment. These tests provide the concrete before-state for that review.

## Limits

This is a focused local Move VM result, not a complete gameplay audit. Synthetic
fixtures bypass planting and watering entry functions to isolate the payout
paths. The passing replay and conservation case covers its stated fixture; it
does not prove every possible sequence. The harness does not establish that this
repository source compiles to the deployed package. It has not published,
upgraded, called, simulated, paused, reset, archived, or funded a real package.
