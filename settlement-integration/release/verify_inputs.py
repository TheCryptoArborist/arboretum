#!/usr/bin/env python3
"""Verify captured chain objects and byte-pinned candidate inputs entirely offline."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
EXPECTED_PACKAGE = '0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724'
ORIGINAL_PACKAGE = '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b'
UPGRADE_CAP = '0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5'
ADMIN_CAP = '0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3'
REGISTRY = '0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50'
OWNER = '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4'
MODULE_HASHES = {
    'arboretum': '2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1',
    'settlement': 'b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531',
}
SOURCE_HASHES = {
    'contract-reconstruction/source/arboretum.move': '14cec739964acbdd077b8231339992265e9014778e50ba52af06ca0e10c312d1',
    'contract-payout/source/settlement.move': '91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb',
}
DEPLOYED_SHA256 = '3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5'
DEPENDENCIES = ['0x' + '0' * 63 + str(n) for n in [1, 2]]


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def blake2b_256(value: bytes) -> bytes:
    return hashlib.blake2b(value, digest_size=32).digest()


def package_digest(modules: list[bytes], dependencies: list[str]) -> bytes:
    """Sui MovePackage::compute_digest_for_modules_and_deps, hash_modules=true.

    Official source: MystenLabs/sui mainnet-v1.78.1,
    crates/sui-types/src/move_package.rs. Rechecked against the signed v11
    authorize_upgrade input as an independent known-good control below.
    """
    parts = [blake2b_256(module) for module in modules]
    parts += [bytes.fromhex(dependency.removeprefix('0x').zfill(64)) for dependency in dependencies]
    return blake2b_256(b''.join(sorted(parts)))


def from_base58(value: str) -> bytes:
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    number = 0
    for character in value:
        number = number * 58 + alphabet.index(character)
    return b'\0' * (len(value) - len(value.lstrip('1'))) + number.to_bytes((number.bit_length() + 7) // 8, 'big')


def fields(obj: dict) -> dict:
    return obj['asMoveObject']['contents']['json']


def owner(obj: dict) -> str:
    require(obj['owner']['__typename'] == 'AddressOwner', 'Capability must be address-owned')
    return obj['owner']['address']['address']


def object_ref(obj: dict) -> dict:
    return {'objectId': obj['address'], 'version': str(obj['version']), 'digest': obj['digest']}


def normalize_type(value: str) -> str:
    address, module, struct = value.split('::')
    return '0x' + address.removeprefix('0x').lower().zfill(64) + '::' + module + '::' + struct


def verify_snapshot(snapshot: dict, checkpoint: dict) -> dict:
    require(snapshot.get('transactionsSubmitted') == 0 and snapshot.get('signaturesProduced') == 0,
            'Snapshot must be a read-only capture')
    require(not snapshot['response'].get('errors'), 'Snapshot contains GraphQL errors')
    data = snapshot['response']['data']
    tip = checkpoint['response']['data']
    require(data['checkpoint'] == tip['checkpoint'], 'Snapshot/checkpoint disagree')
    require(snapshot['variables']['checkpoint'] == data['checkpoint']['sequenceNumber'],
            'Snapshot is not pinned to its recorded checkpoint')
    require(from_base58(tip['genesis']['digest'])[:4].hex() == '35834a8a', 'Not Sui mainnet')
    cap = data['upgradeCap']
    admin_cap = data['legacyAdminCap']
    registry = data['registry']
    deployed = data['deployed']
    require(cap['address'] == UPGRADE_CAP, 'Unexpected UpgradeCap object')
    require(normalize_type(cap['asMoveObject']['contents']['type']['repr']) == normalize_type('0x2::package::UpgradeCap'),
            'Wrong UpgradeCap type')
    require(fields(cap)['package'] == EXPECTED_PACKAGE and fields(cap)['version'] == '11',
            'UpgradeCap no longer points at the verified version-11 package')
    require(fields(cap)['policy'] == 0, 'Upgrade policy changed; review the new restriction')
    require(owner(cap) == OWNER, 'UpgradeCap owner changed; refresh the release review')
    require(admin_cap['address'] == ADMIN_CAP and owner(admin_cap) == OWNER,
            'Legacy AdminCap or its owner changed')
    require(normalize_type(admin_cap['asMoveObject']['contents']['type']['repr']) == ORIGINAL_PACKAGE + '::arboretum::AdminCap',
            'Wrong legacy AdminCap type')
    require(registry['address'] == REGISTRY and registry['owner']['__typename'] == 'Shared',
            'Wrong legacy Registry or ownership')
    require(normalize_type(registry['asMoveObject']['contents']['type']['repr']) == ORIGINAL_PACKAGE + '::arboretum::Registry',
            'Wrong legacy Registry type')
    require(fields(registry)['admin'] == OWNER, 'Registry administrator disagrees with capability owner')
    require(deployed['address'] == EXPECTED_PACKAGE and deployed['version'] == 11,
            'Unexpected deployed package/version')
    require(deployed['owner']['__typename'] == 'Immutable', 'Package is not immutable')
    require(data['original']['address'] == ORIGINAL_PACKAGE and data['original']['version'] == 1,
            'Original package lineage mismatch')
    module_inventory = deployed['asMovePackage']['modules']
    require(not module_inventory['pageInfo']['hasNextPage'], 'Incomplete deployed module inventory')
    require([module['name'] for module in module_inventory['nodes']] == ['arboretum'],
            'Current package module inventory differs from verified baseline')
    require(sha256(base64.b64decode(module_inventory['nodes'][0]['bytes'], validate=True)) == DEPLOYED_SHA256,
            'Live deployed bytecode differs from verified baseline')
    for alias, expected_id in zip(['stdlib', 'framework'], DEPENDENCIES):
        require(data[alias]['address'] == expected_id, 'Dependency package mismatch')
    return data


def verify_candidate(build: dict, sources: dict[str, bytes], provenance: dict) -> list[dict]:
    require(build['status'] == 'PRODUCTION_BUILD_AND_ADDITIVE_BOUNDARY_VERIFIED', 'Unverified candidate build')
    require([module['name'] for module in build['modules']] == list(MODULE_HASHES),
            'Candidate must contain exactly legacy arboretum and new settlement modules')
    for path, expected in SOURCE_HASHES.items():
        require(sha256(sources[path]) == expected, f'Candidate source changed: {path}')
    modules = build['modules']
    for module in modules:
        raw = base64.b64decode(module['base64'], validate=True)
        require(sha256(raw) == MODULE_HASHES[module['name']] == module['sha256'],
                f'Candidate bytecode changed: {module["name"]}')
        require(len(raw) == module['size'], 'Candidate byte length mismatch')
    old_tx = provenance['response']['data']['deployed']['previousTransaction']['transactionJson']['kind']['programmableTransaction']
    old_upgrade = old_tx['commands'][1]['upgrade']
    old_digest = base64.b64decode(old_tx['inputs'][2]['pure'], validate=True)
    require(len(old_digest) == 33 and old_digest[0] == 32, 'Unexpected historical digest BCS encoding')
    require(package_digest([base64.b64decode(module, validate=True) for module in old_upgrade['modules']],
                           old_upgrade['dependencies']) == old_digest[1:],
            'Digest algorithm failed against the successful version-11 transaction')
    return modules


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    args = parser.parse_args()
    chain_path = args.capture / 'chain-inputs.json'
    snapshot = json.loads(chain_path.read_text())
    data = verify_snapshot(snapshot, json.loads((args.capture / 'checkpoint.json').read_text()))
    build_path = REPO / 'contract-payout/evidence/build-result.json'
    build = json.loads(build_path.read_text())
    modules = verify_candidate(build, {path: (REPO / path).read_bytes() for path in SOURCE_HASHES},
                               json.loads((REPO / 'contract-reconstruction/provenance.json').read_text()))
    digest = package_digest([base64.b64decode(module['base64']) for module in modules], DEPENDENCIES)
    result = {
        'schemaVersion': 1, 'status': 'VERIFIED_UNSIGNED_RELEASE_INPUTS',
        'network': 'mainnet', 'chainIdentifier': '35834a8a',
        'checkpoint': data['checkpoint'],
        'sourceEvidence': {'chain-inputs.json': sha256(chain_path.read_bytes()),
                           'candidateBuild': {'path': 'contract-payout/evidence/build-result.json',
                                              'sha256': sha256(build_path.read_bytes())},
                           'sources': SOURCE_HASHES},
        'sender': OWNER, 'packageId': EXPECTED_PACKAGE, 'packageVersion': 11,
        'originalPackageId': ORIGINAL_PACKAGE,
        'upgradeCap': object_ref(data['upgradeCap']), 'upgradePolicy': 0,
        'upgradePolicyName': 'compatible', 'changesUpgradeCapPolicy': False,
        'legacyAdminCap': object_ref(data['legacyAdminCap']),
        'legacyRegistry': object_ref(data['registry']),
        'dependencies': DEPENDENCIES,
        'dependencyObservations': [data[name] for name in ['stdlib', 'framework']],
        'modules': [{key: module[key] for key in ['name', 'sha256', 'size']} for module in modules],
        'packageDigestHex': digest.hex(),
        'digestAlgorithm': 'Blake2b-256(sorted(Blake2b-256(each module), each 32-byte dependency ID))',
        'historicalDigestControlPassed': True,
        'settlementTypeOrigin': None, 'newRegistryId': None, 'newAdminCapId': None,
        'postUpgradeSetup': {
            'function': 'settlement::create_settlement_registry',
            'packageId': None, 'requiresSuccessfulUpgradeEffects': True,
            'input': 'immutable reference to the refreshed legacyAdminCap',
            'startsSeason': False, 'fundsPool': False, 'importsLegacyState': False,
        },
        'transactionsSubmitted': 0, 'signaturesProduced': 0,
    }
    (args.capture / 'verified-inputs.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'packageDigestHex': digest.hex(),
                      'checkpoint': data['checkpoint']['sequenceNumber'], 'transactionsSubmitted': 0}))


if __name__ == '__main__':
    main()
