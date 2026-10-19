#!/usr/bin/env python3
"""Offline, fail-closed comparison of Arboretum v11 and a compiled Move module.

This is a deliberately bounded decoder for Sui Move bytecode v7 without enums or
deprecated global-storage operations. Unsupported tables/instructions are errors,
never omissions. See comparator-design.md for provenance and limitations.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "gameplay-verification/deployed-probe"
DEPLOYED_JSON = EVIDENCE / "deployed-module-20261019.json"
DEPLOYED_DISASSEMBLY = EVIDENCE / "arboretum-deployed-disassembly.txt"
PINNED_JSON_SHA256 = "b7f2b0e97a005a4cd9a842062f31b11fe726e05aff63b8731e2c82d74b4449b3"
PINNED_DISASSEMBLY_SHA256 = "2e7dd587e996abe010106d822099b8194bf61f7357a79fc558d42521eef39604"
PINNED_MODULE_SHA256 = "3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5"
DEPLOYED_PACKAGE = "0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724"
DEPLOYED_SELF = "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum"
DEPLOYED_DIGEST = "G55ZRNKoCDhAgunVDzHgqeiVHgdofsq4FjJuBp984iia"
PREPUBLICATION_MODULE_SHA256 = "2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1"
PINNED_PROVENANCE_SHA256 = "03a3cdcfd73cc12c67084d1b6f56891823650b0df01f7036ff87e59db8998373"
PINNED_TRANSACTION_JSON_SHA256 = "0e43e854c04678e9a5614fb3bd5925c3bba5c60f73228456f408ed1972eda6c6"
UPGRADE_TRANSACTION = "HZRUsU9xNybZ5qSsPZV5wP1PvCEgbdsVJHur4ifFXnbw"
PREVIOUS_PACKAGE = "0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914"
REFERENCE_COMMIT = "367fd808279bed26f7c64fc63160062a2ee29ab7"

TABLE_NAMES = {
    1: "module_handles", 2: "datatype_handles", 3: "function_handles",
    4: "function_instantiations", 5: "signatures", 6: "constants",
    7: "identifiers", 8: "addresses", 10: "struct_definitions",
    11: "struct_instantiations", 12: "function_definitions",
    13: "field_handles", 14: "field_instantiations", 15: "friends",
    16: "metadata",
}
PRIMITIVES = {1: "bool", 2: "u8", 3: "u64", 4: "u128", 5: "address",
              12: "signer", 13: "u16", 14: "u32", 15: "u256"}
NO_OPERAND = {
    1: "Pop", 2: "Ret", 8: "LdTrue", 9: "LdFalse", 20: "ReadRef",
    21: "WriteRef", 22: "Add", 23: "Sub", 24: "Mul", 25: "Mod",
    26: "Div", 27: "BitOr", 28: "BitAnd", 29: "Xor", 30: "Or",
    31: "And", 32: "Not", 33: "Eq", 34: "Neq", 35: "Lt", 36: "Gt",
    37: "Le", 38: "Ge", 39: "Abort", 40: "Nop", 46: "FreezeRef",
    47: "Shl", 48: "Shr", 51: "CastU8", 52: "CastU64", 53: "CastU128",
    75: "CastU16", 76: "CastU32", 77: "CastU256",
}
INDEX_OPERAND = {
    3: ("BrTrue", "branch"), 4: ("BrFalse", "branch"), 5: ("Branch", "branch"),
    7: ("LdConst", "constant"), 10: ("CopyLoc", "local"),
    11: ("MoveLoc", "local"), 12: ("StLoc", "local"),
    13: ("MutBorrowLoc", "local"), 14: ("ImmBorrowLoc", "local"),
    15: ("MutBorrowField", "field"), 16: ("ImmBorrowField", "field"),
    17: ("Call", "function"), 18: ("Pack", "struct"), 19: ("Unpack", "struct"),
    54: ("MutBorrowFieldGeneric", "field_inst"),
    55: ("ImmBorrowFieldGeneric", "field_inst"),
    56: ("CallGeneric", "function_inst"), 57: ("PackGeneric", "struct_inst"),
    58: ("UnpackGeneric", "struct_inst"),
    65: ("VecLen", "signature"), 66: ("VecImmBorrow", "signature"),
    67: ("VecMutBorrow", "signature"), 68: ("VecPushBack", "signature"),
    69: ("VecPopBack", "signature"), 71: ("VecSwap", "signature"),
}
IMMEDIATE_OPERAND = {6: ("LdU64", 8), 49: ("LdU8", 1), 50: ("LdU128", 16),
                     72: ("LdU16", 2), 73: ("LdU32", 4), 74: ("LdU256", 32)}


class DecodeError(ValueError):
    """Invalid or unsupported data: the comparison cannot establish a match."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint(value: Any) -> str:
    return sha256(canonical(value).encode())


