# Offline bytecode comparator

The release-baseline gate is **exact equality with the module bytes submitted in the successful version 11 upgrade transaction**. The comparator also establishes the precise relationship between those submitted bytes and the deployed module: the only change is the publisher's 32-byte self-address rewrite. A fully resolved, per-function comparison supplies diagnostics and an independent coverage check.

## Run

```sh
python3 contract-reconstruction/compare_bytecode.py \
  --candidate /absolute/path/to/build/arboretum/bytecode_modules/arboretum.mv \
  --target prepublication \
  --require-exact \
  --output /absolute/path/to/comparison.json

python3 contract-reconstruction/comparator-tests/test_comparator.py \
  --json-output contract-reconstruction/comparator-tests/latest-result.json
```

The first command is entirely offline. It reads the compiled candidate and already saved evidence; it neither builds nor submits a transaction. Exit status 0 means the requested gate passed, 1 means a comparison found differences, and 2 means malformed, unsupported, missing, or unpinned input prevented a comparison.

The optional `--target deployed` compares directly against the published module. Compiling at address zero will ordinarily fail exact equality with that target because the publisher rewrites the module's self address. The prepublication target avoids accepting an arbitrary address substitution as an exact reproduction.

## Evidence identity

| Evidence | Identity |
|---|---|
| Deployed package | `0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724`, version 11 |
| Package digest | `G55ZRNKoCDhAgunVDzHgqeiVHgdofsq4FjJuBp984iia` |
| Defining module identity | `0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum` |
| Upgrade transaction | `HZRUsU9xNybZ5qSsPZV5wP1PvCEgbdsVJHur4ifFXnbw` |
| Submitted module SHA-256 | `2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1` |
| Deployed module SHA-256 | `3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5` |
| Size of each module | 18,034 bytes |

The comparator pins the complete saved deployed GraphQL response, its disassembly, the complete provenance evidence, the canonical upgrade transaction JSON, and both module hashes. It checks the version, package identifier, digest, successful transaction, previous package, dependency identifiers, and the upgrade's single-module count.

The prepublication module contains a zero self address. Decoding its module handle and address table identifies the address at byte offsets **6201 through 6232 inclusive**. Replacing exactly those 32 bytes with the deployed defining address produces byte-for-byte equality with the independently pinned deployed module. No other byte differs. The comparator derives this span from the tables rather than substituting text throughout the module.

## What the structural comparison covers

It decodes binary tables directly. Values abbreviated by the GraphQL disassembler, such as `1000..`, cannot be treated as complete constants.

- All **96 production function definitions**, including the generic `plant_seed_with_nftree<T>` function.
- Exact parameter and return signatures, generic ability constraints, visibility, entry/native flags, local signatures, and ordered instruction streams.
- Full call identities, signatures, and generic instantiations; full field owners, names, offsets, and types; struct pack/unpack targets and layouts.
- All **32 struct definitions**, including ordered fields, abilities, type parameters, and phantom flags.
- Every constant's type, complete raw bytes, and fully decoded BCS value. Integers are decimal strings in the JSON so no downstream JavaScript precision is lost.
- Every entry in the module, datatype, function, field, instantiation, signature, constant, identifier, address, friend, and metadata tables, including unused entries and duplicates.
- Module identity, bytecode version 7, and Sui flavor 5.

The actual table counts are 14 module handles, 44 datatype handles, 128 function handles, 77 function instantiations, 156 signatures, 81 constants, 262 identifiers, 3 addresses, 32 struct definitions, 96 function definitions, and 56 field handles. Struct-instantiation, field-instantiation, friend, and metadata tables are absent in the reference.

An independent check compares all 96 function names and ordered opcode streams with the saved GraphQL disassembly. Constants and instruction operands are resolved from binary bytes, not from that display.

### Representation differences

Structural comparison treats table entries as sorted multisets after resolving their references. This permits a compiler to reorder a constant pool, for example, **only if every use still resolves to exactly the same type and value**. Such a result remains `exact_binary_match: false` and fails `--require-exact`. Branch offsets, local positions, field order, instruction order, opcode choices, and constant bytes are never optimized or rewritten for comparison.

An optional `--address-map CANDIDATE=DEPLOYED` is available for diagnosis. It is one-to-one, rejects absent addresses and collapsing mappings, and is explicitly recorded. It applies only to module/address identifier tables. It never rewrites address literals in constants. A structural match with this option is labeled conditional. The release-baseline exact comparison uses no address map.

## Fail-closed boundary

This decoder deliberately supports only the applicable Sui v7 module format without enums or deprecated global-storage operations. An enum table, enum instruction, nonempty jump table, deprecated global-storage instruction, unknown table, unknown opcode, unknown signature tag, unknown flag, malformed index, unsupported constant type, truncated value, noncanonical ULEB128, duplicate table, gap/overlap, or trailing byte is an error. None is silently ignored.

This tool is a comparator, **not the Sui bytecode verifier**. It does not prove stack typing, resource safety, package upgrade compatibility, absence of economic bugs, or correctness of payout rules. The normal Sui build/verifier remains required. Package linkage and type-origin provenance are documented separately in `provenance.json` and `provenance-notes.md`.

## Negative checks

The 20 tests modify the actual pinned module bytes. They cover changed payment amounts, call targets, branches, arithmetic comparison instructions, ordered layouts, abilities, return signatures, generic constraints, phantom flags, and entry flags. They also check missing signatures, unsupported binary features, truncated/trailing data, a missing generic function in disassembly, provenance tampering, and address-map boundaries. A positive constant-pool reordering check demonstrates the distinction between resolved structural equality and exact binary equality. The exact 20-test count and zero skips are enforced by the test runner.

## Primary format references

The decoder was checked against these official Rust definitions at commit `367fd808279bed26f7c64fc63160062a2ee29ab7`:

- [Binary constants, tables, serialized types, opcodes, bounds and version/flavor encoding](https://github.com/MystenLabs/sui/blob/367fd808279bed26f7c64fc63160062a2ee29ab7/external-crates/move/crates/move-binary-format/src/file_format_common.rs), blob `8cc696bceee975c9ea5cc2cc7477a71888814bb5`.
- [Binary deserializer](https://github.com/MystenLabs/sui/blob/367fd808279bed26f7c64fc63160062a2ee29ab7/external-crates/move/crates/move-binary-format/src/deserializer.rs), blob `470c0eb4f59b4c44f1c9d58eef8642f22ccce5f0`.
- [Function flags, visibility, abilities and in-memory structures](https://github.com/MystenLabs/sui/blob/367fd808279bed26f7c64fc63160062a2ee29ab7/external-crates/move/crates/move-binary-format/src/file_format.rs), blob `3f6cc11043855e65be77a30bd0b9894bb3e6c570`.

These references specify the decoder's format interpretation. Their commit is not evidence of the historical developer's compiler choice. The reproducible compiler/dependency combination and on-chain dependency comparison are recorded by the build and provenance workflow.
