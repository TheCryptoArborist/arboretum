"""Derive a concise report from the saved read-only probe evidence, offline."""
import datetime
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent

def read(name):
    return json.loads((ROOT / name).read_text())

def fields(obj):
    return obj["asMoveObject"]["contents"]["json"]

def utc(milliseconds):
    return datetime.datetime.fromtimestamp(milliseconds / 1000, datetime.timezone.utc).isoformat()

module_record = read("deployed-module-20261019.json")
module_object = module_record["response"]["data"]["object"]
module = module_object["asMovePackage"]["module"]
disassembly = module["disassembly"]
constants = {int(index): int(value) for index, value in re.findall(r"^\s*(\d+) => u64: (\d+)\s*$", disassembly, re.M)}
assert constants[47] == 2_592_000_000
assert constants[48] == 86_400_000
assert constants[8] == 10

before = read("owned-seeds-20261019.json")["response"]["data"]
after = read("post-simulation-state-20261019.json")["response"]["data"]
water = read("water_seed-simulation-20261019.json")["response"]["data"]["simulateTransaction"]["effects"]
claim = read("claim_reward-simulation-20261019.json")["response"]["data"]["simulateTransaction"]["effects"]
seed_id = read("claim_reward-unsigned-input-20261019.json")["seed"]
seed_object = next(obj for obj in before["objects"]["nodes"] if obj["address"] == seed_id)
seed = fields(seed_object)
registry = fields(before["registry"])
clock_ms = int(fields(before["clock"])["timestamp_ms"])
cutoff_ms = int(registry["season_start_ms"]) + constants[47]
last_watered_ms = int(seed["last_watered_ms"])
claim_changes = {node["address"]: node for node in claim["objectChanges"]["nodes"]}
claim_seed = fields(claim_changes[seed_id]["outputState"])
claim_registry = fields(claim_changes[before["registry"]["address"]]["outputState"])
unchanged = all(before["registry"][key] == after["registry"][key] for key in ["version", "digest"])
unchanged = unchanged and fields(before["registry"]) == fields(after["registry"])
unchanged = unchanged and all(seed_object[key] == after["seed"][key] for key in ["version", "digest"])
unchanged = unchanged and seed == fields(after["seed"])
assert unchanged
assert water["status"] == "FAILURE" and water["executionError"]["abortCode"] == "6"
assert claim["status"] == "SUCCESS"
event_types = [node["contents"]["type"]["repr"] for node in claim["events"]["nodes"]]
assert len(event_types) == 1 and event_types[0].endswith("::SeedDied")
assert claim_seed["state"] == 2 and claim_seed["growth_points"] == "0"
assert claim_registry["reward_pool"] == registry["reward_pool"]

summary = {
    "scope": "Two unsigned simulations of one current-season Seed, plus bounded read-only package and receipt queries",
    "package": {"address": module_object["address"], "version": module_object["version"], "digest": module_object["digest"]},
    "deployedDisassemblySha256": hashlib.sha256(disassembly.encode()).hexdigest(),
    "seed": seed_id,
    "seasonId": registry["current_season_id"],
    "seasonStartMs": int(registry["season_start_ms"]),
    "seasonStartUtc": utc(int(registry["season_start_ms"])),
    "seasonDurationMs": constants[47],
    "seasonCutoffMs": cutoff_ms,
    "seasonCutoffUtc": utc(cutoff_ms),
    "lastWateredMs": last_watered_ms,
    "lastWateredUtc": utc(last_watered_ms),
    "deathDays": constants[8],
    "droughtDaysAtCutoff": (cutoff_ms - last_watered_ms) // constants[48],
    "droughtDaysAtProbeClock": (clock_ms - last_watered_ms) // constants[48],
    "bottomlessCanExpiryMs": int(seed["bottomless_can_expiry_ms"]),
    "cutoffInterpretation": "Applying the deployed drought formula to the stored last-watered timestamp at season cutoff gives three complete drought days, below the seven-day wilt and ten-day death thresholds. This is a derived interpretation of current stored fields, not a historical eligibility or payout proof.",
    "waterSimulation": {"status": water["status"], "error": water["executionError"]["message"], "eventCount": len(water["events"]["nodes"])},
    "claimSimulation": {
        "status": claim["status"],
        "eventTypes": event_types,
        "rewardClaimedEvents": 0,
        "seedStateBefore": seed["state"], "seedStateSimulatedAfter": claim_seed["state"],
        "seedGrowthBefore": seed["growth_points"], "seedGrowthSimulatedAfter": claim_seed["growth_points"],
        "registryGrowthBefore": registry["total_growth_points"], "registryGrowthSimulatedAfter": claim_registry["total_growth_points"],
        "rewardPoolBeforeMist": registry["reward_pool"], "rewardPoolSimulatedAfterMist": claim_registry["reward_pool"],
        "balanceChanges": claim["balanceChangesJson"],
        "interpretation": "Successful Move execution records Seed death and removes points; it does not establish a successful reward payout.",
    },
    "unchangedLiveStateAfterSimulations": unchanged,
    "postSimulationCheckpoint": after["checkpoint"],
    "confirmedLiveRegistryVersion": after["registry"]["version"],
    "confirmedLiveSeedVersion": after["seed"]["version"],
    "transactionValidationChecksEnabled": True,
    "simulations": 2,
    "transactionsSubmitted": 0,
    "walletsInvoked": 0,
    "signaturesCreated": 0,
}
(ROOT / "summary-20261019.json").write_text(json.dumps(summary, indent=2) + "\n")

lines = disassembly.splitlines()
extract = []
for fn in ["assert_season_active", "remove_seed_growth_points", "mark_seed_dead", "seed_is_dead_by_time", "water_seed", "claim_reward"]:
    for index, line in enumerate(lines):
        if re.match(r"^(?:public )?(?:entry )?" + fn + r"\b", line):
            end = index + 1
            while lines[end] != "}":
                end += 1
            extract += [f"// Original disassembly lines {index + 1} through {end + 1}", *lines[index:end + 1], ""]
            break
extract += ["// Relevant constants from the complete deployed disassembly", *[f"{index} => u64: {constants[index]}" for index in [6, 8, 47, 48]]]
(ROOT / "deployed-reward-water-excerpt.txt").write_text("\n".join(extract) + "\n")
print(json.dumps(summary, indent=2))
