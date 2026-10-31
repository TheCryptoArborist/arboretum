// Meaningful offline boundaries for the paid, single-NFTree owner test.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase58, fromBase64, toBase58 } from '@mysten/bcs';
import { parse, visit } from 'graphql';
import {
  EXPECTED, PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY,
  assertExpectedOrigin, assertAdministrator, inspectPlantState, validateInputs,
  buildReviewedPlant, validateWalletTransaction, validateSimulation, validateConfirmedPlant,
  nextNFTPageVariables, appendNFTPage, contents,
} from './plant-core.mjs';
import { createPlantFixtures } from './plant-fixtures.mjs';
const clone = x => structuredClone(x);
const OTHER = '0x' + 'e'.repeat(64);
const options = f => ({ now: f.now });
const effects = f => f.simulation.data.simulateTransaction.effects;
const change = (f, id) => effects(f).objectChanges.nodes.find(x => x.address === id);
const registry = raw => raw.data.registries.nodes[0];
const originalFetch = globalThis.fetch; let networkAttempts = 0;
before(() => { globalThis.fetch = async () => { networkAttempts++; throw Error('Offline tests cannot fetch'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
async function simulationResult(f) {
  return validateSimulation(f.simulation, f.packet, await validateInputs(f.inputs, f.proof, options(f)), f.proof, options(f));
}
async function rejectSimulation(mutate, pattern) {
  const f = await createPlantFixtures(); await mutate(f); await assert.rejects(() => simulationResult(f), pattern);
}
async function rejectInput(mutate, pattern) {
  const f = await createPlantFixtures(); mutate(f); await assert.rejects(() => validateInputs(f.inputs, f.proof, options(f)), pattern);
}
async function rejectReceipt(mutate, pattern) {
  const f = await createPlantFixtures(); await mutate(f);
  await assert.rejects(() => validateConfirmedPlant(f.confirmation, f.digest, f.proof, options(f)), pattern);
}
function mutateSimulationTransaction(f, mutate) {
  const value = bcs.TransactionData.parse(fromBase64(effects(f).transaction.transactionBcs));
  mutate(value.V1); effects(f).transaction.transactionBcs = bcs.TransactionData.serialize(value).toBase64();
}

test('only canonical origin and explicit administrator/mainnet can review the planting', () => {
  assertExpectedOrigin(EXPECTED.origin); assertAdministrator(EXPECTED.sender);
  assert.throws(() => assertExpectedOrigin('https://example.org'), /treegrow/);
  assert.throws(() => assertAdministrator(OTHER), /administrator/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
});

test('the captured immutable first-start proof and complete 1077-NFT inventory establish ready state', async () => {
  const root = new URL('./verification/mainnet/', import.meta.url);
  const read = name => JSON.parse(fs.readFileSync(new URL(name + '.json', root)));
  const f = await createPlantFixtures();
  const state = await validateInputs(read('inputs-complete'), read('proof'), options(f));
  assert.equal(state.status, 'ready'); assert.equal(state.ownedNFTs.length, 1077);
  assert.equal(state.confirmedStart.digest, EXPECTED.startDigest);
  assert.equal(state.currentState.seasonId, '1'); assert.equal(state.currentState.rewardPoolMist, '0');
  assert.equal(state.ownedSeeds.length, 0); assert.equal(state.confirmedStart.cutoffMs, EXPECTED.cutoffMs);
});

test('one explicit NFT creates exactly splitCoins and planting with wallet gas and expiration unset', async () => {
  const f = await createPlantFixtures(); const data = f.packet.transaction.getData();
  assert.equal(await validateWalletTransaction(f.packet.transaction, f.packet), true);
  assert.equal(data.commands.length, 2); assert.equal(data.commands[0].$kind, 'SplitCoins');
  assert.equal(data.commands[1].MoveCall.function, 'plant_seed_with_nftree');
  assert.deepEqual(data.commands[1].MoveCall.typeArguments, [EXPECTED.nftType]);
  assert.equal(data.expiration, null); assert.ok(Object.values(data.gasData).every(x => x === null));
  const state = await validateInputs(f.inputs, f.proof, options(f));
  const different = await buildReviewedPlant(state.ownedNFTs[1].objectId, state);
  assert.notEqual(different.kindSha256, f.packet.kindSha256);
  await assert.rejects(() => buildReviewedPlant(OTHER, state), /Select one verified/);
});

test('extra commands, app-selected gas, changed NFT and changed packet hash are rejected before handoff', async () => {
  const f = await createPlantFixtures();
  f.packet.transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::water_seed`, arguments: [] });
  await assert.rejects(() => validateWalletTransaction(f.packet.transaction, f.packet), /exact single planting/);
  const g = await createPlantFixtures(); g.packet.transaction.setGasBudget(1);
  await assert.rejects(() => validateWalletTransaction(g.packet.transaction, g.packet), /gas and expiration/);
  const h = await createPlantFixtures(); h.packet.nftId = OTHER;
  await assert.rejects(() => validateWalletTransaction(h.packet.transaction, h.packet), /NFTree identity/);
  const j = await createPlantFixtures(); j.packet.kindSha256 = '0'.repeat(64);
  await assert.rejects(() => validateWalletTransaction(j.packet.transaction, j.packet), /hash differs/);
});

test('incomplete, duplicate, foreign-type or foreign-owner inventories fail closed', async () => {
  await rejectInput(f => { f.inputs.data.ownedNFTs.pageInfo.hasNextPage = true; }, /Incomplete owned NFTree/);
  await rejectInput(f => { f.inputs.data.ownedSeeds.pageInfo.hasNextPage = true; }, /Incomplete owned Seed/);
  await rejectInput(f => { f.inputs.data.ownedNFTs.nodes.push(clone(f.inputs.data.ownedNFTs.nodes[0])); }, /Duplicate/);
  await rejectInput(f => { f.inputs.data.ownedNFTs.nodes[0].owner.address.address = OTHER; }, /owner differs/);
  await rejectInput(f => { f.inputs.data.ownedNFTs.nodes[0].asMoveObject.contents.type.repr = `${EXPECTED.packageId}::settlement::Tool`; }, /exact NFTree/);
});

test('stale observations, altered immutable start proof and nonempty financial state cannot authorize planting', async () => {
  await rejectInput(f => { f.inputs.data.checkpoint.timestamp = new Date(f.now - EXPECTED.maxAgeMs - 1).toISOString(); }, /stale/i);
  await rejectInput(f => { f.proof.data.startTransaction.digest = '1'.repeat(32); }, /first-season proof/);
  await rejectInput(f => { registry(f.inputs).version++; contents(registry(f.inputs)).reward_pool = '1'; }, /empty started state/);
  await rejectInput(f => { registry(f.inputs).version++; contents(registry(f.inputs)).paused = true; }, /empty started state/);
});

test('first-Seed discovery blocks duplicate planting and supplies only a receipt candidate', async () => {
  const f = await createPlantFixtures(), raw = clone(f.confirmation); delete raw.data.transaction;
  const state = await inspectPlantState(raw, f.proof, options(f));
  assert.equal(state.status, 'already-planted'); assert.equal(state.digestCandidate, f.digest);
  assert.equal(state.firstSeed.address, f.seedId);
  await assert.rejects(() => validateInputs(raw, f.proof, options(f)), /already recorded/);
  await assert.rejects(() => buildReviewedPlant(f.nftId, state), /empty first-plant/);
});

test('the empty first-season view closes exactly at cutoff', async () => {
  const f = await createPlantFixtures(); f.now = Number(EXPECTED.cutoffMs);
  f.inputs.data.checkpoint.timestamp = f.proof.data.checkpoint.timestamp = new Date(f.now).toISOString();
  contents(f.inputs.data.clock).timestamp_ms = String(f.now);
  assert.equal((await inspectPlantState(f.inputs, f.proof, options(f))).status, 'closed');
  await assert.rejects(() => validateInputs(f.inputs, f.proof, options(f)), /growing period is closed/);
});

test('NFT pagination pins the initial checkpoint and rejects duplicate, missing and repeating pages', async () => {
  const f = await createPlantFixtures(), first = clone(f.inputs);
  const second = first.data.ownedNFTs.nodes.pop(); first.data.ownedNFTs.pageInfo = { hasNextPage: true, endCursor: 'cursor-one' };
  const variables = nextNFTPageVariables(first);
  assert.deepEqual(variables, { checkpoint: first.data.checkpoint.sequenceNumber, after: 'cursor-one' });
  const page = { data: { genesis: clone(first.data.genesis), checkpoint: { sequenceNumber: variables.checkpoint,
    query: { ownedNFTs: { nodes: [second], pageInfo: { hasNextPage: false, endCursor: 'cursor-two' } } } } } };
  const merged = appendNFTPage(first, page); assert.equal(merged.data.ownedNFTs.nodes.length, 2);
  assert.equal(nextNFTPageVariables(merged), null);
  const wrong = clone(page); wrong.data.checkpoint.sequenceNumber++;
  assert.throws(() => appendNFTPage(first, wrong), /changed checkpoint/);
  const duplicate = clone(page); duplicate.data.checkpoint.query.ownedNFTs.nodes = [first.data.ownedNFTs.nodes[0]];
  assert.throws(() => appendNFTPage(first, duplicate), /Duplicate/);
  const repeating = clone(page); repeating.data.checkpoint.query.ownedNFTs.pageInfo = { hasNextPage: true, endCursor: 'cursor-one' };
  assert.throws(() => appendNFTPage(first, repeating), /did not advance/);
  const missing = clone(first); missing.data.ownedNFTs.pageInfo.endCursor = null;
  assert.throws(() => nextNFTPageVariables(missing), /invalid cursor/);
});

test('captured checked simulation proves gross price, automatic pool routing, initial care and first water time', async () => {
  const f = await createPlantFixtures(), result = await simulationResult(f);
  assert.equal(result.status, 'simulated'); assert.equal(result.priceMist, '10000000');
  assert.equal(result.rewardShareMist, '7000000'); assert.equal(result.treasuryShareMist, '2800000');
  assert.equal(result.developerShareMist, '200000'); assert.equal(result.growthPoints, '10');
  assert.equal(BigInt(result.waterReadyMs) - BigInt(result.plantedAtMs), 77760000n);
  assert.equal(result.gasEstimateSui, '0.011151182'); assert.equal(result.virtualGasReservations, 1);
  assert.equal(result.canWaterBeforeCutoff, true); assert.equal(EXPECTED.maxGasMist, '50000000');
});

test('simulation refuses changed live NFT references and changed transaction proposal', async () => {
  await rejectSimulation(f => { f.simulation.data.ownedNFTs.nodes[0].version++; }, /NFTree reference changed/);
  await rejectSimulation(f => { f.packet.simulationTransaction.kind.programmableTransaction.commands.pop(); }, /simulation proposal differs/);
  await rejectSimulation(f => { f.packet.simulationTransaction.kind.programmableTransaction.inputs[0].pure = bcs.u64().serialize(1).toBase64(); }, /simulation proposal differs/);
});

test('simulation rejects wrong sender, extra command and final transaction-kind mutation', async () => {
  await rejectSimulation(f => mutateSimulationTransaction(f, x => { x.sender = OTHER; }), /sender/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => { x.kind.ProgrammableTransaction.commands.push(clone(x.kind.ProgrammableTransaction.commands[1])); }), /commands differ/);
});

test('virtual address-balance gas reservations require owner, mainnet, epoch, magic and positive amount', async () => {
  await rejectSimulation(f => mutateSimulationTransaction(f, x => { x.gasData.payment[0].objectId = OTHER; }), /another owner or network/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => { x.expiration.ValidDuring.chain = '1'.repeat(32); }), /expiration chain/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => {
    const bytes = fromBase58(x.gasData.payment[0].digest); bytes[31] = 0;
    x.gasData.payment[0].digest = toBase58(bytes);
  }), /reservation digest/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => {
    const bytes = fromBase58(x.gasData.payment[0].digest); new DataView(bytes.buffer, bytes.byteOffset).setUint32(8, 0, true);
    x.gasData.payment[0].digest = toBase58(bytes);
  }), /amount or epoch/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => {
    const bytes = fromBase58(x.gasData.payment[0].digest); bytes.fill(0, 0, 8);
    x.gasData.payment[0].digest = toBase58(bytes);
  }), /amount or epoch/);
});

test('a version-zero reservation cannot appear as an ordinary coin change or second reservation', async () => {
  await rejectSimulation(f => {
    const data = Transaction.from(effects(f).transaction.transactionBcs).getData();
    const extra = clone(effects(f).objectChanges.nodes.find(x => x.idCreated)); extra.address = data.gasData.payment[0].objectId;
    effects(f).objectChanges.nodes.push(extra);
  }, /reservation must not masquerade/);
  await rejectSimulation(f => mutateSimulationTransaction(f, x => {
    x.gasData.payment[1] = { ...x.gasData.payment[0], objectId: OTHER };
  }), /must be first/);
});

test('ordinary gas inputs must match exact references, own SUI type and account', async () => {
  await rejectSimulation(f => { const gas = effects(f).objectChanges.nodes.find(x => x.idDeleted); gas.inputState.owner.address.address = OTHER; }, /owner differs/);
  await rejectSimulation(f => { const gas = effects(f).objectChanges.nodes.find(x => x.idDeleted); gas.inputState.digest = '1'.repeat(32); }, /reviewed values differ/);
  await rejectSimulation(f => { effects(f).objectChanges.nodes = effects(f).objectChanges.nodes.filter(x => !x.idDeleted); }, /gas input is missing/);
});

test('Seed, NFT and Registry output fields are checked rather than trusting the event', async () => {
  await rejectSimulation(f => { contents(change(f, f.seedId).outputState).growth_points = '11'; }, /Seed fields/);
  await rejectSimulation(f => { contents(change(f, f.seedId).outputState).last_watered_ms = '0'; }, /Seed fields/);
  await rejectSimulation(f => { contents(change(f, f.nftId).outputState).name = 'changed'; }, /NFTree was modified/);
  await rejectSimulation(f => { contents(change(f, EXPECTED.registryId).outputState).treasury = '2800000'; }, /Registry changes/);
});

test('table parents, keys, values and deterministic dynamic-field addresses must all match', async () => {
  await rejectSimulation(f => { const x = effects(f).objectChanges.nodes.find(x => x.outputState?.owner?.__typename === 'ObjectOwner'); x.outputState.owner.address.address = OTHER; }, /record was not created/);
  await rejectSimulation(f => { const x = effects(f).objectChanges.nodes.find(x => x.outputState?.owner?.__typename === 'ObjectOwner'); contents(x.outputState).value = '999'; }, /value/);
  await rejectSimulation(f => { const x = effects(f).objectChanges.nodes.find(x => x.outputState?.owner?.__typename === 'ObjectOwner'); x.address = x.outputState.address = OTHER; contents(x.outputState).id = OTHER; }, /dynamic-field ID/);
});

test('object-change identity and Lamport output versions cannot diverge', async () => {
  await rejectSimulation(f => { change(f, f.seedId).outputState.address = OTHER; }, /Output-state address/);
  await rejectSimulation(f => { effects(f).lamportVersion++; }, /Lamport version/);
  await rejectSimulation(f => { change(f, f.seedId).outputState.version++; }, /reviewed values differ/);
});

test('gross paid amount and both payment destinations are checked including same-address developer return', async () => {
  await rejectSimulation(f => { effects(f).balanceChangesJson[0].amount = '-21151182'; }, /administrator debit/);
  await rejectSimulation(f => { effects(f).balanceChangesJson[1].address = OTHER; }, /treasury balance/);
  await rejectSimulation(f => { const coin = effects(f).objectChanges.nodes.find(x => x.idCreated && contents(x.outputState)?.balance === '200000'); contents(coin.outputState).balance = '200001'; }, /developer transfer/);
  await rejectSimulation(f => { const coin = effects(f).objectChanges.nodes.find(x => x.idCreated && contents(x.outputState)?.balance === '2800000'); coin.outputState.owner.address.address = EXPECTED.sender; }, /treasury transfer/);
});

test('extra events, incomplete effects and execution exactly at cutoff are rejected', async () => {
  await rejectSimulation(f => { effects(f).events.nodes.push(clone(effects(f).events.nodes[0])); }, /Duplicate planting events|Unexpected planting event/);
  await rejectSimulation(f => { effects(f).objectChanges.pageInfo.hasNextPage = true; }, /Incomplete planting object/);
  await rejectSimulation(f => { contents(effects(f).unchangedConsensusObjects.nodes[0].object).timestamp_ms = EXPECTED.cutoffMs; }, /Stale execution Clock|outside Season/);
});

test('synthetic actual receipt recomputes digest and verifies all effects without treating prediction as confirmation', async () => {
  const f = await createPlantFixtures(), receipt = await validateConfirmedPlant(f.confirmation, f.digest, f.proof, options(f));
  assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.digest, f.digest); assert.equal(receipt.seedId, f.seedId);
  assert.equal(receipt.nftId, f.nftId); assert.equal(receipt.exactKindSha256, f.packet.kindSha256);
  assert.equal(receipt.hasAdvanced, false); assert.equal(receipt.currentSeedUnavailable, false);
  await assert.rejects(() => validateConfirmedPlant(f.simulation, f.digest, f.proof, options(f)), /Simulation cannot/);
});

test('confirmation rejects wrong digest, modified bytes, simulated labels and ambiguous wrappers', async () => {
  await rejectReceipt(f => { f.digest = '1'.repeat(32); }, /digest differs/);
  await rejectReceipt(f => { f.confirmation.data.transaction.transactionBcs = f.proof.data.startTransaction.transactionBcs; }, /bytes do not match/);
  await rejectReceipt(f => { f.confirmation.simulatedIdsAreNotDeployedIds = true; }, /Simulation cannot/);
  await rejectReceipt(f => { f.confirmation.response = { data: f.confirmation.data }; }, /Ambiguous/);
});

test('same-version live state must contain the actual created Seed and exact contents', async () => {
  await rejectReceipt(f => { f.confirmation.data.ownedSeeds.nodes = []; }, /missing its newly planted Seed/);
  await rejectReceipt(f => { contents(f.confirmation.data.ownedSeeds.nodes[0]).growth_points = '24'; }, /reviewed values differ/);
  await rejectReceipt(f => { f.confirmation.data.ownedSeeds.nodes[0].version = String(f.confirmation.data.ownedSeeds.nodes[0].version); contents(f.confirmation.data.ownedSeeds.nodes[0]).growth_points = '24'; }, /reviewed values differ/);
});

test('historical first-plant recovery survives later legitimate care without treating its candidate as a second plant', async () => {
  const f = await createPlantFixtures(); const live = registry(f.confirmation); live.version++;
  contents(live).total_growth_points = contents(live).eligible_growth_points = '24';
  const seed = f.confirmation.data.ownedSeeds.nodes[0]; seed.version++; contents(seed).growth_points = contents(seed).cutoff_growth_points = '24';
  seed.previousTransaction.digest = '1'.repeat(32);
  const receipt = await validateConfirmedPlant(f.confirmation, f.digest, f.proof, options(f));
  assert.equal(receipt.hasAdvanced, true); assert.equal(receipt.growthPoints, '10');
  const raw = clone(f.confirmation); delete raw.data.transaction;
  assert.equal((await inspectPlantState(raw, f.proof, options(f))).status, 'already-planted');
  await assert.rejects(() => validateConfirmedPlant(f.confirmation, seed.previousTransaction.digest, f.proof, options(f)), /digest differs/);
});

test('historical receipt survives later abandonment with nonempty history while first-plant replay stays blocked', async () => {
  const f = await createPlantFixtures(); registry(f.confirmation).version++;
  Object.assign(contents(registry(f.confirmation)), { total_seeds: '0', total_growth_points: '0', eligible_growth_points: '0' });
  f.confirmation.data.ownedSeeds.nodes = [];
  const receipt = await validateConfirmedPlant(f.confirmation, f.digest, f.proof, options(f));
  assert.equal(receipt.currentSeedUnavailable, true); assert.equal(receipt.hasAdvanced, true);
  const raw = clone(f.confirmation); delete raw.data.transaction;
  await assert.rejects(() => validateInputs(raw, f.proof, options(f)), /already recorded/);
});

test('historical receipt remains recoverable after cutoff with fresh observation and unchanged real start proof', async () => {
  const f = await createPlantFixtures(); f.now = Number(EXPECTED.claimDeadlineMs) + 1000;
  for (const data of [f.confirmation.data, f.proof.data]) data.checkpoint.timestamp = new Date(f.now).toISOString();
  contents(f.confirmation.data.clock).timestamp_ms = String(f.now);
  const result = await validateConfirmedPlant(f.confirmation, f.digest, f.proof, options(f));
  assert.equal(result.digest, f.digest); assert.equal(result.plantedAtMs, f.parsedReceipt.plantedAtMs);
});

test('queries retain checked simulation, fixed owner/type and the observed server field/fragment budget', () => {
  for (const query of [PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    let count = 0; visit(parse(query), { Field() { count++; }, InlineFragment() { count++; } });
    assert.ok(count < 300, `Query requires ${count} nodes`);
    assert.doesNotMatch(query, /\bmutation\b|executeTransaction/);
  }
  assert.match(SIMULATION_QUERY, /checksEnabled:true doGasSelection:true/);
  assert.ok(INPUTS_QUERY.includes(EXPECTED.nftType)); assert.ok(INPUTS_QUERY.includes(EXPECTED.sender));
});
