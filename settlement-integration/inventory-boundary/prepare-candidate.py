#!/usr/bin/env python3
"""Prepare or verify a separate production-version candidate from frozen v12.

Only VERSION and the 13 approved price constants change, plus comments.
No historical source, deployment configuration or on-chain object is modified.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASELINE = REPO / 'contract-payout/source/settlement.move'
DECISIONS = REPO / 'economy-review/decisions.json'
BASELINE_SHA256 = '91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb'
DECISIONS_SHA256 = 'ac7833719724023d1f8703cb7d3092e41f5328bfa909bc7f903fbbbffccd2852'
PRICE_NAMES = {
    'Revival Kit': 'SUPPLY_PRICE_REVIVAL_KIT',
    'Drought Shield': 'SUPPLY_PRICE_DROUGHT_SHIELD',
    'Rain Barrel': 'SUPPLY_PRICE_RAIN_BARREL',
    'Mulch': 'SUPPLY_PRICE_MULCH',
    'Watering Boost': 'SUPPLY_PRICE_WATERING_BOOST',
}
EXPECTED_PRICES = {
    'GROWTH_DEPOSIT_MIST': 10_000_000_000,
    'CRATE_PRICE_0': 5_000_000_000,
    'CRATE_PRICE_1': 10_000_000_000,
    'CRATE_PRICE_2': 25_000_000_000,
    'CRATE_PRICE_3': 50_000_000_000,
    'CRATE_PRICE_4': 100_000_000_000,
    'CRATE_PRICE_5': 30_000_000_000,
    'CRATE_PRICE_6': 30_000_000_000,
    'SUPPLY_PRICE_REVIVAL_KIT': 15_000_000_000,
    'SUPPLY_PRICE_DROUGHT_SHIELD': 10_000_000_000,
    'SUPPLY_PRICE_RAIN_BARREL': 5_000_000_000,
    'SUPPLY_PRICE_MULCH': 4_000_000_000,
    'SUPPLY_PRICE_WATERING_BOOST': 2_000_000_000,
}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def prepare() -> dict[str, str]:
    raw = BASELINE.read_bytes()
    decisions_raw = DECISIONS.read_bytes()
    assert digest(raw) == BASELINE_SHA256, 'Frozen v12 source changed'
    assert digest(decisions_raw) == DECISIONS_SHA256, 'Approved economy record changed'
    baseline = raw.decode('utf-8')
    decisions = json.loads(decisions_raw)
    assert decisions['productionEconomy']['status'] == 'full_price_schedule_approved_not_activated'
    assert decisions['guardrails']['retroactiveTestInventoryGrants'] is False
    prices = {'GROWTH_DEPOSIT_MIST': int(decisions['planting']['priceMist'])}
    assert len(decisions['crates']) == 7 and {x['tier'] for x in decisions['crates']} == set(range(7))
    for row in decisions['crates']:
        assert row['status'] == 'approved_price_not_activated'
        prices[f"CRATE_PRICE_{row['tier']}"] = int(row['priceMist'])
    assert len(decisions['supplyDrops']) == 5
    for row in decisions['supplyDrops']:
        assert row['status'] == 'approved_price_not_activated'
        prices[PRICE_NAMES[row['name']]] = int(row['priceMist'])
    assert prices == EXPECTED_PRICES, 'Price mapping differs from the approved schedule'
    candidate = baseline.replace(
        '    // Additive candidate. Legacy arboretum objects cannot enter these typed paths.\n',
        '    // Production candidate: inventory version 2 begins with the approved prices.\n'
        '    // Existing version-1 test objects remain in their original economy.\n',
    )
    assert candidate != baseline
    candidate, count = re.subn(r'(?m)^(    const VERSION:\s+u64 = )1;$', r'\g<1>2;', candidate)
    assert count == 1
    changes = []
    for name, price in prices.items():
        pattern = rf'(?m)^(    const {name}:\s+u64 = )([0-9_]+);[^\n]*$'
        match = re.search(pattern, candidate)
        assert match, name
        previous = int(match.group(2).replace('_', ''))
        candidate, count = re.subn(pattern,
            lambda m: m.group(1) + format(price, '_d') + f'; // {price // 1_000_000_000} SUI; approved production price',
            candidate)
        assert count == 1
        changes.append({'constant': name, 'testPriceMist': str(previous), 'productionPriceMist': str(price)})
    old_comment = ('    // Rotating one-off Supply Drops. These are test-economy prices.\n'
                   '    // Original economy targets: watering boost 5 SUI, mulch 8 SUI,\n'
                   '    // rain barrel 10 SUI, drought shield 15 SUI, revival kit 25 SUI.\n')
    assert candidate.count(old_comment) == 1
    candidate = candidate.replace(old_comment,
        '    // Rotating one-off Supply Drops: approved production prices from first v2 purchase.\n')
    # The planting referral approval did not change. This exact fixed amount,
    # shop routing, destinations, item contents and every function stay intact.
    assert re.search(r'const REFERRAL_SHARE_MIST:\s+u64 =\s+1_000_000;', candidate)
    patch = ''.join(difflib.unified_diff(baseline.splitlines(True), candidate.splitlines(True),
        fromfile='contract-payout/source/settlement.move',
        tofile='settlement-integration/inventory-boundary/production/settlement.move'))
    record = {
        'schemaVersion': 1,
        'status': 'PRODUCTION_INVENTORY_BOUNDARY_CANDIDATE_NOT_PUBLISHED',
        'baselinePackageId': '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a',
        'baselinePackageVersion': 12,
        'baselineInventoryVersion': 1,
        'candidateInventoryVersion': 2,
        'productionRequiresFreshRegistry': True,
        'existingRegistryRemainsTestVersion': True,
        'existingInventoryConverted': False,
        'newMigrationOrGrantFunctions': 0,
        'newStructsOrFields': 0,
        'approvedPrices': changes,
        'fixedPlantingReferralMist': '1000000',
        'baselineSource': str(BASELINE.relative_to(REPO)),
        'baselineSourceSha256': BASELINE_SHA256,
        'approvedDecisions': str(DECISIONS.relative_to(REPO)),
        'approvedDecisionsSha256': DECISIONS_SHA256,
        'candidateSourceSha256': digest(candidate.encode()),
        'reviewPatchSha256': digest(patch.encode()),
        'limits': [
            'This candidate is not a deployed upgrade, active production Registry or live price change.',
            'All v2 paid acquisition must use this approved schedule from its first publication.',
            'Old test Tools and Crates cannot be consumed as v2 items; there is no conversion path.',
            'Same-version production items may still cross production Registries.',
            'The generic NFT-reference planting path remains generic, charges the full production fee and creates fresh Seed state.',
            'Administrator promotions remain an explicit trusted capability; their events alone do not prove paid revenue.',
        ],
    }
    return {'settlement.move': candidate, 'settlement.patch': patch,
            'candidate.json': json.dumps(record, indent=2) + '\n'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Write only missing candidate files; never replace differing files.')
    args = parser.parse_args()
    outputs = prepare()
    folder = HERE / 'production'
    if args.write:
        folder.mkdir(exist_ok=True)
    for name, text in outputs.items():
        target = folder / name
        if args.write and not target.exists():
            with target.open('x') as handle:
                handle.write(text)
        assert target.read_text() == text, f'Candidate differs from its frozen-source/approved-price reconstruction: {name}'
    print(json.dumps({'status': 'CANDIDATE_RECONSTRUCTION_VERIFIED',
        'inventoryVersion': 2, 'approvedPriceConstants': len(EXPECTED_PRICES),
        'candidateSourceSha256': digest(outputs['settlement.move'].encode()),
        'frozenSourceUnchanged': digest(BASELINE.read_bytes()) == BASELINE_SHA256}, indent=2))


if __name__ == '__main__':
    main()
