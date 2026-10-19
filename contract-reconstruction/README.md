# Verified deployed contract reconstruction

## Result — 19 October 2026

**The version-11 contract source has been reconstructed and verified byte for
byte.** The non-test build reproduces the exact 18,034-byte module submitted in
the successful September 6 upgrade. Applying the single self-address rewrite
observed in that transaction reproduces every byte of the deployed module.

The source mismatch identified in the earlier
[preflight](../gameplay-verification/source-baseline-preflight.md) is resolved.
This directory is the verified reference for the separate season-payout
correction. It preserves the existing payout behavior, including the problems in
[payout-remediation.md](../gameplay-verification/payout-remediation.md).
The tester-preview milestone remains complete as reported by Peter.

| Verification | Result |
|---|---|
| Reconstructed Arboretum module | Exact match: 18,034 of 18,034 bytes |
| Production functions | 96 of 96 match, including instructions and operands |
| Struct definitions | 32 of 32 match, including field order, abilities, and type parameters |
| Constants, signatures, handles, and other binary tables | Exact match; complete constant values |
| Publication transformation | Only the 32-byte self-address field changes; all other bytes match |
| Locally compiled MoveStdlib dependency | All 22 modules match linked version 25 |
| Locally compiled Sui framework dependency | All 67 modules match linked version 59 |
| Move VM tests | 7 passed: four existing Canopy tests and three payout characterizations |
| Comparator checks | 20 passed, including deliberate mutations to deployed bytecode |

The source was compiled with Sui `1.78.1-722ac4fcf484` and framework revision
`8b9163554164776bc3372d828f8d6ced55aa2b5e`. The compiler archive, executable,
framework archive, and extracted source files are hash-checked. This establishes
a reproducing toolchain combination; it does not identify the original
developer's executable or prove that no other toolchain can reproduce it.

## Source restored

[source/arboretum.move](source/arboretum.move) starts from the saved production
source. It adds the deployed `buy_boom_chest` and `buy_victory_chest` wrappers and
restores partner handling in `buy_crate`, `send_promo_crate`, and `open_crate`.
The deployed prices, tool charges, distributions, random-call order, events,
and accounting are preserved.

All other 109 saved function bodies, including 18 test-only functions and
helpers, remain textually identical. The original `contract/sources/arboretum.move`
and its saved manifests remain historical inputs; they have not been overwritten.
The complete comparison establishes that the five restored functions account for
the production bytecode differences in this reconstruction.

See [partner-reconstruction-notes.md](partner-reconstruction-notes.md) for the
exact BOOM/Victory behavior and [provenance-notes.md](provenance-notes.md) for the
upgrade history, dependency evidence, and type origins.

## Exact identities

| Item | Value |
|---|---|
| Configured package | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`, version 11 |
| Successful upgrade transaction | `HZRUsU9xNybZ5qSsPZV5wP1PvCEgbdsVJHur4ifFXnbw` |
| Original defining package | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` |
| Reconstructed source SHA-256 | `14cec739964acbdd077b8231339992265e9014778e50ba52af06ca0e10c312d1` |
| Compiled/submitted module SHA-256 | `2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1` |
| Deployed module SHA-256 | `3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5` |

The unpublished compiler output uses self-address `0x0`. The upgrade changes
only the address-table slot at zero-based bytes 6201 through 6232 to the original
defining address. The comparator derives that slot from the binary tables and
verifies the complete resulting byte array. It does not globally replace zero
bytes or assume arbitrary address equivalence.

The saved `Published.toml` references version 3 as `original-id` and version 10
as `published-at`. Both addresses belong to this same lineage. The recovered
history identifies version 1 as the true first publication. Individual type
origins are also preserved: 18 types originate at version 1, 13 at version 9,
and `SupplyDropPurchased` at version 6. The module self-address does not replace
those individual object/event type origins.

## Evidence and executable checks

- [provenance.json](provenance.json): public query, complete package inventory,
  successful upgrade and submitted bytes, version history, linkage, type origins,
  and dependency comparisons.
