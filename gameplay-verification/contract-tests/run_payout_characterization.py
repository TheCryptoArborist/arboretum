#!/usr/bin/env python3
"""Run exactly three characterization tests against an unchanged baseline copy.

Only the supplied work directory and this directory's result files are written.
There are no publish, wallet, signing, simulation, or blockchain RPC operations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

BASELINE_SHA256 = "f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2"
COMPILER_VERSION = "sui 1.79.1-808640d9b49a"
COMPILER_ARCHIVE_SHA256 = "547b3091e975b8a6b4078473a3868d86e985156b6715a8c4afb7fd7313a36abf"
FRAMEWORK_REVISION = "58386edc269ef88ff0f40ab0a9d50e87cba80ca8"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", type=Path, required=True)
    parser.add_argument("--compiler-archive", type=Path)
    parser.add_argument("--framework-dir", type=Path, required=True,
                        help="Pinned packages directory containing sui-framework and move-stdlib")
    parser.add_argument("--work-dir", type=Path, required=True)
    args = parser.parse_args()
    compiler = args.compiler.resolve()
    framework = args.framework_dir.resolve()
    work = args.work_dir.resolve()
    baseline = ROOT / "contract/sources/arboretum.move"
    include = HERE / "payout-characterization.move.inc"
    assert digest(baseline) == BASELINE_SHA256, "Accepted baseline source drift"
    assert work != ROOT and ROOT not in work.parents, "Keep generated packages outside the repository"
    assert (framework / "sui-framework/Move.toml").is_file()
    assert (framework / "move-stdlib/Move.toml").is_file()

    work.mkdir(parents=True, exist_ok=True)
    config = work / "config"
    config.mkdir(exist_ok=True)
    keystore = config / "empty.keystore"
    keystore.write_text("[]\n")
    keystore.chmod(0o600)
    (config / "client.yaml").write_text(json.dumps({
        "keystore": {"File": str(keystore)}, "external_keys": None,
        "envs": [{"alias": "offline-tests", "rpc": "http://127.0.0.1:9",
                  "ws": None, "basic_auth": None, "chain_id": "00000000"}],
        "active_env": "offline-tests", "active_address": None,
    }, indent=2) + "\n")
    env = os.environ.copy()
    env["SUI_CONFIG_DIR"] = str(config)
    # The Move CLI supports a dedicated package-cache location. Do not alter
    # HOME or use the account's default package cache/configuration.
    env["MOVE_HOME"] = str(work / "move-cache")

    version = subprocess.run([str(compiler), "--version"], capture_output=True,
                             text=True, check=True, env=env).stdout.strip()
    assert version == COMPILER_VERSION, f"Unexpected compiler: {version}"
    archive_verified = False
    if args.compiler_archive:
        assert digest(args.compiler_archive) == COMPILER_ARCHIVE_SHA256, "Compiler archive mismatch"
        archive_verified = True

    original = baseline.read_text()
    insertion = original.rfind("}")
    assert insertion >= 0 and not original[insertion + 1:].strip()
    tests = include.read_text()
    generated_source = original[:insertion] + "\n" + tests + "\n" + original[insertion:]
    # Removing only the appended test fragment reconstructs the exact baseline.
    reconstructed = generated_source[:insertion] + generated_source[insertion + len(tests) + 2:]
    assert reconstructed == original
    expected_tests = re.findall(r"#\[test(?:, [^\]]+)?\]\s*fun\s+(payout_\w+)", tests)
    assert len(expected_tests) == 3, expected_tests

    package = work / "generated"
    (package / "sources").mkdir(parents=True, exist_ok=True)
    (package / "sources/arboretum.move").write_text(generated_source)
    manifest = (
        '[package]\nname = "arboretum_payout_characterization"\nedition = "2024.beta"\n\n'
        '[dependencies]\n'
        f'Sui = {{ local = "{framework / "sui-framework"}" }}\n'
        f'MoveStdlib = {{ local = "{framework / "move-stdlib"}" }}\n\n'
        '[addresses]\narboretum = "0x0"\n\n'
        '[environments]\nmainnet = "35834a8a"\n'
    )
    (package / "Move.toml").write_text(manifest)
    command = [str(compiler), "move", "test", "--build-env", "mainnet",
               "--path", str(package), "--threads", "1", "payout_"]
    started = datetime.now(timezone.utc).isoformat()
    execution = subprocess.run(command, cwd=work, env=env, capture_output=True,
                               text=True, timeout=300)
    log = execution.stdout + execution.stderr
    assert "secret recovery phrase" not in log.lower()
    assert "generated new keypair" not in log.lower()
    assert json.loads(keystore.read_text()) == [], "Unexpected signing material"
    assert digest(baseline) == BASELINE_SHA256, "Baseline changed while tests ran"
    (work / "move-tests.log").write_text(log)
    (HERE / "latest-move-tests.log").write_text(log)
    totals = re.search(r"Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)", log)
    counts = {"total": int(totals[1]), "passed": int(totals[2]), "failed": int(totals[3])} if totals else None
    succeeded = execution.returncode == 0 and counts == {"total": 3, "passed": 3, "failed": 0}
    report = {
        "status": "BASELINE_BEHAVIOR_REPRODUCED_REVIEW_REQUIRED" if succeeded else "EXECUTION_FAILED",
        "started_at_utc": started, "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        "baseline_source_sha256": BASELINE_SHA256,
        "baseline_unchanged": True,
        "generated_source_sha256": digest(package / "sources/arboretum.move"),
        "test_include_sha256": digest(include),
        "runner_sha256": digest(Path(__file__)),
        "compiler": version, "compiler_binary_sha256": digest(compiler),
        "compiler_archive_sha256": COMPILER_ARCHIVE_SHA256,
        "compiler_archive_verified": archive_verified,
        "framework_revision": FRAMEWORK_REVISION,
        "framework_source_mode": "local packages downloaded from pinned GitHub revision",
        "command": command, "exit_code": execution.returncode,
        "counts": counts, "tests": expected_tests,
        "evidence_level": "Actual local Sui Move VM using synthetic state and funds",
        "characterization_only": True,
        "new_economic_policy_selected": False,
        "deployed_source_equivalence_established": False,
        "wallet_connected": False, "signed_or_submitted_transactions": False,
        "synthetic_fixture_assertions": {
            "direct_vs_archived": {
                "pool_mist": 1000, "seed_gp": 100,
                "last_watered_relative_to_cutoff_days": -9,
                "claim_relative_to_cutoff_days": 2,
                "direct_payment_mist": 0, "direct_remaining_pool_mist": 1000,
                "archived_payment_mist": 1000, "archived_remaining_pool_mist": 0,
            },
            "claim_order": {
                "pool_mist": 1000, "eligible_gp": 40, "time_dead_gp": 60,
                "eligible_claims_first_payment_mist": 400,
                "time_dead_claims_first_eligible_payment_mist": 1000,
                "funds_conserved_in_both_orders": True,
            },
            "partial_claim_then_archive": {
                "direct_payment_mist": 400, "archived_payment_mist": 600,
                "remaining_pool_mist": 0, "replay_expected_abort": "E_NO_SEEDS (7)",
            },
        } if succeeded else None,
        "limits": [
            "Passing characterization tests confirm baseline inconsistencies; this is not release approval.",
            "Synthetic seeds, clocks, balances and scenario senders are fixtures, not real wallet activity.",
            "The test copy preserves all production functions and appends test-only helpers and tests.",
            "No real package was published, upgraded, called, simulated, paused, reset, archived or funded.",
        ],
    }
    (HERE / "latest-result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(log[-16000:])
    print(json.dumps({"status": report["status"], "compiler": version,
                      "source_sha256": BASELINE_SHA256, "counts": counts,
                      "report": str(HERE / "latest-result.json")}, indent=2))
    return 0 if succeeded else 1


if __name__ == "__main__":
    sys.exit(main())