def address(value: str) -> str:
    if not re.fullmatch(r"(?:0x)?[0-9a-fA-F]{1,64}", value):
        raise DecodeError(f"Invalid address {value!r}")
    return "0x" + value.removeprefix("0x").lower().zfill(64)


def abilities(mask: int) -> list[str]:
    if mask & ~15:
        raise DecodeError(f"Unknown ability bits {mask}")
    return [name for bit, name in [(1, "copy"), (2, "drop"), (4, "store"), (8, "key")] if bit & mask]


class Cursor:
    def __init__(self, data: bytes, start: int = 0, end: int | None = None):
        self.data, self.pos = data, start
        self.end = len(data) if end is None else end
        if not 0 <= start <= self.end <= len(data):
            raise DecodeError("Invalid cursor bounds")

    def read(self, count: int) -> bytes:
        if count < 0 or self.pos + count > self.end:
            raise DecodeError(f"Truncated binary at byte {self.pos}; need {count} bytes")
        result = self.data[self.pos:self.pos + count]
        self.pos += count
        return result

    def u8(self) -> int:
        return self.read(1)[0]

    def uint(self, width: int) -> int:
        return int.from_bytes(self.read(width), "little")

    def uleb(self, maximum: int = 65535) -> int:
        value, shift = 0, 0
        while True:
            b = self.u8()
            if shift > 63 or (shift == 63 and b & 0x7f > 1):
                raise DecodeError("Overflowing ULEB128")
            value |= (b & 0x7f) << shift
            if not b & 0x80:
                if shift and b == 0:
                    raise DecodeError("Noncanonical ULEB128")
                if value > maximum:
                    raise DecodeError(f"ULEB128 {value} exceeds bound {maximum}")
                return value
            shift += 7

    def blob(self, maximum: int = 65535) -> bytes:
        return self.read(self.uleb(maximum))

    def done(self) -> None:
        if self.pos != self.end:
            raise DecodeError(f"Unconsumed bytes at {self.pos}, end {self.end}")


def token(c: Cursor, depth: int = 0) -> Any:
    if depth > 256:
        raise DecodeError("Signature nesting exceeds supported depth")
    tag = c.u8()
    if tag in PRIMITIVES:
        return PRIMITIVES[tag]
    if tag in (6, 7, 10):
        return [{6: "reference", 7: "mutable_reference", 10: "vector"}[tag], token(c, depth + 1)]
    if tag == 8:
        return ["datatype", c.uleb(), []]
    if tag == 9:
        return ["type_parameter", c.uleb(65536)]
    if tag == 11:
        handle, count = c.uleb(), c.uleb(255)
        if not count:
            raise DecodeError("Zero-arity datatype instantiation")
        return ["datatype", handle, [token(c, depth + 1) for _ in range(count)]]
    raise DecodeError(f"Unsupported signature token 0x{tag:02x}")


def signature(c: Cursor) -> list[Any]:
    return [token(c) for _ in range(c.uleb(255))]


