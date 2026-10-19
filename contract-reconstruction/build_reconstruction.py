#!/usr/bin/env python3
"""Build the reconstructed deployment source in an isolated, unsigned workspace.

This command has no publish, upgrade, transaction, or wallet operation. It uses
local pinned framework packages and an empty configuration with a loopback RPC.
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
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
COMPILER_VERSION = 'sui 1.78.1-722ac4fcf484'
COMPILER_ARCHIVE_SHA256 = '87ac74d50009d69419e617a017f1e46eb9c11e409238830d8b66e7f17456805e'
COMPILER_BINARY_SHA256 = '381deb1ffc87177a92bbfd0c1ff59507ceb190fd62d7482909d31d28740ad068'
FRAMEWORK_REVISION = '8b9163554164776bc3372d828f8d6ced55aa2b5e'
FRAMEWORK_ARCHIVE_SHA256 = 'e7faf6fa34d90131550c6a933607cd4a8a67e0eda4151d242e8256ed678d070f'
SAVED_SOURCE_SHA256 = 'f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2'
PROVENANCE_SHA256 = '03a3cdcfd73cc12c67084d1b6f56891823650b0df01f7036ff87e59db8998373'


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def tree_identity(root: Path) -> dict:
    files = {str(p.relative_to(root)): sha256(p)
             for p in sorted(root.rglob('*')) if p.is_file()}
    encoded = json.dumps(files, sort_keys=True, separators=(',', ':')).encode()
    return {'sha256': hashlib.sha256(encoded).hexdigest(), 'file_count': len(files), 'files': files}


def verify_framework_sources(root: Path, archive: Path) -> dict:
    """Tie the actual local input files to the verified official commit archive."""
    prefix = f'sui-{FRAMEWORK_REVISION}/crates/sui-framework/packages/'
    expected = {}
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            if not member.name.startswith(prefix) or not member.isfile():
                continue
            relative = member.name[len(prefix):]
            assert '..' not in Path(relative).parts and not Path(relative).is_absolute()
            with tar.extractfile(member) as stream:
                expected[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
    actual = tree_identity(root)
    assert expected and actual['files'] == expected, 'Extracted framework differs from pinned archive'
    return actual


def run_characterization(compiler: Path, package: Path, work: Path, manifest: str,
                         env: dict, source: Path, output: Path) -> dict:
    """Run existing scenario tests and three payout characterizations on a test-only copy."""
    include = REPO / 'gameplay-verification/contract-tests/payout-characterization.move.inc'
    original = source.read_text()
    fragment = include.read_text()
    insertion = original.rfind('}')
    assert insertion >= 0 and not original[insertion+1:].strip()
    generated = original[:insertion] + '\n' + fragment + '\n' + original[insertion:]
    assert generated[:insertion] + generated[insertion+len(fragment)+2:] == original
    test_package = work / 'characterization'
    (test_package / 'sources').mkdir(parents=True, exist_ok=True)
    (test_package / 'sources/arboretum.move').write_text(generated)
    (test_package / 'Move.toml').write_text(manifest)
    command = [str(compiler), 'move', 'test', '--build-env', 'mainnet',
               '--path', str(test_package), '--threads', '1']
    result = subprocess.run(command, cwd=work, env=env, text=True,
                            capture_output=True, timeout=300)
    log = result.stdout + result.stderr
    assert 'secret recovery phrase' not in log.lower()
    assert 'generated new keypair' not in log.lower()
    totals = re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)', log)
    counts = {'total': int(totals[1]), 'passed': int(totals[2]), 'failed': int(totals[3])} if totals else None
    named = re.findall(r'\[\s*PASS\s*\]\s+([^\r\n]+)', log)
    expected_payout = set(re.findall(r'#\[test(?:, [^\]]+)?\]\s*fun\s+(payout_\w+)', fragment))
    actual_payout = {name.rsplit('::',1)[-1] for name in named if '::payout_' in name}
    succeeded = (result.returncode == 0 and counts == {'total': 7, 'passed': 7, 'failed': 0}
                 and len(named) == 7 and actual_payout == expected_payout and len(expected_payout) == 3)
    report = {
        'status': 'DEPLOYED_BASELINE_BEHAVIOR_REPRODUCED' if succeeded else 'CHARACTERIZATION_FAILED',
        'completed_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_sha256': sha256(source), 'test_include_sha256': sha256(include),
        'generated_test_source_sha256': sha256(test_package / 'sources/arboretum.move'),
        'production_source_unchanged': True, 'test_only_insertion': True,
        'compiler': COMPILER_VERSION, 'framework_revision': FRAMEWORK_REVISION,
        'command': command, 'exit_code': result.returncode,
        'counts': counts, 'tests': named,
        'payout_tests_reproduce_existing_problems': True,
        'new_payout_policy_implemented': False,
        'signed_or_submitted_transactions': False,
    }
    assert (package / 'sources/arboretum.move').read_bytes() == source.read_bytes()
    (output / 'characterization.log').write_text(log)
    (output / 'characterization-result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(log[-12000:])
    return report


def compare_linked_dependencies(package: Path) -> list[dict]:
    provenance = HERE / 'provenance.json'
    assert sha256(provenance) == PROVENANCE_SHA256, 'Pinned dependency evidence drift'
    evidence = json.loads(provenance.read_text())['officialMainnet1781FrameworkComparison']['results']
    root = package / 'build/arboretum/bytecode_modules/dependencies'
    results = []
    for target in evidence:
        assert target['sourceRevision'] == FRAMEWORK_REVISION
        name = {'move-stdlib': 'MoveStdlib', 'sui-framework': 'Sui'}[target['name']]
        files = list((root / name).glob('*.mv'))
        actual = {p.stem: sha256(p) for p in sorted(files)}
        matches = sorted(actual.values()) == target['sourceModuleSha256Sorted']
        assert matches and len(files) == target['chainModuleCount'], f'{name} differs from linked bytecode'
        results.append({'name': name, 'chain_package': target['chainPackage'],
                        'modules_compared': len(files), 'exact_linked_bytecode_match': matches,
                        'compiled_module_sha256': actual})
    assert {r['name'] for r in results} == {'MoveStdlib', 'Sui'}
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compiler', type=Path, required=True)
    parser.add_argument('--compiler-archive', type=Path, required=True)
    parser.add_argument('--framework-dir', type=Path, required=True)
    parser.add_argument('--framework-archive', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--run-characterization-tests', action='store_true')
    args = parser.parse_args()
    compiler = args.compiler.resolve()
    framework = args.framework_dir.resolve()
    work = args.work_dir.resolve()
    assert work != REPO and REPO not in work.parents, 'Build outside the repository'
    assert work != framework and framework not in work.parents, 'Keep build and framework separate'
    assert sha256(args.compiler_archive) == COMPILER_ARCHIVE_SHA256, 'Compiler archive mismatch'
    assert sha256(compiler) == COMPILER_BINARY_SHA256, 'Compiler binary mismatch'
    assert sha256(args.framework_archive) == FRAMEWORK_ARCHIVE_SHA256, 'Framework archive mismatch'
    baseline = REPO / 'contract/sources/arboretum.move'
    assert sha256(baseline) == SAVED_SOURCE_SHA256, 'Saved production source drift'
    source = HERE / 'source/arboretum.move'
    framework_before = verify_framework_sources(framework, args.framework_archive)
    for name in ['sui-framework', 'move-stdlib']:
        assert (framework / name / 'Move.toml').is_file(), name

    work.mkdir(parents=True, exist_ok=True)
    config = work / 'config'
    config.mkdir(exist_ok=True)
    keyfile = config / 'empty.keystore'
    keyfile.write_text('[]\n')
    keyfile.chmod(0o600)
    (config / 'client.yaml').write_text(json.dumps({
        'keystore': {'File': str(keyfile)}, 'external_keys': None,
        'envs': [{'alias': 'offline-reconstruction', 'rpc': 'http://127.0.0.1:9',
                  'ws': None, 'basic_auth': None, 'chain_id': '00000000'}],
        'active_env': 'offline-reconstruction', 'active_address': None,
    }, indent=2)+'\n')
    env = os.environ.copy()
    env['SUI_CONFIG_DIR'] = str(config)
    env['MOVE_HOME'] = str(work / 'move-cache')
    version = subprocess.check_output([str(compiler), '--version'], env=env, text=True).strip()
    assert version == COMPILER_VERSION, version

    package = work / 'generated'
    (package / 'sources').mkdir(parents=True, exist_ok=True)
    (package / 'sources/arboretum.move').write_bytes(source.read_bytes())
    manifest = (
        '[package]\nname = "arboretum"\nedition = "2024.beta"\n\n'
        '[dependencies]\n'
        f'Sui = {{ local = "{framework / "sui-framework"}" }}\n'
        f'MoveStdlib = {{ local = "{framework / "move-stdlib"}" }}\n\n'
        '[addresses]\narboretum = "0x0"\n\n'
        '[environments]\nmainnet = "35834a8a"\n'
    )
    (package / 'Move.toml').write_text(manifest)
    command = [str(compiler), 'move', 'build', '--build-env', 'mainnet',
               '--path', str(package), '--disassemble']
    started = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(command, env=env, cwd=work, capture_output=True, text=True, timeout=300)
    log = result.stdout + result.stderr
    assert 'secret recovery phrase' not in log.lower()
    assert 'generated new keypair' not in log.lower()
    assert json.loads(keyfile.read_text()) == [], 'Unexpected signing material'
    assert sha256(baseline) == SAVED_SOURCE_SHA256
    assert (package / 'sources/arboretum.move').read_bytes() == source.read_bytes()
    modules = list((package / 'build').glob('*/bytecode_modules/arboretum.mv'))
    dependencies = compare_linked_dependencies(package) if result.returncode == 0 else []
    report = {
        'status': 'BUILD_SUCCEEDED_COMPARISON_REQUIRED' if result.returncode == 0 else 'BUILD_FAILED',
        'started_at_utc': started, 'completed_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_sha256': sha256(source), 'saved_source_sha256': SAVED_SOURCE_SHA256,
        'runner_sha256': sha256(Path(__file__)),
        'saved_source_unchanged': True, 'compiler': version,
        'compiler_binary_sha256': sha256(compiler),
        'compiler_archive_sha256': COMPILER_ARCHIVE_SHA256,
        'framework_revision': FRAMEWORK_REVISION,
        'framework_archive_sha256': FRAMEWORK_ARCHIVE_SHA256,
        'framework_inputs': framework_before,
        'compiled_dependencies': dependencies,
        'manifest': manifest, 'command': command, 'exit_code': result.returncode,
        'signed_or_submitted_transactions': False,
        'modules': [{
            'name': p.stem, 'path': str(p), 'sha256': sha256(p),
            'size': p.stat().st_size, 'base64': base64.b64encode(p.read_bytes()).decode(),
        } for p in modules],
        'generated_lock': (package / 'Move.lock').read_text() if (package / 'Move.lock').exists() else None,
    }
    out = HERE / 'evidence'
    out.mkdir(exist_ok=True)
    (out / 'build.log').write_text(log)
    (out / 'build-result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(log[-12000:])
    print(json.dumps({k: report[k] for k in ['status', 'compiler', 'source_sha256', 'exit_code']}, indent=2))
    print(json.dumps({'modules': [{k: v for k, v in m.items() if k != 'base64'} for m in report['modules']]}, indent=2))
    if result.returncode == 0 and args.run_characterization_tests:
        characterized = run_characterization(compiler, package, work, manifest, env, source, out)
        assert json.loads(keyfile.read_text()) == []
        assert sha256(baseline) == SAVED_SOURCE_SHA256
        if characterized['status'] != 'DEPLOYED_BASELINE_BEHAVIOR_REPRODUCED':
            return 1
    return result.returncode


if __name__ == '__main__':
    sys.exit(main())
