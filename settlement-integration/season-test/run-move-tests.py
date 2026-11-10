#!/usr/bin/env python3
"""Run new first-season tests in an isolated copy of the deployed Move source.

Requires the existing pinned public toolchain prepared by prepare_toolchain.py.
All outputs use a new directory outside the repository. There are no network,
signing, publishing, execution, or existing-evidence overwrite operations.
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
sys.path.insert(0, str(REPO / 'contract-reconstruction'))
import build_reconstruction as B
from compare_bytecode import Module

LEGACY_SOURCE_SHA256 = '14cec739964acbdd077b8231339992265e9014778e50ba52af06ca0e10c312d1'
SETTLEMENT_SOURCE_SHA256 = '91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb'
ORIGINAL_PACKAGE = '6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b'
PUBLISHED_PACKAGE = '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + '\n')


def publication_bytes(raw: bytes) -> bytes:
    module = Module(raw)
    index = module.at(1, module.self_index)[0]
    start, end = module.spans[8][index]
    assert end - start == 32 and raw[start:end] == bytes(32)
    return raw[:start] + bytes.fromhex(ORIGINAL_PACKAGE) + raw[end:]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--toolchain', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    assert not output.exists(), 'Use a fresh directory; previous observations are immutable.'
    assert output != REPO and REPO not in output.parents
    output.mkdir(parents=True)
    toolchain = json.loads(args.toolchain.read_text())
    compiler = Path(toolchain['compiler'])
    framework = Path(toolchain['framework_dir'])
    assert B.sha256(compiler) == B.COMPILER_BINARY_SHA256
    assert B.sha256(Path(toolchain['compiler_archive'])) == B.COMPILER_ARCHIVE_SHA256
    assert B.sha256(Path(toolchain['framework_archive'])) == B.FRAMEWORK_ARCHIVE_SHA256
    framework_before = B.verify_framework_sources(framework, Path(toolchain['framework_archive']))
    source_paths = {
        'arboretum.move': REPO / 'contract-reconstruction/source/arboretum.move',
        'settlement.move': REPO / 'contract-payout/source/settlement.move',
    }
    assert B.sha256(source_paths['arboretum.move']) == LEGACY_SOURCE_SHA256
    assert B.sha256(source_paths['settlement.move']) == SETTLEMENT_SOURCE_SHA256
    sources = {name: path.read_text() for name, path in source_paths.items()}
    fragment_path = HERE / 'move/first-season-tests.move.inc'
    fragment = fragment_path.read_text()
    fragment_hash = B.sha256(fragment_path)
    expected = sorted(re.findall(r'^    fun (season_test_[A-Za-z0-9_]+)\(', fragment, re.M))
    assert expected and len(set(expected)) == len(expected)
    config = output / 'config'; config.mkdir()
    keyfile = config / 'empty.keystore'; keyfile.write_text('[]\n'); keyfile.chmod(0o600)
    save(config / 'client.yaml', {'keystore': {'File': str(keyfile)}, 'external_keys': None,
        'envs': [{'alias': 'offline-first-season', 'rpc': 'http://127.0.0.1:9',
                  'ws': None, 'basic_auth': None, 'chain_id': '00000000'}],
        'active_env': 'offline-first-season', 'active_address': None})
    env = {**os.environ, 'SUI_CONFIG_DIR': str(config), 'MOVE_HOME': str(output / 'move-cache'),
           'CARGO_NET_OFFLINE': 'true', 'HTTP_PROXY': 'http://127.0.0.1:9',
           'HTTPS_PROXY': 'http://127.0.0.1:9', 'ALL_PROXY': 'http://127.0.0.1:9'}
    version = subprocess.check_output([str(compiler), '--version'], env=env, text=True).strip()
    assert version == B.COMPILER_VERSION
    manifest = ('[package]\nname = "arboretum"\nedition = "2024.beta"\n\n[dependencies]\n'
        f'Sui = {{ local = "{framework / "sui-framework"}" }}\n'
        f'MoveStdlib = {{ local = "{framework / "move-stdlib"}" }}\n\n'
        '[addresses]\narboretum = "0x0"\n\n[environments]\nmainnet = "35834a8a"\n')

    def package(folder: str, contents: dict[str, str]) -> Path:
        path = output / folder; (path / 'sources').mkdir(parents=True)
        (path / 'Move.toml').write_text(manifest)
        for name, text in contents.items(): (path / 'sources' / name).write_text(text)
        return path

    def run(command: list[str], label: str) -> tuple[subprocess.CompletedProcess, str]:
        result = subprocess.run(command, cwd=output, env=env, capture_output=True, text=True, timeout=300)
        log = ANSI.sub('', result.stdout + result.stderr)
        (output / (label + '.log')).write_text(log)
        assert 'secret recovery phrase' not in log.lower() and 'generated new keypair' not in log.lower()
        assert json.loads(keyfile.read_text()) == []
        return result, log

    production = package('production', sources)
    build_command = [str(compiler), 'move', 'build', '--build-env', 'mainnet', '--path', str(production)]
    build, build_log = run(build_command, 'production-build')
    assert build.returncode == 0, build_log[-6000:]
    expected_build = json.loads((REPO / 'contract-payout/evidence/build-result.json').read_text())
    expected_raw = {item['name']: item['sha256'] for item in expected_build['modules']}
    receipt_path = REPO / 'settlement-integration/release/evidence/20261031-confirmed-upgrade/receipt.json'
    receipt = json.loads(receipt_path.read_text())
    packages = []
    def visit(value):
        if isinstance(value, dict):
            if value.get('address') == PUBLISHED_PACKAGE and 'modules' in value and 'typeOrigins' in value:
                packages.append(value)
            for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
    visit(receipt)
    assert len(packages) == 1 and not packages[0]['modules']['pageInfo']['hasNextPage']
    published = {module['name']: base64.b64decode(module['bytes'], validate=True)
                 for module in packages[0]['modules']['nodes']}
    module_records = []
    for name in ['arboretum', 'settlement']:
        path = production / f'build/arboretum/bytecode_modules/{name}.mv'
        raw = path.read_bytes(); published_form = publication_bytes(raw)
        assert B.sha256(path) == expected_raw[name]
        assert published_form == published[name], f'{name} differs from confirmed published module'
        module_records.append({'name': name, 'bytes': len(raw), 'sourceSha256': B.sha256(source_paths[name + '.move']),
            'prepublicationSha256': B.sha256(path), 'publishedSha256': hashlib.sha256(published_form).hexdigest(),
            'exactPublishedMatchAfterOnlySelfAddressBinding': True})
    dependencies = B.compare_linked_dependencies(production)
    index = sources['settlement.move'].rfind('}')
    generated = sources['settlement.move'][:index] + '\n' + fragment + '\n' + sources['settlement.move'][index:]
    assert generated[:index] + generated[index + len(fragment) + 2:] == sources['settlement.move']
    tests = package('tests', {**sources, 'settlement.move': generated})
    test_command = [str(compiler), 'move', 'test', '--build-env', 'mainnet', '--path', str(tests),
                    '--threads', '1', 'season_test_']
    result, log = run(test_command, 'first-season-tests')
    totals = re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)', log)
    counts = {'total': int(totals[1]), 'passed': int(totals[2]), 'failed': int(totals[3])} if totals else None
    passed = re.findall(r'\[\s*PASS\s*\]\s+([^\r\n]+)', log)
    actual = sorted(name.rsplit('::', 1)[-1] for name in passed)
    success = result.returncode == 0 and counts == {'total': len(expected), 'passed': len(expected), 'failed': 0} and actual == expected
    assert B.sha256(fragment_path) == fragment_hash
    assert all(path.read_text() == sources[name] for name, path in source_paths.items())
    assert B.tree_identity(framework) == framework_before
    assert json.loads(keyfile.read_text()) == []
    report = {'schemaVersion': 1, 'completedAt': now(),
        'status': 'FIRST_SEASON_VM_TESTS_PASSED' if success else 'FIRST_SEASON_VM_TESTS_FAILED',
        'compiler': version, 'compilerSha256': B.COMPILER_BINARY_SHA256,
        'frameworkRevision': B.FRAMEWORK_REVISION, 'frameworkSourceFilesUnchanged': framework_before['file_count'],
        'publishedPackageId': PUBLISHED_PACKAGE, 'publishedReceiptSha256': B.sha256(receipt_path),
        'modules': module_records, 'exactLinkedFrameworkModules': sum(row['modules_compared'] for row in dependencies),
        'productionBuildCommand': build_command, 'testCommand': test_command,
        'testFragmentSha256': fragment_hash, 'runnerSha256': B.sha256(Path(__file__)),
        'testOnlyInsertion': True, 'counts': counts, 'expectedTests': expected, 'passedTests': actual,
        'exitCode': result.returncode, 'productionSourceUnchanged': True,
        'isolatedKeystoreStayedEmpty': True, 'configuredRpc': 'http://127.0.0.1:9',
        'networkOrWalletOperation': False, 'signaturesProduced': 0, 'transactionsSubmitted': 0,
        'limits': ['Offline VM fixtures are not a mainnet transaction or user-wallet acceptance test.',
                   'The same-version cross-Registry inventory case characterizes existing deployed behavior; it does not fix it.']}
    save(output / 'summary.json', report)
    print(json.dumps({'status': report['status'], 'counts': counts, 'output': str(output),
                      'exactPublishedModuleMatches': len(module_records)}, indent=2))
    if not success: print(log[-10000:])
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