def decode_constant_value(kind: Any, raw: bytes) -> Any:
    """Complete BCS values, including vector lengths; raw bytes are also retained."""
    c = Cursor(raw)

    def read_value(t: Any, depth: int = 0) -> Any:
        if depth > 256:
            raise DecodeError("Constant nesting exceeds supported depth")
        if t == "bool":
            v = c.u8()
            if v not in (0, 1):
                raise DecodeError("Noncanonical constant boolean")
            return bool(v)
        if isinstance(t, str) and t.startswith("u") and t[1:].isdigit():
            return str(c.uint(int(t[1:]) // 8))
        if t == "address":
            return "0x" + c.read(32).hex()
        if isinstance(t, list) and t[0] == "vector":
            count = c.uleb(0xffffffff)
            if count > len(raw):
                raise DecodeError("Constant vector exceeds available data")
            return [read_value(t[1], depth + 1) for _ in range(count)]
        raise DecodeError(f"Unsupported constant type {t!r}")

    value = read_value(kind)
    c.done()
    return value


class Module:
    """Decoded module with indexed tables preserved for diagnostics and validation."""
    def __init__(self, data: bytes):
        self.data = data
        c = Cursor(data)
        if c.read(4) != bytes.fromhex("a11ceb0b"):
            raise DecodeError("Not a publishable Move module (bad/unsupported magic)")
        flavored = c.uint(4)
        self.version, self.flavor = flavored & 0xffffff, flavored >> 24
        if (self.version, self.flavor) != (7, 5):
            raise DecodeError(f"Unsupported bytecode version/flavor {self.version}/{self.flavor}; expected 7/5")
        self.headers: dict[int, tuple[int, int]] = {}
        for _ in range(c.uleb(255)):
            kind, offset, size = c.u8(), c.uleb(0xffffffff), c.uleb(0xffffffff)
            if kind not in TABLE_NAMES:
                raise DecodeError(f"Unsupported binary table 0x{kind:02x}; cannot establish equivalence")
            if kind in self.headers or not size:
                raise DecodeError("Duplicate or empty binary table")
            self.headers[kind] = (offset, size)
        self.data_offset = c.pos
        size = 0
        for offset, count in sorted(self.headers.values()):
            if offset != size:
                raise DecodeError("Table intervals overlap or have a gap")
            size += count
        c.read(size)
        self.self_index = c.uleb()
        c.done()
        self.tables: dict[int, list[Any]] = {k: [] for k in TABLE_NAMES}
        self.spans: dict[int, list[tuple[int, int]]] = {k: [] for k in TABLE_NAMES}
        for kind, (offset, size) in self.headers.items():
            cur = Cursor(data, self.data_offset + offset, self.data_offset + offset + size)
            while cur.pos < cur.end:
                start = cur.pos
                self.tables[kind].append(self.read_entry(kind, cur))
                self.spans[kind].append((start, cur.pos))
            cur.done()
        self.validate()

    def read_entry(self, kind: int, c: Cursor) -> Any:
        if kind in (1, 4, 11, 13, 14, 15):
            return [c.uleb(), c.uleb()]
        if kind == 2:
            return {"module": c.uleb(), "name": c.uleb(), "abilities": abilities(c.uleb(15)),
                    "type_parameters": [{"constraints": abilities(c.uleb(15)), "phantom": bool(c.uleb(1))}
                                        for _ in range(c.uleb(255))]}
        if kind == 3:
            return {"module": c.uleb(), "name": c.uleb(), "parameters": c.uleb(), "returns": c.uleb(),
                    "type_parameters": [abilities(c.uleb(15)) for _ in range(c.uleb(255))]}
        if kind == 5:
            return signature(c)
        if kind == 6:
            t = token(c)
            raw = c.blob()
            return {"type": t, "bytes_hex": raw.hex(), "value": decode_constant_value(t, raw)}
        if kind == 7:
            try:
                name = c.blob().decode("utf-8")
            except UnicodeDecodeError as exc:
                raise DecodeError("Non-UTF8 identifier") from exc
            if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name):
                raise DecodeError(f"Invalid/unsupported identifier {name!r}")
            return name
        if kind == 8:
            return "0x" + c.read(32).hex()
        if kind == 10:
            handle, flag = c.uleb(), c.u8()
            if flag not in (1, 2):
                raise DecodeError(f"Unknown struct flag {flag}")
            fields = None if flag == 1 else [{"name": c.uleb(), "type": token(c)} for _ in range(c.uleb(255))]
            return {"handle": handle, "fields": fields}
        if kind == 12:
            return self.read_function(c)
        if kind == 16:
            return {"key_hex": c.blob(1023).hex(), "value_hex": c.blob().hex()}
        raise DecodeError(f"Unimplemented binary table {kind}")

    @staticmethod
    def read_function(c: Cursor) -> dict[str, Any]:
        handle, visibility, flags = c.uleb(), c.u8(), c.u8()
        if visibility not in (0, 1, 3) or flags & ~6:
            raise DecodeError(f"Invalid function visibility/flags {visibility}/{flags}")
        acquires = [c.uleb() for _ in range(c.uleb(255))]
        if acquires:
            raise DecodeError("Deprecated acquires/global-storage operations are unsupported")
        result = {"handle": handle, "visibility": {0: "private", 1: "public", 3: "friend"}[visibility],
                  "entry": bool(flags & 4), "native": bool(flags & 2), "acquires": acquires}
        if flags & 2:
            result.update({"locals": None, "code": None})
            return result
        result["locals"] = c.uleb()
        code = []
        for _ in range(c.uleb()):
            start, opcode = c.pos, c.u8()
            if opcode in NO_OPERAND:
                ins = {"op": NO_OPERAND[opcode]}
            elif opcode in INDEX_OPERAND:
                name, category = INDEX_OPERAND[opcode]
                ins = {"op": name, "category": category, "operand": c.uleb(255 if category == "local" else 65535)}
            elif opcode in IMMEDIATE_OPERAND:
                name, width = IMMEDIATE_OPERAND[opcode]
                ins = {"op": name, "category": "immediate", "operand": str(c.uint(width))}
            elif opcode in (64, 70):
                ins = {"op": "VecPack" if opcode == 64 else "VecUnpack", "category": "signature",
                       "operand": c.uleb(), "count": str(c.uint(8))}
            else:
                raise DecodeError(f"Unsupported instruction 0x{opcode:02x} at byte {start}")
            ins["_span"] = [start, c.pos]
            code.append(ins)
        if c.uleb(127):
            raise DecodeError("Enum jump tables are unsupported; cannot establish equivalence")
        result["code"] = code
        return result

    def at(self, table: int, index: int) -> Any:
        if not isinstance(index, int) or index < 0 or index >= len(self.tables[table]):
            raise DecodeError(f"Out-of-bounds {TABLE_NAMES[table]} index {index}")
        return self.tables[table][index]

    def module_id(self, index: int, mapping: dict[str, str] | None = None) -> str:
        addr, name = self.at(1, index)
        value = self.at(8, addr)
        return (mapping or {}).get(value, value) + "::" + self.at(7, name)

    def datatype_id(self, index: int, mapping: dict[str, str] | None = None) -> str:
        d = self.at(2, index)
        return self.module_id(d["module"], mapping) + "::" + self.at(7, d["name"])

    def resolve_token(self, value: Any, mapping: dict[str, str] | None = None) -> Any:
        if isinstance(value, str):
            return value
        kind = value[0]
        if kind == "datatype":
            handle = self.at(2, value[1])
            if len(value[2]) != len(handle["type_parameters"]):
                raise DecodeError("Datatype type-argument arity mismatch")
            return {"datatype": self.datatype_id(value[1], mapping),
                    "type_arguments": [self.resolve_token(v, mapping) for v in value[2]]}
        if kind == "type_parameter":
            return {"type_parameter": value[1]}
        return {kind: self.resolve_token(value[1], mapping)}

    def resolve_signature(self, index: int, mapping: dict[str, str] | None = None) -> list[Any]:
        return [self.resolve_token(v, mapping) for v in self.at(5, index)]

    def function_handle(self, index: int, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        f = self.at(3, index)
        return {"id": self.module_id(f["module"], mapping) + "::" + self.at(7, f["name"]),
                "parameters": self.resolve_signature(f["parameters"], mapping),
                "returns": self.resolve_signature(f["returns"], mapping),
                "type_parameters": f["type_parameters"]}

    def struct(self, index: int, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        s = self.at(10, index)
        d = self.at(2, s["handle"])
        return {"id": self.datatype_id(s["handle"], mapping), "abilities": d["abilities"],
                "type_parameters": d["type_parameters"], "native": s["fields"] is None,
                "fields": None if s["fields"] is None else [
                    {"name": self.at(7, f["name"]), "type": self.resolve_token(f["type"], mapping)}
                    for f in s["fields"]]}

    def field(self, index: int, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        owner, offset = self.at(13, index)
        struct = self.struct(owner, mapping)
        fields = struct["fields"]
        if fields is None or not 0 <= offset < len(fields):
            raise DecodeError(f"Invalid field offset {offset} in {struct['id']}")
        return {"owner": struct["id"], "offset": offset, **fields[offset]}

    def instantiation(self, table: int, index: int, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        handle, sig = self.at(table, index)
        args = self.resolve_signature(sig, mapping)
        if table == 4:
            target = self.function_handle(handle, mapping)
            arity = len(target["type_parameters"])
        elif table == 11:
            target = self.struct(handle, mapping)
            arity = len(target["type_parameters"])
        elif table == 14:
            target = self.field(handle, mapping)
            owner = self.at(13, handle)[0]
            arity = len(self.struct(owner, mapping)["type_parameters"])
        else:
            raise DecodeError("Unknown instantiation table")
        if len(args) != arity:
            raise DecodeError(f"Generic target arity mismatch: {len(args)} != {arity}")
        return {"target": target, "type_arguments": args}

    def instruction(self, ins: dict[str, Any], mapping: dict[str, str] | None = None) -> dict[str, Any]:
        result = {"op": ins["op"]}
        if "category" not in ins:
            return result
        category, value = ins["category"], ins["operand"]
        resolvers = {"constant": lambda i: self.at(6, i),
                     "function": lambda i: self.function_handle(i, mapping),
                     "struct": lambda i: self.struct(i, mapping),
                     "field": lambda i: self.field(i, mapping),
                     "function_inst": lambda i: self.instantiation(4, i, mapping),
                     "struct_inst": lambda i: self.instantiation(11, i, mapping),
                     "field_inst": lambda i: self.instantiation(14, i, mapping),
                     "signature": lambda i: self.resolve_signature(i, mapping)}
        result[category] = resolvers[category](value) if category in resolvers else value
        if "count" in ins:
            result["count"] = ins["count"]
        return result

    def functions(self, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        result = {}
        for f in self.tables[12]:
            handle = self.function_handle(f["handle"], mapping)
            name = self.at(7, self.at(3, f["handle"])["name"])
            if name in result:
                raise DecodeError(f"Duplicate function definition {name}")
            result[name] = {**handle, "visibility": f["visibility"], "entry": f["entry"],
                            "native": f["native"], "acquires": f["acquires"],
                            "locals": None if f["locals"] is None else self.resolve_signature(f["locals"], mapping),
                            "code": None if f["code"] is None else [self.instruction(i, mapping) for i in f["code"]]}
        return result

    def validate(self) -> None:
        self_id = self.module_id(self.self_index)
        for k, values in self.tables.items():
            if len(values) > 65536:
                raise DecodeError(f"Oversized table {k}")
        for i, d in enumerate(self.tables[2]):
            self.datatype_id(i)
        for i in range(len(self.tables[5])):
            self.resolve_signature(i)
        for i, f in enumerate(self.tables[3]):
            self.function_handle(i)
            for t in self.at(5, f["parameters"]) + self.at(5, f["returns"]):
                self.check_type_parameters(t, len(f["type_parameters"]))
        seen = set()
        for i, s in enumerate(self.tables[10]):
            resolved = self.struct(i)
            if not resolved["id"].startswith(self_id + "::") or resolved["id"] in seen:
                raise DecodeError("Duplicate/nonlocal struct definition")
            seen.add(resolved["id"])
            names = [f["name"] for f in resolved["fields"] or []]
            if len(set(names)) != len(names):
                raise DecodeError("Duplicate struct field")
            for f in s["fields"] or []:
                self.check_type_parameters(f["type"], len(resolved["type_parameters"]))
        for table in (4, 11, 14):
            for i in range(len(self.tables[table])):
                self.instantiation(table, i)
        for i in range(len(self.tables[13])):
            self.field(i)
        for a, n in self.tables[15]:
            self.at(8, a)
            self.at(7, n)
        for f in self.tables[12]:
            h = self.at(3, f["handle"])
            if self.module_id(h["module"]) != self_id:
                raise DecodeError("Function definition references foreign module")
            if f["code"] is None:
                continue
            local_tokens = self.at(5, f["locals"])
            for t in local_tokens:
                self.check_type_parameters(t, len(h["type_parameters"]))
            local_count = len(self.at(5, h["parameters"])) + len(local_tokens)
            for ins in f["code"]:
                category, v = ins.get("category"), ins.get("operand")
                if category == "local" and v >= local_count:
                    raise DecodeError(f"Local index {v} exceeds {local_count}")
                if category == "branch" and v >= len(f["code"]):
                    raise DecodeError(f"Branch offset {v} exceeds function code")
                self.instruction(ins)
        self.functions()

    @staticmethod
    def check_type_parameters(t: Any, count: int) -> None:
        if isinstance(t, str):
            return
        if t[0] == "type_parameter":
            if t[1] >= count:
                raise DecodeError("Type parameter index outside signature constraints")
        elif t[0] == "datatype":
            for child in t[2]:
                Module.check_type_parameters(child, count)
        else:
            Module.check_type_parameters(t[1], count)

    def resolved_inventory(self, mapping: dict[str, str] | None = None) -> dict[str, Any]:
        """All entries, including unused handles/constants; sorted multisets retain duplicates."""
        resolved = {
            "module_id": self.module_id(self.self_index, mapping),
            "version": self.version, "flavor": self.flavor,
            "module_handles": [self.module_id(i, mapping) for i in range(len(self.tables[1]))],
            "datatype_handles": [{"id": self.datatype_id(i, mapping),
                                  "abilities": d["abilities"], "type_parameters": d["type_parameters"]}
                                 for i, d in enumerate(self.tables[2])],
            "function_handles": [self.function_handle(i, mapping) for i in range(len(self.tables[3]))],
            "signatures": [self.resolve_signature(i, mapping) for i in range(len(self.tables[5]))],
            "constants": self.tables[6],
            "identifiers": self.tables[7],
            "addresses": [(mapping or {}).get(a, a) for a in self.tables[8]],
            "struct_definitions": [self.struct(i, mapping) for i in range(len(self.tables[10]))],
            "field_handles": [self.field(i, mapping) for i in range(len(self.tables[13]))],
            "friends": [(mapping or {}).get(self.at(8, a), self.at(8, a)) + "::" + self.at(7, n)
                        for a, n in self.tables[15]],
            "metadata": self.tables[16],
        }
        for table in (4, 11, 14):
            resolved[TABLE_NAMES[table]] = [self.instantiation(table, i, mapping) for i in range(len(self.tables[table]))]
        return {key: sorted(value, key=canonical) if isinstance(value, list) else value for key, value in resolved.items()}


def differences(left: Any, right: Any, path: str = "$", limit: int = 30) -> list[dict[str, Any]]:
    result = []

    def walk(a: Any, b: Any, p: str) -> None:
        if a == b or len(result) >= limit:
            return
        if type(a) is type(b) and isinstance(a, dict):
            for k in sorted(a.keys() | b.keys()):
                if k not in a or k not in b:
                    result.append({"path": p + "." + k, "deployed": a.get(k), "candidate": b.get(k),
                                   "presence": [k in a, k in b]})
                else:
                    walk(a[k], b[k], p + "." + k)
                if len(result) >= limit:
                    return
        elif type(a) is type(b) and isinstance(a, list):
            if len(a) != len(b):
                result.append({"path": p + ".length", "deployed": len(a), "candidate": len(b)})
            for i, (av, bv) in enumerate(zip(a, b)):
                walk(av, bv, f"{p}[{i}]")
                if len(result) >= limit:
                    return
        else:
            result.append({"path": p, "deployed": a, "candidate": b})
    walk(left, right, path)
    return result[:limit]


def compare_modules(deployed: Module, candidate: Module, mapping: dict[str, str] | None = None) -> dict[str, Any]:
    mapping = mapping or {}
    if len(set(mapping.values())) != len(mapping):
        raise DecodeError("Address map must be one-to-one")
    if any(k not in candidate.tables[8] for k in mapping):
        raise DecodeError("Address map contains an address absent from the candidate")
    mapped = [mapping.get(a, a) for a in candidate.tables[8]]
    if len(set(mapped)) != len(set(candidate.tables[8])):
        raise DecodeError("Address map collapses distinct candidate addresses")
    deployed_functions, candidate_functions = deployed.functions(), candidate.functions(mapping)
    rows = []
    for name in sorted(deployed_functions.keys() | candidate_functions.keys()):
        a, b = deployed_functions.get(name), candidate_functions.get(name)
        equal = a == b
        row = {"name": name, "match": equal, "deployed_present": a is not None,
               "candidate_present": b is not None, "deployed_sha256": fingerprint(a) if a is not None else None,
               "candidate_sha256": fingerprint(b) if b is not None else None}
        if not equal:
            row["differences"] = differences(a, b)
            row["difference_display_limit"] = 30
        rows.append(row)
    a_inv, b_inv = deployed.resolved_inventory(), candidate.resolved_inventory(mapping)
    table_rows = []
    for name in a_inv:
        a, b = a_inv[name], b_inv[name]
        row = {"name": name, "match": a == b, "deployed_sha256": fingerprint(a), "candidate_sha256": fingerprint(b)}
        if a != b:
            row["differences"] = differences(a, b)
        table_rows.append(row)
    equivalent = all(r["match"] for r in rows + table_rows)
    exact = deployed.data == candidate.data
    return {"schema_version": 1,
            "status": "EXACT_BINARY_MATCH" if exact else ("RESOLVED_MATCH_WITH_DECLARED_ADDRESS_MAP" if equivalent and mapping
                      else "RESOLVED_MATCH" if equivalent else "DIFFERENCES_FOUND"),
            "exact_binary_match": exact, "resolved_module_match": equivalent,
            "declared_candidate_address_map": mapping,
            "address_mapping_scope": "Module/address identifier tables only. Constant bytes and constant address values are never remapped.",
            "deployed": {"module_sha256": sha256(deployed.data), "bytes": len(deployed.data),
                         "module_id": deployed.module_id(deployed.self_index), "function_count": len(deployed_functions),
                         "struct_count": len(deployed.tables[10]),
                         "table_counts": {TABLE_NAMES[k]: len(v) for k, v in deployed.tables.items()}},
            "candidate": {"module_sha256": sha256(candidate.data), "bytes": len(candidate.data),
                          "module_id": candidate.module_id(candidate.self_index), "function_count": len(candidate_functions),
                          "struct_count": len(candidate.tables[10]),
                          "table_counts": {TABLE_NAMES[k]: len(v) for k, v in candidate.tables.items()}},
            "functions_matching": sum(r["match"] for r in rows),
            "functions_compared": len(rows), "functions": rows, "module_inventory": table_rows,
            "limitations": ["Structural identity is not a bytecode verifier, security audit, or economic-correctness proof.",
                            "No instruction rewriting, optimizer equivalence, branch renumbering, or local-variable remapping is assumed.",
                            "Only the pinned module is compared; package linkage and type-origin tables need separate provenance verification.",
                            "A declared address map makes structural equality conditional and cannot establish deployed package identity."]}


def load_pinned_deployed(json_path: Path = DEPLOYED_JSON, disassembly_path: Path = DEPLOYED_DISASSEMBLY) -> tuple[Module, dict[str, Any]]:
    raw_json, raw_disassembly = json_path.read_bytes(), disassembly_path.read_bytes()
    if sha256(raw_json) != PINNED_JSON_SHA256 or sha256(raw_disassembly) != PINNED_DISASSEMBLY_SHA256:
        raise DecodeError("Pinned deployed evidence file hash mismatch")
    obj = json.loads(raw_json)["response"]["data"]["object"]
    pkg, mod = obj["asMovePackage"], obj["asMovePackage"]["module"]
    if obj["address"] != DEPLOYED_PACKAGE or obj["version"] != 11 or obj["digest"] != DEPLOYED_DIGEST:
        raise DecodeError("Unexpected deployed package identity/version/digest")
    if pkg["address"] != DEPLOYED_PACKAGE or pkg["version"] != 11 or mod["name"] != "arboretum" or mod["fileFormatVersion"] != 7:
        raise DecodeError("Unexpected deployed module metadata")
    data = base64.b64decode(mod["bytes"], validate=True)
    if sha256(data) != PINNED_MODULE_SHA256:
        raise DecodeError("Pinned deployed module bytes hash mismatch")
    if mod["disassembly"].encode() != raw_disassembly:
        raise DecodeError("Saved disassembly and pinned GraphQL response disagree")
    module = Module(data)
    if module.module_id(module.self_index) != DEPLOYED_SELF or len(module.tables[12]) != 96:
        raise DecodeError("Deployed module identity/function count mismatch")
    crosscheck_disassembly(module, raw_disassembly.decode())
    return module, {"json_sha256": sha256(raw_json), "disassembly_sha256": sha256(raw_disassembly),
                    "module_sha256": sha256(data), "package_address": DEPLOYED_PACKAGE,
                    "package_version": 11, "package_digest": DEPLOYED_DIGEST,
                    "offline_disassembly_crosscheck": "All 96 function names and ordered opcode streams match the pinned disassembly."}


def crosscheck_disassembly(module: Module, source: str) -> None:
    """Independent saved GraphQL rendering checks name boundaries and opcode order."""
    rows, active = {}, None
    for line in source.splitlines():
        match = re.match(r"^(?:(?:public|entry|friend)\s+)*([A-Za-z_]\w*)(?:<[^\n]*?>)?\(", line)
        if match:
            active = match.group(1)
            if active in rows:
                raise DecodeError("Duplicate disassembly function")
            rows[active] = []
        ins = re.match(r"^\s+(\d+): ([A-Za-z][A-Za-z0-9]*)", line)
        if ins:
            if active is None or int(ins.group(1)) != len(rows[active]):
                raise DecodeError("Malformed disassembly instruction numbering")
            rows[active].append(ins.group(2))
    expected = {}
    for f in module.tables[12]:
        name = module.at(7, module.at(3, f["handle"])["name"])
        # Rust's renderer uses generic type arguments instead of a Generic suffix.
        expected[name] = [i["op"].removesuffix("Generic") for i in f["code"] or []]
    if rows != expected:
        missing = sorted(set(rows) ^ set(expected))
        mismatched = [n for n in rows.keys() & expected.keys() if rows[n] != expected[n]]
        raise DecodeError(f"Binary/disassembly opcode crosscheck failed: missing={missing}, changed={mismatched}")


def load_pinned_prepublication(deployed: Module, path: Path) -> tuple[Module, dict[str, Any]]:
    provenance_bytes = path.read_bytes()
    if sha256(provenance_bytes) != PINNED_PROVENANCE_SHA256:
        raise DecodeError("Pinned prepublication provenance file hash mismatch")
    evidence = json.loads(provenance_bytes)
    obj = evidence["response"]["data"]["deployed"]
    if obj["address"] != DEPLOYED_PACKAGE or obj["version"] != 11 or obj["digest"] != DEPLOYED_DIGEST:
        raise DecodeError("Prepublication provenance refers to a different deployed package")
    tx = obj["previousTransaction"]
    if tx["digest"] != UPGRADE_TRANSACTION or tx["effects"]["status"] != "SUCCESS":
        raise DecodeError("Prepublication provenance refers to a different/unsuccessful upgrade transaction")
    if fingerprint(tx["transactionJson"]) != PINNED_TRANSACTION_JSON_SHA256:
        raise DecodeError("Pinned upgrade transaction data hash mismatch")
    upgrade = tx["transactionJson"]["kind"]["programmableTransaction"]["commands"][1]["upgrade"]
    if len(upgrade["modules"]) != 1 or upgrade["package"] != PREVIOUS_PACKAGE:
        raise DecodeError("Upgrade target or module count does not match the known transaction")
    if upgrade["dependencies"] != [address("1"), address("2")]:
        raise DecodeError("Upgrade dependency identifiers differ from the known transaction")
    raw = base64.b64decode(upgrade["modules"][0], validate=True)
    if sha256(raw) != PREPUBLICATION_MODULE_SHA256:
        raise DecodeError("Pinned prepublication module bytes hash mismatch")
    module = Module(raw)
    if module.module_id(module.self_index) != address("0") + "::arboretum":
        raise DecodeError("Unexpected prepublication self identity")
    self_address_index = module.at(1, module.self_index)[0]
    start, end = module.spans[8][self_address_index]
    if end - start != 32 or raw[start:end] != bytes(32):
        raise DecodeError("Prepublication self address is not a 32-byte zero address")
    target_address_index = deployed.at(1, deployed.self_index)[0]
    target_span = deployed.spans[8][target_address_index]
    if target_span != (start, end):
        raise DecodeError("Prepublication and deployed self addresses occupy different binary locations")
    rewritten = raw[:start] + deployed.data[start:end] + raw[end:]
    if rewritten != deployed.data:
        raise DecodeError("Prepublication module differs beyond the single publisher self-address rewrite")
    conditional = compare_modules(deployed, module, {address("0"): DEPLOYED_SELF.split("::")[0]})
    if not conditional["resolved_module_match"]:
        raise DecodeError("Publisher self-address rewrite failed resolved-structure crosscheck")
    return module, {"provenance_file_sha256": sha256(path.read_bytes()),
                    "transaction_json_canonical_sha256": fingerprint(tx["transactionJson"]),
                    "upgrade_transaction_digest": UPGRADE_TRANSACTION,
                    "upgrade_previous_package": PREVIOUS_PACKAGE,
                    "module_sha256": sha256(raw), "deployed_module_sha256": sha256(deployed.data),
                    "modules_in_upgrade": 1, "dependencies": upgrade["dependencies"],
                    "publisher_rewrite": {"only_difference": "Self module address: zero to deployed defining package address",
                                          "byte_start_inclusive": start, "byte_end_exclusive": end,
                                          "before": address("0"), "after": DEPLOYED_SELF.split("::")[0],
                                          "all_other_bytes_identical": True},
                    "resolved_published_functions_matching": conditional["functions_matching"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True, help="Path to the non-test compiled arboretum.mv")
    parser.add_argument("--output", type=Path, required=True, help="JSON evidence report")
    parser.add_argument("--target", choices=("deployed", "prepublication"), default="deployed",
                        help="Exact comparison target; prepublication uses the recorded successful upgrade module")
    parser.add_argument("--provenance", type=Path, default=ROOT / "contract-reconstruction/provenance.json")
    parser.add_argument("--address-map", action="append", default=[], metavar="CANDIDATE=DEPLOYED",
                        help="Explicit conditional remapping of module/address identifier tables; constants remain exact")
    parser.add_argument("--require-exact", action="store_true", help="Exit successfully only for identical module bytes")
    args = parser.parse_args()
    try:
        mapping = {}
        for item in args.address_map:
            pair = item.split("=")
            if len(pair) != 2:
                raise DecodeError("Address map must be CANDIDATE=DEPLOYED")
            key, value = map(address, pair)
            if key in mapping:
                raise DecodeError("Duplicate candidate address mapping")
            mapping[key] = value
        deployed, provenance = load_pinned_deployed()
        target, publisher_proof = deployed, None
        if args.target == "prepublication":
            target, publisher_proof = load_pinned_prepublication(deployed, args.provenance)
        candidate = Module(args.candidate.read_bytes())
        result = compare_modules(target, candidate, mapping)
        result["comparison_target"] = args.target
        if publisher_proof is not None:
            result["prepublication_provenance"] = publisher_proof
            result["target"] = result.pop("deployed")
            result["target_label"] = "Prepublication module from the successful v11 upgrade transaction"
        result["deployed_evidence"] = provenance
        result["candidate_path"] = str(args.candidate)
        result["decoder_reference_commit"] = REFERENCE_COMMIT
        passed = result["exact_binary_match"] if args.require_exact else result["resolved_module_match"]
        result["exit_gate"] = "exact_binary_match" if args.require_exact else "resolved_module_match"
        code = 0 if passed else 1
    except (DecodeError, OSError, KeyError, ValueError, TypeError) as exc:
        result = {"schema_version": 1, "status": "COMPARISON_REJECTED", "error": str(exc),
                  "exact_binary_match": False, "resolved_module_match": False}
        code = 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"status": result["status"], "functions_matching": result.get("functions_matching"),
                      "functions_compared": result.get("functions_compared"), "report": str(args.output),
                      **({"error": result["error"]} if "error" in result else {})}))
    return code


if __name__ == "__main__":
    sys.exit(main())
