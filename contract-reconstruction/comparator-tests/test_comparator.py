#!/usr/bin/env python3
"""Independent negative checks mutate actual pinned deployed bytecode, not mock IR."""
import importlib.util
import json
from pathlib import Path
import argparse
from datetime import datetime, timezone
import platform
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve()
SPEC = importlib.util.spec_from_file_location("compare_bytecode", HERE.parents[1] / "compare_bytecode.py")
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)


def uleb(n):
    result = bytearray()
    while n >= 128:
        result.append((n & 127) | 128)
        n >>= 7
    result.append(n)
    return bytes(result)


def replace_entry(module, table, index, value):
    """Reassemble table offsets after replacing one actual encoded table entry."""
    chunks, headers, offset = [], {}, 0
    for k, (start, size) in sorted(module.headers.items(), key=lambda kv: kv[1][0]):
        table_start = module.data_offset + start
        data = module.data[table_start:table_start + size]
        if k == table:
            a, b = module.spans[k][index]
            data = data[:a - table_start] + value + data[b - table_start:]
        headers[k] = (offset, len(data))
        offset += len(data)
        chunks.append(data)
    result = module.data[:8] + uleb(len(headers))
    for k in module.headers:
        offset, size = headers[k]
        result += bytes([k]) + uleb(offset) + uleb(size)
    return result + b"".join(chunks) + uleb(module.self_index)


class ComparatorChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.deployed, cls.proof = C.load_pinned_deployed()

    def report_for_mutation(self, data):
        candidate = C.Module(data)
        result = C.compare_modules(self.deployed, candidate)
        self.assertFalse(result["exact_binary_match"])
        self.assertFalse(result["resolved_module_match"])
        self.assertEqual(result["status"], "DIFFERENCES_FOUND")
        return result

    def function(self, name):
        for f in self.deployed.tables[12]:
            if self.deployed.at(7, self.deployed.at(3, f["handle"])["name"]) == name:
                return f
        self.fail(f"Missing fixture function {name}")

    def function_row(self, report, name):
        return next(row for row in report["functions"] if row["name"] == name)

    def mutate_instruction(self, name, category, operand):
        ins = next(i for i in self.function(name)["code"] if i.get("category") == category)
        start, end = ins["_span"]
        original = self.deployed.data[start:end]
        replacement = original[:1] + operand
        self.assertEqual(len(original), len(replacement))
        return self.deployed.data[:start] + replacement + self.deployed.data[end:]

    def test_01_exact_deployed_binary_and_all_96_functions(self):
        report = C.compare_modules(self.deployed, C.Module(self.deployed.data))
        self.assertEqual(report["status"], "EXACT_BINARY_MATCH")
        self.assertEqual(report["functions_matching"], 96)
        self.assertEqual(report["deployed"]["struct_count"], 32)
        self.assertEqual(report["deployed"]["table_counts"]["constants"], 81)

    def test_02_prepublication_target_has_only_publisher_self_address_change(self):
        pre, proof = C.load_pinned_prepublication(self.deployed, HERE.parents[1] / "provenance.json")
        self.assertEqual(C.sha256(pre.data), C.PREPUBLICATION_MODULE_SHA256)
        self.assertEqual(proof["publisher_rewrite"]["byte_start_inclusive"], 6201)
        self.assertEqual(proof["publisher_rewrite"]["byte_end_exclusive"], 6233)
        self.assertTrue(proof["publisher_rewrite"]["all_other_bytes_identical"])
        self.assertEqual(proof["resolved_published_functions_matching"], 96)
        self.assertNotEqual(pre.data, self.deployed.data)

    def test_03_payment_constant_change_is_detected_in_buy_crate(self):
        idx = next(i for i, k in enumerate(self.deployed.tables[6]) if k["type"] == "u64" and k["value"] == "10000000")
        start, end = self.deployed.spans[6][idx]
        original = self.deployed.data[start:end]
        changed = original[:-8] + (10_000_001).to_bytes(8, "little")
        report = self.report_for_mutation(replace_entry(self.deployed, 6, idx, changed))
        self.assertFalse(self.function_row(report, "buy_crate")["match"])
        self.assertTrue(any("10000001" in C.canonical(d) for d in self.function_row(report, "buy_crate")["differences"]))

    def test_04_constant_table_renumbering_resolves_values_without_hiding_changes(self):
        # Swap constants 0 and 1, whose u64 encoded lengths are equal. Keep each
        # LdConst pointed at its original value. Raw bytes differ, semantics do not.
        d = self.deployed
        a, b = d.spans[6][0], d.spans[6][1]
        self.assertEqual(a[1] - a[0], b[1] - b[0])
        data = bytearray(d.data)
        data[a[0]:a[1]], data[b[0]:b[1]] = d.data[b[0]:b[1]], d.data[a[0]:a[1]]
        for f in d.tables[12]:
            for ins in f["code"] or []:
                if ins.get("category") == "constant" and ins["operand"] in (0, 1):
                    start, end = ins["_span"]
                    self.assertEqual(end - start, 2)
                    data[start + 1] = 1 - ins["operand"]
        report = C.compare_modules(d, C.Module(bytes(data)))
        self.assertFalse(report["exact_binary_match"])
        self.assertTrue(report["resolved_module_match"])
        self.assertEqual(report["functions_matching"], 96)

    def test_05_external_call_target_change_is_detected(self):
        target = next(i for i in range(len(self.deployed.tables[3])) if self.deployed.function_handle(i)["id"].endswith("::clock::timestamp_ms"))
        report = self.report_for_mutation(self.mutate_instruction("assert_admin", "function", uleb(target)))
        self.assertFalse(self.function_row(report, "assert_admin")["match"])

    def test_06_valid_branch_target_change_is_detected(self):
        report = self.report_for_mutation(self.mutate_instruction("assert_admin", "branch", uleb(7)))
        self.assertFalse(self.function_row(report, "assert_admin")["match"])

    def test_07_equality_instruction_changed_to_inequality_is_detected(self):
        ins = next(i for i in self.function("assert_admin")["code"] if i["op"] == "Eq")
        start, end = ins["_span"]
        data = self.deployed.data[:start] + bytes([0x22]) + self.deployed.data[end:]
        report = self.report_for_mutation(data)
        self.assertFalse(self.function_row(report, "assert_admin")["match"])

    def test_08_ordered_struct_layout_change_is_detected(self):
        d = self.deployed
        index = next(i for i in range(len(d.tables[10])) if d.struct(i)["id"].endswith("::Registry"))
        start, end = d.spans[10][index]
        cur = C.Cursor(d.data, start, end)
        cur.uleb(); self.assertEqual(cur.u8(), 2)
        count, spans = cur.uleb(255), []
        prefix_end = cur.pos
        for _ in range(count):
            pos = cur.pos; cur.uleb(); C.token(cur); spans.append((pos, cur.pos))
        fields = [d.data[a:b] for a, b in spans]
        # Both fields are u64: this changes field order without invalidating types.
        fields[2], fields[3] = fields[3], fields[2]
        entry = d.data[start:prefix_end] + b"".join(fields)
        report = self.report_for_mutation(replace_entry(d, 10, index, entry))
        self.assertFalse(next(r for r in report["module_inventory"] if r["name"] == "struct_definitions")["match"])

    def test_09_struct_ability_change_is_detected(self):
        d = self.deployed
        index = next(i for i in range(len(d.tables[2])) if d.datatype_id(i).endswith("::Seed"))
        start, end = d.spans[2][index]
        c = C.Cursor(d.data, start, end); c.uleb(); c.uleb()
        data = bytearray(d.data); self.assertEqual(data[c.pos], 8); data[c.pos] = 12
        report = self.report_for_mutation(bytes(data))
        self.assertFalse(next(r for r in report["module_inventory"] if r["name"] == "datatype_handles")["match"])

    def test_10_signature_return_type_change_is_detected(self):
        d = self.deployed
        index = next(i for i, sig in enumerate(d.tables[5]) if sig == ["u64"])
        report = self.report_for_mutation(replace_entry(d, 5, index, bytes([1, 2])))
        self.assertTrue(any(not r["match"] for r in report["functions"]))
        self.assertFalse(next(r for r in report["module_inventory"] if r["name"] == "function_handles")["match"])

    def test_11_generic_function_constraint_change_is_detected(self):
        d = self.deployed
        f = self.function("plant_seed_with_nftree")
        start, end = d.spans[3][f["handle"]]
        c = C.Cursor(d.data, start, end)
        for _ in range(4): c.uleb()
        self.assertEqual(c.uleb(255), 1)
        data = bytearray(d.data); self.assertEqual(data[c.pos], 8); data[c.pos] = 4
        report = self.report_for_mutation(bytes(data))
        self.assertFalse(self.function_row(report, "plant_seed_with_nftree")["match"])

    def test_12_phantom_type_parameter_change_is_detected(self):
        d = self.deployed
        index = next(i for i, h in enumerate(d.tables[2]) if d.datatype_id(i).endswith("::balance::Balance"))
        start, end = d.spans[2][index]
        c = C.Cursor(d.data, start, end); c.uleb(); c.uleb(); c.uleb(15)
        self.assertEqual(c.uleb(255), 1); c.uleb(15)
        data = bytearray(d.data); self.assertEqual(data[c.pos], 1); data[c.pos] = 0
        report = self.report_for_mutation(bytes(data))
        self.assertFalse(next(r for r in report["module_inventory"] if r["name"] == "datatype_handles")["match"])

    def test_13_entry_flag_change_is_detected(self):
        d = self.deployed
        f = self.function("claim_reward")
        index = d.tables[12].index(f)
        start, end = d.spans[12][index]
        c = C.Cursor(d.data, start, end); c.uleb(); c.u8()
        data = bytearray(d.data); self.assertEqual(data[c.pos], 4); data[c.pos] = 0
        report = self.report_for_mutation(bytes(data))
        self.assertFalse(self.function_row(report, "claim_reward")["match"])

    def test_14_unknown_binary_table_fails_closed(self):
        d = bytearray(self.deployed.data)
        cursor = C.Cursor(d, 8); cursor.uleb(255)
        d[cursor.pos] = 0x11  # Enum table, intentionally outside this bounded decoder.
        with self.assertRaisesRegex(C.DecodeError, "Unsupported binary table"):
            C.Module(bytes(d))

    def test_15_missing_function_signature_fails_closed(self):
        d = self.deployed
        f = self.function("claim_reward")
        h = d.at(3, f["handle"])
        encoded = uleb(h["module"]) + uleb(h["name"]) + uleb(65535) + uleb(h["returns"]) + uleb(0)
        with self.assertRaisesRegex(C.DecodeError, "Out-of-bounds signatures"):
            C.Module(replace_entry(d, 3, f["handle"], encoded))

    def test_16_unknown_instruction_fails_closed(self):
        ins = self.function("assert_admin")["code"][0]
        data = bytearray(self.deployed.data); data[ins["_span"][0]] = 0xff
        with self.assertRaisesRegex(C.DecodeError, "Unsupported instruction"):
            C.Module(bytes(data))

    def test_17_truncated_or_extra_binary_data_fails_closed(self):
        for data in (self.deployed.data[:-1], self.deployed.data + bytes([0])):
            with self.subTest(length=len(data)), self.assertRaises(C.DecodeError):
                C.Module(data)

    def test_18_disassembly_missing_generic_function_fails_closed(self):
        text = C.DEPLOYED_DISASSEMBLY.read_text()
        text = text.replace("plant_seed_with_nftree<", "unrecognized_generic_function<", 1)
        self.assertNotEqual(text, C.DEPLOYED_DISASSEMBLY.read_text())
        with self.assertRaisesRegex(C.DecodeError, "opcode crosscheck failed"):
            C.crosscheck_disassembly(self.deployed, text)

    def test_19_address_mapping_is_explicit_and_cannot_change_constants(self):
        pre, _ = C.load_pinned_prepublication(self.deployed, HERE.parents[1] / "provenance.json")
        self.assertFalse(C.compare_modules(self.deployed, pre)["resolved_module_match"])
        mapping = {C.address("0"): C.DEPLOYED_SELF.split("::")[0]}
        result = C.compare_modules(self.deployed, pre, mapping)
        self.assertEqual(result["status"], "RESOLVED_MATCH_WITH_DECLARED_ADDRESS_MAP")
        self.assertFalse(result["exact_binary_match"])
        with self.assertRaises(C.DecodeError):
            C.compare_modules(self.deployed, pre, {C.address("1"): C.address("2")})
        # Simulate an address literal equal to each module's self address. The
        # explicit module-address map must not silently equate these payments.
        index = next(i for i, k in enumerate(pre.tables[6]) if k["type"] == "address")
        a, b = self.deployed.spans[6][index]
        deployed_entry = self.deployed.data[a:b - 32] + bytes.fromhex(C.DEPLOYED_SELF.split("::")[0][2:])
        a, b = pre.spans[6][index]
        candidate_entry = pre.data[a:b - 32] + bytes(32)
        reference = C.Module(replace_entry(self.deployed, 6, index, deployed_entry))
        candidate = C.Module(replace_entry(pre, 6, index, candidate_entry))
        self.assertFalse(C.compare_modules(reference, candidate, mapping)["resolved_module_match"])
        constants = candidate.resolved_inventory(mapping)["constants"]
        self.assertTrue(any(k["type"] == "address" and k["value"] == C.address("0") for k in constants))

    def test_20_evidence_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="arboretum-comparator-check-") as tmp:
            altered = Path(tmp) / "evidence.json"
            altered.write_bytes(C.DEPLOYED_JSON.read_bytes() + b"\n")
            with self.assertRaisesRegex(C.DecodeError, "hash mismatch"):
                C.load_pinned_deployed(altered, C.DEPLOYED_DISASSEMBLY)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ComparatorChecks)
    names = [test.id() for test in suite]
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if args.json_output:
        report = {"schema_version": 1, "completed_at": datetime.now(timezone.utc).isoformat(),
                  "python_version": platform.python_version(), "tests_run": result.testsRun,
                  "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped),
                  "success": result.wasSuccessful(), "test_names": names,
                  "comparator_sha256": C.sha256((HERE.parents[1] / "compare_bytecode.py").read_bytes()),
                  "test_source_sha256": C.sha256(HERE.read_bytes()),
                  "deployed_module_sha256": C.PINNED_MODULE_SHA256,
                  "prepublication_module_sha256": C.PREPUBLICATION_MODULE_SHA256,
                  "failure_details": [{"test": test.id(), "traceback": detail} for test, detail in result.failures + result.errors]}
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(report, indent=2) + "\n")
    sys.exit(0 if result.wasSuccessful() and result.testsRun == 20 and not result.skipped else 1)
