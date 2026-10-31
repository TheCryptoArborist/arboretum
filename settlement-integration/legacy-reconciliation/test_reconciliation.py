"""Meaningful failure controls for historical coverage and payout arithmetic."""

import copy
import json
import unittest
from unittest.mock import patch

import capture
import derive
from reconcile import CUTOFF_MS, DAY_MS, SAMPLE_SEED


class ReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = json.loads((capture.ROOT / "reconciliation-evidence.json").read_text())
        cls.details = json.loads((capture.ROOT / "reconciliation-details.json").read_text())

    def seed(self):
        return copy.deepcopy(self.details["cutoffSeedPoints"][SAMPLE_SEED])

    def test_frozen_ledger_and_unapproved_integer_allocation(self):
        result = derive.derive(self.evidence, self.details)
        self.assertEqual((result["seedCount"], result["ownerCount"]), (20, 7))
        self.assertEqual(result["recordedGrowthPoints"], "2498")
        self.assertEqual(result["rewardPoolMist"], "209720000")
        self.assertEqual(result["registryMutationCount"], 62)
        self.assertEqual(result["grossPoolDecreasesMist"], "0")
        scenario = result["draftPolicyScenario"]
        self.assertEqual((scenario["cutoffEligibleGP"], scenario["excludedGP"]), ("1848", "650"))
        self.assertEqual(scenario["allocationsTotalMist"], "209719994")
        self.assertEqual(scenario["roundingResidueMist"], "6")
        self.assertIsNone(result["approvedCompensationMist"])
        self.assertFalse(scenario["legacyCodePaysThisScenario"])

    def test_removed_receipt_breaks_continuity(self):
        details = copy.deepcopy(self.details)
        result = derive.derive(self.evidence, details)
        del details["transactionDetails"][result["mutationChain"][25]["transaction"]]
        with self.assertRaisesRegex(ValueError, "Gap or fork"):
            derive.derive(self.evidence, details)

    def test_incomplete_receipt_is_never_a_clean_result(self):
        details = copy.deepcopy(self.details)
        tx = next(iter(details["transactionDetails"].values()))
        tx["effects"]["objectChanges"]["pageInfo"]["hasNextPage"] = True
        with self.assertRaisesRegex(ValueError, "Incomplete receipt"):
            derive.derive(self.evidence, details)

    def test_changed_snapshot_seed_cannot_reuse_reconciliation(self):
        evidence = copy.deepcopy(self.evidence)
        sample = next(o for o in evidence["snapshots"]["anchor"]["objects"] if o["address"] == SAMPLE_SEED)
        sample["version"] += 1
        with self.assertRaisesRegex(ValueError, "Seed changed"):
            derive.derive(evidence, self.details)

    def test_nine_dry_days_eligible_ten_days_excluded(self):
        seed = self.seed()
        data = derive.fields(seed)
        data["last_watered_ms"] = str(CUTOFF_MS - 10 * DAY_MS + 1)
        self.assertEqual(derive.checked_policy_contribution(seed, CUTOFF_MS)[0], 188)
        data["last_watered_ms"] = str(CUTOFF_MS - 10 * DAY_MS)
        self.assertEqual(derive.checked_policy_contribution(seed, CUTOFF_MS)[0], 0)

    def test_protection_equality_counts_but_expired_protection_does_not(self):
        seed = self.seed()
        data = derive.fields(seed)
        data["last_watered_ms"] = str(CUTOFF_MS - 12 * DAY_MS)
        data["bottomless_can_expiry_ms"] = str(CUTOFF_MS)
        self.assertEqual(derive.checked_policy_contribution(seed, CUTOFF_MS)[0], 188)
        data["bottomless_can_expiry_ms"] = str(CUTOFF_MS - 1)
        self.assertEqual(derive.checked_policy_contribution(seed, CUTOFF_MS)[0], 0)

    def test_stored_dead_seed_stays_excluded_even_with_protection(self):
        seed = self.seed()
        derive.fields(seed)["state"] = 2
        derive.fields(seed)["bottomless_can_expiry_ms"] = str(CUTOFF_MS)
        self.assertEqual(derive.checked_policy_contribution(seed, CUTOFF_MS)[0], 0)

    def test_missing_field_and_owner_mismatch_never_infer_entitlement(self):
        seed = self.seed()
        del derive.fields(seed)["growth_points"]
        with self.assertRaisesRegex(ValueError, "missing"):
            derive.checked_policy_contribution(seed, CUTOFF_MS)
        seed = self.seed()
        derive.fields(seed)["owner"] = "0x1"
        with self.assertRaisesRegex(ValueError, "owner differs"):
            derive.checked_policy_contribution(seed, CUTOFF_MS)

    def test_future_historical_watering_is_rejected(self):
        seed = self.seed()
        derive.fields(seed)["last_watered_ms"] = str(CUTOFF_MS + 1)
        with self.assertRaisesRegex(ValueError, "after cutoff"):
            derive.checked_policy_contribution(seed, CUTOFF_MS)

    def test_mutation_and_simulation_queries_are_rejected_before_network(self):
        for query in ["mutation Publish { executeTransaction }", "query Sim { simulateTransaction }",
                      "query Attack { executeTransaction }", "{ checkpoint { sequenceNumber } }"]:
            with self.assertRaises(ValueError):
                capture.capture("forbidden", query)

    def test_repeated_cursor_cannot_produce_complete_history(self):
        page = {"connection": {"nodes": [], "pageInfo": {"hasNextPage": True, "endCursor": "same"}}}
        with patch.object(capture, "capture", return_value=page):
            with self.assertRaisesRegex(RuntimeError, "repeated cursor"):
                capture.page_connection("test", "query X { x }", {}, "connection")

    def test_missing_cursor_cannot_produce_complete_history(self):
        page = {"connection": {"nodes": [], "pageInfo": {"hasNextPage": True, "endCursor": None}}}
        with patch.object(capture, "capture", return_value=page):
            with self.assertRaisesRegex(RuntimeError, "missing"):
                capture.page_connection("test", "query X { x }", {}, "connection")

    def test_captured_evidence_hashes_and_aggregate_binding(self):
        self.assertGreater(derive.verify_capture_hashes(), 100)
        derive.verify_capture_binding(self.evidence, self.details)

    def test_altered_aggregate_fails_raw_evidence_binding(self):
        details = copy.deepcopy(self.details)
        derive.fields(details["cutoffSeedPoints"][SAMPLE_SEED])["growth_points"] = "999"
        with self.assertRaisesRegex(ValueError, "capture binding mismatch"):
            derive.verify_capture_binding(self.evidence, details)


if __name__ == "__main__":
    unittest.main(verbosity=2)
