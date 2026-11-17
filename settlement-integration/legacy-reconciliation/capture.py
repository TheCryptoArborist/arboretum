"""Capture reproducible public Sui GraphQL reads; no signer or write API.

Every capture stores its complete request, response, UTC retrieval time and
response digest. Cached results are reused only for identical requests. A new
snapshot uses a new output directory. Mutation and simulation operations are
rejected; this tool never invokes a wallet, key store or transaction builder.
"""

import datetime
import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.request

ENDPOINT = "https://graphql.mainnet.sui.io/graphql"
ROOT = pathlib.Path(__file__).resolve().parent


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def capture(name, query, variables=None, *, directory=None, reuse=True):
    if not re.match(r"^\s*query\s+\w+", query):
        raise ValueError("Only named GraphQL read queries are permitted")
    if re.search(r"\b(?:mutation|executeTransaction|simulateTransaction)\b", query):
        raise ValueError("Transaction execution and simulation are not permitted")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
        raise ValueError("Capture name must be a simple filename stem")
    request_body = {"query": query, "variables": variables or {}}
    output_dir = pathlib.Path(directory or ROOT / "evidence")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / (name + ".json")
    if reuse and path.exists():
        record = json.loads(path.read_text())
        if record.get("request") != request_body:
            raise ValueError(f"Existing capture request differs: {path}")
        if record.get("response") and not record["response"].get("errors"):
            if record.get("responseSha256") != digest(record["response"]):
                raise ValueError(f"Capture response digest mismatch: {path}")
            return record["response"]["data"]
    record = {
        "retrievedAt": utc_now(), "endpoint": ENDPOINT,
        "request": request_body, "transactionsSubmitted": 0,
        "signaturesCreated": 0, "simulations": 0,
    }
    request = urllib.request.Request(
        ENDPOINT, data=json.dumps(request_body).encode(),
        headers={"Content-Type": "application/json",
                 "User-Agent": "ArboretumLegacyReconciliation/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            record["httpStatus"] = response.status
            record["response"] = json.load(response)
            record["responseSha256"] = digest(record["response"])
    except urllib.error.HTTPError as error:
        record["httpStatus"] = error.code
        record["transportError"] = error.read().decode(errors="replace")
    except Exception as error:
        record["transportError"] = str(error)
    path.write_text(json.dumps(record, indent=2) + "\n")
    if record.get("transportError"):
        raise RuntimeError(f"{name}: {record['transportError']}")
    if record["response"].get("errors"):
        raise RuntimeError(f"{name}: {json.dumps(record['response']['errors'])}")
    return record["response"]["data"]


def page_connection(prefix, query, variables, field, *, directory=None,
                    max_pages=100, cursor_name="cursor"):
    """Never silently accept a truncated, looping or duplicate connection."""
    cursor = None
    seen = set()
    nodes = []
    pages = []
    for number in range(max_pages):
        args = {**variables, cursor_name: cursor}
        data = capture(f"{prefix}-{number:03d}", query, args, directory=directory)
        connection = data
        for component in field.split("."):
            connection = connection[component]
        if connection is None:
            raise RuntimeError(f"{prefix}: null connection")
        nodes.extend(connection["nodes"])
        page = connection["pageInfo"]
        pages.append({"file": f"{prefix}-{number:03d}.json",
                      "nodes": len(connection["nodes"]), **page})
        if page["hasNextPage"] is False:
            return nodes, pages
        next_cursor = page.get("endCursor")
        if not next_cursor or next_cursor in seen:
            raise RuntimeError(f"{prefix}: missing or repeated cursor")
        seen.add(next_cursor)
        cursor = next_cursor
    raise RuntimeError(f"{prefix}: page budget exhausted; incomplete history")
