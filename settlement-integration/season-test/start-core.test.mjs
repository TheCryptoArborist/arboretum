// Offline regressions using captured public mainnet responses. No provider,
// credential, signature, simulation request or chain execution is available.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64 } from '@mysten/bcs';
import {
  EXPECTED, contents, reference, validateInputs, buildStartRehearsal,
  validateSimulation, validateUnchangedAfter,
} from './start-core.mjs';

const fixtureRoot = new URL('../verification/season-test-20261031/mainnet/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, fixtureRoot), 'utf8'));
const captured = {
  proof: read('confirmed-proof.json'), inputs: read('inputs.json'),
  simulation: read('simulation.json'), after: read('after.json'),
  packet: read('unsigned-packet.json'), summary: read('summary.json'),
};
const clone = value => structuredClone(value);
const options = Object.freeze({ now: Date.parse(captured.summary.verifiedAt) });
const OTHER = '0x' + 'a'.repeat(64);
const OTHER_DIGEST = '1'.repeat(32);
const effectsOf = response => response.response.data.simulateTransaction.effects;
const registryOf = response => response.response.data.registries.nodes[0];
const capOf = response => response.response.data.adminCaps.nodes[0];
const registryChange = effects => effects.objectChanges.nodes.find(item => item.address === EXPECTED.registryId);
const capChange = effects => effects.objectChanges.nodes.find(item => item.address === EXPECTED.adminCapId);
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('Network access is unavailable in first-season validator tests');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0, 'Offline validator tests attempted a network request');
});

async function preflight() {
  return validateInputs(clone(captured.inputs), clone(captured.proof), options);
}
async function rejectInputs(mutate, expected) {
  const response = clone(captured.inputs), proof = clone(captured.proof);
  mutate(response, proof);
  await assert.rejects(() => validateInputs(response, proof, options), expected);
}
async function rejectSimulation(mutate, expected) {
  const previous = await preflight();
  const response = clone(captured.simulation), packet = clone(captured.packet), proof = clone(captured.proof);
  mutate(response, packet, proof);
  await assert.rejects(() => validateSimulation(response, packet, previous, proof, options), expected);
}
function mutateResolved(response, mutate) {
  const effects = effectsOf(response);
  const decoded = bcs.TransactionData.parse(fromBase64(effects.transaction.transactionBcs));
  mutate(decoded.V1);
  // Serialize outside the rejection assertion: a malformed test fixture must
  // fail the test, rather than count as successful validator rejection.
  effects.transaction.transactionBcs = bcs.TransactionData.serialize(decoded).toBase64();
}

test('actual confirmed setup proof and fresh empty Registry are accepted', async () => {
  const result = await preflight();
  assert.equal(result.confirmedSetup.currentEmpty, true);
  assert.equal(result.confirmedSetup.digest, EXPECTED.setupDigest);
  assert.equal(result.registry.address, EXPECTED.registryId);
  assert.equal(result.adminCap.address, EXPECTED.adminCapId);
  assert.equal(contents(result.registry).current_season_id, '0');
  assert.equal(contents(result.registry).season_start_ms, '0');
  assert.equal(contents(result.registry).reward_pool, '0');
  assert.equal(contents(result.registry).treasury, '0');
});

test('rebuilding the unsigned proposal reproduces the captured one-call 24-hour packet', async () => {
  const packet = await buildStartRehearsal(await preflight());
  assert.deepEqual(packet, captured.packet);
  assert.equal(packet.kindBytes, 258);
  assert.equal(packet.transactionData.commands.length, 1);
  assert.equal(packet.transactionData.inputs.length, 4);
  assert.equal(packet.proposedDurationMs, '86400000');
  assert.equal(packet.transactionData.expiration, null);
  assert.ok(Object.values(packet.transactionData.gasData).every(value => value === null));
});

test('actual checked simulation preserves funds and correctly relates execution, stored start and cutoff', async () => {
  const result = await validateSimulation(clone(captured.simulation), clone(captured.packet),
    await preflight(), clone(captured.proof), options);
  assert.deepEqual(result, captured.summary.simulated);
  assert.equal(result.gasEstimateMist, '100553');
  assert.equal(result.resolvedGasPayments, 0);
  assert.equal(result.returnedGasObjectChanges, 0);
  assert.equal(result.protocolObjectChanges, 2);
  assert.equal(result.predictedRewardPoolMist, '0');
  assert.equal(result.predictedTreasuryMist, '0');
  assert.equal(BigInt(result.simulatedActualStartMs) - BigInt(result.predictedStoredStartMs), 29n * 86400000n);
  assert.equal(BigInt(result.predictedCutoffMs) - BigInt(result.simulatedActualStartMs), 86400000n);
  assert.equal(BigInt(result.predictedClaimDeadlineMs) - BigInt(result.predictedCutoffMs), 7n * 86400000n);
  assert.equal(BigInt(result.predictedNormalResetReadyMs) - BigInt(result.predictedCutoffMs), 86400000n);
});

