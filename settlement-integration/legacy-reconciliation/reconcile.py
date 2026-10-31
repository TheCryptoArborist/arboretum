"""Read and derive legacy Season 3 evidence without any blockchain mutations."""

import argparse
import collections
import concurrent.futures
import datetime
import json
import pathlib

from capture import ROOT, capture, page_connection, utc_now

REGISTRY = "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50"
TYPE_PACKAGE = "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
ARCHIVE_PACKAGE = "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
SAMPLE_SEED = "0x0055f786810a6094e0d4231968d4b546f3c5e3177d2e71253ef38f8e6ea2dffc"
SEASON_ID = 3
CUTOFF_MS = 1790812806247
DAY_MS = 86_400_000

CHECKPOINT_FIELDS = "sequenceNumber digest timestamp"
OBJECT_FIELDS = """address version digest
  owner { __typename ... on AddressOwner { address { address } }
    ... on Shared { initialSharedVersion } }
  previousTransaction { digest effects { checkpoint { sequenceNumber timestamp } } }
  asMoveObject { contents { type { repr } json } }
"""
PAGE_FIELDS = "pageInfo { hasNextPage endCursor }"
ANCHOR_QUERY = "query ReconciliationAnchor { chainIdentifier checkpoint { " + CHECKPOINT_FIELDS + " } }"
CHECKPOINT_QUERY = "query HistoricalCheckpoint($checkpoint: UInt53!) { checkpoint(sequenceNumber:$checkpoint) { " + CHECKPOINT_FIELDS + " } }"
REGISTRY_QUERY = """query LegacyRegistryAtCheckpoint($checkpoint: UInt53!, $registry: SuiAddress!) {
  checkpoint(sequenceNumber:$checkpoint) {
    """ + CHECKPOINT_FIELDS + """
    query { registry: object(address:$registry) { """ + OBJECT_FIELDS + """ } }
  }
}"""
OBJECTS_QUERY = """query LegacyObjectsAtCheckpoint($checkpoint: UInt53!, $type: String!, $cursor: String) {
  checkpoint(sequenceNumber:$checkpoint) {
    sequenceNumber
    query { objects(first:50, after:$cursor, filter:{type:$type}) {
      nodes { """ + OBJECT_FIELDS + """ } """ + PAGE_FIELDS + """
    } }
  }
}"""
TRANSACTIONS_QUERY = """query LegacyRegistryTransactions($registry: SuiAddress!, $before: UInt53!, $cursor: String) {
  transactions(first:50, after:$cursor,
    filter:{affectedObject:$registry, beforeCheckpoint:$before}) {
    nodes { digest effects { status checkpoint { sequenceNumber timestamp } } }
    """ + PAGE_FIELDS + """
  }
}"""
STATE_FIELDS = """address version digest
  owner { __typename ... on AddressOwner { address { address } }
    ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }
"""
DETAIL_QUERY = """query LegacyTransactionEvidence($digest: String!, $eventCursor: String, $objectCursor: String) {
  transaction(digest:$digest) {
    digest sender { address } transactionJson
    effects { digest status checkpoint { sequenceNumber timestamp }
      executionError { message abortCode }
      gasEffects { gasSummary { computationCost storageCost storageRebate } }
      balanceChangesJson
      events(first:50, after:$eventCursor) {
        nodes { sequenceNumber contents { type { repr } json } }
        """ + PAGE_FIELDS + """
      }
      objectChanges(first:50, after:$objectCursor) {
        nodes { address idCreated idDeleted
          inputState { """ + STATE_FIELDS + """ }
          outputState { """ + STATE_FIELDS + """ }
        }
        """ + PAGE_FIELDS + """
      }
    }
  }
}"""
POINT_QUERY = """query LegacyObjectPoint($object: SuiAddress!, $checkpoint: UInt53!) {
  checkpoint(sequenceNumber:$checkpoint) { sequenceNumber timestamp }
  object(address:$object, atCheckpoint:$checkpoint) { """ + OBJECT_FIELDS + """ }
}"""
EVENT_QUERY = """query LegacyClaimEvents($type: String!, $before: UInt53!, $cursor: String) {
  events(first:50, after:$cursor, filter:{type:$type, beforeCheckpoint:$before}) {
    nodes { sequenceNumber contents { type { repr } json }
      transaction { digest effects { status checkpoint { sequenceNumber timestamp } } }
    }
    """ + PAGE_FIELDS + """
  }
}"""


def timestamp_ms(text):
    value = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    delta = value - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return delta.days * DAY_MS + delta.seconds * 1000 + delta.microseconds // 1000


def fields(obj):
    return (obj.get("asMoveObject") or {}).get("contents", {}).get("json") or {}


def save(name, value):
    (ROOT / (name + ".json")).write_text(json.dumps(value, indent=2) + "\n")


