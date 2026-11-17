import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { EXPECTED, contents, dataOf, reference, inspectState, SUI_TYPE } from './common.mjs';
import { assertCycleReceipt, validateConfirmedRollover } from './rollover-core.mjs';
import { observedRolloverInputs, observedRolloverProof } from './rollover-fixtures.mjs';
import * as care from './care-core.mjs';
import { createCareFixtures, careLiveInput, careFieldsResponse, makeConfirmedCareFailure, observedCareFields, observedUnchangedPlant } from './care-fixtures.mjs';

const f = await createCareFixtures();
const unchanged = await createCareFixtures({ unchangedGrowth: true });
const clone = value => structuredClone(value);
const nameOf = action => action[0].toUpperCase() + action.slice(1);
const options = item => ({ nowMs: item.now,
  ...(item.unchangedPlantField ? { unchangedPlantField: item.unchangedPlantField } : {}) });
const context = item => [item.cycle, ...(item.action === 'plant' ? [] : [item.planting])];
const simulate = (item, response = item.simulation, packet = item.packet, previous = item.state) =>
  care[`validate${nameOf(item.action)}Simulation`](response, packet, previous, item.proof, ...context(item), options(item));
const confirm = (item, response = item.confirmation, digest = item.digest) =>
  care[`validateConfirmed${nameOf(item.action)}`](response, digest, item.proof, ...context(item), options(item));
const copiedCase = item => ({ ...item, confirmation: clone(item.confirmation), simulation: clone(item.simulation) });
const at = (state, now) => ({ ...state, clockMs: String(now), checkpoint: { ...state.checkpoint, timestamp: new Date(now).toISOString() } });
const effects = response => response.data.simulateTransaction?.effects ?? response.data.transaction.effects;
const objectChange = (response, id) => effects(response).objectChanges.nodes.find(x => x.address === id);
async function currentState(item, now = item.now) {
  return inspectState(careLiveInput(item.confirmation, now), item.proof, { nowMs: now });
}

test('the recorded public mainnet field query validates the actual existing owner and NFT records', async () => {
  const inputs = observedRolloverInputs(), now = Date.parse(inputs.data.checkpoint.timestamp);
  const state = await inspectState(inputs, observedRolloverProof(), { nowMs: now });
  const recorded = observedCareFields();
  assert.equal(recorded.query, care.PLANT_FIELDS_QUERY);
  assert.deepEqual(recorded.variables, care.plantFieldVariables(state, EXPECTED.previousNftId));
  const checked = care.attachPlantFields(state, recorded, EXPECTED.previousNftId);
  assert.deepEqual(contents(checked.careFields.seedsByOwner).value, [EXPECTED.previousSeedId]);
  assert.equal(contents(checked.careFields.playerGrowth).value, '10');
  assert.equal(contents(checked.careFields.playerGrowthSeason).value, '1');
  assert.equal(contents(checked.careFields.plantedSapling).value, '1');
});

test('the care core accepts only verified, frozen rollover and planting contexts', () => {
  assert.equal(assertCycleReceipt(f.cycle), f.cycle);
  assert.equal(care.assertPlantReceipt(f.plant.receipt, f.cycle), f.plant.receipt);
  assert.throws(() => assertCycleReceipt(clone(f.cycle)), /Reverify/);
  assert.throws(() => care.assertPlantReceipt(clone(f.plant.receipt), f.cycle), /Reverify/);
  assert.ok(Object.isFrozen(f.plant.receipt.seedOutput.asMoveObject.contents.json));
  assert.throws(() => { f.plant.receipt.waterReadyMs = '1'; }, TypeError);
});

test('processed Season 1 inventory and existing owner tables permit one reused NFTree planting', async () => {
  assert.equal(f.plant.state.ownedSeeds.length, 1);
  assert.equal(contents(f.plant.state.oldSeed).reward_processed, true);
  const packet = await care.preparePlant(f.plant.state, EXPECTED.previousNftId, f.cycle, options(f.plant));
  assert.equal(packet.action, 'plant');
  assert.equal(contents(packet.fieldInputs.plantedSapling).value, '1');
  assert.deepEqual(contents(f.plant.receipt.fieldOutputs.seedsByOwner).value, [EXPECTED.previousSeedId, f.plant.seedId]);
  for (const table of ['seeds_by_owner', 'player_growth', 'player_growth_season', 'planted_saplings'])
    assert.deepEqual(contents(f.plant.receipt.registryOutput)[table], contents(f.cycle.registryOutput)[table]);
});

