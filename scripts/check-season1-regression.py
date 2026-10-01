#!/usr/bin/env python3
"""Run a synthetic local Move-VM negative control, not an on-chain transaction."""
from pathlib import Path
import json
import re
import runpy
import subprocess

root = Path(__file__).resolve().parents[1]
ns = runpy.run_path(str(root / 'scripts/prepare-season1-step1.py'))
area = ns['AREA']
original = ns['original']
tests = ns['tests']
span = ns['fn_span']
helpers = []
for name in ['step1_seed','step1_setup','step1_drop_seed','step1_finish']:
    a,b = span(tests,name)
    code = tests[a:b]
    code = code.replace('        register_line(&mut registry, &seed, 1);\n','')
    helpers.append('    #[test_only]\n'+code)
a,b = span(tests,'step1_protection_blocks_early_points')
regression = '    #[test, expected_failure(abort_code = E_ALREADY_WATERED_TODAY)]\n'+tests[a:b]
baseline = original.rstrip()[:-1]+'\n    const POINT_INTERVAL_MS: u64 = 77_760_000;\n'+'\n'.join(helpers)+'\n'+regression+'\n}\n'
dest = area / 'baseline-regression'
(dest/'sources').mkdir(parents=True,exist_ok=True)
(dest/'Move.toml').write_text(ns['manifest'].replace('arboretum_step1_candidate','arboretum_step1_negative_control'))
(dest/'sources/arboretum.move').write_text(baseline)
# --build-env selects framework dependency context; it does not publish or submit.
result = subprocess.run(['sui','move','test','--build-env','mainnet','--path',str(dest)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=300)
# Defense in depth: never put any compiler-generated recovery phrase into an artifact.
log = re.sub(r'(?im)^.*secret recovery phrase.*$', '[EPHEMERAL CLI RECOVERY MATERIAL REDACTED]', result.stdout)
(root/'step1-results/baseline-regression.txt').write_text(log)
expected_test_failed = re.search(r'\[\s*FAIL\s*\].*step1_protection_blocks_early_points',log) is not None
expected_totals = re.search(r'Total tests:\s*5;\s*passed:\s*4;\s*failed:\s*1',log) is not None
if result.returncode == 0 or not expected_test_failed or not expected_totals:
    print(log)
    raise SystemExit('Negative control did not show exactly the intended one failing regression. Do not claim it reproduced.')
report = {'baseline_commit':ns['BASE'],'baseline_test':'step1_protection_blocks_early_points',
          'baseline_expected_failure_reproduced':True,'baseline_existing_tests_passed':4,
          'scope':'Synthetic Move VM execution only, not mainnet simulation or proof of full deployed-source equivalence.'}
(root/'step1-results/negative-control.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
