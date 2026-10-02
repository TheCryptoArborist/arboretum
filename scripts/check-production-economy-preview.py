#!/usr/bin/env python3
from pathlib import Path
import re,subprocess
ROOT=Path(__file__).resolve().parents[1]
subprocess.run(['python3','scripts/build-production-economy-preview.py'],cwd=ROOT,check=True)
w=(ROOT/'production-economy/preview/wallet.js').read_text()
h=(ROOT/'production-economy/preview/index.html').read_text()
assert 'GROWTH_DEPOSIT_MIST = 10_000_000_000n' in w
for s in ['0: 5_000_000_000n','1: 10_000_000_000n','2: 25_000_000_000n','3: 50_000_000_000n','4: 100_000_000_000n','5: 30_000_000_000n','6: 30_000_000_000n']: assert s in w
for s in ['0: 15_000_000_000n','1: 10_000_000_000n','2: 5_000_000_000n','3: 4_000_000_000n','4: 2_000_000_000n']: assert s in w
for s in ["price:'15 SUI'","price:'10 SUI'","price:'5 SUI'","price:'4 SUI'","price:'2 SUI'"]: assert s in h
assert 'PRODUCTION ECONOMY REVIEW' in h
assert 'Connect your wallet and plant a Seed for 0.01 SUI.' not in h
assert "showConfirm('Plant Seed with 0.01 SUI deposit?'" not in h
assert "tx.setGasBudget(SUPPLY_DROP_GAS_BUDGET_MIST)" not in w
# Production source remains the test economy until an explicit cutover.
live=(ROOT/'wallet.js').read_text()
assert 'GROWTH_DEPOSIT_MIST = 10_000_000n; // 0.01 SUI' in live
print('production economy frontend preview checks passed')
