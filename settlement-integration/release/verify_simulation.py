#!/usr/bin/env python3
"""Verify upgrade simulation effects and optionally capture unchanged live inputs."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import sys

from capture_inputs import IDS, OBJECT_FIELDS, query_only
from verify_inputs import ORIGINAL_PACKAGE, OWNER, UPGRADE_CAP, fields, require, sha256

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO / 'contract-reconstruction'))
from compare_bytecode import Module


def published_bytes(prepublication: bytes) -> bytes:
    module = Module(prepublication)
    address_index = module.at(1, module.self_index)[0]
    start, end = module.spans[8][address_index]
    require(end - start == 32 and prepublication[start:end] == b'\0' * 32,
            'Unexpected candidate self-address slot')
    return prepublication[:start] + bytes.fromhex(ORIGINAL_PACKAGE[2:]) + prepublication[end:]


def verify(capture: Path) -> dict:
    raw_input = (capture / 'unsigned-upgrade.json').read_bytes()
    packet = json.loads(raw_input)
    simulation = json.loads((capture / 'upgrade-simulation.json').read_text())
    require(simulation['unsignedPacketSha256'] == sha256(raw_input), 'Simulation used a different packet')
    require(simulation['transactionKindSha256'] == packet['transactionKindSha256'], 'Simulation kind mismatch')
    require(simulation['variables']['transaction'] == packet['transaction'], 'Simulation transaction mismatch')
    require('checksEnabled: true' in simulation['query'] and 'doGasSelection: true' in simulation['query'],
            'Simulation disabled transaction checks')
    data = simulation['response']['data']
    effects = data['simulateTransaction']['effects']
    require(effects['status'] == 'SUCCESS' and effects['executionError'] is None, 'Upgrade simulation failed')
    changes = effects['objectChanges']
    require(not changes['pageInfo']['hasNextPage'], 'Incomplete simulated object changes')
    package_changes = [change for change in changes['nodes'] if (change['outputState'] or {}).get('asMovePackage')]
    require(len(package_changes) == 1, 'Expected exactly one simulated package')
    created = package_changes[0]
    require(created['idCreated'] is True and created['idDeleted'] is False, 'Expected a newly created package')
    package = created['outputState']['asMovePackage']
    package_id = package['address']
    require(package['version'] == 12 and created['outputState']['owner']['__typename'] == 'Immutable',
            'Unexpected simulated package version or ownership')
    require(not package['modules']['pageInfo']['hasNextPage'], 'Incomplete simulated module inventory')
    modules = {module['name']: base64.b64decode(module['bytes'], validate=True) for module in package['modules']['nodes']}
    require(set(modules) == {'arboretum', 'settlement'}, 'Wrong simulated module inventory')
    build = json.loads((REPO / 'contract-payout/evidence/build-result.json').read_text())
    for module in build['modules']:
        require(modules[module['name']] == published_bytes(base64.b64decode(module['base64'], validate=True)),
                f'Unexpected publication transformation for {module["name"]}')
    before = json.loads((capture / 'chain-inputs.json').read_text())['response']['data']
    old_origins = before['deployed']['asMovePackage']['typeOrigins']
    preserved = [origin for origin in package['typeOrigins'] if origin['module'] == 'arboretum']
    require(preserved == old_origins, 'Legacy type origins changed')
    new_origins = [origin for origin in package['typeOrigins'] if origin['module'] == 'settlement']
    require(len(new_origins) == 39 and all(origin['definingId'] == package_id for origin in new_origins),
            'New settlement types must originate at the simulated new package, not the original package')
    cap_changes = [change for change in changes['nodes'] if change['address'] == UPGRADE_CAP]
    require(len(cap_changes) == 1, 'Expected one UpgradeCap update')
    cap = cap_changes[0]['outputState']
    require(fields(cap)['package'] == package_id and fields(cap)['version'] == '12' and fields(cap)['policy'] == 0,
            'UpgradeCap receipt was not committed correctly')
    require(cap['owner']['address']['address'] == OWNER, 'UpgradeCap was transferred')
    require(len(changes['nodes']) == 2, 'Unexpected state touched by the simulated upgrade')
    gas = effects['gasEffects']['gasSummary']
    net = int(gas['computationCost']) + int(gas['storageCost']) - int(gas['storageRebate'])
    balance_changes = effects['balanceChangesJson']
    require(len(balance_changes) == 1 and balance_changes[0]['address'] == OWNER
            and int(balance_changes[0]['amount']) == -net, 'Unexpected non-gas transfer')
    return {
        'schemaVersion': 1, 'status': 'UNSIGNED_MAINNET_UPGRADE_SIMULATION_VERIFIED',
        'inputCheckpoint': before['checkpoint'], 'simulationCheckpoint': data['checkpoint'],
        'transactionKindSha256': packet['transactionKindSha256'],
        'packageDigestHex': packet['packageDigestHex'],
        'simulationSucceededWithChecksEnabled': True,
        'simulatedPackageIdNeverDeployed': package_id,
        'simulatedPackageVersion': 12,
        'legacyModuleBytesPreserved': True, 'legacyTypeOriginsPreserved': len(old_origins),
        'newTypeOriginsBoundToNewPackage': len(new_origins),
        'newModuleBytesMatchAfterSelfAddressBinding': True,
        'simulatedDependencyLinks': package['linkage'],
        'upgradeCapOwnerAndPolicyPreserved': True,
        'legacyRegistryOrSeedsOrAdminCapMutated': False,
        'settlementRegistryCreated': False, 'startsSeason': False, 'fundsPool': False,
        'gasEstimateMist': {**gas, 'net': str(net)},
        'gasEstimateSui': f'{net // 1_000_000_000}.{net % 1_000_000_000:09d}',
        'newDeploymentPackageId': None, 'newRegistryId': None, 'newAdminCapId': None,
        'transactionsSubmitted': 0, 'signaturesProduced': 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--capture-post-state', action='store_true')
    args = parser.parse_args()
    result = verify(args.capture)
    post_file = args.capture / 'post-simulation-state.json'
    if args.capture_post_state:
        require(not post_file.exists(), 'Post-simulation capture already exists')
        query = '''query PostSimulationState($upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!,
          $registry: SuiAddress!, $simulatedPackage: SuiAddress!) {
          checkpoint { sequenceNumber timestamp digest }
          upgradeCap: object(address: $upgradeCap) { %s }
          legacyAdminCap: object(address: $legacyAdminCap) { %s }
          registry: object(address: $registry) { %s }
          simulatedPackage: object(address: $simulatedPackage) { address version }
        }''' % (OBJECT_FIELDS, OBJECT_FIELDS, OBJECT_FIELDS)
        post = query_only(query, {**{key: IDS[key] for key in ['upgradeCap', 'legacyAdminCap', 'registry']},
                                  'simulatedPackage': result['simulatedPackageIdNeverDeployed']})
        post_file.write_text(json.dumps(post, indent=2) + '\n')
    if post_file.exists():
        before = json.loads((args.capture / 'chain-inputs.json').read_text())['response']['data']
        after = json.loads(post_file.read_text())['response']['data']
        for name in ['upgradeCap', 'legacyAdminCap', 'registry']:
            require(before[name] == after[name], f'{name} changed since the input capture; refresh release inputs')
        require(after['simulatedPackage'] is None, 'Simulated package unexpectedly exists on-chain')
        result['liveStateVerifiedUnchangedAfterSimulation'] = True
        result['postSimulationCheckpoint'] = after['checkpoint']
    else:
        result['liveStateVerifiedUnchangedAfterSimulation'] = False
    (args.capture / 'simulation-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ['status', 'legacyModuleBytesPreserved',
         'newTypeOriginsBoundToNewPackage', 'gasEstimateSui', 'liveStateVerifiedUnchangedAfterSimulation',
         'transactionsSubmitted']}))


if __name__ == '__main__':
    main()