- [evidence/build-result.json](evidence/build-result.json): actual compiler and
  source identities, every framework input file hash, generated manifest/lock,
  compiled dependency comparisons, and compiled module bytes.
- [evidence/bytecode-comparison.json](evidence/bytecode-comparison.json): exact
  match, all 96 function comparisons, binary tables, and publication-address proof.
- [evidence/characterization-result.json](evidence/characterization-result.json)
  and [evidence/characterization.log](evidence/characterization.log): seven actual
  Move VM test outcomes on a separate test-only copy.
- [comparator-tests/latest-result.json](comparator-tests/latest-result.json):
  the comparator's 20 checks. See [comparator-design.md](comparator-design.md) for
  the supported binary format and validation rules.

The comparator detects changes to payment amounts, call targets, control flow,
instructions, field order, abilities, signatures, generic constraints, phantom
flags, entry flags, and literal addresses. Malformed or unsupported bytecode and
tampered evidence are rejected. A correctly relinked constant-table permutation
can be structurally equivalent, but fails the exact-byte gate used here.

The three payout tests still reproduce the direct/archive discrepancy and the
claim-order discrepancy, and preserve the checked conservation/replay boundary.
Their passing status confirms existing behavior on the verified baseline; it
does not mean the payout defects have been corrected.

## Reproduce locally

Requirements: Linux x86-64, Python 3.11 or later, and space for the official
compiler archive. Downloads are public, hash-pinned MystenLabs assets. After
preparation, compilation and tests use local inputs and an empty keystore with
a loopback client configuration. From the repository root:

```sh
python3 contract-reconstruction/prepare_toolchain.py \
  --work-dir /tmp/arboretum-v11-tools

python3 contract-reconstruction/build_reconstruction.py \
  --compiler /tmp/arboretum-v11-tools/sui \
  --compiler-archive /tmp/arboretum-v11-tools/sui-mainnet-v1.78.1-ubuntu-x86_64.tgz \
  --framework-dir /tmp/arboretum-v11-tools/framework-8b9163554164776bc3372d828f8d6ced55aa2b5e \
  --framework-archive /tmp/arboretum-v11-tools/framework-8b9163554164776bc3372d828f8d6ced55aa2b5e.tar.gz \
  --work-dir /tmp/arboretum-v11-build \
  --run-characterization-tests

python3 contract-reconstruction/compare_bytecode.py \
  --candidate /tmp/arboretum-v11-build/generated/build/arboretum/bytecode_modules/arboretum.mv \
  --target prepublication --require-exact \
  --output contract-reconstruction/evidence/bytecode-comparison.json

python3 -m unittest discover -s contract-reconstruction/comparator-tests -v
```

The generated build manifest deliberately uses local framework dependencies,
the historical source edition, and unpublished self-address `0x0` to reproduce
the recorded bytes. It is generated outside the repository and is not a
publication manifest. No production `Published.toml` is deleted or rewritten.
The compiler's note about disabling automatic dependencies is expected because
this build pins the matching framework sources.

[The reconstruction workflow](../.github/workflows/contract-reconstruction.yml)
repeats preparation, exact compilation/dependency checks, the seven Move tests,
the exact-byte comparison, and comparator tests on GitHub. It has read-only
repository permissions and no deployment or transaction step.

## Next implementation

Use this verified source as the reference for a separate payout candidate.
The proposed correction determines eligibility at the season cutoff, finalizes
eligible Growth Points before claims, and uses common entitlement rules for
direct and archived claims. Its policy proposal must cover ineligible shares,
residual funds, deadlines, and already processed claims.

That candidate should change the relevant payout bytecode while preserving
upgrade compatibility and unrelated gameplay behavior. Its acceptance tests
must verify delay/order invariance, consistent direct/archive entitlements,
conservation, and prevention of repeat payment. The baseline comparison in this
directory should continue to pass unchanged as the reference for that work.

No payout-policy correction, merge, production publication, package upgrade,
season administration, price activation, signature, or payment occurred in this
reconstruction step.
