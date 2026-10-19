# Version 11 contract provenance

## Result

The configured Arboretum package has a complete, immutable reconstruction target: the single `arboretum` module and the exact pre-publication bytes in its successful upgrade transaction. Official Sui mainnet 1.78.1 is the best supported build candidate: its release predates this upgrade and its precompiled dependency modules exactly match both recorded dependency versions. The compiler's identity is not embedded in the deployed module. A successful reconstruction establishes that a compiler/source/dependency combination reproduces the target, without proving which CLI binary the original developer used.

The complete public query response, upgrade transaction, package history, type origins, and derived module comparisons are in [provenance.json](provenance.json). These are read-only observations; this investigation submitted no transactions.

## Exact package and transaction

| Item | Verified value |
|---|---|
| Configured package | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724` |
| Package version | 11 |
| Package object digest | `G55ZRNKoCDhAgunVDzHgqeiVHgdofsq4FjJuBp984iia` |
| Package ownership | Immutable |
| Module inventory | Exactly one module, `arboretum`; complete pagination |
| Module byte length | 18,034 |
| Binary format | Move v7, Sui flavor 5 |
| Successful upgrade transaction | `HZRUsU9xNybZ5qSsPZV5wP1PvCEgbdsVJHur4ifFXnbw` |
| Upgrade checkpoint | 319,546,807 |
| Upgrade time | September 6, 2026, 19:55:41.102 UTC |
| Observation checkpoint | 335,880,211, October 19, 2026, 21:02:18.921 UTC |

The deployed module SHA256 is `3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5`.

The upgrade transaction contains an equally long pre-publication module with SHA256 `2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1`. These two byte arrays differ at exactly 32 byte positions: zero-based offsets 6201 through 6232. The submitted self-address is `0x0`; the published self-address is the original package address `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b`. Replacing that exact address slot reproduces every deployed byte. This supplies a direct raw-byte comparison target for an offline build using self-address `0x0`.

## Correct interpretation of the saved manifest

The saved addresses belong to older versions of the same upgrade lineage:

| Address | Actual position in lineage |
|---|---|
| `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b` | Version 1, first publication on June 21, 2026 |
| `0xcc0ddce744b32314fd69ea6f842ea2e6e37c2fc8be7591cde468a56842f64f62` | Version 3, published June 22, 2026 |
| `0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914` | Version 10, published September 2, 2026 |
| `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724` | Version 11, published September 6, 2026 |

The saved `Published.toml` labels version 3's address as `original-id`. The immutable history identifies version 1's `0x6f13…` address as the actual first publication and module self-address. The saved `published-at` correctly identifies the older version 10; it is also the exact previous-package argument in the version 11 upgrade transaction. These saved addresses are older or misrecorded metadata, not evidence of an unrelated deployment.

The full type-origin table contains 32 types. Eighteen originate at version 1, thirteen archive/challenge types originate at version 9 (`0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940`), and `SupplyDropPurchased` originates at version 6 (`0xb6f93eb9efc6a1e6760efc2d5f0e07064ed6e72665ef7401a9047f7889e551d7`). The bytecode's module self-address does not replace those individual type origins for object or event queries.

## Dependency evidence

The deployed package records these exact links:

| Dependency | Recorded version | Object digest |
|---|---:|---|
| MoveStdlib, `0x1` | 25 | `9kbT8AW15PCizPLMWACFi6vppCc9bQsVb47zYuYeThD8` |
| Sui, `0x2` | 59 | `5X7bvB2bFiKVUn1f8nybKAwugEPtTcEaZujcdiPdicfE` |

The comparison decoded the official `packages_compiled` BCS sequences and the exact linked on-chain packages' `moduleBcs` maps. It compared complete module byte arrays, independent of container ordering. The comparison covers every module, including dependency modules Arboretum does not directly import.

| Official framework revision | MoveStdlib comparison | Sui comparison |
|---|---|---|
| Saved lock revision `367fd808279bed26f7c64fc63160062a2ee29ab7` | All 22 modules byte-identical | 65 source modules versus 67 on-chain; 10 changed and 2 absent from the saved revision |
| Mainnet 1.78.1 release commit `8b9163554164776bc3372d828f8d6ced55aa2b5e` | All 22 modules byte-identical | All 67 modules byte-identical |

The ten differing Sui modules in the older revision are `accumulator`, `coin`, `config`, `derived_object`, `dynamic_field`, `funds_accumulator`, `linked_table`, `object`, `package`, and `rangeproofs`. The older revision lacks `forwarding_address` and `scratch`. These differences prevent calling that revision an exact dependency baseline. They do not, by themselves, prove it could not compile Arboretum to the same bytes: that depends on the imported interfaces, compiler behavior, and any expanded macros.

The release commit's official precompiled bundles have these SHA256 hashes:

- MoveStdlib: `931a76ad97bdb49525c1480d605c20062798749050cfddcb18c607dfde57009e`.
- Sui framework: `62274b630424b7a5f2ea822b8b81e69d7bf52cdcc7d20f4d9d1d3421a3423eb1`.

Sources: [MoveStdlib bundle](https://github.com/MystenLabs/sui/blob/8b9163554164776bc3372d828f8d6ced55aa2b5e/crates/sui-framework/packages_compiled/move-stdlib), [Sui framework bundle](https://github.com/MystenLabs/sui/blob/8b9163554164776bc3372d828f8d6ced55aa2b5e/crates/sui-framework/packages_compiled/sui-framework), and the exact-version public GraphQL query recorded in the evidence JSON. The official [framework loader](https://github.com/MystenLabs/sui/blob/367fd808279bed26f7c64fc63160062a2ee29ab7/crates/sui-framework/src/lib.rs) defines these bundles as BCS `Vec<Vec<u8>>` module bytes. GraphQL describes `moduleBcs` as alphabetically ordered pairs of module name and module bytes.

## Compiler evidence and limits

The module's binary table directory contains no metadata table (`0x10`). Format v7 and Sui flavor 5 identify serialization format, not the Sui CLI release, compiler commit, source edition, optimization choices, or source code. The table IDs and version encoding are defined by the official [binary format source](https://github.com/MystenLabs/sui/blob/mainnet-v1.78.1/external-crates/move/crates/move-binary-format/src/file_format_common.rs).

The [official mainnet 1.78.1 release](https://github.com/MystenLabs/sui/releases/tag/mainnet-v1.78.1) was published August 27, 2026, before the September 6 upgrade. The saved version 10 manifest also names toolchain 1.78.1. Together with the exact dependency byte matches, this makes 1.78.1 a well-supported reproduction candidate. The reconstruction build results are recorded separately in [build-result.json](evidence/build-result.json). A successful exact comparison demonstrates a reproducible toolchain combination; it does not identify the original developer's binary or prove that no other compiler version could produce the same bytes.

The [official mainnet 1.79.1 release](https://github.com/MystenLabs/sui/releases/tag/mainnet-v1.79.1) was published September 9, after the upgrade. Its use in earlier local characterization tests does not establish the original build compiler.

This provenance investigation supplies the exact byte target, correct lineage,
complete package inventory, and matching dependency revision. The subsequent
[build](evidence/build-result.json) and
[comparison](evidence/bytecode-comparison.json) now establish exact source-to-target
reproduction, including all locally compiled dependency modules. Reward-settlement
policy and the separate payout correction remain unresolved by this reconstruction.