test('the original mainnet planting reproduction verifies an explicitly unchanged 10-GP field', async () => {
  const capture = observedUnchangedPlant(), nowMs = Date.parse(capture.simulation.capturedAt);
  const cycle = await validateConfirmedRollover(capture.rollover, dataOf(capture.rollover).transaction.digest, capture.proof, { nowMs });
  const { transaction: _transaction, ...live } = dataOf(capture.rollover);
  const state = care.attachPlantFields(await inspectState({ data: live }, capture.proof, { nowMs }), capture.fields, EXPECTED.previousNftId);
  const packet = await care.preparePlant(state, EXPECTED.previousNftId, cycle, { nowMs });
  const actualEffects = dataOf(capture.simulation).simulateTransaction.effects;
  assert.equal(actualEffects.objectChanges.nodes.some(x => x.address === state.careFields.playerGrowth.address), false);
  assert.deepEqual(actualEffects.effectsJson.unchangedLoadedRuntimeObjects,
    [{ objectId: state.careFields.playerGrowth.address, version: String(state.careFields.playerGrowth.version) }]);
  const result = await care.validatePlantSimulation(capture.simulation, packet, state, capture.proof, cycle, { nowMs });
  assert.equal(result.status, 'simulated'); assert.equal(result.growthPoints, '10');
  assert.equal(result.gasEstimateMist, '2959058');
  assert.deepEqual(reference(result.fieldOutputs.playerGrowth), reference(state.careFields.playerGrowth));
  assert.equal(contents(result.fieldOutputs.playerGrowth).value, '10');
  assert.equal(contents(result.fieldOutputs.playerGrowthSeason).value, '2');
});

test('unchanged growth preserves its original version through planting receipt recovery and subsequent care', async () => {
  const item = unchanged.plant;
  const variables = await care.plantReceiptFieldVariables(item.confirmation, item.digest);
  assert.deepEqual(variables, { objectId: item.fields.playerGrowth.address, version: item.fields.playerGrowth.version });
  assert.ok(care.PLANT_RECEIPT_FIELD_QUERY.includes('version:$version'));
  const simulated = await simulate(item), receipt = await confirm(item);
  assert.equal(simulated.status, 'simulated'); assert.equal(receipt.status, 'confirmed');
  assert.deepEqual(reference(receipt.fieldOutputs.playerGrowth), reference(item.fields.playerGrowth));
  assert.equal(care.assertPlantReceipt(receipt, item.cycle), receipt);
  for (const alias of ['seedsByOwner', 'playerGrowthSeason', 'plantedSapling'])
    assert.equal(receipt.fieldOutputs[alias].version, effects(item.confirmation).lamportVersion);
  assert.equal((await simulate(unchanged.water)).growthPoints, '24');
  assert.equal((await confirm(unchanged.water)).growthPoints, '24');
  assert.equal((await confirm(unchanged.claim)).rewardProcessed, true);
});

test('changed growth and failed planting receipts request no historical unchanged-field hydration', async () => {
  assert.equal(await care.plantReceiptFieldVariables(f.plant.confirmation, f.plant.digest), null);
  const failed = makeConfirmedCareFailure(copiedCase(unchanged.plant));
  assert.equal(await care.plantReceiptFieldVariables(failed.confirmation, failed.digest), null);
  await assert.rejects(care.plantReceiptFieldVariables(unchanged.plant.confirmation, f.water.digest), /digests differ/);
  await assert.rejects(care.plantReceiptFieldVariables(f.water.confirmation, f.water.digest), /verified Season 1 NFTree/);
});

