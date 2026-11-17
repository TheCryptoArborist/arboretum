import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase64, fromBase58, fromHex, toHex, toBase58 } from '@mysten/bcs';
import { parse, visit } from 'graphql';
import { EXPECTED, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES,
  contents, inspectClaimState, buildReviewedClaim, validateWalletTransaction, validateSimulation, validateConfirmedClaim,
  assertExpectedOrigin, assertAdministrator } from './claim-core.mjs';
import { createClaimFixtures, observedClaimInput, observedClaimSimulation, makeConfirmedClaimFailure } from './claim-fixtures.mjs';

const clone = value => structuredClone(value), OTHER = '0x' + 'e'.repeat(64);
const opts = f => ({ nowMs: f.now });
const effects = f => f.simulation.data.simulateTransaction.effects;
const change = (f, id) => effects(f).objectChanges.nodes.find(x => x.address === id);
const originalFetch = globalThis.fetch; let fetchAttempts = 0;
before(() => { globalThis.fetch = async () => { fetchAttempts++; throw Error('Offline core tests must not fetch.'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(fetchAttempts, 0); });
async function simulate(f) { return validateSimulation(f.simulation, f.packet, inspectClaimState(f.inputs, opts(f)), opts(f)); }
async function rejectSimulation(mutate, pattern) { const f = await createClaimFixtures(); await mutate(f); await assert.rejects(() => simulate(f), pattern); }
async function rejectReceipt(mutate, pattern) { const f = await createClaimFixtures(); await mutate(f); await assert.rejects(() => validateConfirmedClaim(f.confirmation, f.digest, opts(f)), pattern); }
function changeTx(f, mutate) {
  const value = bcs.TransactionData.parse(fromBase64(effects(f).transaction.transactionBcs));
  mutate(value.V1); effects(f).transaction.transactionBcs = bcs.TransactionData.serialize(value).toBase64();
}
function setLiveTime(response, time) {
  contents(response.data.clock).timestamp_ms = String(time); response.data.checkpoint.timestamp = new Date(Number(time)).toISOString();
}

test('real unsigned mainnet simulation proves 0.007 SUI gross and 0.005424949 SUI after its network fee', async () => {
  const input = observedClaimInput(), capture = observedClaimSimulation(), options = { nowMs: Date.parse(input.capturedAt) };
  const state = inspectClaimState(input, options), packet = await buildReviewedClaim(state);
  assert.equal(state.status, 'ready'); assert.equal(state.growthPoints, '10'); assert.equal(state.wateringStreak, '1');
  assert.equal(state.seed.previousTransaction.digest, EXPECTED.plantDigest);
  assert.equal(capture.realSignatures, 0); assert.equal(capture.realTransactionsSubmitted, 0);
  const result = await validateSimulation(capture, packet, state, options);
  assert.equal(result.status, 'simulated'); assert.equal(result.rewardMist, '7000000');
  assert.equal(result.gasEstimateMist, '1575051'); assert.equal(result.netReceiveMist, '5424949');
  assert.equal(result.finalizedByClaim, true); assert.equal(result.growthPoints, '0'); assert.equal(result.rewardProcessed, true);
  assert.equal(result.kindSha256, 'd41721d878a2b77c073e642216d4ae6a8f7a984c9f59356bb1846c4b08e58492');
  assert.equal(Transaction.from(capture.response.data.simulateTransaction.effects.transaction.transactionBcs).getData().gasData.payment.length, 0);
  await assert.rejects(() => validateConfirmedClaim(capture, EXPECTED.plantDigest, options), /Simulation cannot/);
});

test('all public requests are bounded read queries and simulation enables transaction checks', () => {
  assert.deepEqual(INPUT_VARIABLES, { registry: EXPECTED.registryId, seed: EXPECTED.seedId });
  assert.deepEqual(CONFIRM_VARIABLES, INPUT_VARIABLES);
  for (const query of [INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    const ast = parse(query); assert.equal(ast.definitions[0].operation, 'query');
    let fields = 0; visit(ast, { Field() { fields++; } }); assert.ok(fields < 300);
    assert.doesNotMatch(query, /executeTransaction|ownedNFTs|claim_archived_reward|plant_seed/);
  }
  assert.match(SIMULATION_QUERY, /checksEnabled:true/); assert.match(SIMULATION_QUERY, /doGasSelection:true/);
});

test('mainnet, exact origin and the pinned owner are required', () => {
  assertExpectedOrigin(EXPECTED.origin); assertAdministrator(EXPECTED.sender);
  assert.throws(() => assertExpectedOrigin('https://example.org'), /treegrow/);
  assert.throws(() => assertAdministrator(OTHER), /administrator/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
});

test('claim opens exactly at cutoff and remains open through the exact seven-day deadline', async () => {
  const f = await createClaimFixtures();
  assert.equal(BigInt(EXPECTED.claimDeadlineMs) - BigInt(EXPECTED.cutoffMs), 604800000n);
  assert.equal(new Date(Number(EXPECTED.claimDeadlineMs)).toISOString(), '2026-11-08T21:57:28.277Z');
  for (const [time, status] of [[BigInt(EXPECTED.cutoffMs) - 1n, 'waiting'], [BigInt(EXPECTED.cutoffMs), 'ready'],
    [BigInt(EXPECTED.claimDeadlineMs), 'ready'], [BigInt(EXPECTED.claimDeadlineMs) + 1n, 'expired']]) {
    setLiveTime(f.inputs, time); const state = inspectClaimState(f.inputs, { nowMs: Number(time) }); assert.equal(state.status, status);
    if (status === 'ready') assert.equal((await buildReviewedClaim(state)).seedId, EXPECTED.seedId);
    else await assert.rejects(() => buildReviewedClaim(state), /claim window/);
  }
});

test('post-season wilting and death by current time do not erase cutoff Growth Points', async () => {
  const f = await createClaimFixtures();
  for (const [time, status] of [[BigInt(EXPECTED.plantedAtMs) + 7n * 86400000n, 'ready'],
    [BigInt(EXPECTED.plantedAtMs) + 10n * 86400000n, 'expired']]) {
    setLiveTime(f.inputs, time); const state = inspectClaimState(f.inputs, { nowMs: Number(time) });
    assert.equal(state.status, status); assert.equal(state.eligibleGrowthPoints, '10'); assert.equal(state.rewardMist, '7000000');
  }
});

test('10 or valid first-water 24 GP earns the whole single-Seed pool, including while gameplay is paused', async () => {
  for (const growthPoints of ['10', '24']) {
    const f = await createClaimFixtures({ growthPoints, paused: true }), state = inspectClaimState(f.inputs, opts(f));
    assert.equal(state.status, 'ready'); assert.equal(state.paused, true); assert.equal(state.eligibleGrowthPoints, growthPoints);
    const result = await simulate(f); assert.equal(result.rewardMist, '7000000'); assert.equal(result.previousGrowthPoints, growthPoints);
    assert.equal(result.growthPoints, '0'); assert.equal(result.netReceiveMist, '5424949');
  }
});

test('an already-finalized snapshot is used unchanged without a duplicate finalization event', async () => {
  const f = await createClaimFixtures({ finalized: true, growthPoints: '24' });
  assert.equal(f.state.settlementFinalized, true); assert.equal(effects(f).events.nodes.length, 2);
  const result = await simulate(f); assert.equal(result.finalizedByClaim, false); assert.equal(result.rewardMist, '7000000');
  effects(f).events.nodes.unshift(clone(observedClaimSimulation().response.data.simulateTransaction.effects.events.nodes[0]));
  await assert.rejects(() => simulate(f), /Unexpected reward claim events/);
});

test('reward review uses the actual frozen pool and exact integer arithmetic', async () => {
  const poolMist = '9007199254740993', f = await createClaimFixtures({ poolMist, finalized: true });
  assert.equal(f.state.rewardMist, poolMist);
  const result = await simulate(f); assert.equal(result.rewardMist, poolMist);
  assert.equal(result.netReceiveMist, String(BigInt(poolMist) - 1575051n));
});

test('wrong Seed, owner, package, Registry, network or planting time cannot authorize a claim', async () => {
  for (const mutate of [
    f => { f.inputs.data.seed.address = OTHER; },
    f => { f.inputs.data.seed.owner.address.address = OTHER; },
    f => { f.inputs.data.seed.asMoveObject.contents.type.repr = `${OTHER}::settlement::Seed`; },
    f => { contents(f.inputs.data.seed).registry_id = OTHER; },
    f => { contents(f.inputs.data.seed).planted_at_ms = '1'; },
    f => { f.inputs.data.registry.owner.initialSharedVersion++; },
    f => { contents(f.inputs.data.registry).admin = OTHER; },
    f => { f.inputs.data.genesis.digest = '11111111111111111111111111111111'; },
  ]) { const f = await createClaimFixtures(); mutate(f); assert.throws(() => inspectClaimState(f.inputs, opts(f))); }
});

test('unexpected care, tool changes, population or denominator fail closed', async () => {
  for (const mutate of [
    f => { contents(f.inputs.data.seed).growth_points = '11'; },
    f => { contents(f.inputs.data.seed).cutoff_growth_points = '0'; },
    f => { contents(f.inputs.data.seed).state = 2; },
    f => { contents(f.inputs.data.seed).fertilizer_charges = 1; },
    f => { contents(f.inputs.data.seed).miracle_grow_applied = true; },
    f => { contents(f.inputs.data.seed).bottomless_can_expiry_ms = '1'; },
    f => { contents(f.inputs.data.seed).permanent_gp_bonus = '1'; },
    f => { contents(f.inputs.data.registry).total_seeds = '2'; },
    f => { contents(f.inputs.data.registry).eligible_growth_points = '11'; },
    f => { contents(f.inputs.data.registry).seeds_by_owner.size = '2'; },
  ]) { const f = await createClaimFixtures(); mutate(f); assert.throws(() => inspectClaimState(f.inputs, opts(f))); }
});

test('archived or replaced seasons stay closed without switching to another claim route', async () => {
  const f = await createClaimFixtures(); contents(f.inputs.data.registry).current_season_id = '2';
  const state = inspectClaimState(f.inputs, opts(f)); assert.equal(state.status, 'closed'); assert.equal(state.rewardMist, null);
  await assert.rejects(() => buildReviewedClaim(state), /claim window/);
});

test('frozen deadline, original pool, denominator and permanent accounting must agree', async () => {
  for (const mutate of [
    r => { r.settlement.claim_deadline_ms = String(BigInt(EXPECTED.claimDeadlineMs) + 1n); },
    r => { r.settlement.season_id = '2'; },
    r => { r.settlement.season_end_ms = '1'; },
    r => { r.settlement.pool_mist = '7000001'; },
    r => { r.settlement.eligible_growth_points = '9'; },
    r => { r.settlement.paid_mist = '1'; },
    r => { r.settlement.processed_growth_points = '1'; },
    r => { r.settlement.processed_seeds = '1'; },
    r => { r.settlement = []; },
  ]) { const f = await createClaimFixtures({ finalized: true }); mutate(contents(f.inputs.data.registry)); assert.throws(() => inspectClaimState(f.inputs, opts(f))); }
});

test('stale clocks, checkpoints, ambiguous wrappers and partial reads cannot pass review', async () => {
  for (const mutate of [
    f => { contents(f.inputs.data.clock).timestamp_ms = String(f.now - EXPECTED.maxAgeMs - 1); },
    f => { f.inputs.data.checkpoint.timestamp = new Date(f.now - EXPECTED.maxAgeMs - 1).toISOString(); },
    f => { f.inputs.data.checkpoint.timestamp = new Date(f.now - 1).toISOString(); },
    f => { f.inputs.data.clock.owner.initialSharedVersion = 2; },
    f => { f.inputs.errors = [{ message: 'partial result' }]; },
    f => { f.inputs.response = clone(f.inputs); },
  ]) { const f = await createClaimFixtures(); mutate(f); assert.throws(() => inspectClaimState(f.inputs, opts(f))); }
});

test('the reviewed transaction contains only claim_reward with the exact three inputs and wallet-owned gas', async () => {
  const f = await createClaimFixtures(), data = f.packet.transaction.getData();
  assert.equal(await validateWalletTransaction(f.packet.transaction, f.packet), true);
  assert.equal(data.commands.length, 1); assert.equal(data.commands[0].MoveCall.function, 'claim_reward');
  assert.deepEqual(data.commands[0].MoveCall.typeArguments, []); assert.equal(data.commands[0].MoveCall.arguments.length, 3);
  assert.equal(data.inputs.length, 3); assert.equal(data.inputs[0].Object.SharedObject.mutable, true);
  assert.equal(data.inputs[2].Object.SharedObject.mutable, false); assert.equal(data.expiration, null);
  assert.ok(Object.values(data.gasData).every(x => x === null)); assert.equal(EXPECTED.appChargeMist, '0');
});

test('extra calls, altered packets, wrong account and application-selected gas fail wallet handoff', async () => {
  for (const mutate of [
    f => { f.packet.transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::claim_reward`, arguments: [] }); },
    f => { f.packet.transaction.setGasBudget(1); },
    f => { f.packet.transaction.setSender(OTHER); },
    f => { f.packet.kindSha256 = '0'.repeat(64); },
    f => { f.packet.kindBase64 = ''; },
    f => { f.packet.seedReference.objectId = OTHER; },
  ]) { const f = await createClaimFixtures(); mutate(f); await assert.rejects(() => validateWalletTransaction(f.packet.transaction, f.packet)); }
});

test('changed input versions, previous state and simulation proposals demand a fresh review', async () => {
  await rejectSimulation(f => { f.simulation.data.seed.version++; }, /reference changed/);
  await rejectSimulation(f => { f.simulation.data.registry.version++; }, /reference changed/);
  await rejectSimulation(f => { f.simulation.data.checkpoint.sequenceNumber--; }, /moved backwards/);
  await rejectSimulation(f => { f.packet.simulationTransaction.kind.programmableTransaction.commands[0].moveCall.function = 'water_seed'; }, /proposal differs/);
});

test('failed, too-early, too-late or falsely confirmed simulations cannot pass', async () => {
  await rejectSimulation(f => { effects(f).status = 'FAILURE'; effects(f).executionError = { message: 'abort: E_ARCHIVE_CLAIM_ENDED' }; }, /E_ARCHIVE_CLAIM_ENDED/);
  await rejectSimulation(f => { contents(effects(f).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(BigInt(EXPECTED.cutoffMs) - 1n); f.now = Number(EXPECTED.cutoffMs); setLiveTime(f.inputs, f.now); setLiveTime(f.simulation, f.now); }, /outside the fixed/);
  await rejectSimulation(f => { contents(effects(f).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(BigInt(EXPECTED.claimDeadlineMs) + 1n); f.now = Number(EXPECTED.claimDeadlineMs); setLiveTime(f.inputs, f.now); setLiveTime(f.simulation, f.now); }, /outside the fixed/);
  await rejectSimulation(f => { effects(f).checkpoint = clone(f.inputs.data.checkpoint); }, /Simulation cannot/);
  await rejectSimulation(f => { effects(f).unchangedConsensusObjects.nodes = []; }, /read-only Clock/);
});

test('only the exact Seed reset and frozen Registry accounting are accepted', async () => {
  await rejectSimulation(f => { contents(change(f, EXPECTED.seedId).outputState).growth_points = '10'; }, /Unexpected Seed/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.seedId).outputState).reward_processed = false; }, /Unexpected Seed/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.registryId).outputState).total_growth_points = '0'; }, /Unexpected Registry/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.registryId).outputState).reward_pool = '1'; }, /Unexpected Registry/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.registryId).outputState).settlement.paid_mist = '6999999'; }, /Unexpected Registry/);
  await rejectSimulation(f => { effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => x.address !== EXPECTED.seedId); }, /required claim input/);
});

test('reward receipt events must be complete, ordered and match the exact entitlement', async () => {
  await rejectSimulation(f => { effects(f).events.nodes.shift(); }, /Unexpected reward claim events/);
  await rejectSimulation(f => { effects(f).events.nodes.reverse(); }, /Unexpected reward claim events/);
  await rejectSimulation(f => { effects(f).events.nodes[1].contents.json.amount_mist = '1'; }, /Unexpected reward claim events/);
  await rejectSimulation(f => { effects(f).events.nodes[2].sender.address = OTHER; }, /Unexpected reward claim events/);
  await rejectSimulation(f => { effects(f).events.pageInfo.hasNextPage = true; }, /Incomplete reward claim events/);
});

test('the created reward coin must pay exactly the entitlement to the owner', async () => {
  await rejectSimulation(f => { change(f, f.rewardCoinId).outputState.owner.address.address = OTHER; }, /owner differs/);
  await rejectSimulation(f => { contents(change(f, f.rewardCoinId).outputState).balance = '6999999'; }, /reward coin amount/);
  await rejectSimulation(f => { change(f, f.rewardCoinId).outputState.asMoveObject.contents.type.repr = `${OTHER}::coin::TOKEN`; }, /reward coin type/);
  await rejectSimulation(f => { effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => x.address !== f.rewardCoinId); }, /exactly one reward coin/);
  await rejectSimulation(f => { const c = clone(change(f, f.rewardCoinId)); c.address = OTHER; c.outputState.address = OTHER; effects(f).objectChanges.nodes.push(c); }, /exactly one reward coin/);
});

test('no additional spending, recipient, transfer or object change may hide behind the payout', async () => {
  await rejectSimulation(f => { effects(f).balanceChangesJson[0].amount = '7000000'; }, /reward minus network gas/);
  await rejectSimulation(f => { effects(f).balanceChangesJson[0].amount = '5424948'; }, /reward minus network gas/);
  await rejectSimulation(f => { effects(f).balanceChangesJson.push({ ...effects(f).balanceChangesJson[0], address: OTHER, amount: '1' }); }, /Only the claim owner/);
  await rejectSimulation(f => { change(f, EXPECTED.seedId).outputState.owner.address.address = OTHER; }, /input was transferred/);
  await rejectSimulation(f => { const c = clone(change(f, f.gasId)); c.address = OTHER; for (const s of [c.inputState, c.outputState]) s.address = OTHER; effects(f).objectChanges.nodes.push(c); }, /Unexpected object/);
  await rejectSimulation(f => { effects(f).objectChanges.pageInfo.hasNextPage = true; }, /Incomplete claim object changes/);
});

test('full transaction bytes must preserve exact claim arguments, sender and gas owner', async () => {
  await rejectSimulation(f => changeTx(f, data => { data.sender = OTHER; }), /Wrong claim sender/);
  await rejectSimulation(f => changeTx(f, data => { data.gasData.owner = OTHER; }), /Wrong gas owner/);
  await rejectSimulation(f => changeTx(f, data => { data.kind.ProgrammableTransaction.commands[0].MoveCall.function = 'claim_archived_reward'; }), /commands differ/);
  await rejectSimulation(f => changeTx(f, data => { data.kind.ProgrammableTransaction.commands[0].MoveCall.arguments.reverse(); }), /commands differ/);
  await rejectSimulation(f => changeTx(f, data => { data.kind.ProgrammableTransaction.commands.push(clone(data.kind.ProgrammableTransaction.commands[0])); }), /commands differ/);
});

test('ordinary gas objects must balance exactly; address gas remains wallet-selectable and chain-bound', async () => {
  const f = await createClaimFixtures({ gasMode: 'address' }); assert.equal((await simulate(f)).gasEstimateMist, '1575051');
  await rejectSimulation(f => { contents(change(f, f.gasId).outputState).balance = '999999999'; }, /Gas coin balances/);
  await rejectSimulation(f => changeTx(f, data => { data.gasData.payment = []; }), /mainnet-bound expiration/);
  await rejectSimulation(f => changeTx(f, data => { data.gasData.budget = '1'; }), /exceeds its budget/);
  await rejectSimulation(f => changeTx(f, data => { data.gasData.price = '0'; }), /Invalid gas budget or price/);
});

test('storage rebates are reported as gas credits without changing the gross reward', async () => {
  const f = await createClaimFixtures(); effects(f).gasEffects.gasSummary.storageRebate = 9000000;
  const net = -912400n; effects(f).balanceChangesJson[0].amount = String(7000000n - net);
  contents(change(f, f.gasId).outputState).balance = String(1000000000n - net);
  const result = await simulate(f); assert.equal(result.gasEstimateMist, '-912400');
  assert.equal(result.gasEstimateSui, '-0.000912400'); assert.equal(result.rewardMist, '7000000'); assert.equal(result.netReceiveMist, '7912400');
});

test('zero net owner balance is distinct from a zero reward and may have no balance-change row', async () => {
  const f = await createClaimFixtures({ gasMode: 'address' });
  effects(f).gasEffects.gasSummary = { computationCost: 7000000, storageCost: 0, storageRebate: 0, nonRefundableStorageFee: 0 };
  effects(f).balanceChangesJson = [];
  const result = await simulate(f); assert.equal(result.rewardMist, '7000000'); assert.equal(result.netReceiveMist, '0');
});

function useVirtualGas(f) {
  const reservation = new Uint8Array(32).fill(0xac), view = new DataView(reservation.buffer);
  view.setBigUint64(0, 10000000n, true); view.setUint32(8, 1302, true);
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const owner = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  const objectId = '0x' + toHex(owner.map((v, i) => v ^ chain[i]));
  changeTx(f, data => {
    data.expiration = { ValidDuring: { minEpoch: '1302', maxEpoch: '1303', minTimestamp: null, maxTimestamp: null,
      chain: EXPECTED.genesisDigest, nonce: 123 } };
    data.gasData.payment = [{ objectId, version: '0', digest: toBase58(reservation) }];
  });
  effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => x.address !== f.gasId);
}

test('virtual gas reservations are valid only for the owner, mainnet and execution epoch', async () => {
  const f = await createClaimFixtures(); useVirtualGas(f); assert.equal((await simulate(f)).virtualGasReservations, 1);
  for (const [mutate, pattern] of [
    [data => { data.gasData.payment[0].objectId = OTHER; }, /another owner or network/],
    [data => { data.expiration.ValidDuring.chain = '11111111111111111111111111111111'; }, /Wrong expiration chain/],
    [data => { data.expiration.ValidDuring.maxEpoch = '1305'; }, /expiration window/],
    [data => { data.gasData.payment[0].digest = '11111111111111111111111111111111'; }, /reservation digest/],
  ]) { const g = await createClaimFixtures(); useVirtualGas(g); changeTx(g, mutate); await assert.rejects(() => simulate(g), pattern); }
});

test('a zero-value entitlement still processes once and creates no payout coin', async () => {
  const f = await createClaimFixtures({ poolMist: '0' }), result = await simulate(f);
  assert.equal(result.rewardMist, '0'); assert.equal(result.rewardCoinId, null); assert.equal(result.rewardProcessed, true);
  assert.equal(effects(f).events.nodes.length, 2); assert.equal(result.netReceiveMist, '-1575051');
});

test('confirmed receipt binds full transaction digest, original input, payout and current processed marker', async () => {
  const f = await createClaimFixtures(), result = await validateConfirmedClaim(f.confirmation, f.digest, opts(f));
  assert.equal(f.synthetic, true); assert.equal(result.status, 'confirmed'); assert.equal(result.digest, f.digest);
  assert.equal(result.rewardMist, '7000000'); assert.equal(result.hasAdvanced, false); assert.equal(result.kindSha256, f.packet.kindSha256);
  const live = clone(f.confirmation); delete live.data.transaction;
  const state = inspectClaimState(live, opts(f)); assert.equal(state.status, 'claimed'); assert.equal(state.digestCandidate, f.digest);
  assert.equal(state.eligibleGrowthPoints, '10'); assert.equal(state.growthPoints, '0');
  await assert.rejects(() => buildReviewedClaim(state), /claim window/);
});

test('claim receipts remain verifiable after the deadline using their historical execution Clock', async () => {
  const f = await createClaimFixtures(); f.now = Number(EXPECTED.claimDeadlineMs) + 86400000;
  f.confirmation.data.checkpoint = { sequenceNumber: f.confirmation.data.checkpoint.sequenceNumber + 1000, timestamp: new Date(f.now).toISOString() };
  contents(f.confirmation.data.clock).timestamp_ms = String(f.now);
  const receipt = await validateConfirmedClaim(f.confirmation, f.digest, opts(f));
  assert.equal(receipt.status, 'confirmed'); assert.ok(BigInt(receipt.claimedAtMs) < BigInt(EXPECTED.claimDeadlineMs));
});

test('wrong digest, missing checkpoint, mismatched bytes and unprocessed current Seed fail confirmation', async () => {
  await rejectReceipt(f => { f.confirmation.data.transaction.digest = EXPECTED.plantDigest; }, /digest differs/);
  await rejectReceipt(f => { f.confirmation.data.transaction.effects.checkpoint = null; }, /not yet indexed/);
  await rejectReceipt(f => { f.confirmation.data.transaction.transactionBcs = observedClaimSimulation().response.data.simulateTransaction.effects.transaction.transactionBcs; }, /bytes do not match/);
  await rejectReceipt(f => { f.confirmation.data.seed.previousTransaction.digest = EXPECTED.plantDigest; }, /confirmed claim digest/);
  await rejectReceipt(f => { contents(f.confirmation.data.seed).reward_processed = false; }, /inconsistent|not reward-processed/);
  await rejectReceipt(f => { f.confirmation.simulatedIdsAreNotDeployedIds = true; }, /Simulation cannot/);
});

test('later versions cannot replace or erase the proven permanent claim outcome', async () => {
  const f = await createClaimFixtures(); f.confirmation.data.seed.version++; f.confirmation.data.registry.version++;
  contents(f.confirmation.data.registry).paused = true;
  assert.equal((await validateConfirmedClaim(f.confirmation, f.digest, opts(f))).hasAdvanced, true);
  contents(f.confirmation.data.seed).growth_points = '10';
  await assert.rejects(() => validateConfirmedClaim(f.confirmation, f.digest, opts(f)), /inconsistent/);
});

test('a confirmed failure exposes explicit retry metadata only after full receipt and fresh unprocessed-state checks', async () => {
  for (const gasMode of ['coin', 'address']) {
    const f = makeConfirmedClaimFailure(await createClaimFixtures({ gasMode }));
    await assert.rejects(() => validateConfirmedClaim(f.confirmation, f.digest, opts(f)), error => {
      assert.equal(error.code, 'TRANSACTION_FAILED'); const failure = error.confirmedFailure;
      assert.equal(failure.status, 'failed'); assert.equal(failure.digest, f.digest); assert.equal(failure.kindSha256, f.packet.kindSha256);
      assert.equal(failure.permitsRetry, true); assert.equal(failure.currentStatus, 'ready'); assert.equal(failure.gasEstimateMist, '1575051'); return true;
    });
  }
});

test('verified failure before the claim window or after its deadline never permits a retry', async () => {
  for (const [time, status] of [[Number(EXPECTED.cutoffMs) - 1, 'waiting'], [Number(EXPECTED.claimDeadlineMs) + 1, 'expired']]) {
    const f = makeConfirmedClaimFailure(await createClaimFixtures()); f.now = time;
    for (const cp of [f.confirmation.data.checkpoint, f.confirmation.data.transaction.effects.checkpoint]) cp.timestamp = new Date(time).toISOString();
    contents(f.confirmation.data.clock).timestamp_ms = String(time);
    contents(f.confirmation.data.transaction.effects.unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(time);
    await assert.rejects(() => validateConfirmedClaim(f.confirmation, f.digest, opts(f)), error => {
      assert.equal(error.confirmedFailure.currentStatus, status); assert.equal(error.confirmedFailure.permitsRetry, false); return true;
    });
  }
});

test('unknown failures, payout effects, altered state and a later successful claim never unlock retries', async () => {
  for (const mutate of [
    f => { f.confirmation.data.transaction.effects.executionError = null; },
    f => { f.confirmation.data.transaction.effects.events.nodes = clone(effects(f).events.nodes); },
    f => { f.confirmation.data.transaction.effects.balanceChangesJson[0].amount = '5424949'; },
    f => { f.confirmation.data.transaction.effects.objectChanges.nodes.push(clone(change(f, f.rewardCoinId))); },
    f => { contents(f.confirmation.data.seed).reward_processed = true; contents(f.confirmation.data.seed).growth_points = '0'; contents(f.confirmation.data.seed).cutoff_growth_points = '0'; },
    f => { const c = f.confirmation.data.transaction.effects.objectChanges.nodes.find(x => x.address === EXPECTED.seedId); contents(c.outputState).reward_processed = true; },
    f => { f.confirmation.data.seed.previousTransaction.digest = EXPECTED.plantDigest; },
    f => { f.confirmation.data.transaction.effects.checkpoint = null; },
  ]) {
    const f = makeConfirmedClaimFailure(await createClaimFixtures()); mutate(f);
    await assert.rejects(() => validateConfirmedClaim(f.confirmation, f.digest, opts(f)), error => { assert.equal(error.confirmedFailure, undefined); return true; });
  }
});

test('partial processing and reset Growth Points cannot create a second entitlement', async () => {
  const f = await createClaimFixtures();
  contents(f.inputs.data.seed).reward_processed = true; contents(f.inputs.data.seed).growth_points = '0'; contents(f.inputs.data.seed).cutoff_growth_points = '0';
  assert.throws(() => inspectClaimState(f.inputs, opts(f)), /finalized settlement/);
  const g = await createClaimFixtures({ finalized: true }); contents(g.inputs.data.registry).settlement.processed_seeds = '1';
  assert.throws(() => inspectClaimState(g.inputs, opts(g)), /processing totals/);
});