test('the final captured observation confirms unchanged real objects after simulated execution time', async () => {
  const previous = await preflight();
  const current = await validateInputs(clone(captured.after), clone(captured.proof), options);
  const result = validateUnchangedAfter(previous, current, captured.summary.simulated);
  assert.deepEqual(result, captured.summary.actualAfterRehearsal);
  assert.ok(Date.parse(current.checkpoint.timestamp) >= Number(captured.summary.simulated.simulatedActualStartMs));
  assert.equal(result.actualSeasonId, '0');
  assert.equal(result.actualSeasonStartMs, '0');
});

test('matching proof/live responses from another network are rejected', async () => {
  await rejectInputs((response, proof) => {
    response.response.data.genesis.digest = OTHER_DIGEST;
    proof.response.data.genesis.digest = OTHER_DIGEST;
  }, /mainnet/i);
});

test('stale receipt-proof observations cannot authorize a fresh-looking rehearsal', async () => {
  const proof = clone(captured.proof);
  proof.response.data.checkpoint.timestamp = new Date(options.now - EXPECTED.maxAgeMs - 1).toISOString();
  await assert.rejects(() => validateInputs(clone(captured.inputs), proof, options), /proof observation is stale/i);
});

test('receipt proof, live authority and simulation responses cannot be mixed', async () => {
  await rejectInputs(response => {
    response.response.data.transaction = clone(captured.proof.response.data.transaction);
  }, /must remain distinct/i);
  await rejectInputs((_response, proof) => {
    proof.response.data.simulateTransaction = clone(captured.simulation.response.data.simulateTransaction);
  }, /must remain distinct/i);
  await rejectInputs((_response, proof) => {
    proof.response.data.transaction = clone(proof.response.data.upgradeTransaction);
  }, /different transaction|different digest|different.*setup/i);
});

test('receipt proof newer than the live authority snapshot is rejected', async () => {
  await rejectInputs((response, proof) => {
    proof.response.data.checkpoint.sequenceNumber = response.response.data.checkpoint.sequenceNumber + 1;
  }, /checkpoint order/i);
});

test('a foreign administrator or another Registry binding cannot supply the capability', async () => {
  await rejectInputs(response => {
    capOf(response).owner.address.address = OTHER;
  }, /administrator|owner/i);
  await rejectInputs(response => {
    contents(capOf(response)).registry_id = OTHER;
  }, /bound|binding|Registry/i);
});

test('a later or changed UpgradeCap package version is rejected', async () => {
  await rejectInputs(response => {
    contents(response.response.data.upgradeCap).version = '13';
  }, /not committed to the expected capability|package version|upgrade policy/i);
});

test('a Registry whose first season has already started is rejected', async () => {
  await rejectInputs(response => {
    const registry = registryOf(response);
    registry.version += 1;
    contents(registry).current_season_id = '1';
    contents(registry).season_start_ms = String(options.now);
  }, /no longer empty/i);
});

test('empty tables with changed identities do not satisfy the exact creation baseline', async () => {
  await rejectInputs(response => {
    const registry = registryOf(response);
    registry.version += 1;
    contents(registry).seeds_by_owner.id = OTHER;
  }, /exact empty creation contents/i);
});

test('partial inventories and GraphQL errors cannot establish readiness', async () => {
  await rejectInputs(response => {
    response.response.data.registries.pageInfo.hasNextPage = true;
  }, /incomplete/i);
  await rejectInputs(response => {
    response.response.errors = [{ message: 'Synthetic incomplete response' }];
  }, /failed GraphQL response/i);
});

test('altered proposal metadata or command data is rejected before inspecting effects', async () => {
  await rejectSimulation((_response, packet) => {
    packet.proposedDurationMs = '43200000';
  }, /exact single start call/i);
  await rejectSimulation((_response, packet) => {
    packet.transactionData.commands.push(clone(packet.transactionData.commands[0]));
  }, /exact single start call/i);
});

test('an extra Move command in resolved transaction bytes is rejected', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    const ptb = data.kind.ProgrammableTransaction;
    ptb.commands.push(clone(ptb.commands[0]));
  }), /Resolved transaction kind changed/i);
});

test('a different duration in resolved transaction bytes is rejected', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.kind.ProgrammableTransaction.inputs[3].Pure.bytes = bcs.u64().serialize('43200000').toBase64();
  }), /Resolved transaction kind changed/i);
});

test('a foreign resolved sender cannot be hidden behind the expected response sender', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.sender = OTHER;
  }), /Wrong resolved sender/i);
});

test('a foreign resolved gas owner is rejected', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.gasData.owner = OTHER;
  }), /Wrong resolved gas owner/i);
});

test('resolved gas must have positive price and cover the actual predicted debit', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.gasData.budget = '1';
  }), /Estimated gas exceeds the resolved budget/i);
  await rejectSimulation(response => mutateResolved(response, data => {
    data.gasData.price = '0';
  }), /budget and price must be positive/i);
});