test('an omitted growth update requires the exact unchanged runtime reference and matching transaction metadata', async () => {
  const item = unchanged.plant;
  for (const mutate of [
    e => { delete e.effectsJson; },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects = []; },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects.push(clone(e.effectsJson.unchangedLoadedRuntimeObjects[0])); },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects[0].objectId = item.fields.playerGrowthSeason.address; },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects[0].version = String(BigInt(item.fields.playerGrowth.version) + 1n); },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects[0].version = '0'; },
    e => { e.effectsJson.unchangedLoadedRuntimeObjects[0].version = String(e.lamportVersion); },
    e => { e.effectsJson.transactionDigest = f.water.digest; },
    e => { e.effectsJson.status = { success: false }; },
    e => { e.effectsJson.version = 1; },
    e => { e.effectsJson.epoch = '1'; },
    e => { e.effectsJson.lamportVersion = String(BigInt(e.lamportVersion) + 1n); },
    e => { e.effectsJson.changedObjects.push({ objectId: item.fields.playerGrowth.address }); },
  ]) {
    const raw = clone(item.simulation); mutate(effects(raw)); await assert.rejects(simulate(item, raw));
  }
});

test('an unchanged field cannot replace a required owner-index, season, NFT-use, or watering update', async () => {
  for (const alias of ['seedsByOwner', 'playerGrowthSeason', 'plantedSapling']) {
    const item = unchanged.plant, raw = clone(item.simulation);
    effects(raw).objectChanges.nodes = effects(raw).objectChanges.nodes.filter(x => x.address !== item.fields[alias].address);
    await assert.rejects(simulate(item, raw), /output is missing/);
    const receipt = clone(item.confirmation);
    effects(receipt).objectChanges.nodes = effects(receipt).objectChanges.nodes.filter(x => x.address !== item.fields[alias].address);
    await assert.rejects(confirm(item, receipt), /receipt lacks/);
  }
  const water = clone(unchanged.water.simulation);
  effects(water).objectChanges.nodes = effects(water).objectChanges.nodes.filter(x => x.address !== unchanged.water.fields.playerGrowth.address);
  await assert.rejects(simulate(unchanged.water, water), /player_growth output is missing/);
  const contradictory = clone(f.plant.simulation);
  effects(contradictory).effectsJson = clone(effects(unchanged.plant.simulation).effectsJson);
  await assert.rejects(simulate(f.plant, contradictory), /both changed and unchanged/);
});

test('unchanged growth still binds the exact checkpoint-observed field version and expected value', async () => {
  const item = unchanged.plant;
  for (const mutate of [
    fields => { contents(fields.playerGrowth).value = '11'; },
    fields => { fields.playerGrowth.version++; },
  ]) {
    const fields = clone(item.fields); mutate(fields);
    const state = care.attachPlantFields(item.state, careFieldsResponse(item.state, fields), EXPECTED.previousNftId);
    const packet = await care.preparePlant(state, EXPECTED.previousNftId, item.cycle, options(item));
    await assert.rejects(simulate(item, item.simulation, packet, state), /unchanged player_growth reference|exact expected value/);
  }
});

test('confirmed recovery requires the versioned field proof and rejects wrong network, version, owner, key, type, or value', async () => {
  const item = unchanged.plant;
  await assert.rejects(care.validateConfirmedPlant(item.confirmation, item.digest, item.proof, item.cycle, { nowMs: item.now }),
    error => error.code === 'CONFIRMATION_PENDING' && /exact unchanged/.test(error.message));
  for (const mutate of [
    r => { r.data.genesis.digest = f.water.digest; },
    r => { r.data.playerGrowth = null; },
    r => { r.data.playerGrowth.address = item.fields.playerGrowthSeason.address; },
    r => { r.data.playerGrowth.version++; },
    r => { r.data.playerGrowth.owner.address.address = EXPECTED.registryId; },
    r => { contents(r.data.playerGrowth).name = EXPECTED.previousNftId; },
    r => { r.data.playerGrowth.asMoveObject.contents.type.repr += 'wrong'; },
    r => { contents(r.data.playerGrowth).value = '24'; },
    r => { r.data.playerGrowth.digest = 'bad'; },
    r => { r.errors = [{ message: 'Historical object unavailable.' }]; },
  ]) {
    const field = clone(item.unchangedPlantField); mutate(field);
    await assert.rejects(care.validateConfirmedPlant(item.confirmation, item.digest, item.proof, item.cycle,
      { nowMs: item.now, unchangedPlantField: field }));
  }
  const badRuntime = clone(item.confirmation);
  effects(badRuntime).effectsJson.unchangedLoadedRuntimeObjects[0].objectId = item.fields.playerGrowthSeason.address;
  await assert.rejects(care.plantReceiptFieldVariables(badRuntime, item.digest), /another field/);
  await assert.rejects(confirm(item, badRuntime), /another field/);
});

