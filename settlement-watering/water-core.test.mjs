import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase64, fromBase58, fromHex, toHex, toBase58 } from '@mysten/bcs';
import { parse, visit } from 'graphql';
import { EXPECTED, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY, contents, inspectWaterState,
  buildReviewedWater, validateWalletTransaction, validateSimulation, validateConfirmedWater,
  assertExpectedOrigin, assertAdministrator } from './water-core.mjs';
import { createWaterFixtures, observedWaterInput } from './water-fixtures.mjs';

const clone = value => structuredClone(value), OTHER = '0x' + 'e'.repeat(64);
const opts = f => ({ nowMs: f.now });
const effects = f => f.simulation.data.simulateTransaction.effects;
const change = (f, id) => effects(f).objectChanges.nodes.find(x => x.address === id);
const originalFetch = globalThis.fetch; let fetchAttempts = 0;
before(() => { globalThis.fetch = async () => { fetchAttempts++; throw Error('Offline tests must not fetch.'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(fetchAttempts, 0); });
async function simulate(f) { return validateSimulation(f.simulation, f.packet, inspectWaterState(f.inputs, opts(f)), opts(f)); }
async function rejectSimulation(mutate, pattern) { const f = await createWaterFixtures(); await mutate(f); await assert.rejects(() => simulate(f), pattern); }
async function rejectReceipt(mutate, pattern) { const f = await createWaterFixtures(); await mutate(f); await assert.rejects(() => validateConfirmedWater(f.confirmation, f.digest, opts(f)), pattern); }
function changeTx(f, mutate) {
  const value = bcs.TransactionData.parse(fromBase64(effects(f).transaction.transactionBcs));
  mutate(value.V1); effects(f).transaction.transactionBcs = bcs.TransactionData.serialize(value).toBase64();
}

test('captured mainnet state is still waiting with 10 GP and an exact DST-aware watering window', () => {
  const observed = observedWaterInput(), state = inspectWaterState(observed, { nowMs: Date.parse(observed.capturedAt) });
  assert.equal(state.status, 'waiting'); assert.equal(state.growthPoints, '10'); assert.equal(state.wateringStreak, '1');
  assert.equal(state.seed.previousTransaction.digest, EXPECTED.plantDigest);
  assert.equal(BigInt(EXPECTED.waterReadyMs) - BigInt(EXPECTED.plantedAtMs), 77760000n);
  assert.equal(new Date(Number(EXPECTED.waterReadyMs)).toISOString(), '2026-11-01T20:16:41.252Z');
  assert.equal(new Date(Number(EXPECTED.cutoffMs)).toISOString(), '2026-11-01T21:57:28.277Z');
  assert.equal(Number(EXPECTED.cutoffMs) - Number(EXPECTED.waterReadyMs), 6047025);
});

test('all exported requests are bounded read queries and simulation has checks enabled', () => {
  for (const query of [INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    const ast = parse(query); assert.equal(ast.definitions[0].operation, 'query');
    let fields = 0; visit(ast, { Field() { fields++; } }); assert.ok(fields < 300);
    assert.doesNotMatch(query, /executeTransaction|ownedNFTs|plant_seed/);
  }
  assert.match(SIMULATION_QUERY, /checksEnabled:true/); assert.match(SIMULATION_QUERY, /doGasSelection:true/);
});

test('origin, wallet account and mainnet guards remain explicit', () => {
  assertExpectedOrigin(EXPECTED.origin); assertAdministrator(EXPECTED.sender);
  assert.throws(() => assertExpectedOrigin('https://example.org'), /treegrow/);
  assert.throws(() => assertAdministrator(OTHER), /administrator/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
});

test('the cooldown opens at the exact millisecond and the season closes at its cutoff', async () => {
  const f = await createWaterFixtures();
  for (const [time, expected] of [[BigInt(EXPECTED.waterReadyMs) - 1n, 'waiting'], [BigInt(EXPECTED.waterReadyMs), 'ready'],
    [BigInt(EXPECTED.cutoffMs) - 1n, 'ready'], [BigInt(EXPECTED.cutoffMs), 'closed']]) {
    contents(f.inputs.data.clock).timestamp_ms = String(time); f.inputs.data.checkpoint.timestamp = new Date(Number(time)).toISOString();
    const state = inspectWaterState(f.inputs, { nowMs: Number(time) }); assert.equal(state.status, expected);
    if (expected !== 'ready') await assert.rejects(() => buildReviewedWater(state), /Wait until/);
  }
});

test('one gas-only water_seed call contains no payment, NFTree, referral, admin capability or gas override', async () => {
  const f = await createWaterFixtures(), data = f.packet.transaction.getData();
  assert.equal(await validateWalletTransaction(f.packet.transaction, f.packet), true);
  assert.equal(data.commands.length, 1); assert.equal(data.commands[0].MoveCall.function, 'water_seed');
  assert.equal(data.commands[0].MoveCall.arguments.length, 3); assert.deepEqual(data.commands[0].MoveCall.typeArguments, []);
  assert.equal(data.inputs.length, 3); assert.equal(data.expiration, null); assert.ok(Object.values(data.gasData).every(x => x === null));
  assert.equal(EXPECTED.priceMist, '0');
});

test('extra calls, changed packets and application-selected gas cannot reach wallet handoff', async () => {
  const f = await createWaterFixtures(); f.packet.transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::water_seed`, arguments: [] });
  await assert.rejects(() => validateWalletTransaction(f.packet.transaction, f.packet), /exact single watering/);
  const g = await createWaterFixtures(); g.packet.transaction.setGasBudget(1);
  await assert.rejects(() => validateWalletTransaction(g.packet.transaction, g.packet), /gas and expiration/);
  const h = await createWaterFixtures(); h.packet.kindSha256 = '0'.repeat(64);
  await assert.rejects(() => validateWalletTransaction(h.packet.transaction, h.packet), /hash differs/);
  const j = await createWaterFixtures(); j.packet.seedReference.objectId = OTHER;
  await assert.rejects(() => validateWalletTransaction(j.packet.transaction, j.packet), /Wrong Seed/);
});

test('wrong owner, package, Registry and planting time fail before preparing a transaction', async () => {
  const changes = [
    f => { f.inputs.data.seed.owner.address.address = OTHER; },
    f => { f.inputs.data.seed.asMoveObject.contents.type.repr = `${OTHER}::settlement::Seed`; },
    f => { contents(f.inputs.data.seed).registry_id = OTHER; },
    f => { contents(f.inputs.data.seed).planted_at_ms = '1'; },
    f => { f.inputs.data.genesis.digest = '11111111111111111111111111111111'; },
  ];
  for (const mutate of changes) { const f = await createWaterFixtures(); mutate(f); assert.throws(() => inspectWaterState(f.inputs, opts(f))); }
});

test('stale clocks, stale checkpoints and tool-altered Seeds cannot authorize normal watering', async () => {
  for (const mutate of [
    f => { contents(f.inputs.data.clock).timestamp_ms = String(f.now - EXPECTED.maxAgeMs - 1); },
    f => { f.inputs.data.checkpoint.timestamp = new Date(f.now - EXPECTED.maxAgeMs - 1).toISOString(); },
    f => { contents(f.inputs.data.seed).fertilizer_charges = 1; },
    f => { contents(f.inputs.data.seed).bottomless_can_expiry_ms = String(f.now + 1000); },
    f => { contents(f.inputs.data.seed).permanent_gp_bonus = '5'; },
  ]) { const f = await createWaterFixtures(); mutate(f); assert.throws(() => inspectWaterState(f.inputs, opts(f))); }
});

test('paused, processed and completed seasons report closed without offering another watering', async () => {
  for (const mutate of [f => { contents(f.inputs.data.registry).paused = true; },
    f => { contents(f.inputs.data.seed).reward_processed = true; }, f => { contents(f.inputs.data.registry).current_season_id = '2'; }]) {
    const f = await createWaterFixtures(); mutate(f); assert.equal(inspectWaterState(f.inputs, opts(f)).status, 'closed');
  }
});

test('synthetic future success validates 10→24 GP, streak 1→2, unchanged pool and gas-only balance', async () => {
  const f = await createWaterFixtures(), result = await simulate(f);
  assert.equal(f.synthetic, true); assert.equal(result.status, 'simulated');
  assert.equal(result.previousGrowthPoints, '10'); assert.equal(result.growthPoints, '24'); assert.equal(result.wateringStreak, '2');
  assert.equal(result.appChargeMist, '0'); assert.equal(result.gasEstimateMist, '100651'); assert.equal(result.gasEstimateSui, '0.000100651');
  assert.equal(result.kindSha256, f.packet.kindSha256);
});

test('failed, too-early, cutoff and stale-input simulations cannot be mistaken for success', async () => {
  await rejectSimulation(f => { effects(f).status = 'FAILURE'; effects(f).executionError = { message: 'abort code: 5' }; }, /abort code: 5/);
  await rejectSimulation(f => { contents(effects(f).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(BigInt(EXPECTED.waterReadyMs) - 1n); }, /outside the allowed/);
  await rejectSimulation(f => { f.simulation.data.seed.version++; }, /reference changed/);
  await rejectSimulation(f => { f.packet.simulationTransaction.kind.programmableTransaction.commands.push(clone(f.packet.simulationTransaction.kind.programmableTransaction.commands[0])); }, /proposal differs/);
});

test('only exact watering effects, player record and event are accepted', async () => {
  await rejectSimulation(f => { contents(change(f, EXPECTED.seedId).outputState).growth_points = '25'; }, /Unexpected Seed/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.registryId).outputState).reward_pool = '7000001'; }, /Unexpected Registry/);
  await rejectSimulation(f => { effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => x.address !== f.fieldId); }, /player Growth Points record is missing/);
  await rejectSimulation(f => { contents(change(f, f.fieldId).outputState).value = '25'; }, /Wrong player Growth/);
  await rejectSimulation(f => { effects(f).events.nodes[0].contents.json.streak = '3'; }, /watering event/);
  await rejectSimulation(f => { effects(f).objectChanges.pageInfo.hasNextPage = true; }, /Incomplete watering/);
});

test('extra spend, recipient, object creation or transaction command is rejected', async () => {
  await rejectSimulation(f => { effects(f).balanceChangesJson[0].amount = '-1000651'; }, /network gas only/);
  await rejectSimulation(f => { effects(f).balanceChangesJson.push({ ...effects(f).balanceChangesJson[0], address: OTHER, amount: '1000000' }); }, /Only the watering sender/);
  await rejectSimulation(f => { change(f, f.gasId).idCreated = true; }, /Unexpected object/);
  await rejectSimulation(f => changeTx(f, x => { x.sender = OTHER; }), /Wrong watering sender/);
  await rejectSimulation(f => changeTx(f, x => { x.kind.ProgrammableTransaction.commands.push(clone(x.kind.ProgrammableTransaction.commands[0])); }), /commands differ/);
});

test('gas-owner mismatch and non-chain-bound empty gas payments are rejected', async () => {
  await rejectSimulation(f => changeTx(f, x => { x.gasData.owner = OTHER; }), /Wrong gas owner/);
  await rejectSimulation(f => changeTx(f, x => { x.gasData.payment = []; }), /mainnet-bound expiration/);
});

test('a storage rebate is accounted as a net gas credit and cannot hide another payment', async () => {
  const f = await createWaterFixtures(); effects(f).gasEffects.gasSummary.storageRebate = 7000000;
  effects(f).balanceChangesJson[0].amount = '386800';
  contents(change(f, f.gasId).outputState).balance = '1000386800';
  const result = await simulate(f); assert.equal(result.gasEstimateMist, '-386800'); assert.equal(result.gasEstimateSui, '-0.000386800');
});

function useVirtualGas(f) {
  const reservation = new Uint8Array(32).fill(0xac), view = new DataView(reservation.buffer);
  view.setBigUint64(0, 1000000n, true); view.setUint32(8, 1300, true);
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const owner = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  const objectId = '0x' + toHex(owner.map((v, i) => v ^ chain[i]));
  changeTx(f, data => {
    data.expiration = { ValidDuring: { minEpoch: '1300', maxEpoch: '1301', minTimestamp: null, maxTimestamp: null,
      chain: EXPECTED.genesisDigest, nonce: 123 } };
    data.gasData.payment = [{ objectId, version: '0', digest: toBase58(reservation) }];
  });
  effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => x.address !== f.gasId);
}

test('wallet address-balance reservations are accepted only for this owner, chain and epoch', async () => {
  const f = await createWaterFixtures(); useVirtualGas(f);
  assert.equal((await simulate(f)).virtualGasReservations, 1);
  for (const [mutate, pattern] of [
    [data => { data.gasData.payment[0].objectId = OTHER; }, /another owner or network/],
    [data => { data.expiration.ValidDuring.chain = '11111111111111111111111111111111'; }, /Wrong expiration chain/],
    [data => { data.expiration.ValidDuring.maxEpoch = '1305'; }, /expiration window/],
    [data => { data.gasData.payment[0].digest = '11111111111111111111111111111111'; }, /reservation digest/],
  ]) {
    const g = await createWaterFixtures(); useVirtualGas(g); changeTx(g, mutate);
    await assert.rejects(() => simulate(g), pattern);
  }
});

test('synthetic confirmed receipt binds digest, exact call, actual effects and current output', async () => {
  const f = await createWaterFixtures(), result = await validateConfirmedWater(f.confirmation, f.digest, opts(f));
  assert.equal(result.status, 'confirmed'); assert.equal(result.digest, f.digest); assert.equal(result.growthPoints, '24');
  assert.equal(result.hasAdvanced, false); assert.equal(result.exactKindSha256, f.packet.kindSha256);
  const live = clone(f.confirmation); delete live.data.transaction;
  const state = inspectWaterState(live, opts(f)); assert.equal(state.status, 'watered'); assert.equal(state.digestCandidate, f.digest);
  await assert.rejects(() => buildReviewedWater(state), /Wait until/);
});

test('missing checkpoint, wrong digest, failed effects and altered output fail confirmation', async () => {
  await rejectReceipt(f => { f.confirmation.data.transaction.effects.checkpoint = null; }, /not yet indexed/);
  await rejectReceipt(f => { f.confirmation.data.transaction.digest = EXPECTED.plantDigest; }, /digest differs/);
  await rejectReceipt(f => { f.confirmation.data.transaction.effects.status = 'FAILURE'; }, /lacks its execution error/);
  await rejectReceipt(f => { contents(f.confirmation.data.seed).growth_points = '25'; }, /contents differ/);
  await rejectReceipt(f => { f.confirmation.simulatedIdsAreNotDeployedIds = true; }, /Simulation cannot/);
});

test('later state is separate from the immutable first-watering receipt', async () => {
  const f = await createWaterFixtures(); f.confirmation.data.registry.version++; f.confirmation.data.seed.version++;
  contents(f.confirmation.data.seed).growth_points = '0'; contents(f.confirmation.data.seed).cutoff_growth_points = '0';
  contents(f.confirmation.data.seed).reward_processed = true;
  const result = await validateConfirmedWater(f.confirmation, f.digest, opts(f));
  assert.equal(result.growthPoints, '24'); assert.equal(result.hasAdvanced, true);
});

function makeConfirmedFailure(f) {
  const data = f.confirmation.data, effects = data.transaction.effects;
  effects.status = 'FAILURE'; effects.executionError = { message: 'Synthetic confirmed Move abort for offline recovery test.' };
  effects.events.nodes = [];
  for (const change of effects.objectChanges.nodes.filter(x => x.address !== f.gasId)) {
    change.outputState.asMoveObject.contents.json = clone(contents(change.inputState));
    if (change.address === EXPECTED.seedId) data.seed = { ...clone(change.outputState), previousTransaction: { digest: f.digest } };
    if (change.address === EXPECTED.registryId) data.registry = { ...clone(change.outputState), previousTransaction: { digest: f.digest } };
  }
}

test('only a fully verified failed receipt exposes explicit retry metadata bound to digest and kind', async () => {
  const f = await createWaterFixtures(); makeConfirmedFailure(f);
  await assert.rejects(() => validateConfirmedWater(f.confirmation, f.digest, opts(f)), error => {
    assert.equal(error.code, 'TRANSACTION_FAILED'); assert.equal(error.confirmedFailure.status, 'failed');
    assert.equal(error.confirmedFailure.digest, f.digest); assert.equal(error.confirmedFailure.kindSha256, f.packet.kindSha256);
    assert.equal(error.confirmedFailure.permitsRetry, true); assert.equal(error.confirmedFailure.currentStatus, 'ready');
    assert.equal(error.confirmedFailure.gasEstimateMist, '100651'); return true;
  });
});

test('verified failure outside the watering window never grants retry permission', async () => {
  for (const [time, status] of [[Number(EXPECTED.waterReadyMs) - 1, 'waiting'], [Number(EXPECTED.cutoffMs), 'closed']]) {
    const f = await createWaterFixtures(); makeConfirmedFailure(f); f.now = time;
    for (const cp of [f.confirmation.data.checkpoint, f.confirmation.data.transaction.effects.checkpoint]) cp.timestamp = new Date(time).toISOString();
    contents(f.confirmation.data.clock).timestamp_ms = String(time);
    await assert.rejects(() => validateConfirmedWater(f.confirmation, f.digest, opts(f)), error => {
      assert.equal(error.code, 'TRANSACTION_FAILED'); assert.equal(error.confirmedFailure.currentStatus, status);
      assert.equal(error.confirmedFailure.permitsRetry, false); return true;
    });
  }
});

test('unknown failure, gameplay effects, foreign spend or a later successful water never unlock retry', async () => {
  for (const mutate of [
    f => { f.confirmation.data.transaction.effects.events.nodes = clone(effects(f).events.nodes); },
    f => { f.confirmation.data.transaction.effects.balanceChangesJson[0].amount = '-1000651'; },
    f => { contents(f.confirmation.data.seed).growth_points = '24'; contents(f.confirmation.data.seed).last_watered_ms = String(f.now); },
    f => { f.confirmation.data.transaction.effects.objectChanges.nodes.find(x => x.address === EXPECTED.seedId).outputState.asMoveObject.contents.json.growth_points = '24'; },
    f => { f.confirmation.data.transaction.effects.checkpoint = null; },
  ]) {
    const f = await createWaterFixtures(); makeConfirmedFailure(f); mutate(f);
    await assert.rejects(() => validateConfirmedWater(f.confirmation, f.digest, opts(f)), error => {
      assert.equal(error.confirmedFailure, undefined); return true;
    });
  }
});
