#!/usr/bin/env python3
"""Capture public Sui release inputs at one fixed checkpoint; never execute a transaction."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

ENDPOINT = 'https://graphql.mainnet.sui.io/graphql'
HERE = Path(__file__).resolve().parent
IDS = {
    'package': '0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724',
    'original': '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b',
    'upgradeCap': '0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5',
    'legacyAdminCap': '0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3',
    'registry': '0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50',
}
OBJECT_FIELDS = '''address version digest
  owner { __typename ... on AddressOwner { address { address } }
    ... on Shared { initialSharedVersion } }
  previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } }
  asMoveObject { contents { type { repr } json } }'''
INPUTS_QUERY = '''query ReleaseInputs($checkpoint: UInt53!, $package: SuiAddress!,
 $original: SuiAddress!, $upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!, $registry: SuiAddress!) {
 checkpoint(sequenceNumber: $checkpoint) { sequenceNumber timestamp digest }
 upgradeCap: object(address: $upgradeCap, atCheckpoint: $checkpoint) { %s }
 legacyAdminCap: object(address: $legacyAdminCap, atCheckpoint: $checkpoint) { %s }
 registry: object(address: $registry, atCheckpoint: $checkpoint) { %s }
 deployed: object(address: $package, atCheckpoint: $checkpoint) {
   address version digest owner { __typename }
   previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } }
   asMovePackage { linkage { originalId upgradedId version }
     typeOrigins { module struct definingId }
     modules(first: 50) { nodes { name bytes fileFormatVersion }
       pageInfo { hasNextPage endCursor } }
   }
 }
 original: object(address: $original, atCheckpoint: $checkpoint) { address version digest }
 stdlib: object(address: "0x1", atCheckpoint: $checkpoint) { address version digest }
 framework: object(address: "0x2", atCheckpoint: $checkpoint) { address version digest }
}''' % (OBJECT_FIELDS, OBJECT_FIELDS, OBJECT_FIELDS)


def query_only(query: str, variables: dict) -> dict:
    if not query.lstrip().startswith('query ') or 'mutation' in query or 'executeTransaction' in query:
        raise ValueError('Only explicit GraphQL read queries are allowed')
    request = urllib.request.Request(
        ENDPOINT, data=json.dumps({'query': query, 'variables': variables}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'ArboretumUnsignedReleaseReview/1.0'},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        result = json.load(response)
    if result.get('errors'):
        raise RuntimeError(json.dumps(result['errors']))
    if not result.get('data'):
        raise RuntimeError('GraphQL returned no data')
    return {
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'endpoint': ENDPOINT, 'query': query, 'variables': variables,
        'response': result, 'transactionsSubmitted': 0, 'signaturesProduced': 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='New directory for this immutable capture; do not overwrite a prior capture')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    tip = query_only('query ReleaseTip { checkpoint { sequenceNumber timestamp digest } '
                     'genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest } }', {})
    (args.output / 'checkpoint.json').write_text(json.dumps(tip, indent=2) + '\n')
    checkpoint = tip['response']['data']['checkpoint']['sequenceNumber']
    inputs = query_only(INPUTS_QUERY, {'checkpoint': checkpoint, **IDS})
    (args.output / 'chain-inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    data = inputs['response']['data']
    for name in ['upgradeCap', 'legacyAdminCap', 'registry', 'deployed', 'original', 'stdlib', 'framework']:
        if not data.get(name):
            raise RuntimeError(f'Missing required on-chain input: {name}')
    if data['deployed']['asMovePackage']['modules']['pageInfo']['hasNextPage']:
        raise RuntimeError('Package module inventory is incomplete')
    print(json.dumps({'output': str(args.output), 'checkpoint': checkpoint,
                      'packageVersion': data['deployed']['version'],
                      'upgradeCap': data['upgradeCap']['asMoveObject']['contents']['json'],
                      'upgradeOwner': data['upgradeCap']['owner'],
                      'legacyAdminOwner': data['legacyAdminCap']['owner'],
                      'transactionsSubmitted': 0, 'signaturesProduced': 0}))


if __name__ == '__main__':
    main()
