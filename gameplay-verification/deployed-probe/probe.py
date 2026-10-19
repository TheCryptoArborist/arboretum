"""Bounded read-only GraphQL probes for the configured Arboretum deployment.

Only explicit GraphQL queries are sent. There are no key, signature, execution,
publication, or admin paths. Evidence is written beside this script.
"""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import urllib.error
import urllib.request

ENDPOINT = "https://graphql.mainnet.sui.io/graphql"
PACKAGE = "0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724"
TYPE_PACKAGE = "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
REGISTRY = "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50"
KNOWN_OWNER = "0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4"
KNOWN_CHEST = "GPXAb93pyvhRtSCQn6cRB1YcxR2hGp8iqmYQNyPVhNNB"
ROOT = pathlib.Path(__file__).resolve().parent
FUNCTIONS = ["claim_reward", "water_seed", "apply_tool", "buy_crate", "open_crate",
             "buy_boom_chest", "buy_victory_chest", "buy_supply_drop", "plant_seed",
             "plant_seed_with_nftree", "claim_archived_reward", "assert_season_active"]

FUNCTION_QUERY = """query DeployedModule($package: SuiAddress!) {
  checkpoint { sequenceNumber timestamp }
  object(address: $package) {
    address version digest
    asMovePackage { address version
      module(name: "arboretum") {
        name fileFormatVersion bytes disassembly
        %s
      }
    }
  }
}""" % "\n".join(
    f'{name}: function(name: "{name}") {{ name isEntry visibility '
    'parameters { repr signature } return { repr signature } '
    'typeParameters { constraints } }'
    for name in FUNCTIONS
)

SEED_QUERY = """query OwnedSeeds($owner: SuiAddress!, $type: String!, $registry: SuiAddress!) {
  checkpoint { sequenceNumber timestamp }
  registry: object(address: $registry) { address version digest owner {
    __typename ... on Shared { initialSharedVersion }
  } asMoveObject { contents { json type { repr } } } }
  clock: object(address: "0x6") { address version digest owner {
    __typename ... on Shared { initialSharedVersion }
  } asMoveObject { contents { json } } }
  objects(first: 8, filter: {owner: $owner, type: $type}) {
    nodes { address version digest owner {
      __typename ... on AddressOwner { address { address } }
    } asMoveObject { contents { json type { repr } } } }
    pageInfo { hasNextPage endCursor }
  }
}"""

CONFIRMATION_QUERY = """query ConfirmArboretumTransaction($digest: String!) {
  transaction(digest: $digest) {
    digest
    effects {
      digest status
      executionError {
        message abortCode
        module { name package { address } }
        function { name }
      }
      checkpoint { sequenceNumber timestamp }
      events(first: 50) {
        nodes { sequenceNumber sender { address } contents { type { repr } json } }
        pageInfo { hasNextPage endCursor }
      }
      objectChanges(first: 50) {
        nodes { address idCreated idDeleted outputState {
          version digest asMoveObject { contents { type { repr } json } }
        } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}"""

SIMULATION_QUERY = """query SimulateSingleSeed($transaction: JSON!) {
  simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) {
    effects {
      status
      executionError {
        message abortCode instructionOffset
        module { name package { address } }
        function { name }
      }
      gasEffects { gasSummary { computationCost storageCost storageRebate } }
      balanceChangesJson
      events(first: 10) {
        nodes { sequenceNumber contents { type { repr } json } }
        pageInfo { hasNextPage endCursor }
      }
      objectChanges(first: 20) {
        nodes { address idCreated idDeleted
          inputState { version asMoveObject { contents { type { repr } json } } }
          outputState { version asMoveObject { contents { type { repr } json } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}"""

def capture(name, query, variables):
    assert query.lstrip().startswith("query "), "Only GraphQL query operations are permitted"
    assert "executeTransaction" not in query and "mutation" not in query
    request = urllib.request.Request(
        ENDPOINT, data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "ArboretumReadOnlyVerification/1.0"},
    )
    record = {"retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "endpoint": ENDPOINT, "query": query, "variables": variables,
              "transactionsSubmitted": 0}
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            record["httpStatus"] = response.status
            record["response"] = json.load(response)
    except urllib.error.HTTPError as error:
        record["httpStatus"] = error.code
        record["error"] = error.read().decode(errors="replace")
    except Exception as error:
        record["error"] = str(error)
    (ROOT / f"{name}.json").write_text(json.dumps(record, indent=2) + "\n")
    return name, record

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["metadata", "simulate"])
    options = parser.parse_args()
    jobs = [
        ("deployed-module-20261019", FUNCTION_QUERY, {"package": PACKAGE}),
        ("owned-seeds-20261019", SEED_QUERY, {"owner": KNOWN_OWNER, "type": TYPE_PACKAGE + "::arboretum::Seed", "registry": REGISTRY}),
        ("known-chest-confirmation-20261019", CONFIRMATION_QUERY, {"digest": KNOWN_CHEST}),
    ]
    if options.mode == "simulate":
        jobs = []
        for fn in ["water_seed", "claim_reward"]:
            payload = json.loads((ROOT / f"{fn}-unsigned-input-20261019.json").read_text())
            assert payload["checksEnabled"] is True
            assert payload["doGasSelection"] is True
            assert payload["transactionsSubmitted"] == 0
            jobs.append((f"{fn}-simulation-20261019", SIMULATION_QUERY,
                         {"transaction": payload["transaction"]}))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(capture, *job) for job in jobs]
        for future in futures:
            name, record = future.result()
            data = record.get("response", {}).get("data", {}) or {}
            print(json.dumps({"name": name, "httpStatus": record.get("httpStatus"),
                              "errors": record.get("error") or record.get("response", {}).get("errors"),
                              "dataKeys": list(data)}))
            if name.startswith("deployed-module") and data.get("object"):
                module = (data["object"].get("asMovePackage") or {}).get("module")
                if module and module.get("disassembly"):
                    disassembly = module["disassembly"]
                    (ROOT / "arboretum-deployed-disassembly.txt").write_text(disassembly)
                    print(json.dumps({"bytecodeFormat": module.get("fileFormatVersion"),
                        "disassemblySha256": hashlib.sha256(disassembly.encode()).hexdigest(),
                        "functionsPresent": {fn: module.get(fn) is not None for fn in FUNCTIONS}}))
            elif not name.startswith("deployed-module"):
                simulation = (data.get("simulateTransaction") or {}).get("effects") or {}
                transaction = (data.get("transaction") or {}).get("effects") or {}
                print(json.dumps({"simulationStatus": simulation.get("status"),
                                  "simulationError": simulation.get("executionError"),
                                  "transactionStatus": transaction.get("status"),
                                  "ownedObjectsReturned": len((data.get("objects") or {}).get("nodes", []))}))

if __name__ == "__main__":
    main()
