#!/usr/bin/env python3
"""Run focused offline suites and require their individual test counts.

The suites use a synthetic wallet and injected network responses. No signer,
external service, chain submission, or deployment is invoked by this runner.
"""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SUITES = [
    ("scripts/test-wallet-transactions.mjs", 50),
    ("scripts/test-season-status.mjs", 47),
    ("economy-review/garden-ux.test.mjs", 34),
    ("economy-review/garden-ended.test.mjs", 28),
]


def sha(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def main():
    results = []
    for relative, minimum_tests in SUITES:
        # Direct invocation emits each node:test case in this runtime and CI.
        # Requiring parsed counts prevents a process-only wrapper result from
        # being mistaken for execution of the underlying tests.
        command = ["node", "--test-reporter=tap", relative]
        execution = subprocess.run(command, cwd=ROOT, capture_output=True,
                                   text=True, check=True, timeout=60)
        counts = {}
        for field in ["tests", "pass", "fail", "cancelled", "skipped"]:
            matches = re.findall(rf"^# {field} (\d+)$", execution.stdout, re.MULTILINE)
            assert len(matches) == 1, f"Missing/ambiguous {field} count in {relative}"
            counts[field] = int(matches[0])
        assert counts["tests"] >= minimum_tests, f"Named tests did not execute: {relative}"
        assert counts["pass"] == counts["tests"], f"Not all tests passed: {relative}"
        assert all(counts[field] == 0 for field in ["fail", "cancelled", "skipped"])
        results.append({"command": command, "sourceSha256": sha(relative),
                        **counts, "output": execution.stdout, "stderr": execution.stderr})
        print(f"{relative}: {counts['pass']} passed, 0 failed, 0 skipped")
    report = {
        "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "nodeVersion": subprocess.check_output(["node", "--version"], text=True).strip(),
        "walletSha256": sha("wallet.js"), "gameHtmlSha256": sha("index.html"),
        "totalTests": sum(result["tests"] for result in results),
        "totalFailed": 0, "totalSkipped": 0, "results": results,
        "responseMode": "Offline fixtures; synthetic wallet only", "transactionsSubmitted": 0,
    }
    output = ROOT / "gameplay-verification/evidence/offline-verification.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"tests": report["totalTests"], "failed": 0,
                      "walletSha256": report["walletSha256"]}))


if __name__ == "__main__":
    main()
