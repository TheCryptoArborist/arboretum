#!/usr/bin/env python3
"""Build and test the inventory-version candidate without network or wallet use.

The frozen v12 sources and confirmed publication remain the baseline. Candidate
source may differ only in VERSION and the 13 already approved purchase prices,
ignoring comments/whitespace. Production bytecode is built independently from
test-only copies. All outputs go to a new directory outside the repository.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path[:0] = [str(REPO / 'contract-reconstruction'), str(REPO / 'contract-payout'),
                str(REPO / 'settlement-integration/release')]
import build_reconstruction as B
import compare_bytecode as C
import audit_source_scope as S
from verify_inputs import package_digest, DEPENDENCIES

LEGACY_SOURCE_SHA256 = '14cec739964acbdd077b8231339992265e9014778e50ba52af06ca0e10c312d1'
BASELINE_SOURCE_SHA256 = '91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb'
APPROVAL_SHA256 = 'ac7833719724023d1f8703cb7d3092e41f5328bfa909bc7f903fbbbffccd2852'
RECEIPT_SHA256 = '113184bcead64c2fd64eb94e67c600ccaab3fe5c47fb2b017d7688077d060d5b'
ORIGINAL_PACKAGE = '6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b'
PUBLISHED_PACKAGE = '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a'
BASELINE_MODULE_SHA256 = {
    'arboretum': '2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1',
    'settlement': 'b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531',
}
APPROVED_PRICES = {
    'GROWTH_DEPOSIT_MIST': 10_000_000_000,
    'CRATE_PRICE_0': 5_000_000_000, 'CRATE_PRICE_1': 10_000_000_000,
    'CRATE_PRICE_2': 25_000_000_000, 'CRATE_PRICE_3': 50_000_000_000,
    'CRATE_PRICE_4': 100_000_000_000, 'CRATE_PRICE_5': 30_000_000_000,
    'CRATE_PRICE_6': 30_000_000_000,
    'SUPPLY_PRICE_WATERING_BOOST': 2_000_000_000,
    'SUPPLY_PRICE_MULCH': 4_000_000_000,
    'SUPPLY_PRICE_RAIN_BARREL': 5_000_000_000,
    'SUPPLY_PRICE_DROUGHT_SHIELD': 10_000_000_000,
    'SUPPLY_PRICE_REVIVAL_KIT': 15_000_000_000,
}
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
TEST_FUNCTION = re.compile(
    r'^\s*#\[\s*test\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*'
    r'(?:(?:public|entry)\s+)*fun\s+([A-Za-z_]\w*)\s*(?:<|\()', re.MULTILINE)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def save(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + '\n')


def publication_bytes(raw: bytes) -> bytes:
    module = C.Module(raw)
    index = module.at(1, module.self_index)[0]
    start, end = module.spans[8][index]
    require(end - start == 32 and raw[start:end] == bytes(32), 'Unexpected unpublished self address')
    return raw[:start] + bytes.fromhex(ORIGINAL_PACKAGE) + raw[end:]


def scalar_constant(tokens: list[str], name: str) -> int:
    require(len(tokens) == 7 and tokens[:5] == ['const', name, ':', 'u64', '='] and tokens[-1] == ';',
            f'Expected a literal u64 constant: {name}')
    require(re.fullmatch(r'[0-9][0-9_]*', tokens[5]) is not None, f'Invalid literal: {name}')
    return int(tokens[5].replace('_', ''))


def inspect_source(baseline: str, candidate: str, decisions: dict) -> dict:
    recorded = {'GROWTH_DEPOSIT_MIST': int(decisions['planting']['priceMist'])}
    require(len(decisions['crates']) == 7 and len(decisions['supplyDrops']) == 5, 'Approval inventory differs')
    for row in decisions['crates']:
        name = 'CRATE_PRICE_' + str(row['tier'])
        require(name not in recorded and row['status'] == 'approved_price_not_activated', 'Crate approval differs')
        recorded[name] = int(row['priceMist'])
    for row in decisions['supplyDrops']:
        name = 'SUPPLY_PRICE_' + row['name'].upper().replace(' ', '_')
        require(name not in recorded and row['status'] == 'approved_price_not_activated', 'Supply Drop approval differs')
        recorded[name] = int(row['priceMist'])
    require(recorded == APPROVED_PRICES, 'Production prices differ from the pinned approval')
    old_constants, old_functions = S.extract(baseline)
    new_constants, new_functions = S.extract(candidate)
    require(old_functions == new_functions, 'Function signatures or bodies changed in candidate source')
    require(old_constants.keys() == new_constants.keys(), 'Candidate added or removed a constant')
    expected = {'VERSION': 2, **APPROVED_PRICES}
    require(scalar_constant(old_constants['VERSION'], 'VERSION') == 1, 'Frozen source is not version 1')
    changed = sorted(name for name in old_constants if old_constants[name] != new_constants[name])
    require(changed == sorted(expected), 'Source change set is not the exact version/price constant set')
    restored = S.tokens(candidate)
    rows = []
    for name, value in expected.items():
        before = scalar_constant(old_constants[name], name)
        after = scalar_constant(new_constants[name], name)
        require(after == value, f'Unexpected candidate value: {name}')
        restored = S.replace_exactly_once(restored, ' '.join(new_constants[name]), ' '.join(old_constants[name]))
        rows.append({'name': name, 'before': str(before), 'after': str(after)})
    require(restored == S.tokens(baseline), 'Candidate changes more than approved scalar constants/comments/whitespace')
    require(scalar_constant(new_constants['REFERRAL_SHARE_MIST'], 'REFERRAL_SHARE_MIST') == 1_000_000,
            'Existing fixed planting referral amount changed')
    return {'status': 'ONLY_VERSION_AND_13_APPROVED_PRICES_CHANGED',
            'functionSourceCount': len(old_functions), 'allFunctionSourceTokensIdentical': True,
            'changedConstants': rows, 'allOtherTokensIdentical': True,
            'plantingReferralMistUnchanged': '1000000', 'migrationFunctionAdded': False}


def inspect_bytecode(baseline: bytes, candidate: bytes, source_report: dict) -> dict:
    old, new = C.Module(baseline), C.Module(candidate)
    require(old.module_id(old.self_index) == new.module_id(new.self_index), 'Settlement module identity differs')
    old_structs = {row['id']: row for row in [old.struct(i) for i in range(len(old.tables[10]))]}
    new_structs = {row['id']: row for row in [new.struct(i) for i in range(len(new.tables[10]))]}
    require(len(old_structs) == 39 and new_structs == old_structs, 'Existing settlement layouts/abilities differ')
    functions, next_functions = old.functions(), new.functions()
    require(len(functions) == 118 and functions.keys() == next_functions.keys(), 'Production function inventory differs')
    abis = {name: {k: f[k] for k in ['id', 'parameters', 'returns', 'type_parameters', 'visibility', 'entry', 'native']}
            for name, f in functions.items() if f['entry'] or f['visibility'] == 'public'}
    next_abis = {name: {k: f[k] for k in ['id', 'parameters', 'returns', 'type_parameters', 'visibility', 'entry', 'native']}
                 for name, f in next_functions.items() if f['entry'] or f['visibility'] == 'public'}
    require(len(abis) == 85 and abis == next_abis, 'Public/entry ABI changed')
    pairs = {(row['before'], row['after']) for row in source_report['changedConstants']}
    changes, changed_functions = [], []
    for name, before in functions.items():
        after = next_functions[name]
        require({k: v for k, v in before.items() if k != 'code'} ==
                {k: v for k, v in after.items() if k != 'code'}, f'Function metadata changed: {name}')
        require(before['code'] is not None and after['code'] is not None, 'Unexpected native function')
        require(len(before['code']) == len(after['code']), f'Instruction count changed: {name}')
        for index, (left, right) in enumerate(zip(before['code'], after['code'])):
            if left == right:
                continue
            require(left.get('op') == right.get('op') == 'LdConst' and
                    set(left) == set(right) == {'op', 'constant'} and
                    left['constant']['type'] == right['constant']['type'] == 'u64' and
                    (left['constant']['value'], right['constant']['value']) in pairs,
                    f'Non-approved instruction change in {name} at {index}: {left} -> {right}')
            for value in [left['constant'], right['constant']]:
                require(set(value) == {'type', 'bytes_hex', 'value'} and
                        value['bytes_hex'] == int(value['value']).to_bytes(8, 'little').hex(),
                        'Changed numeric constant does not have exact u64 BCS bytes')
            changes.append({'function': name, 'instructionIndex': index, 'before': left, 'after': right})
        if before != after:
            changed_functions.append(name)
    old_inventory, new_inventory = old.resolved_inventory(), new.resolved_inventory()
    require({k: v for k, v in old_inventory.items() if k != 'constants'} ==
            {k: v for k, v in new_inventory.items() if k != 'constants'},
            'A non-constant bytecode inventory changed; compatibility requires review')
    # Named u64 constants use LdConst. The compiler deduplicates equal values;
    # distinct approved prices can therefore change the pool's length/order.
    # Every constant must be used by an instruction already checked above.
    for label, module in [('baseline', old), ('candidate', new)]:
        pool = {C.canonical(value) for value in module.tables[6]}
        used = {C.canonical(instruction['constant']) for function in module.functions().values()
                for instruction in (function['code'] or []) if instruction['op'] == 'LdConst'}
        require(len(pool) == len(module.tables[6]) and pool == used,
                f'{label} constant pool includes a duplicate, unused or unknown value')
    return {'status': 'EXACT_LAYOUT_ABI_AND_INSTRUCTION_STRUCTURE_PRESERVED',
            'structsPreserved': len(old_structs), 'publicOrEntryAbisPreserved': len(abis),
            'productionFunctionsPreserved': len(functions), 'newStructs': [], 'newFunctions': [],
            'allNonConstantInventoryTablesIdentical': True, 'instructionStructureIdentical': True,
            'constantPool': {'baselineCount': len(old.tables[6]), 'candidateCount': len(new.tables[6]),
                             'completeInstructionUsageVerified': True},
            'changedNumericLoadOperands': len(changes), 'functionsWithChangedConstantLoads': sorted(changed_functions),
            'constantOperandChanges': changes,
            'structFingerprint': C.fingerprint(old_structs), 'abiFingerprint': C.fingerprint(abis),
            'limit': 'Strict offline structural inspection; native upgrade compatibility is verified separately by a checked unsigned simulation.'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--toolchain', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--build-only', action='store_true', help='Save verified unsigned production build without running test fixtures')
    args = parser.parse_args()
    output = args.output.resolve()
    require(not output.exists(), 'Use a fresh output directory; saved observations are immutable')
    require(output != REPO and REPO not in output.parents, 'Build outside the repository')
    output.mkdir(parents=True)
    toolchain = json.loads(args.toolchain.read_text())
    compiler, framework = Path(toolchain['compiler']), Path(toolchain['framework_dir'])
    require(B.sha256(compiler) == B.COMPILER_BINARY_SHA256, 'Pinned compiler binary differs')
    require(B.sha256(Path(toolchain['compiler_archive'])) == B.COMPILER_ARCHIVE_SHA256, 'Compiler archive differs')
    require(B.sha256(Path(toolchain['framework_archive'])) == B.FRAMEWORK_ARCHIVE_SHA256, 'Framework archive differs')
    require(output != framework and framework not in output.parents, 'Keep build and framework separate')
    framework_before = B.verify_framework_sources(framework, Path(toolchain['framework_archive']))
    paths = {
        'legacy': REPO / 'contract-reconstruction/source/arboretum.move',
        'baseline': REPO / 'contract-payout/source/settlement.move',
        'candidate': HERE / 'production/settlement.move',
        'decisions': REPO / 'economy-review/decisions.json',
        'receipt': REPO / 'settlement-integration/release/evidence/20261031-confirmed-upgrade/receipt.json',
        'runner': Path(__file__), 'decoder': REPO / 'contract-reconstruction/compare_bytecode.py',
        'frameworkVerifier': REPO / 'contract-reconstruction/build_reconstruction.py',
        'sourceTokenizer': REPO / 'contract-payout/audit_source_scope.py',
        'digestImplementation': REPO / 'settlement-integration/release/verify_inputs.py',
    }
    hashes = {str(p.relative_to(REPO)): B.sha256(p) for p in paths.values()}
    require(B.sha256(paths['legacy']) == LEGACY_SOURCE_SHA256, 'Frozen legacy source changed')
    require(B.sha256(paths['baseline']) == BASELINE_SOURCE_SHA256, 'Frozen v12 settlement source changed')
    require(B.sha256(paths['decisions']) == APPROVAL_SHA256, 'Approved decision record changed')
    require(B.sha256(paths['receipt']) == RECEIPT_SHA256, 'Confirmed v12 publication evidence changed')
    legacy, baseline, candidate = (paths[name].read_text() for name in ['legacy', 'baseline', 'candidate'])
    for name, text in [('legacy', legacy), ('baseline', baseline), ('candidate', candidate)]:
        require(C.sha256(text.encode()) == hashes[str(paths[name].relative_to(REPO))],
                'Source changed while being captured: ' + name)
    source_report = inspect_source(baseline, candidate, json.loads(paths['decisions'].read_text()))
    save(output / 'source-scope.json', source_report)
    config = output / 'config'; config.mkdir()
    keyfile = config / 'empty.keystore'; keyfile.write_text('[]\n'); keyfile.chmod(0o600)
    save(config / 'client.yaml', {'keystore': {'File': str(keyfile)}, 'external_keys': None,
        'envs': [{'alias': 'offline-inventory-boundary', 'rpc': 'http://127.0.0.1:9',
                  'ws': None, 'basic_auth': None, 'chain_id': '00000000'}],
        'active_env': 'offline-inventory-boundary', 'active_address': None})
    env = {**os.environ, 'SUI_CONFIG_DIR': str(config), 'MOVE_HOME': str(output / 'move-cache'),
           'CARGO_NET_OFFLINE': 'true', 'HTTP_PROXY': 'http://127.0.0.1:9',
           'HTTPS_PROXY': 'http://127.0.0.1:9', 'ALL_PROXY': 'http://127.0.0.1:9'}
    version = subprocess.check_output([str(compiler), '--version'], env=env, text=True).strip()
    require(version == B.COMPILER_VERSION, 'Unexpected compiler version')
    manifest = ('[package]\nname = "arboretum"\nedition = "2024.beta"\n\n[dependencies]\n'
        f'Sui = {{ local = "{framework / "sui-framework"}" }}\n'
        f'MoveStdlib = {{ local = "{framework / "move-stdlib"}" }}\n\n'
        '[addresses]\narboretum = "0x0"\n\n[environments]\nmainnet = "35834a8a"\n')

    def package(folder: str, source: str, legacy_override: str | None = None) -> Path:
        path = output / folder; (path / 'sources').mkdir(parents=True)
        (path / 'Move.toml').write_text(manifest)
        (path / 'sources/arboretum.move').write_text(legacy if legacy_override is None else legacy_override)
        (path / 'sources/settlement.move').write_text(source)
        return path

    def run(command: list[str], label: str):
        result = subprocess.run(command, cwd=output, env=env, capture_output=True, text=True, timeout=300)
        log = ANSI.sub('', result.stdout + result.stderr)
        (output / (label + '.log')).write_text(log)
        require('secret recovery phrase' not in log.lower() and 'generated new keypair' not in log.lower(),
                'Unexpected wallet initialization')
        require(json.loads(keyfile.read_text()) == [], 'Keystore acquired signing material')
        return result, log

    raw_modules = {}
    builds, dependency_reports = {}, {}
    for label, source in [('baseline', baseline), ('production', candidate)]:
        folder = package(label, source)
        command = [str(compiler), 'move', 'build', '--build-env', 'mainnet', '--path', str(folder)]
        result, log = run(command, label + '-build')
        require(result.returncode == 0, label + ' compilation failed:\n' + log[-9000:])
        raw_modules[label] = {name: (folder / f'build/arboretum/bytecode_modules/{name}.mv').read_bytes()
                              for name in ['arboretum', 'settlement']}
        dependency_reports[label] = B.compare_linked_dependencies(folder)
        builds[label] = {'command': command, 'exitCode': result.returncode}
    published_packages = []
    def visit(value):
        if isinstance(value, dict):
            if value.get('address') == PUBLISHED_PACKAGE and 'modules' in value and 'typeOrigins' in value:
                published_packages.append(value)
            for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
    visit(json.loads(paths['receipt'].read_text()))
    require(len(published_packages) == 1, 'Ambiguous confirmed package evidence')
    published = published_packages[0]
    require(published['version'] == 12 and not published['modules']['pageInfo']['hasNextPage'],
            'Invalid v12 published package inventory')
    receipt_modules = {row['name']: base64.b64decode(row['bytes'], validate=True) for row in published['modules']['nodes']}
    require(set(receipt_modules) == {'arboretum', 'settlement'}, 'Wrong confirmed module set')
    baseline_proof = []
    for name, raw in raw_modules['baseline'].items():
        require(C.sha256(raw) == BASELINE_MODULE_SHA256[name], 'Frozen prepublication module changed: ' + name)
        require(publication_bytes(raw) == receipt_modules[name], 'Rebuilt baseline differs from v12 publication: ' + name)
        baseline_proof.append({'name': name, 'bytes': len(raw), 'prepublicationSha256': C.sha256(raw),
                               'publishedSha256': C.sha256(receipt_modules[name]),
                               'exactPublishedMatchAfterOnlySelfAddressBinding': True})
    require(raw_modules['production']['arboretum'] == raw_modules['baseline']['arboretum'],
            'Candidate modified legacy module bytes')
    bytecode_report = inspect_bytecode(raw_modules['baseline']['settlement'],
                                      raw_modules['production']['settlement'], source_report)
    save(output / 'bytecode-scope.json', bytecode_report)
    provenance = json.loads((REPO / 'contract-reconstruction/provenance.json').read_text())
    old_tx = provenance['response']['data']['deployed']['previousTransaction']['transactionJson']['kind']['programmableTransaction']
    old_upgrade = old_tx['commands'][1]['upgrade']
    old_digest = base64.b64decode(old_tx['inputs'][2]['pure'], validate=True)
    require(len(old_digest) == 33 and old_digest[0] == 32, 'Unexpected historical upgrade digest format')
    require(package_digest([base64.b64decode(value, validate=True) for value in old_upgrade['modules']],
                           old_upgrade['dependencies']) == old_digest[1:], 'Existing digest algorithm failed historical control')
    origins = published['typeOrigins']
    require(len(origins) == 71 and len([row for row in origins if row['module'] == 'settlement']) == 39,
            'Confirmed type-origin inventory changed')
    require(all(row['definingId'] == PUBLISHED_PACKAGE for row in origins if row['module'] == 'settlement'),
            'Wrong existing settlement type origin')
    modules = []
    bytecode_dir = output / 'bytecode'; bytecode_dir.mkdir()
    for name, raw in raw_modules['production'].items():
        (bytecode_dir / (name + '.mv')).write_bytes(raw)
        modules.append({'name': name, 'size': len(raw), 'sha256': C.sha256(raw),
                        'base64': base64.b64encode(raw).decode(), 'bytecodeFile': 'bytecode/' + name + '.mv'})
    build = {'schemaVersion': 1, 'completedAt': now(), 'status': 'UNSIGNED_PRODUCTION_BUILD_VERIFIED',
        'purpose': 'Offline production candidate only; native upgrade compatibility and live state are separate checks',
        'baselinePackage': PUBLISHED_PACKAGE, 'candidateObjectVersion': 2,
        'productionPricesApproved': True, 'freshProductionRegistryRequired': True, 'migratesExistingObjects': False,
        'modules': modules, 'dependencies': DEPENDENCIES,
        'packageDigestHex': package_digest(list(raw_modules['production'].values()), DEPENDENCIES).hex(),
        'digestAlgorithm': 'Blake2b-256(sorted(Blake2b-256(each module), each 32-byte dependency ID))',
        'digestImplementation': 'settlement-integration/release/verify_inputs.py:package_digest',
        'historicalDigestControlPassed': True,
        'existingTypeOriginsToPreserve': origins, 'observedV12Linkage': published['linkage'],
        'pinnedFrameworkReference': dependency_reports, 'baselinePublicationProof': baseline_proof,
        'sourceSha256': hashes, 'compiler': version, 'compilerSha256': B.COMPILER_BINARY_SHA256,
        'frameworkRevision': B.FRAMEWORK_REVISION, 'builds': builds,
        'all39StructLayoutsPreserved': True, 'all85PublicAndEntryAbisPreserved': True,
        'instructionStructurePreserved': True, 'legacyBytecodeUnchanged': True,
        'nativeCompatibilitySimulationPerformed': False, 'signaturesProduced': 0, 'transactionsSubmitted': 0}
    save(output / 'candidate-build.json', build)
    print(json.dumps({'status': build['status'], 'artifact': str(output / 'candidate-build.json'),
                      'packageDigestHex': build['packageDigestHex'],
                      'modules': [{k: m[k] for k in ['name', 'size', 'sha256']} for m in modules]}), flush=True)
    tests = []
    if not args.build_only:
        suites = [
            ('v2', candidate, ['tests/version-boundary-v2.move.inc', 'tests/production-economy-v2.move.inc']),
            ('v1', baseline, ['tests/old-package-rejection-v1.move.inc']),
        ]
        for label, source, names in suites:
            fragment_bytes = [(HERE / name).read_bytes() for name in names]
            fragments = [raw.decode('utf-8') for raw in fragment_bytes]
            fragment_hashes = {str((HERE / name).relative_to(REPO)): C.sha256(raw)
                               for name, raw in zip(names, fragment_bytes)}
            hashes.update(fragment_hashes)
            expected = sorted(name for fragment in fragments for name in TEST_FUNCTION.findall(fragment))
            require(expected and len(expected) == len(set(expected)) and all(name.startswith('bnd_') for name in expected),
                    'Invalid or duplicate focused test names in ' + label)
            fragment = '\n'.join(fragments)
            index = source.rfind('}')
            require(index >= 0 and not source[index + 1:].strip(), 'Expected one complete settlement module')
            generated = source[:index] + '\n' + fragment + '\n' + source[index:]
            require(generated[:index] + generated[index + len(fragment) + 2:] == source,
                    'Test insertion altered production source')
            generated_legacy = legacy
            if label == 'v2':
                legacy_fixture = HERE / 'tests/legacy-admin-fixture.move.inc'
                legacy_fragment_bytes = legacy_fixture.read_bytes()
                legacy_fragment = legacy_fragment_bytes.decode('utf-8')
                require(not TEST_FUNCTION.findall(legacy_fragment), 'Legacy helper fragment must contain no tests')
                require('#[test_only]' in legacy_fragment, 'Legacy fixture must be explicitly test-only')
                fragment_hashes[str(legacy_fixture.relative_to(REPO))] = C.sha256(legacy_fragment_bytes)
                hashes.update(fragment_hashes)
                legacy_index = legacy.rfind('}')
                generated_legacy = legacy[:legacy_index] + '\n' + legacy_fragment + '\n' + legacy[legacy_index:]
                require(generated_legacy[:legacy_index] + generated_legacy[legacy_index + len(legacy_fragment) + 2:] == legacy,
                        'Legacy fixture insertion altered the original module source')
            folder = package(label + '-tests', generated, generated_legacy)
            command = [str(compiler), 'move', 'test', '--build-env', 'mainnet', '--path', str(folder),
                       '--threads', '1', 'bnd_']
            result, log = run(command, label + '-tests')
            totals = re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)', log)
            counts = {'total': int(totals[1]), 'passed': int(totals[2]), 'failed': int(totals[3])} if totals else None
            actual = sorted(name.rsplit('::', 1)[-1] for name in re.findall(r'\[\s*PASS\s*\]\s+([^\r\n]+)', log))
            success = result.returncode == 0 and counts == {'total': len(expected), 'passed': len(expected), 'failed': 0} and actual == expected
            record = {'suite': label, 'passed': success, 'command': command, 'counts': counts,
                      'expectedTests': expected, 'passedTests': actual, 'exitCode': result.returncode,
                      'testFragmentSha256': fragment_hashes, 'testOnlyInsertion': True,
                      'generatedSourceSha256': B.sha256(folder / 'sources/settlement.move'),
                      'legacyTestOnlyInsertion': label == 'v2',
                      'generatedLegacySourceSha256': B.sha256(folder / 'sources/arboretum.move')}
            tests.append(record)
            save(output / (label + '-tests.json'), record)
            require(success, label + ' focused VM suite failed:\n' + log[-12000:])
    for name, expected_hash in hashes.items():
        require(B.sha256(REPO / name) == expected_hash, 'Input changed during verification: ' + name)
    require(B.tree_identity(framework) == framework_before, 'Pinned framework files changed during verification')
    require(json.loads(keyfile.read_text()) == [], 'Keystore did not remain empty')
    summary = {'schemaVersion': 1, 'completedAt': now(),
        'status': 'INVENTORY_BOUNDARY_BUILD_ONLY_PASSED' if args.build_only else 'INVENTORY_BOUNDARY_OFFLINE_VERIFICATION_PASSED',
        'buildOnly': args.build_only, 'compiler': version, 'frameworkRevision': B.FRAMEWORK_REVISION,
        'frameworkSourceFilesUnchanged': framework_before['file_count'],
        'pinnedFrameworkModulesCompared': sum(row['modules_compared'] for row in dependency_reports['production']),
        'sourceSha256': hashes, 'sourceScope': source_report,
        'bytecodeScope': {k: v for k, v in bytecode_report.items() if k != 'constantOperandChanges'},
        'baselinePublicationProof': baseline_proof, 'tests': tests,
        'totalFocusedTests': sum(row['counts']['total'] for row in tests),
        'candidateBuildSha256': B.sha256(output / 'candidate-build.json'),
        'packageDigestHex': build['packageDigestHex'], 'legacySourceAndBytecodeUnchanged': True,
        'frozenV12SourceUnchanged': True, 'applicationMutationPerformed': False,
        'isolatedKeystoreStayedEmpty': True, 'configuredRpc': 'http://127.0.0.1:9',
        'networkOrWalletOperation': False, 'signaturesProduced': 0, 'transactionsSubmitted': 0,
        'limits': ['This is an offline candidate, not a published upgrade or active production economy.',
                   'Native upgrade compatibility/current dependencies require a separate checked unsigned simulation.',
                   'A fresh version-2 Registry is required; no existing Registry, item, claim or history is migrated.',
                   'Version-2 acquisition must remain at approved production prices; future discounts need a new boundary review.']}
    save(output / 'summary.json', summary)
    print(json.dumps({'status': summary['status'], 'totalFocusedTests': summary['totalFocusedTests'],
                      'output': str(output), 'transactionsSubmitted': 0}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
