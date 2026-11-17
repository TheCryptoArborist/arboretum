"""Offline legacy reconciliation, with a separate unapproved policy scenario.

This is an evidence review. It does not create compensation records, executable
transactions, wallets, payment instructions, or eligibility for the new game.
"""

import collections
import csv
import hashlib
import json

from capture import ROOT, digest
from reconcile import CUTOFF_MS, DAY_MS, REGISTRY, SAMPLE_SEED, SEASON_ID, TYPE_PACKAGE, fields


def require(condition, message):
    if not condition:
        raise ValueError(message)


def native_type(obj):
    return (obj.get("asMoveObject") or {}).get("contents", {}).get("type", {}).get("repr")


def address_owner(obj):
    owner = obj.get("owner") or {}
    if owner.get("__typename") != "AddressOwner":
        return None
    return (owner.get("address") or {}).get("address")


def complete(connection):
    return connection.get("complete") is True or connection.get("pageInfo", {}).get("hasNextPage") is False


def checked_policy_contribution(seed, cutoff_ms):
    """Evaluate the draft #15 cutoff rule; never infer missing eligibility."""
    data = fields(seed)
    needed = ["growth_points", "state", "planted_at_ms", "last_watered_ms", "bottomless_can_expiry_ms", "owner"]
    require(all(k in data for k in needed), "Seed fields needed for cutoff review are missing")
    require(address_owner(seed) == data["owner"], "Seed stored owner differs from on-chain owner")
    require(int(data["planted_at_ms"]) <= cutoff_ms, "Seed was planted after cutoff")
    require(int(data["last_watered_ms"]) <= cutoff_ms, "Historical watering time is after cutoff")
    gp = int(data["growth_points"])
    require(0 <= gp <= (1 << 64) - 1, "Invalid unsigned growth points")
    drought_days = (cutoff_ms - int(data["last_watered_ms"])) // DAY_MS
    protected = int(data["bottomless_can_expiry_ms"]) >= cutoff_ms
    if int(data["state"]) == 2:
        return 0, "stored_dead", drought_days, protected
    if drought_days >= 10 and not protected:
        return 0, "ten_complete_dry_days_at_cutoff", drought_days, protected
    return gp, "eligible_under_draft_cutoff_rule", drought_days, protected


def registry_chain(transactions, final_registry):
    edges = []
    for tx in transactions.values():
        effects = tx["effects"]
        require(tx["digest"] == effects["digest"], "Receipt digest mismatch")
        require(complete(effects["events"]) and complete(effects["objectChanges"]), "Incomplete receipt pagination")
        if effects["status"] != "SUCCESS":
            continue
        for change in effects["objectChanges"]["nodes"]:
            if change["address"] != REGISTRY:
                continue
            before, after = change.get("inputState"), change.get("outputState")
            if after and int(fields(after).get("current_season_id", -1)) == SEASON_ID:
                require(before is not None, "Season 3 Registry mutation missing input state")
                edges.append({"transaction": tx["digest"], "checkpoint": effects["checkpoint"],
                              "before": before, "after": after})
    edges.sort(key=lambda e: int(e["after"]["version"]))
    require(bool(edges), "No Season 3 mutation chain")
    first = edges[0]
    require(int(fields(first["before"])["current_season_id"]) == SEASON_ID - 1,
            "Chain does not start at the preceding season")
    require(int(fields(first["after"])["reward_pool"]) == 0,
            "Unexpected opening Season 3 pool")
    require(int(fields(first["after"])["total_growth_points"]) == 0,
            "Unexpected opening Season 3 GP")
    for left, right in zip(edges, edges[1:]):
        require(left["after"]["version"] == right["before"]["version"]
                and left["after"]["digest"] == right["before"]["digest"],
                "Gap or fork in the Registry version/digest chain")
        require(fields(left["after"]) == fields(right["before"]),
                "Registry state differs at a chain boundary")
    require(edges[-1]["after"]["version"] == final_registry["version"]
            and edges[-1]["after"]["digest"] == final_registry["digest"],
            "Mutation chain does not reach frozen Registry")
    require(fields(edges[-1]["after"]) == fields(final_registry),
            "Final mutation state differs from snapshot")
    return edges