test('historical unchanged growth supports later recovery without substituting the current 24-GP field', async () => {
  const item = unchanged.plant, later = clone(unchanged.claim.confirmation);
  later.data.transaction = clone(item.confirmation.data.transaction);
  const receipt = await care.validateConfirmedPlant(later, item.digest, unchanged.claim.proof, item.cycle,
    { nowMs: unchanged.claim.now, unchangedPlantField: item.unchangedPlantField });
  assert.equal(receipt.hasAdvanced, true); assert.equal(contents(receipt.fieldOutputs.playerGrowth).value, '10');
  assert.deepEqual(reference(receipt.fieldOutputs.playerGrowth), reference(item.fields.playerGrowth));
  const current = clone(item.unchangedPlantField); current.data.playerGrowth = clone(unchanged.water.fieldOutputs.playerGrowth);
  await assert.rejects(care.validateConfirmedPlant(later, item.digest, unchanged.claim.proof, item.cycle,
    { nowMs: unchanged.claim.now, unchangedPlantField: current }), /historical player_growth object/);
});

test('the isolated cycle rejects a different NFTree even if an owner inventory is supplied', async () => {
  const id = '0x' + '7'.repeat(64);
  await assert.rejects(care.preparePlant(f.plant.state, id, f.cycle, options(f.plant)), /reuses the verified/);
});

test('field observations bind exact network, checkpoint, table parent, key, type, and complete owner index', () => {
  const mutators = [
    raw => { raw.data.genesis.digest = f.plant.digest; },
    raw => { raw.data.checkpoint.sequenceNumber++; },
    raw => { raw.data.checkpoint.timestamp = new Date(f.plant.now + 1).toISOString(); },
    raw => { raw.data.checkpoint.query.playerGrowth.owner.address.address = EXPECTED.sender; },
    raw => { contents(raw.data.checkpoint.query.playerGrowth).name = EXPECTED.previousNftId; },
    raw => { raw.data.checkpoint.query.playerGrowth.asMoveObject.contents.type.repr += 'wrong'; },
    raw => { contents(raw.data.checkpoint.query.seedsByOwner).value.push(EXPECTED.previousSeedId); },
    raw => { contents(raw.data.checkpoint.query.seedsByOwner).value = []; },
    raw => { raw.data.checkpoint.query.plantedSapling = null; },
  ];
  for (const mutate of mutators) {
    const raw = clone(f.plant.fieldResponse); mutate(raw);
    assert.throws(() => care.attachPlantFields(f.plant.state, raw, EXPECTED.previousNftId));
  }
});

test('prepare requires field reads at the same Registry reference and prevents already-used season trackers', async () => {
  await assert.rejects(care.preparePlant({ ...f.plant.state, careFieldCheckpoint: 0 }, EXPECTED.previousNftId, f.cycle, options(f.plant)), /different checkpoint/);
  for (const alias of ['plantedSapling', 'playerGrowthSeason']) {
    const fields = clone(f.plant.fields); contents(fields[alias]).value = '2';
    const state = care.attachPlantFields(f.plant.state, careFieldsResponse(f.plant.state, fields), EXPECTED.previousNftId);
    await assert.rejects(care.preparePlant(state, EXPECTED.previousNftId, f.cycle, options(f.plant)), /already/);
  }
});

test('planting closes precisely when less than a complete first-watering interval remains', async () => {
  const last = Number(f.cycle.cutoffMs) - Number(EXPECTED.wateringIntervalMs);
  assert.equal(care.inspectCare(at(f.plant.state, last - 1), f.cycle, null, { nowMs: last - 1 }).status, 'plant-ready');
  const boundary = at(f.plant.state, last);
  assert.equal(care.inspectCare(boundary, f.cycle, null, { nowMs: last }).status, 'plant-window-closed');
  await assert.rejects(care.preparePlant(boundary, EXPECTED.previousNftId, f.cycle, { nowMs: last }), /planting window/);
});