def cutoff_checkpoints(anchor, target_ms=CUTOFF_MS):
    # Locate the final checkpoint whose observable Clock is at or before cutoff,
    # and its immediate successor. This is temporal evidence, not an estimate.
    low = 0
    high = int(anchor["sequenceNumber"])
    reads = []
    while high - low > 1:
        mid = (high + low) // 2
        item = capture(f"checkpoint-{mid}", CHECKPOINT_QUERY,
                       {"checkpoint": mid})["checkpoint"]
        if not item:
            raise RuntimeError(f"Missing historical checkpoint {mid}")
        reads.append(item)
        if timestamp_ms(item["timestamp"]) <= target_ms:
            low = mid
        else:
            high = mid
    before = capture(f"checkpoint-{low}", CHECKPOINT_QUERY,
                     {"checkpoint": low})["checkpoint"]
    after = capture(f"checkpoint-{high}", CHECKPOINT_QUERY,
                    {"checkpoint": high})["checkpoint"]
    if not (timestamp_ms(before["timestamp"]) <= target_ms < timestamp_ms(after["timestamp"])):
        raise RuntimeError("Failed to bracket season cutoff")
    return {"cutoffMs": target_ms, "atOrBefore": before,
            "immediatelyAfter": after, "lookupCount": len(reads)}


def collect():
    anchor = capture("anchor", ANCHOR_QUERY)
    print(json.dumps({"anchor": anchor}), flush=True)
    bounds = cutoff_checkpoints(anchor["checkpoint"])
    save("cutoff-checkpoints", bounds)
    print(json.dumps({"cutoff": bounds}), flush=True)
    manifest = {"createdAt": utc_now(), "network": "mainnet",
                "chainIdentifier": anchor["chainIdentifier"],
                "registryId": REGISTRY, "seasonId": SEASON_ID,
                "anchor": anchor["checkpoint"], "cutoff": bounds,
                "transactionsSubmitted": 0, "simulations": 0,
                "snapshots": {}, "limitations": []}
    for label, checkpoint in [("cutoff", bounds["atOrBefore"]["sequenceNumber"]),
                              ("anchor", anchor["checkpoint"]["sequenceNumber"])]:
        entry = {"checkpoint": checkpoint, "objects": [], "pages": {}}
        try:
            entry["registry"] = capture(label + "-registry", REGISTRY_QUERY,
                                          {"checkpoint": checkpoint, "registry": REGISTRY})["checkpoint"]["query"]["registry"]
        except RuntimeError as error:
            entry["registryError"] = str(error)
            manifest["limitations"].append(str(error))
        for origin_label, origin in [("original", TYPE_PACKAGE), ("archive", ARCHIVE_PACKAGE)]:
            try:
                objects, pages = page_connection(
                    label + "-" + origin_label + "-objects", OBJECTS_QUERY,
                    {"checkpoint": checkpoint, "type": origin + "::arboretum"},
                    "checkpoint.query.objects")
                ids = [obj["address"] for obj in objects]
                if len(ids) != len(set(ids)):
                    raise RuntimeError(f"{label}/{origin_label}: duplicate object IDs")
                entry["objects"].extend(objects)
                entry["pages"][origin_label] = pages
            except RuntimeError as error:
                entry.setdefault("objectErrors", []).append(str(error))
                manifest["limitations"].append(str(error))
        manifest["snapshots"][label] = entry
        save("reconciliation-evidence", manifest)
        print(json.dumps({"snapshot": label, "objects": len(entry["objects"]),
                          "registry": fields(entry.get("registry") or {}),
                          "errors": entry.get("registryError") or entry.get("objectErrors")}), flush=True)
    transactions, pages = page_connection(
        "registry-transactions", TRANSACTIONS_QUERY,
        {"registry": REGISTRY, "before": int(anchor["checkpoint"]["sequenceNumber"]) + 1},
        "transactions")
    digests = [tx["digest"] for tx in transactions]
    if len(digests) != len(set(digests)):
        raise RuntimeError("Duplicate transaction digest in registry history")
    manifest["registryTransactions"] = transactions
    manifest["registryTransactionPages"] = pages
    save("reconciliation-evidence", manifest)
    print(json.dumps({"registryTransactions": len(transactions), "pages": len(pages)}), flush=True)


