#!/usr/bin/env python3
"""Run only GraphQL Query.simulateTransaction for an already verified unsigned packet."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

from capture_inputs import query_only

QUERY = '''query SimulateReviewedUpgrade($transaction: JSON!) {
 checkpoint { sequenceNumber timestamp digest }
 simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) {
   effects {
     status
     executionError { message abortCode instructionOffset
       module { name package { address } } function { name } }
     gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
     balanceChangesJson
     objectChanges(first: 20) {
       nodes { address idCreated idDeleted
         inputState { address version digest asMoveObject { contents { type { repr } json } } }
         outputState { address version digest
           owner { __typename ... on AddressOwner { address { address } } }
           asMoveObject { contents { type { repr } json } }
           asMovePackage { address version linkage { originalId upgradedId version }
             typeOrigins { module struct definingId }
             modules(first: 50) { nodes { name bytes } pageInfo { hasNextPage endCursor } }
           }
         }
       }
       pageInfo { hasNextPage endCursor }
     }
   }
 }
}'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    args = parser.parse_args()
    # Rebuild the kind offline and compare both the BCS and GraphQL payload.
    subprocess.run(['node', str(Path(__file__).resolve().parent / 'build-upgrade.mjs'),
                    '--verify', str(args.capture)], check=True, capture_output=True, text=True)
    packet_file = args.capture / 'unsigned-upgrade.json'
    packet = json.loads(packet_file.read_text())
    evidence_file = args.capture / packet['sourceEvidence']
    if hashlib.sha256(evidence_file.read_bytes()).hexdigest() != packet['sourceEvidenceSha256']:
        raise ValueError('Verified input evidence changed')
    kind = base64.b64decode((args.capture / packet['kindFile']).read_text(), validate=False)
    if hashlib.sha256(kind).hexdigest() != packet['transactionKindSha256']:
        raise ValueError('Unsigned kind changed')
    if packet['transactionsSubmitted'] != 0 or packet['signaturesProduced'] != 0:
        raise ValueError('Not an unsigned packet')
    if not packet['checksEnabled'] or not packet['doGasSelection']:
        raise ValueError('Simulation must retain checks and gas selection')
    target = args.capture / 'upgrade-simulation.json'
    if target.exists():
        raise ValueError('Simulation capture exists; create a new input capture to repeat it')
    result = query_only(QUERY, {'transaction': packet['transaction']})
    result['unsignedPacketSha256'] = hashlib.sha256(packet_file.read_bytes()).hexdigest()
    result['transactionKindSha256'] = packet['transactionKindSha256']
    result['simulatedIdsAreNotDeployedIds'] = True
    target.write_text(json.dumps(result, indent=2) + '\n')
    effects = result['response']['data']['simulateTransaction']['effects']
    print(json.dumps({'status': effects['status'], 'error': effects.get('executionError'),
                      'gasSummary': effects.get('gasEffects'),
                      'changes': len(effects['objectChanges']['nodes']), 'transactionsSubmitted': 0}))
    if effects['status'] != 'SUCCESS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