test('fresh read-only status distinguishes watering cooldown, ready, already watered, and claim', () => {
  const ready = Number(f.plant.receipt.waterReadyMs), cutoff = Number(f.cycle.cutoffMs);
  assert.equal(care.inspectCare(at(f.water.state, ready - 1), f.cycle, f.plant.receipt, { nowMs: ready - 1 }).status, 'waiting-water');
  assert.equal(care.inspectCare(at(f.water.state, ready), f.cycle, f.plant.receipt, { nowMs: ready }).status, 'water-ready');
  assert.equal(care.inspectCare(at(f.claim.state, f.water.now + 1), f.cycle, f.plant.receipt, { nowMs: f.water.now + 1 }).status, 'watered');
  assert.equal(care.inspectCare(at(f.claim.state, cutoff), f.cycle, f.plant.receipt, { nowMs: cutoff }).status, 'claim-ready');
});

test('no early, duplicate, or cutoff watering can be prepared', async () => {
  for (const [state, now] of [[f.water.state, Number(f.plant.receipt.waterReadyMs) - 1],
    [f.claim.state, f.water.now + 1], [f.water.state, Number(f.cycle.cutoffMs)]])
    await assert.rejects(care.prepareWater(at(state, now), f.cycle, f.plant.receipt, { nowMs: now }), /not eligible/);
});

test('the claim window is inclusive at its deadline and expires immediately after', async () => {
  const deadline = Number(f.cycle.claimDeadlineMs);
  assert.equal(care.inspectCare(at(f.claim.state, deadline), f.cycle, f.plant.receipt, { nowMs: deadline }).status, 'claim-ready');
  assert.equal(care.inspectCare(at(f.claim.state, deadline + 1), f.cycle, f.plant.receipt, { nowMs: deadline + 1 }).status, 'expired');
  await assert.rejects(care.prepareClaim(at(f.claim.state, deadline + 1), f.cycle, f.plant.receipt, { nowMs: deadline + 1 }), /not currently claimable/);
});

test('stale, wrong-season, changed inventory, and duplicated Seed observations fail closed', () => {
  assert.throws(() => care.inspectCare(f.water.state, f.cycle, f.plant.receipt, { nowMs: f.water.now + 200000 }), /stale/);
  const foreign = clone(f.water.state); contents(foreign.registry).current_season_id = '3'; foreign.registry.version++;
  assert.equal(care.inspectCare(foreign, f.cycle, f.plant.receipt, options(f.water)).status, 'closed');
  const duplicate = clone(f.water.state); duplicate.ownedSeeds.push(clone(duplicate.ownedSeeds[1]));
  assert.throws(() => care.inspectCare(duplicate, f.cycle, f.plant.receipt, options(f.water)), /duplicate/);
  const changed = clone(f.water.state); contents(changed.registry).player_growth.size = '2';
  assert.throws(() => care.inspectCare(changed, f.cycle, f.plant.receipt, options(f.water)), /inventory changed/);
});

test('an existing new Seed without its verified planting receipt requires recovery', () => {
  const state = care.inspectCare(f.water.state, f.cycle, null, options(f.water));
  assert.equal(state.status, 'needs-plant-receipt'); assert.equal(state.canAct, false);
});

test('a planting receipt cannot be reused with a different verified rollover context', async () => {
  const other = await createCareFixtures({ gasMode: 'address', nowMs: f.rollover.now + 5000 });
  assert.throws(() => care.assertPlantReceipt(f.plant.receipt, other.cycle), /Reverify/);
});

