#!/usr/bin/env python3
"""Compile and exercise the unsigned, additive settlement candidate offline.

This runner verifies the existing pinned compiler and framework archives, uses
an isolated empty keystore and loopback-only client configuration, and never
publishes, upgrades, signs, submits, or queries a chain. It builds production
bytecode separately from test-only fixture insertion and compiler-negative
type-isolation probes. Evidence is written only under contract-payout/evidence.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / 'contract-reconstruction'))
import build_reconstruction as B
import compare_bytecode as C
import inspect_additive_package as A
import audit_source_scope as S

VERIFIED_SOURCE_SHA256 = '14cec739964acbdd077b8231339992265e9014778e50ba52af06ca0e10c312d1'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
TEST_FUNCTION = re.compile(
    r'^\s*#\[\s*test\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*'
    r'(?:(?:public|entry)\s+)*fun\s+([A-Za-z_]\w*)\s*(?:<|\()', re.MULTILINE)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def checked_run(command: list[str], work: Path, env: dict, keyfile: Path,
                timeout: int = 300) -> tuple[subprocess.CompletedProcess, str]:
    result = subprocess.run(command, cwd=work, env=env, text=True,
                            capture_output=True, timeout=timeout)
    log = ANSI.sub('', result.stdout + result.stderr)
    A.require('secret recovery phrase' not in log.lower(), 'Unexpected wallet initialization')
    A.require('generated new keypair' not in log.lower(), 'Unexpected wallet initialization')
    A.require(json.loads(keyfile.read_text()) == [], 'Unexpected signing material')
    return result, log


def write_package(root: Path, manifest: str, sources: dict[str, str]) -> None:
    (root / 'sources').mkdir(parents=True, exist_ok=True)
    existing = {path.name for path in (root / 'sources').glob('*.move')}
    A.require(existing <= sources.keys(), f'Unexpected stale Move sources in {root}')
    for name, contents in sources.items():
        A.require(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.move', name) is not None,
                  'Invalid generated source name')
        (root / 'sources' / name).write_text(contents)
    (root / 'Move.toml').write_text(manifest)


def names_in_source(source: str, module: str) -> list[str]:
    names = TEST_FUNCTION.findall(source)
    A.require(len(names) == len(set(names)), f'Duplicate test declaration in {module}')
    return [f'arboretum::{module}::{name}' for name in names]


def run_move_tests(compiler: Path, work: Path, manifest: str, env: dict, keyfile: Path,
                   sources: dict[str, str], output: Path) -> dict:
    include = HERE / 'tests/settlement-tests.move.inc'
    fragment = include.read_text()
    fragment_sha256 = C.sha256(fragment.encode())
    original = sources['settlement.move']
    insertion = original.rfind('}')
    A.require(insertion >= 0 and not original[insertion + 1:].strip(),
              'Expected a complete single settlement module')
    generated = original[:insertion] + '\n' + fragment + '\n' + original[insertion:]
    A.require(generated[:insertion] + generated[insertion + len(fragment) + 2:] == original,
              'Test insertion changed the production source')
    expected_baseline = names_in_source(sources['arboretum.move'], 'arboretum')
    expected_existing = names_in_source(original, 'settlement')
    expected_fixture = names_in_source(fragment, 'settlement')
    A.require(len(expected_baseline) == 4, 'Expected the four unchanged legacy Canopy tests')
    A.require(len(expected_existing) == 4, 'Expected the four retained new-module Canopy tests')
    A.require(len(expected_fixture) > 0, 'Settlement fixture contains no executable tests')
    expected = expected_baseline + expected_existing + expected_fixture
    A.require(len(expected) == len(set(expected)), 'Duplicate qualified test name')
    test_package = work / 'tests'
    write_package(test_package, manifest, {**sources, 'settlement.move': generated})
    command = [str(compiler), 'move', 'test', '--build-env', 'mainnet',
               '--path', str(test_package), '--threads', '1']
    result, log = checked_run(command, work, env, keyfile)
    totals = re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)', log)
    counts = {'total': int(totals[1]), 'passed': int(totals[2]), 'failed': int(totals[3])} if totals else None
    named = re.findall(r'\[\s*PASS\s*\]\s+([^\r\n]+)', log)
    succeeded = (result.returncode == 0 and counts == {'total': len(expected), 'passed': len(expected), 'failed': 0}
                 and len(named) == len(expected) and sorted(named) == sorted(expected))
    report = {
        'schema_version': 1,
        'status': 'ALL_NAMED_MOVE_TESTS_PASSED' if succeeded else 'MOVE_TESTS_FAILED',
        'completed_at_utc': utc_now(),
        'compiler': B.COMPILER_VERSION,
        'framework_revision': B.FRAMEWORK_REVISION,
        'production_source_sha256': B.sha256(HERE / 'source/settlement.move'),
        'verified_legacy_source_sha256': VERIFIED_SOURCE_SHA256,
        'test_include_sha256': fragment_sha256,
        'generated_test_source_sha256': B.sha256(test_package / 'sources/settlement.move'),
        'test_only_insertion': True,
        'legacy_source_unchanged': (test_package / 'sources/arboretum.move').read_text() == sources['arboretum.move'],
        'command': command,
        'exit_code': result.returncode,
        'counts': counts,
        'expected_test_count': len(expected),
        'legacy_canopy_test_count': len(expected_baseline),
        'new_module_canopy_test_count': len(expected_existing),
        'settlement_fixture_test_count': len(expected_fixture),
        'expected_tests': sorted(expected),
        'passed_tests': named,
        'missing_tests': sorted(set(expected) - set(named)),
        'unexpected_tests': sorted(set(named) - set(expected)),
        'signed_or_submitted_transactions': False,
    }
    (output / 'move-tests.log').write_text(log)
    write_json(output / 'move-tests-result.json', report)
    print(log[-18000:], flush=True)
    A.require(B.sha256(include) == fragment_sha256, 'Settlement fixture changed during verification; rerun')
    return report


def isolation_probe(legacy: bool, type_name: str, argument_is_legacy: bool) -> str:
    """Call a real public function, avoiding private-entry visibility failures."""
    callee = 'legacy' if legacy else 'settlement'
    argument = 'legacy' if argument_is_legacy else 'settlement'
    getter = {'Registry': 'registry_total_gp', 'Seed': 'seed_growth_points',
              'SeasonArchive': 'archive_total_gp'}[type_name]
    return (
        'module arboretum::isolation_probe {\n'
        '    use arboretum::arboretum as legacy;\n'
        '    use arboretum::settlement;\n'
        f'    public fun probe(value: &{argument}::{type_name}): u64 {{\n'
        f'        {callee}::{getter}(value)\n'
        '    }\n}\n'
    )


def run_type_isolation(compiler: Path, work: Path, manifest: str, env: dict, keyfile: Path,
                       sources: dict[str, str], output: Path) -> dict:
    directory = output / 'type-isolation'
    directory.mkdir(exist_ok=True)
    rows = []
    for legacy in (True, False):
        for type_name in ('Registry', 'Seed', 'SeasonArchive'):
            target = 'legacy' if legacy else 'settlement'
            label = f'{target}-{type_name.lower()}'
            package = work / 'type-isolation' / label
            positive = isolation_probe(legacy, type_name, legacy)
            negative = isolation_probe(legacy, type_name, not legacy)
            write_package(package, manifest, {**sources, 'isolation_probe.move': positive})
            command = [str(compiler), 'move', 'build', '--build-env', 'mainnet', '--path', str(package)]
            control, control_log = checked_run(command, work, env, keyfile)
            (directory / f'{label}-positive.log').write_text(control_log)
            A.require(control.returncode == 0, f'Type-isolation positive control failed: {label}')
            (package / 'sources/isolation_probe.move').write_text(negative)
            rejection, rejection_log = checked_run(command, work, env, keyfile)
            (directory / f'{label}-negative.log').write_text(rejection_log)
            errors = re.findall(r'error\[([A-Z]+\d+)\]', rejection_log)
            named_types = (f'arboretum::arboretum::{type_name}' in rejection_log
                           and f'arboretum::settlement::{type_name}' in rejection_log)
            rejected = rejection.returncode != 0 and errors == ['EC04007'] and named_types
            rows.append({
                'name': label,
                'target_module': 'arboretum::arboretum' if legacy else 'arboretum::settlement',
                'type_name': type_name,
                'positive_control_exit_code': control.returncode,
                'negative_probe_exit_code': rejection.returncode,
                'negative_probe_compiler_errors': errors,
                'both_distinct_type_identities_in_diagnostic': named_types,
                'type_confusion_rejected': rejected,
                'positive_probe_sha256': C.sha256(positive.encode()),
                'negative_probe_sha256': C.sha256(negative.encode()),
                'positive_probe_source': positive,
                'negative_probe_source': negative,
                'command': command,
            })
            A.require((package / 'sources/arboretum.move').read_text() == sources['arboretum.move'],
                      'Isolation probe changed the original module')
            A.require((package / 'sources/settlement.move').read_text() == sources['settlement.move'],
                      'Isolation probe changed the candidate module')
            print(json.dumps({'type_isolation': label, 'positive_control': control.returncode,
                              'type_confusion_rejected': rejected}), flush=True)
    succeeded = len(rows) == 6 and all(row['type_confusion_rejected'] for row in rows)
    report = {
        'schema_version': 1,
        'status': 'BOTH_DIRECTIONS_REJECT_LEGACY_NEW_TYPE_CONFUSION' if succeeded else 'TYPE_ISOLATION_FAILED',
        'completed_at_utc': utc_now(),
        'compiler': B.COMPILER_VERSION,
        'framework_revision': B.FRAMEWORK_REVISION,
        'positive_controls_passed': sum(row['positive_control_exit_code'] == 0 for row in rows),
        'negative_probes_rejected': sum(row['type_confusion_rejected'] for row in rows),
        'tests': rows,
        'method': 'Each real public getter is compiled successfully with its own object type, then only the argument type is changed to the other module. The compiler must emit exactly the incompatible-type error and identify both module-qualified types.',
        'limitation': 'The legacy claim entries are private to their module, so these probes use its public getters with the same Registry, Seed, and SeasonArchive type identities. Exact preserved legacy bytecode separately proves that legacy claim signatures are unchanged.',
        'signed_or_submitted_transactions': False,
    }
    write_json(output / 'type-isolation-result.json', report)
    return report


def run_comparator_checks(work: Path, env: dict, keyfile: Path, output: Path) -> dict:
    command = [sys.executable, str(REPO / 'contract-reconstruction/comparator-tests/test_comparator.py'),
               '--json-output', str(output / 'legacy-comparator-tests.json')]
    result, log = checked_run(command, work, env, keyfile)
    (output / 'legacy-comparator-tests.log').write_text(log)
    report = json.loads((output / 'legacy-comparator-tests.json').read_text())
    A.require(result.returncode == 0 and report['success'] and report['tests_run'] == 20
              and report['failures'] == 0 and report['errors'] == 0 and report['skipped'] == 0,
              'Bytecode comparator negative controls failed')
    print(json.dumps({'legacy_comparator_tests': report['tests_run'], 'success': report['success']}), flush=True)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compiler', type=Path, required=True)
    parser.add_argument('--compiler-archive', type=Path, required=True)
    parser.add_argument('--framework-dir', type=Path, required=True)
    parser.add_argument('--framework-archive', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--build-only', action='store_true',
                        help='Compile and inspect production bytecode; omit all VM and type-isolation tests')
    args = parser.parse_args()
    write_json(HERE / 'evidence/verification-summary.json', {
        'schema_version': 1, 'status': 'CANDIDATE_VERIFICATION_IN_PROGRESS',
        'started_at_utc': utc_now(), 'signed_or_submitted_transactions': False,
    })
    compiler = args.compiler.resolve()
    framework = args.framework_dir.resolve()
    work = args.work_dir.resolve()
    A.require(work != REPO and REPO not in work.parents, 'Build outside the repository')
    A.require(work != framework and framework not in work.parents, 'Keep build and framework separate')
    A.require(B.sha256(args.compiler_archive) == B.COMPILER_ARCHIVE_SHA256, 'Compiler archive mismatch')
    A.require(B.sha256(compiler) == B.COMPILER_BINARY_SHA256, 'Compiler binary mismatch')
    A.require(B.sha256(args.framework_archive) == B.FRAMEWORK_ARCHIVE_SHA256, 'Framework archive mismatch')
    historical = REPO / 'contract/sources/arboretum.move'
    baseline = REPO / 'contract-reconstruction/source/arboretum.move'
    candidate = HERE / 'source/settlement.move'
    A.require(B.sha256(historical) == B.SAVED_SOURCE_SHA256, 'Historical production source drift')
    A.require(B.sha256(baseline) == VERIFIED_SOURCE_SHA256, 'Verified deployed reconstruction drift')
    sources = {'arboretum.move': baseline.read_text(), 'settlement.move': candidate.read_text()}
    source_hashes = {name: C.sha256(value.encode()) for name, value in sources.items()}
    framework_before = B.verify_framework_sources(framework, args.framework_archive)
    output = HERE / 'evidence'
    output.mkdir(exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    config = work / 'config'
    config.mkdir(exist_ok=True)
    keyfile = config / 'empty.keystore'
    keyfile.write_text('[]\n')
    keyfile.chmod(0o600)
    (config / 'client.yaml').write_text(json.dumps({
        'keystore': {'File': str(keyfile)}, 'external_keys': None,
        'envs': [{'alias': 'offline-payout-candidate', 'rpc': 'http://127.0.0.1:9',
                  'ws': None, 'basic_auth': None, 'chain_id': '00000000'}],
        'active_env': 'offline-payout-candidate', 'active_address': None,
    }, indent=2) + '\n')
    env = os.environ.copy()
    env['SUI_CONFIG_DIR'] = str(config)
    env['MOVE_HOME'] = str(work / 'move-cache')
    version = subprocess.check_output([str(compiler), '--version'], env=env, text=True).strip()
    A.require(version == B.COMPILER_VERSION, f'Unexpected compiler version: {version}')
    manifest = (
        '[package]\nname = "arboretum"\nedition = "2024.beta"\n\n'
        '[dependencies]\n'
        f'Sui = {{ local = "{framework / "sui-framework"}" }}\n'
        f'MoveStdlib = {{ local = "{framework / "move-stdlib"}" }}\n\n'
        '[addresses]\narboretum = "0x0"\n\n'
        '[environments]\nmainnet = "35834a8a"\n'
    )
    package = work / 'generated'
    write_package(package, manifest, sources)
    command = [str(compiler), 'move', 'build', '--build-env', 'mainnet',
               '--path', str(package), '--disassemble']
    started = utc_now()
    result, log = checked_run(command, work, env, keyfile)
    (output / 'build.log').write_text(log)
    paths = sorted((package / 'build/arboretum/bytecode_modules').glob('*.mv'))
    dependencies = B.compare_linked_dependencies(package) if result.returncode == 0 else []
    report = {
        'schema_version': 1,
        'status': 'PRODUCTION_BUILD_SUCCEEDED_INSPECTION_REQUIRED' if result.returncode == 0 else 'BUILD_FAILED',
        'started_at_utc': started,
        'completed_at_utc': utc_now(),
        'source_sha256': source_hashes,
        'historical_source_sha256': B.SAVED_SOURCE_SHA256,
        'verified_legacy_source_sha256': VERIFIED_SOURCE_SHA256,
        'runner_sha256': B.sha256(Path(__file__)),
        'compiler': version,
        'compiler_binary_sha256': B.COMPILER_BINARY_SHA256,
        'compiler_archive_sha256': B.COMPILER_ARCHIVE_SHA256,
        'framework_revision': B.FRAMEWORK_REVISION,
        'framework_archive_sha256': B.FRAMEWORK_ARCHIVE_SHA256,
        'framework_inputs': framework_before,
        'compiled_dependencies': dependencies,
        'manifest': manifest,
        'command': command,
        'exit_code': result.returncode,
        'modules': [{'name': path.stem, 'path': str(path), 'sha256': B.sha256(path),
                     'size': path.stat().st_size, 'base64': base64.b64encode(path.read_bytes()).decode()}
                    for path in paths] if result.returncode == 0 else [],
        'generated_lock': (package / 'Move.lock').read_text() if (package / 'Move.lock').exists() else None,
        'signed_or_submitted_transactions': False,
    }
    write_json(output / 'build-result.json', report)
    print(log[-12000:], flush=True)
    if result.returncode != 0:
        raise ValueError(f'Candidate production compilation failed with exit code {result.returncode}')
    A.require({path.stem for path in paths} == {'arboretum', 'settlement'},
              'Production package must contain exactly the unchanged legacy module and new settlement module')
    modules = {path.stem: C.Module(path.read_bytes()) for path in paths}
    additive, legacy_comparison = A.inspect(modules['arboretum'], modules['settlement'])
    write_json(output / 'additive-compatibility.json', additive)
    write_json(output / 'legacy-bytecode-comparison.json', legacy_comparison)
    scope = S.audit(sources['arboretum.move'], sources['settlement.move'],
                    set(modules['arboretum'].functions()), set(modules['settlement'].functions()))
    write_json(output / 'source-scope.json', scope)
    report['status'] = 'PRODUCTION_BUILD_AND_ADDITIVE_BOUNDARY_VERIFIED'
    write_json(output / 'build-result.json', report)
    print(json.dumps({'status': report['status'],
                      'legacy_functions_unchanged': additive['legacy']['functions_unchanged'],
                      'legacy_structs_unchanged': additive['legacy']['struct_layouts_unchanged'],
                      'exact_dependency_modules': sum(row['modules_compared'] for row in dependencies)}), flush=True)

    tests = isolation = comparator = None
    if not args.build_only:
        tests = run_move_tests(compiler, work, manifest, env, keyfile, sources, output)
        if tests['status'] != 'ALL_NAMED_MOVE_TESTS_PASSED':
            raise ValueError('The actual VM test results do not match every expected named test')
        isolation = run_type_isolation(compiler, work, manifest, env, keyfile, sources, output)
        comparator = run_comparator_checks(work, env, keyfile, output)
        A.require(B.sha256(HERE / 'tests/settlement-tests.move.inc') == tests['test_include_sha256'],
                  'Settlement fixture changed during verification; rerun')
    A.require(B.sha256(historical) == B.SAVED_SOURCE_SHA256, 'Historical source changed during verification')
    A.require(B.sha256(baseline) == VERIFIED_SOURCE_SHA256, 'Verified baseline changed during verification')
    A.require(B.sha256(candidate) == source_hashes['settlement.move'], 'Candidate changed during verification; rerun')
    for name, contents in sources.items():
        A.require((package / 'sources' / name).read_text() == contents, 'Generated production source changed')
    framework_after = B.tree_identity(framework)
    A.require(framework_after == framework_before, 'Pinned framework source changed during verification')
    A.require(json.loads(keyfile.read_text()) == [], 'Unexpected signing material')
    succeeded = args.build_only or isolation['status'] == 'BOTH_DIRECTIONS_REJECT_LEGACY_NEW_TYPE_CONFUSION'
    summary = {
        'schema_version': 1,
        'status': ('BUILD_ONLY_VERIFIED_TESTS_NOT_RUN' if args.build_only else
                   'CANDIDATE_VERIFIED' if succeeded else 'CANDIDATE_VERIFICATION_FAILED'),
        'completed_at_utc': utc_now(),
        'source_sha256': source_hashes,
        'modules': [{key: value for key, value in module.items() if key != 'base64'} for module in report['modules']],
        'legacy_exact_v11_prepublication_match': True,
        'legacy_functions_unchanged': additive['legacy']['functions_unchanged'],
        'legacy_struct_layouts_unchanged': additive['legacy']['struct_layouts_unchanged'],
        'exact_linked_dependency_modules': sum(row['modules_compared'] for row in dependencies),
        'protected_non_error_constants_unchanged': scope['protected_existing_non_error_constants'],
        'economics_and_care_functions_match_with_listed_changes': scope['protected_function_count'],
        'move_tests': tests['counts'] if tests else None,
        'type_isolation_positive_controls': isolation['positive_controls_passed'] if isolation else None,
        'type_isolation_negative_probes': isolation['negative_probes_rejected'] if isolation else None,
        'legacy_comparator_tests': comparator['tests_run'] if comparator else None,
        'framework_input_files_unchanged': framework_before['file_count'],
        'production_sources_unchanged_during_verification': True,
        'isolated_keystore_stayed_empty': True,
        'signed_or_submitted_transactions': False,
        'deployment_or_existing_season_migration_performed': False,
    }
    write_json(output / 'verification-summary.json', summary)
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if succeeded else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, AssertionError, subprocess.SubprocessError) as exc:
        failure = {'schema_version': 1, 'status': 'CANDIDATE_VERIFICATION_REJECTED',
                   'completed_at_utc': utc_now(), 'error': str(exc),
                   'signed_or_submitted_transactions': False}
        write_json(HERE / 'evidence/verification-summary.json', failure)
        print(json.dumps(failure), file=sys.stderr, flush=True)
        sys.exit(1)
