#!/usr/bin/env python3
"""Fail-closed bytecode inspection of the separate settlement-module candidate.

The original module must equal the actual version-11 upgrade input, byte for
byte. The candidate adds a different module and different object types. This
inspection is evidence of that boundary, not an on-chain upgrade simulation or
a general security audit of the new implementation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / 'contract-reconstruction'))
import compare_bytecode as C

ZERO = C.address('0')
LEGACY_MODULE = ZERO + '::arboretum'
NEW_MODULE = ZERO + '::settlement'
LEGACY_CAP = LEGACY_MODULE + '::AdminCap'
BOOTSTRAP = 'create_settlement_registry'
CORE_TYPES = ('Registry', 'Seed', 'SeasonArchive', 'AdminCap')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def datatype_ids(value) -> set[str]:
    result = set()
    if isinstance(value, dict):
        if 'datatype' in value:
            result.add(value['datatype'])
        for child in value.values():
            result.update(datatype_ids(child))
    elif isinstance(value, list):
        for child in value:
            result.update(datatype_ids(child))
    return result


def inspect(legacy: C.Module, candidate: C.Module) -> tuple[dict, dict]:
    deployed, deployed_proof = C.load_pinned_deployed()
    baseline, publisher_proof = C.load_pinned_prepublication(
        deployed, REPO / 'contract-reconstruction/provenance.json')
    legacy_comparison = C.compare_modules(baseline, legacy)
    legacy_comparison['comparison_target'] = 'prepublication'
    legacy_comparison['prepublication_provenance'] = publisher_proof
    legacy_comparison['deployed_evidence'] = deployed_proof
    legacy_comparison['target'] = legacy_comparison.pop('deployed')
    legacy_comparison['exit_gate'] = 'exact_binary_match'
    require(legacy_comparison['exact_binary_match'],
            'Legacy module differs from the pinned successful version-11 upgrade input')
    require(legacy.module_id(legacy.self_index) == LEGACY_MODULE,
            'Unexpected legacy module identity')
    require(candidate.module_id(candidate.self_index) == NEW_MODULE,
            'New module must have the distinct unpublished identity 0x0::settlement')

    definitions = [candidate.struct(i) for i in range(len(candidate.tables[10]))]
    by_name = {row['id'].rsplit('::', 1)[-1]: row for row in definitions}
    require(all(name in by_name for name in CORE_TYPES),
            'Missing new Registry, Seed, SeasonArchive, or AdminCap definition')
    require(all(row['id'].startswith(NEW_MODULE + '::') for row in definitions),
            'A newly defined type has a legacy or foreign identity')
    require(all('key' in by_name[name]['abilities'] for name in CORE_TYPES),
            'New protected object types must have the key ability')
    legacy_ids = {legacy.struct(i)['id'] for i in range(len(legacy.tables[10]))}
    require(not (legacy_ids & {row['id'] for row in definitions}),
            'New and legacy struct identities overlap')
    require(not any(identifier.startswith(LEGACY_MODULE + '::')
                    for row in definitions for identifier in datatype_ids(row)),
            'New object storage must not embed a legacy object or capability')

    handles = [candidate.datatype_id(i) for i in range(len(candidate.tables[2]))]
    legacy_handles = sorted({identifier for identifier in handles
                             if identifier.startswith(LEGACY_MODULE + '::')})
    require(legacy_handles == [LEGACY_CAP],
            'Only the legacy AdminCap may cross the module boundary for bootstrap')
    functions = candidate.functions()
    require(BOOTSTRAP in functions, 'Missing explicit settlement bootstrap')
    bootstrap = functions[BOOTSTRAP]
    require(bootstrap['entry'] or bootstrap['visibility'] == 'public',
            'Settlement bootstrap is not callable')
    expected_cap = {'reference': {'datatype': LEGACY_CAP, 'type_arguments': []}}
    legacy_parameters = [value for value in bootstrap['parameters']
                         if any(identifier.startswith(LEGACY_MODULE + '::')
                                for identifier in datatype_ids(value))]
    require(legacy_parameters == [expected_cap],
            'Bootstrap must take exactly one immutable legacy AdminCap reference')
    require(not datatype_ids(bootstrap['returns']) & {LEGACY_CAP},
            'Bootstrap must not return a legacy capability')

    legacy_type_uses = []
    legacy_calls = []
    for name, function in functions.items():
        parameter_uses = sorted(identifier for identifier in datatype_ids(function['parameters'])
                                if identifier.startswith(LEGACY_MODULE + '::'))
        other_uses = sorted(identifier for identifier in datatype_ids(
            [function['returns'], function['locals']])
                            if identifier.startswith(LEGACY_MODULE + '::'))
        if parameter_uses or other_uses:
            require(name == BOOTSTRAP and parameter_uses == [LEGACY_CAP] and not other_uses,
                    f'Unexpected legacy type in {name}: {parameter_uses + other_uses}')
            legacy_type_uses.append({'function': name, 'parameters': parameter_uses,
                                     'immutable_capability_only': True})
        for instruction in function['code'] or []:
            if instruction['op'] == 'Call':
                target = instruction['function']['id']
            elif instruction['op'] == 'CallGeneric':
                target = instruction['function_inst']['target']['id']
            else:
                continue
            if target.startswith(LEGACY_MODULE + '::'):
                legacy_calls.append({'caller': name, 'target': target})
    require(not legacy_calls, 'The new module calls mutable legacy implementation paths')
    require(len(legacy_type_uses) == 1, 'Ambiguous legacy capability bootstrap boundary')

    public_abis = [{key: value for key, value in function.items()
                    if key in ('id', 'parameters', 'returns', 'type_parameters', 'visibility', 'entry')}
                   for _, function in sorted(functions.items())
                   if function['entry'] or function['visibility'] == 'public']
    report = {
        'schema_version': 1,
        'status': 'ADDITIVE_MODULE_WITH_BYTE_EXACT_LEGACY',
        'completed_at_utc': datetime.now(timezone.utc).isoformat(),
        'inspector_sha256': C.sha256(Path(__file__).read_bytes()),
        'legacy': {
            'module_id': LEGACY_MODULE,
            'sha256': C.sha256(legacy.data),
            'exact_v11_prepublication_match': True,
            'functions_unchanged': len(legacy.functions()),
            'struct_layouts_unchanged': len(legacy.tables[10]),
            'every_binary_table_unchanged': True,
        },
        'added_module': {
            'module_id': NEW_MODULE,
            'sha256': C.sha256(candidate.data),
            'size_bytes': len(candidate.data),
            'function_count': len(functions),
            'struct_count': len(definitions),
            'struct_definitions': definitions,
            'public_and_entry_signatures': public_abis,
        },
        'type_isolation': {
            'core_type_identities': {name: {'legacy': LEGACY_MODULE + '::' + name,
                                             'new': NEW_MODULE + '::' + name}
                                     for name in CORE_TYPES},
            'overlapping_defined_type_ids': [],
            'legacy_type_references': legacy_type_uses,
            'legacy_function_calls': legacy_calls,
            'legacy_types_in_new_object_fields': [],
        },
        'signed_or_submitted_transactions': False,
        'limitations': [
            'This proves preservation of existing module bytes and separation of newly defined object types.',
            'New settlement objects cannot be supplied where legacy Registry, Seed, or SeasonArchive types are required.',
            'A legacy generic NFTree:key parameter can still borrow a new object as an opaque object ID; it cannot treat that object as a legacy Seed or mutate its settlement fields.',
            'The legacy version-11 module remains callable for legacy objects and retains its existing payout behavior.',
            'No existing object, historical claim, reward balance, published package, or frontend configuration is migrated by this build.',
            'The new module requires an explicit bootstrap transaction after a separately reviewed deployment.',
            'This is not a signed upgrade, an on-chain upgrade-capability check, a deployment simulation, or a security audit.',
        ],
    }
    return report, legacy_comparison


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy', type=Path, required=True)
    parser.add_argument('--settlement', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--legacy-comparison-output', type=Path)
    args = parser.parse_args()
    try:
        report, comparison = inspect(C.Module(args.legacy.read_bytes()),
                                     C.Module(args.settlement.read_bytes()))
        if args.legacy_comparison_output:
            args.legacy_comparison_output.parent.mkdir(parents=True, exist_ok=True)
            args.legacy_comparison_output.write_text(json.dumps(comparison, indent=2) + '\n')
        code = 0
    except (C.DecodeError, OSError, ValueError, KeyError, TypeError) as exc:
        report = {'schema_version': 1, 'status': 'ADDITIVE_COMPATIBILITY_REJECTED',
                  'error': str(exc), 'signed_or_submitted_transactions': False}
        code = 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'output': str(args.output),
                      **({'error': report['error']} if 'error' in report else {})}))
    return code


if __name__ == '__main__':
    sys.exit(main())