for (const action of ['plant', 'water', 'claim']) {
  test(`${action} exact unsigned simulation validates its intended effects and balance`, async () => {
    const item = f[action], checked = await simulate(item);
    assert.equal(checked.status, 'simulated'); assert.equal(checked.action, action);
    assert.equal(checked.kindSha256, item.packet.kindSha256); assert.equal(checked.seasonId, '2');
    assert.equal(checked.seedId, f.plant.seedId);
    if (action === 'plant') assert.equal(checked.netReceiveMist, '-13000000');
    if (action === 'water') { assert.equal(checked.growthPointsAdded, '14'); assert.equal(checked.appChargeMist, '0'); }
    if (action === 'claim') { assert.equal(checked.rewardMist, '7000000'); assert.equal(checked.netReceiveMist, '5424949'); }
  });

  test(`${action} rejects unreviewed wallet commands, sender, or wallet-assigned gas`, async () => {
    const item = f[action];
    assert.equal(await care.validateWalletTransaction(item.packet.transaction, item.packet, item.cycle, item.planting), true);
    const command = Transaction.fromKind(item.packet.kindBase64); command.setSender(EXPECTED.sender);
    command.transferObjects([command.gas], EXPECTED.treasuryWallet);
    await assert.rejects(care.validateWalletTransaction(command, item.packet, item.cycle, item.planting), /exact reviewed/);
    const gas = Transaction.fromKind(item.packet.kindBase64); gas.setSender(EXPECTED.sender); gas.setGasBudget(50000000);
    await assert.rejects(care.validateWalletTransaction(gas, item.packet, item.cycle, item.planting), /wallet/);
    const sender = Transaction.fromKind(item.packet.kindBase64); sender.setSender(EXPECTED.treasuryWallet);
    await assert.rejects(care.validateWalletTransaction(sender, item.packet, item.cycle, item.planting), /administrator/);
  });

  test(`${action} confirmed receipt verifies actual bytes, digest, exact outputs and current state`, async () => {
    const item = f[action], checked = await confirm(item);
    assert.equal(checked.status, 'confirmed'); assert.equal(checked.digest, item.digest); assert.equal(checked.hasAdvanced, false);
    const wrongDigest = item.digest === f.rollover.digest ? f.water.digest : f.rollover.digest;
    await assert.rejects(confirm(item, item.confirmation, wrongDigest), /digests differ/);
    const merelySubmitted = clone(item.confirmation); merelySubmitted.data.transaction.effects.checkpoint = null;
    await assert.rejects(confirm(item, merelySubmitted), /not yet indexed/);
    const fakeBytes = clone(item.confirmation); fakeBytes.data.transaction.transactionBcs = f.rollover.bytes;
    await assert.rejects(confirm(item, fakeBytes), /actual bytes/);
  });

  test(`${action} rejects wrong balance recipients and changed gas accounting`, async () => {
    const item = f[action], wrongRecipient = clone(item.simulation);
    effects(wrongRecipient).balanceChangesJson[0].address = EXPECTED.previousNftId;
    await assert.rejects(simulate(item, wrongRecipient), /recipient/);
    const wrongBalance = clone(item.simulation); effects(wrongBalance).balanceChangesJson[0].amount = '123';
    await assert.rejects(simulate(item, wrongBalance), /balance change/);
    const wrongGas = clone(item.simulation); effects(wrongGas).gasEffects.gasSummary.computationCost++;
    await assert.rejects(simulate(item, wrongGas), /Gas coin balances/);
  });

  test(`${action} known gas-only failure grants retry metadata only for the exact action and unchanged state`, async () => {
    const item = makeConfirmedCareFailure(copiedCase(f[action]));
    await assert.rejects(confirm(item), error => {
      assert.equal(error.code, 'TRANSACTION_FAILED');
      assert.equal(error.confirmedFailure?.permitsRetry, true);
      assert.equal(error.confirmedFailure?.kindSha256, item.packet.kindSha256);
      assert.equal(error.confirmedFailure?.digest, item.digest); return true;
    });
    const uncertain = clone(item.confirmation); effects(uncertain).events.nodes.push(clone(effects(f[action].simulation).events.nodes[0]));
    await assert.rejects(confirm(item, uncertain), error => error.code === 'TRANSACTION_FAILED' && !error.confirmedFailure);
  });
}