test('resolved gas references cannot name protocol objects or omit their effects', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.gasData.payment = [reference(capOf(captured.inputs))];
  }), /protocol input cannot be a gas coin/i);
  await rejectSimulation(response => mutateResolved(response, data => {
    data.gasData.payment = [{ objectId: OTHER, version: '1', digest: OTHER_DIGEST }];
  }), /gas object changes do not match the resolved payment list/i);
});

test('resolved expiration must remain bound to mainnet and the observed epoch window', async () => {
  await rejectSimulation(response => mutateResolved(response, data => {
    data.expiration = { None: true, $kind: 'None' };
  }), /ValidDuring|expiration.*required|address.balance.*expir/i);
  await rejectSimulation(response => mutateResolved(response, data => {
    data.expiration.ValidDuring.chain = OTHER_DIGEST;
  }), /wrong chain/i);
  await rejectSimulation(response => mutateResolved(response, data => {
    data.expiration.ValidDuring.maxEpoch = String(BigInt(data.expiration.ValidDuring.maxEpoch) + 1n);
  }), /expiration window differs/i);
});

test('additional events or a substituted start timestamp are rejected', async () => {
  await rejectSimulation(response => {
    const events = effectsOf(response).events.nodes;
    events.push(clone(events[0]));
  }, /Unexpected SeasonStarted event/i);
  await rejectSimulation(response => {
    const event = effectsOf(response).events.nodes[0];
    event.contents.json.start_ms = String(BigInt(event.contents.json.start_ms) + 1n);
  }, /Unexpected SeasonStarted event/i);
});

test('the actual simulation Clock must be the sole unchanged consensus input', async () => {
  await rejectSimulation(response => {
    const nodes = effectsOf(response).unchangedConsensusObjects.nodes;
    nodes.push(clone(nodes[0]));
  }, /only the read-only Clock consensus input/i);
  await rejectSimulation(response => {
    effectsOf(response).unchangedConsensusObjects.nodes[0].object.address = OTHER;
  }, /Wrong Clock object/i);
});

test('Registry output cannot gain funds or substitute the event time for the stored backdate', async () => {
  await rejectSimulation(response => {
    contents(registryChange(effectsOf(response)).outputState).reward_pool = '1';
  }, /Unexpected Registry state changes/i);
  await rejectSimulation(response => {
    const effects = effectsOf(response);
    contents(registryChange(effects).outputState).season_start_ms = effects.events.nodes[0].contents.json.start_ms;
  }, /Unexpected Registry state changes/i);
});

test('AdminCap metadata advancement cannot conceal a binding change or transfer', async () => {
  await rejectSimulation(response => {
    contents(capChange(effectsOf(response)).outputState).registry_id = OTHER;
  }, /AdminCap fields changed/i);
  await rejectSimulation(response => {
    capChange(effectsOf(response)).outputState.owner.address.address = OTHER;
  }, /transferred a protocol object/i);
});

test('an unrelated object cannot be changed by the single start call', async () => {
  await rejectSimulation(response => {
    const effects = effectsOf(response), extra = clone(capChange(effects));
    extra.address = OTHER;
    extra.inputState.address = OTHER;
    extra.outputState.address = OTHER;
    effects.objectChanges.nodes.push(extra);
  }, /gas object changes do not match the resolved payment list/i);
});

test('a foreign or non-gas balance movement is rejected', async () => {
  await rejectSimulation(response => {
    const effects = effectsOf(response);
    effects.balanceChangesJson.push({ address: OTHER,
      coinType: effects.balanceChangesJson[0].coinType, amount: '1' });
  }, /Only the predicted administrator SUI gas debit/i);
});

test('input references cannot change between the preflight and simulated observation', async () => {
  await rejectSimulation(response => {
    capOf(response).version += 1;
  }, /adminCap input reference changed/i);
});

test('a changed real Registry cannot be reported as unchanged after rehearsal', async () => {
  const previous = await preflight();
  const current = await validateInputs(clone(captured.after), clone(captured.proof), options);
  contents(current.registry).reward_pool = '1';
  assert.throws(() => validateUnchangedAfter(previous, current, captured.summary.simulated), /registry input contents changed/i);
});

test('a same-checkpoint post-read before the simulation Clock cannot prove unchanged final state', async () => {
  const previous = await preflight();
  const current = await validateInputs(clone(captured.after), clone(captured.proof), options);
  current.checkpoint.sequenceNumber = captured.summary.simulated.checkpoint.sequenceNumber;
  current.checkpoint.timestamp = new Date(Number(captured.summary.simulated.simulatedActualStartMs) - 1).toISOString();
  assert.throws(() => validateUnchangedAfter(previous, current, captured.summary.simulated), /predates|before|execution.*time|simulation.*time|simulation Clock/i);
});