def collect_details():
    manifest = json.loads((ROOT / "reconciliation-evidence.json").read_text())
    anchor_cp = int(manifest["anchor"]["sequenceNumber"])
    cutoff_cp = int(manifest["cutoff"]["atOrBefore"]["sequenceNumber"])
    selected = [tx for tx in manifest["registryTransactions"]
                if tx["effects"]["checkpoint"]["timestamp"] >= "2026-09-01"]
    # Keep the Registry's earliest indexed transaction too, so continuity can
    # be checked against its creation rather than assuming retention is whole.
    selected += manifest["registryTransactions"][:1]
    details = {}
    failures = []

    def read_detail(tx):
        tx_digest = tx["digest"]
        record = capture("transaction-" + tx_digest, DETAIL_QUERY,
                         {"digest": tx_digest, "eventCursor": None, "objectCursor": None})["transaction"]
        if not record or record["digest"] != tx_digest or record["effects"]["digest"] != tx_digest:
            raise RuntimeError(f"Missing or mismatched receipt: {tx_digest}")
        effects = record["effects"]
        if int(effects["checkpoint"]["sequenceNumber"]) > anchor_cp:
            raise RuntimeError("Receipt is newer than the frozen anchor")
        # All pagination must be complete. Additional independent requests are
        # issued only for connections whose first page has more data.
        for key, cursor_variable in [("events", "eventCursor"), ("objectChanges", "objectCursor")]:
            if effects[key]["pageInfo"]["hasNextPage"]:
                nodes, pages = page_connection(
                    "transaction-" + tx_digest + "-" + key, DETAIL_QUERY,
                    {"digest": tx_digest, "eventCursor": None, "objectCursor": None},
                    "transaction.effects." + key, cursor_name=cursor_variable)
                effects[key] = {"nodes": nodes, "complete": True, "pages": pages}
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        future_map = {executor.submit(read_detail, tx): tx["digest"] for tx in selected}
        for future in concurrent.futures.as_completed(future_map):
            tx_digest = future_map[future]
            try:
                details[tx_digest] = future.result()
            except Exception as error:
                failures.append({"transaction": tx_digest, "error": str(error)})
    print(json.dumps({"transactionDetails": len(details), "failures": failures}), flush=True)

    events = {}
    for name, origin in [("RewardClaimed", TYPE_PACKAGE), ("SeedDied", TYPE_PACKAGE),
                          ("ArchivedRewardClaimed", ARCHIVE_PACKAGE), ("SeasonArchived", ARCHIVE_PACKAGE)]:
        try:
            nodes, pages = page_connection("events-" + name, EVENT_QUERY,
                {"type": origin + "::arboretum::" + name, "before": anchor_cp + 1}, "events")
            events[name] = {"nodes": nodes, "pages": pages, "complete": True}
        except RuntimeError as error:
            events[name] = {"error": str(error), "complete": False}
    print(json.dumps({"events": {k:len(v.get("nodes", [])) for k,v in events.items()}}), flush=True)
    # Add any payout receipt found by type-indexed event history even if it
    # changes an Archive instead of taking the Registry as an input.
    event_digests = {event["transaction"]["digest"] for group in events.values()
                     for event in group.get("nodes", []) if event.get("transaction")}
    for tx_digest in sorted(event_digests - set(details)):
        try:
            details[tx_digest] = read_detail({"digest": tx_digest})
        except Exception as error:
            failures.append({"transaction": tx_digest, "error": str(error)})

    seed_ids = {obj["address"] for obj in manifest["snapshots"]["anchor"]["objects"]
                if (obj.get("asMoveObject") or {}).get("contents", {}).get("type", {}).get("repr")
                == TYPE_PACKAGE + "::arboretum::Seed"}
    # Transaction output/input states discover Seeds which may later have
    # been destroyed and would be absent from today's live object listing.
    for tx in details.values():
        for change in tx["effects"]["objectChanges"]["nodes"]:
            for direction in ["inputState", "outputState"]:
                state = change.get(direction)
                if not state:
                    continue
                if (state.get("asMoveObject") or {}).get("contents", {}).get("type", {}).get("repr") == TYPE_PACKAGE + "::arboretum::Seed":
                    seed_ids.add(change["address"])
    points = {}
    def point(seed_id):
        return seed_id, capture("cutoff-seed-" + seed_id[2:], POINT_QUERY,
                               {"object": seed_id, "checkpoint": cutoff_cp})["object"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(point, seed_id) for seed_id in sorted(seed_ids)]
        for future in concurrent.futures.as_completed(futures):
            try:
                seed_id, value = future.result()
                points[seed_id] = value
            except Exception as error:
                failures.append({"cutoffObjectError": str(error)})
    result = {"createdAt": utc_now(), "anchor": manifest["anchor"],
              "cutoff": manifest["cutoff"], "transactionDetails": details,
              "events": events, "cutoffSeedPoints": points, "failures": failures,
              "transactionsSubmitted": 0, "simulations": 0}
    save("reconciliation-details", result)
    print(json.dumps({"cutoffSeedsFound": sum(p is not None for p in points.values()),
                      "cutoffSeedIdsExamined": len(seed_ids), "failures": failures}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["collect", "details"])
    args = parser.parse_args()
    {"collect": collect, "details": collect_details}[args.mode]()