test('plant rejects wrong owner-index append, changed NFT, wrong seed season, and extra field-table growth', async () => {
  const item = f.plant, seedId = item.seedId, indexId = item.fields.seedsByOwner.address;
  const mutations = [
    raw => { contents(objectChange(raw, indexId).outputState).value = [seedId]; },
    raw => { contents(objectChange(raw, EXPECTED.previousNftId).outputState).name = 'Modified NFT'; },
    raw => { contents(objectChange(raw, seedId).outputState).season_id = '1'; },
    raw => { contents(objectChange(raw, EXPECTED.registryId).outputState).planted_saplings.size = '2'; },
    raw => { objectChange(raw, item.fields.playerGrowth.address).inputState.digest = item.digest; },
  ];
  for (const mutate of mutations) { const raw = clone(item.simulation); mutate(raw); await assert.rejects(simulate(item, raw)); }
});

test('watering rejects wrong Seed, premature execution, altered points, and unexpected extra action events', async () => {
  const item = f.water, mutations = [
    raw => { contents(objectChange(raw, item.seedId).outputState).id = EXPECTED.previousSeedId; },
    raw => { contents(effects(raw).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(Number(f.plant.receipt.waterReadyMs) - 1); },
    raw => { contents(objectChange(raw, item.seedId).outputState).growth_points = '25'; },
    raw => { effects(raw).events.nodes.push(clone(effects(raw).events.nodes[0])); },
  ];
  for (const mutate of mutations) { const raw = clone(item.simulation); mutate(raw); await assert.rejects(simulate(item, raw)); }
});

test('claim rejects wrong eligible points, transferred Seed, changed reward coin, or premature execution', async () => {
  const item = f.claim, rewardId = item.receipt.rewardCoinId, mutations = [
    raw => { contents(objectChange(raw, EXPECTED.registryId).outputState).settlement.eligible_growth_points = '25'; },
    raw => { objectChange(raw, item.seedId).outputState.owner.address.address = EXPECTED.treasuryWallet; },
    raw => { contents(objectChange(raw, rewardId).outputState).balance = '7000001'; },
    raw => { contents(effects(raw).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(Number(f.cycle.cutoffMs) - 1); },
  ];
  for (const mutate of mutations) { const raw = clone(item.simulation); mutate(raw); await assert.rejects(simulate(item, raw)); }
});

test('all care outputs must use the exact Lamport version implied by their actual inputs', async () => {
  for (const action of ['plant', 'water', 'claim']) {
    const item = f[action], raw = clone(item.simulation); effects(raw).lamportVersion++;
    for (const change of effects(raw).objectChanges.nodes) if (change.outputState) change.outputState.version++;
    await assert.rejects(simulate(item, raw), /Lamport version differs/);
  }
});

test('processed 0 GP is a completed reward, and a second claim is unavailable', async () => {
  const current = await currentState(f.claim), state = care.inspectCare(current, f.cycle, f.plant.receipt, options(f.claim));
  assert.equal(state.status, 'claimed'); assert.equal(state.rewardProcessed, true);
  assert.equal(state.growthPoints, '0'); assert.equal(state.eligibleGrowthPoints, '24');
  await assert.rejects(care.prepareClaim(current, f.cycle, f.plant.receipt, options(f.claim)), /not currently claimable/);
});

test('planting and first-water receipts can be reverified after the Seed has completed its claim', async () => {
  for (const item of [f.plant, f.water]) {
    const raw = clone(f.claim.confirmation); raw.data.transaction = clone(item.confirmation.data.transaction);
    const checked = await care[`validateConfirmed${nameOf(item.action)}`](raw, item.digest, f.claim.proof,
      ...context(item), options(f.claim));
    assert.equal(checked.hasAdvanced, true); assert.equal(checked.status, 'confirmed');
  }
});

test('a real-shaped late planting receipt remains recoverable even though new late planting is disabled', async () => {
  const late = Number(f.cycle.cutoffMs) - 1000, raw = clone(f.plant.confirmation), proof = clone(f.plant.proof);
  for (const checkpoint of [raw.data.checkpoint, raw.data.transaction.effects.checkpoint, proof.data.checkpoint])
    checkpoint.timestamp = new Date(late).toISOString();
  contents(raw.data.clock).timestamp_ms = String(late);
  contents(effects(raw).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(late);
  for (const seed of [objectChange(raw, f.plant.seedId).outputState, raw.data.ownedSeeds.nodes.find(x => x.address === f.plant.seedId)])
    Object.assign(contents(seed), { planted_at_ms: String(late), last_watered_ms: String(late) });
  const receipt = await care.validateConfirmedPlant(raw, f.plant.digest, proof, f.cycle, { nowMs: late });
  assert.equal(receipt.canWaterBeforeCutoff, false);
  const claimAt = Number(f.cycle.cutoffMs), live = careLiveInput(raw, claimAt);
  proof.data.checkpoint.timestamp = new Date(claimAt).toISOString();
  const current = await inspectState(live, proof, { nowMs: claimAt });
  assert.equal(care.inspectCare(current, f.cycle, receipt, { nowMs: claimAt }).status, 'claim-ready');
  assert.equal((await care.prepareClaim(current, f.cycle, receipt, { nowMs: claimAt })).eligibleGrowthPoints, '10');
});

test('direct 10-GP claim uses cutoff eligibility despite post-season dryness and supports address-balance gas', async () => {
  const fixture = await createCareFixtures({ growthPoints: '10', gasMode: 'address' });
  for (const action of ['plant', 'water', 'claim']) assert.equal((await simulate(fixture[action])).status, 'simulated');
  assert.equal(fixture.claim.receipt.eligibleGrowthPoints, '10'); assert.equal(fixture.claim.receipt.rewardMist, '7000000');
  assert.equal(fixture.claim.receipt.growthPoints, '0'); assert.equal(fixture.claim.receipt.rewardProcessed, true);
});

test('a paused season and already finalized eligible settlement still allow reward processing', async () => {
  const fixture = await createCareFixtures({ paused: true, finalized: true });
  assert.equal(care.inspectCare(fixture.claim.state, fixture.cycle, fixture.plant.receipt, options(fixture.claim)).status, 'claim-ready');
  const result = await simulate(fixture.claim); assert.equal(result.finalizedByClaim, false); assert.equal(result.rewardMist, '7000000');
});

test('zero-pool claim processes entitlement without inventing a reward coin, while negative gas is retained honestly', async () => {
  const zero = await createCareFixtures({ poolMist: '0' });
  assert.equal((await simulate(zero.claim)).rewardMist, '0'); assert.equal(zero.claim.receipt.rewardCoinId, null);
  assert.ok(BigInt(zero.claim.receipt.netReceiveMist) < 0n);
  const rebate = await createCareFixtures({ gasNetMist: '-100000' });
  assert.equal((await simulate(rebate.claim)).gasEstimateMist, '-100000');
  assert.equal(rebate.claim.receipt.gasEstimateSui, '-0.000100000'); assert.equal(rebate.claim.receipt.netReceiveMist, '7100000');
});

test('unknown extra spending on a failed receipt never grants retry metadata', async () => {
  const item = makeConfirmedCareFailure(copiedCase(f.claim));
  effects(item.confirmation).balanceChangesJson.push({ address: EXPECTED.treasuryWallet, coinType: SUI_TYPE, amount: '1' });
  await assert.rejects(confirm(item), error => error.code === 'TRANSACTION_FAILED' && !error.confirmedFailure);
});

test('a known failed claim after the deadline remains recognizable but cannot authorize a retry', async () => {
  const item = makeConfirmedCareFailure(copiedCase(f.claim));
  const later = Number(f.cycle.claimDeadlineMs) + 1;
  const current = careLiveInput(item.confirmation, later); current.data.transaction = item.confirmation.data.transaction;
  const proof = clone(item.proof); proof.data.checkpoint.timestamp = new Date(later).toISOString();
  await assert.rejects(care.validateConfirmedClaim(current, item.digest, proof, f.cycle, f.plant.receipt, { nowMs: later }),
    error => error.code === 'TRANSACTION_FAILED' && error.confirmedFailure?.permitsRetry === false && error.confirmedFailure.currentStatus === 'expired');
});

test('care validation never requires fetch, a wallet, signing, or transaction submission', async () => {
  const original = globalThis.fetch; globalThis.fetch = () => { throw new Error('Unexpected network access.'); };
  try { for (const action of ['plant', 'water', 'claim']) { await simulate(f[action]); await confirm(f[action]); } }
  finally { globalThis.fetch = original; }
});