def derive(evidence, details):
    require(not details["failures"], "Some receipt or historical point reads failed")
    cutoff = evidence["snapshots"]["cutoff"]["registry"]
    current = evidence["snapshots"]["anchor"]["registry"]
    require(evidence["anchor"] == details["anchor"], "Snapshot anchors differ")
    require(cutoff["version"] == current["version"] and cutoff["digest"] == current["digest"],
            "Registry changed since cutoff; a new reconciliation is required")
    require(fields(cutoff) == fields(current), "Registry fields changed since cutoff")
    require(int(fields(current)["current_season_id"]) == SEASON_ID, "Wrong Registry season")
    require(int(fields(current)["season_start_ms"]) + 30 * DAY_MS == CUTOFF_MS,
            "Cutoff does not match observed deployed legacy duration")
    chain = registry_chain(details["transactionDetails"], current)
    current_seeds = {o["address"]: o for o in evidence["snapshots"]["anchor"]["objects"]
                     if native_type(o) == TYPE_PACKAGE + "::arboretum::Seed"
                     and int(fields(o)["season_id"]) == SEASON_ID}
    historical_seeds = {seed_id: obj for seed_id, obj in details["cutoffSeedPoints"].items()
                        if obj and int(fields(obj).get("season_id", -1)) == SEASON_ID}
    require(set(current_seeds) == set(historical_seeds), "Season 3 roster differs between anchor and cutoff")
    planted = {}
    for tx in details["transactionDetails"].values():
        if tx["effects"]["status"] != "SUCCESS":
            continue
        for change in tx["effects"]["objectChanges"]["nodes"]:
            out = change.get("outputState")
            if change["idCreated"] and out and native_type(out) == TYPE_PACKAGE + "::arboretum::Seed" and int(fields(out)["season_id"]) == SEASON_ID:
                require(change["address"] not in planted, "Seed creation repeated")
                planted[change["address"]] = tx["digest"]
    require(set(planted) == set(historical_seeds), "Created Seed set differs from cutoff roster")
    gp_total = sum(int(fields(s)["growth_points"]) for s in historical_seeds.values())
    require(gp_total == int(fields(current)["total_growth_points"]), "Seed GP does not reconcile to Registry")
    require(len(historical_seeds) == int(fields(current)["total_seeds"]), "Seed count does not reconcile to Registry")
    rows = []
    for seed_id, historical in sorted(historical_seeds.items()):
        live = current_seeds[seed_id]
        require(historical["version"] == live["version"] and historical["digest"] == live["digest"],
                "Seed changed between cutoff and anchor")
        require(fields(historical) == fields(live), "Seed historical contents differ")
        data = fields(historical)
        gp, reason, dry_days, protected = checked_policy_contribution(historical, CUTOFF_MS)
        rows.append({"seedId": seed_id, "owner": data["owner"], "seasonId": SEASON_ID,
                     "versionAtCutoff": str(historical["version"]), "digestAtCutoff": historical["digest"],
                     "creationTransaction": planted[seed_id],
                     "growthPointsAtCutoff": str(data["growth_points"]),
                     "rawStoredState": data["state"], "lastWateredMs": str(data["last_watered_ms"]),
                     "protectionExpiryMs": str(data["bottomless_can_expiry_ms"]),
                     "completeDryDaysAtCutoff": dry_days, "protectedAtCutoff": protected,
                     "draftPolicyEligibleGrowthPoints": str(gp), "draftPolicyReason": reason,
                     "confirmedLegacyPayoutMist": "0", "approvedCompensationMist": None,
                     "unchangedSinceCutoff": True})
    eligible_gp = sum(int(row["draftPolicyEligibleGrowthPoints"]) for row in rows)
    pool = int(fields(current)["reward_pool"])
    require(eligible_gp > 0, "No denominator for the draft-policy scenario")
    for row in rows:
        row["unapprovedScenarioAllocationMist"] = str(pool * int(row["draftPolicyEligibleGrowthPoints"]) // eligible_gp)
    pool_increases = 0
    pool_decreases = 0
    chain_rows = []
    for edge in chain:
        delta = int(fields(edge["after"])["reward_pool"]) - int(fields(edge["before"])["reward_pool"])
        pool_increases += max(0, delta)
        pool_decreases += max(0, -delta)
        chain_rows.append({"transaction": edge["transaction"], "checkpoint": edge["checkpoint"],
                           "inputVersion": edge["before"]["version"], "inputDigest": edge["before"]["digest"],
                           "outputVersion": edge["after"]["version"], "outputDigest": edge["after"]["digest"],
                           "rewardPoolDeltaMist": str(delta)})
    require(pool_decreases == 0 and pool_increases == pool, "Pool movements require a new payout reconciliation")
    for edge in chain:
        receipt = details["transactionDetails"][edge["transaction"]]
        commands = receipt["transactionJson"].get("kind", {}).get("programmableTransaction", {}).get("commands", [])
        require(not any(command.get("moveCall", {}).get("module") == "arboretum"
                        and command["moveCall"].get("function") in {"claim_reward", "claim_archived_reward"}
                        for command in commands), "A claim call requires per-Seed payout reconciliation")
        require(not any(event["contents"]["type"]["repr"].endswith("::arboretum::RewardClaimed")
                        for event in receipt["effects"]["events"]["nodes"]),
                "A reward event requires per-Seed payout reconciliation")
    require(all(group.get("complete") for group in details["events"].values()),
            "Some event discovery pages are incomplete")
    require(not any(int(event["contents"]["json"].get("season_id", -1)) == SEASON_ID
                    for event in details["events"]["ArchivedRewardClaimed"]["nodes"]),
            "A Season 3 archived claim requires reconciliation")
    after_cutoff = [tx for tx in evidence["registryTransactions"]
                    if int(tx["effects"]["checkpoint"]["sequenceNumber"]) > int(evidence["cutoff"]["atOrBefore"]["sequenceNumber"])]
    require(not after_cutoff, "Registry activity after cutoff needs receipt reconciliation")
    owners = collections.defaultdict(lambda: {"seedCount": 0, "growthPoints": 0, "draftEligibleGP": 0,
                                              "confirmedLegacyPayoutMist": "0", "unapprovedScenarioMist": 0})
    for row in rows:
        owner = owners[row["owner"]]
        owner["seedCount"] += 1
        owner["growthPoints"] += int(row["growthPointsAtCutoff"])
        owner["draftEligibleGP"] += int(row["draftPolicyEligibleGrowthPoints"])
        owner["unapprovedScenarioMist"] += int(row["unapprovedScenarioAllocationMist"])
    inventories = collections.Counter(native_type(obj) for obj in evidence["snapshots"]["anchor"]["objects"])
    archives = [{"objectId": obj["address"], **fields(obj)}
                for obj in evidence["snapshots"]["anchor"]["objects"]
                if (native_type(obj) or "").endswith("::SeasonArchive")]
    require(not any(int(a["season_id"]) == SEASON_ID for a in archives), "A Season 3 archive requires separate reconciliation")
    sample = historical_seeds[SAMPLE_SEED]
    return {
        "status": "LEGACY_SEASON_3_RECONCILED_FOR_REVIEW",
        "network": evidence["network"], "chainIdentifier": evidence["chainIdentifier"],
        "registryId": REGISTRY, "seasonId": SEASON_ID, "anchor": evidence["anchor"],
        "cutoff": evidence["cutoff"], "registryVersion": current["version"], "registryDigest": current["digest"],
        "rewardPoolMist": str(pool), "recordedGrowthPoints": str(gp_total),
        "seedCount": len(rows), "ownerCount": len(owners),
        "confirmedLegacySeason3PoolPayoutMist": "0", "approvedCompensationMist": None,
        "registryMutationChainComplete": True, "registryMutationCount": len(chain),
        "registryTransactionsAfterCutoff": 0, "grossPoolIncreasesMist": str(pool_increases),
        "grossPoolDecreasesMist": str(pool_decreases), "allSeason3SeedsUnchangedSinceCutoff": True,
        "sampleSeed": {"objectId": SAMPLE_SEED, "version": sample["version"],
                       "digest": sample["digest"], "growthPoints": fields(sample)["growth_points"],
                       "storedState": fields(sample)["state"], "reported188GPLossWasSimulationOnly": True},
        "draftPolicyScenario": {
            "status": "UNAPPROVED_ILLUSTRATION_NOT_AN_ENTITLEMENT_OR_PAYMENT_INSTRUCTION",
            "policySource": "contract-payout/legacy-transition.md and contract-payout settlement candidate #15",
            "cutoffEligibleGP": str(eligible_gp), "excludedGP": str(gp_total - eligible_gp),
            "eligibleSeeds": sum(int(r["draftPolicyEligibleGrowthPoints"]) > 0 for r in rows),
            "excludedSeeds": sum(int(r["draftPolicyEligibleGrowthPoints"]) == 0 for r in rows),
            "allocationsTotalMist": str(sum(int(r["unapprovedScenarioAllocationMist"]) for r in rows)),
            "roundingResidueMist": str(pool - sum(int(r["unapprovedScenarioAllocationMist"]) for r in rows)),
            "legacyCodePaysThisScenario": False,
        },
        "owners": dict(sorted(owners.items())), "seeds": rows,
        "mutationChain": chain_rows, "currentNativeInventoryCounts": dict(sorted(inventories.items())),
        "existingArchives": archives,
        "transactionsSubmitted": 0, "signaturesCreated": 0, "simulations": 0,
    }


def verify_capture_hashes():
    count = 0
    for path in sorted((ROOT / "evidence").glob("*.json")):
        record = json.loads(path.read_text())
        if "responseSha256" not in record:
            continue  # Early schema-only discovery, not ledger evidence.
        require(record["responseSha256"] == digest(record["response"]), f"Evidence hash mismatch: {path.name}")
        if "request" in record:
            require(record.get("transactionsSubmitted") == 0, "Non-read capture encountered")
        count += 1
    return count


def verify_capture_binding(evidence, details):
    """Ensure offline aggregate inputs are the actual captured records."""
    def read(stem):
        return json.loads((ROOT / "evidence" / (stem + ".json")).read_text())["response"]["data"]
    require(evidence["anchor"] == read("anchor")["checkpoint"], "Anchor binding mismatch")
    for label in ["anchor", "cutoff"]:
        require(evidence["snapshots"][label]["registry"] == read(label + "-registry")["checkpoint"]["query"]["registry"],
                "Registry capture binding mismatch")
        objects = []
        for pages in evidence["snapshots"][label]["pages"].values():
            for page in pages:
                captured = read(page["file"][:-5])["checkpoint"]["query"]["objects"]
                objects.extend(captured["nodes"])
                require(captured["pageInfo"]["hasNextPage"] == page["hasNextPage"], "Object page binding mismatch")
        require(objects == evidence["snapshots"][label]["objects"], "Object-set capture binding mismatch")
    transactions = []
    for page in evidence["registryTransactionPages"]:
        transactions.extend(read(page["file"][:-5])["transactions"]["nodes"])
    require(transactions == evidence["registryTransactions"], "Transaction list binding mismatch")
    for tx_digest, expected in details["transactionDetails"].items():
        actual = read("transaction-" + tx_digest)["transaction"]
        for key in ["events", "objectChanges"]:
            if expected["effects"][key].get("complete"):
                nodes = []
                for page in expected["effects"][key]["pages"]:
                    nodes.extend(read(page["file"][:-5])["transaction"]["effects"][key]["nodes"])
                actual["effects"][key] = {"nodes": nodes, "complete": True,
                                           "pages": expected["effects"][key]["pages"]}
        require(actual == expected, "Receipt capture binding mismatch")
    for seed_id, expected in details["cutoffSeedPoints"].items():
        require(expected == read("cutoff-seed-" + seed_id[2:])["object"], "Historical Seed capture binding mismatch")
    for group in details["events"].values():
        nodes = []
        for page in group["pages"]:
            nodes.extend(read(page["file"][:-5])["events"]["nodes"])
        require(nodes == group["nodes"], "Event discovery binding mismatch")


def write_outputs(result):
    (ROOT / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    rows = result["seeds"]
    with (ROOT / "season3-seeds-review.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    owner_rows = [{"owner": owner, **values} for owner, values in result["owners"].items()]
    with (ROOT / "season3-owners-review.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(owner_rows[0]))
        writer.writeheader()
        writer.writerows(owner_rows)


if __name__ == "__main__":
    evidence = json.loads((ROOT / "reconciliation-evidence.json").read_text())
    details = json.loads((ROOT / "reconciliation-details.json").read_text())
    verified = verify_capture_hashes()
    verify_capture_binding(evidence, details)
    result = derive(evidence, details)
    write_outputs(result)
    print(json.dumps({"status": result["status"], "capturesWithVerifiedHashes": verified,
                      "seeds": result["seedCount"], "growthPoints": result["recordedGrowthPoints"],
                      "poolMist": result["rewardPoolMist"], "mutationChainLength": result["registryMutationCount"],
                      "draftScenario": result["draftPolicyScenario"]}))
