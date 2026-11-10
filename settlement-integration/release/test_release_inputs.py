"""Offline tamper checks for the exact release packet. No chain or wallet calls."""
import base64
import copy
import json
from pathlib import Path
import unittest

import verify_inputs as V
import verify_simulation as S

HERE = Path(__file__).resolve().parent
CAPTURE = HERE / 'evidence/20261020-initial'


def read(path):
    return json.loads(path.read_text())


class ReleaseInputsTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = read(CAPTURE / 'chain-inputs.json')
        self.checkpoint = read(CAPTURE / 'checkpoint.json')
        self.build = read(V.REPO / 'contract-payout/evidence/build-result.json')
        self.sources = {path: (V.REPO / path).read_bytes() for path in V.SOURCE_HASHES}
        self.provenance = read(V.REPO / 'contract-reconstruction/provenance.json')

    def test_captured_inputs_and_known_digest_control_pass(self):
        V.verify_snapshot(self.snapshot, self.checkpoint)
        modules = V.verify_candidate(self.build, self.sources, self.provenance)
        self.assertEqual(V.package_digest([base64.b64decode(m['base64']) for m in modules], V.DEPENDENCIES).hex(),
                         'a4f84de8007a0d8b8f79ab9d0fa8bdb03a1926dc954b1d72d626783be04c29df')

    def test_wrong_network_is_rejected(self):
        self.checkpoint['response']['data']['genesis']['digest'] = '11111111111111111111111111111111'
        with self.assertRaisesRegex(ValueError, 'Not Sui mainnet'):
            V.verify_snapshot(self.snapshot, self.checkpoint)

    def test_stale_cap_package_is_rejected(self):
        V.fields(self.snapshot['response']['data']['upgradeCap'])['version'] = '12'
        with self.assertRaisesRegex(ValueError, 'version-11'):
            V.verify_snapshot(self.snapshot, self.checkpoint)

    def test_changed_upgrade_policy_is_rejected(self):
        V.fields(self.snapshot['response']['data']['upgradeCap'])['policy'] = 192
        with self.assertRaisesRegex(ValueError, 'policy changed'):
            V.verify_snapshot(self.snapshot, self.checkpoint)

    def test_wrong_cap_owner_is_rejected(self):
        self.snapshot['response']['data']['upgradeCap']['owner']['address']['address'] = '0x' + '1' * 64
        with self.assertRaisesRegex(ValueError, 'owner changed'):
            V.verify_snapshot(self.snapshot, self.checkpoint)

    def test_incomplete_module_inventory_is_rejected(self):
        self.snapshot['response']['data']['deployed']['asMovePackage']['modules']['pageInfo']['hasNextPage'] = True
        with self.assertRaisesRegex(ValueError, 'Incomplete deployed'):
            V.verify_snapshot(self.snapshot, self.checkpoint)

    def test_modified_candidate_source_is_rejected(self):
        self.sources['contract-payout/source/settlement.move'] += b'\n'
        with self.assertRaisesRegex(ValueError, 'source changed'):
            V.verify_candidate(self.build, self.sources, self.provenance)

    def test_modified_candidate_module_is_rejected(self):
        raw = bytearray(base64.b64decode(self.build['modules'][1]['base64']))
        raw[-1] ^= 1
        self.build['modules'][1]['base64'] = base64.b64encode(raw).decode()
        with self.assertRaisesRegex(ValueError, 'bytecode changed'):
            V.verify_candidate(self.build, self.sources, self.provenance)

    def test_module_order_cannot_drop_legacy(self):
        self.build['modules'].pop(0)
        with self.assertRaisesRegex(ValueError, 'exactly legacy'):
            V.verify_candidate(self.build, self.sources, self.provenance)

    def test_digest_ignores_order_but_detects_missing_dependency(self):
        modules = [base64.b64decode(m['base64']) for m in self.build['modules']]
        expected = V.package_digest(modules, V.DEPENDENCIES)
        self.assertEqual(expected, V.package_digest(list(reversed(modules)), list(reversed(V.DEPENDENCIES))))
        self.assertNotEqual(expected, V.package_digest(modules, V.DEPENDENCIES[:1]))

    def test_captured_simulation_verifies_type_origins_and_transformed_bytes(self):
        result = S.verify(CAPTURE)
        self.assertEqual(result['newTypeOriginsBoundToNewPackage'], 39)
        self.assertEqual(result['legacyTypeOriginsPreserved'], 32)
        self.assertEqual(result['gasEstimateSui'], '0.338028763')
        self.assertFalse(result['legacyRegistryOrSeedsOrAdminCapMutated'])


if __name__ == '__main__':
    unittest.main()
