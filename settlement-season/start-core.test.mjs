// Offline captured/synthetic evidence tests. These fixtures are not signed or
// submitted transactions and do not establish a live first-season receipt.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64 } from '@mysten/bcs';
import {
  START_EXPECTED as EXPECTED, assertExpectedOrigin, assertAdministrator,
  loadReviewedStart, validateWalletTransaction, validateInputs, inspectStartState,
  validateSimulation, validateConfirmedStart, contents, reference,
} from './start-core.mjs';

const fixtures = new URL('../settlement-integration/verification/season-test-20261031/mainnet/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, fixtures), 'utf8'));
const captured = { proof: read('confirmed-proof.json'), inputs: read('inputs.json'),
  simulation: read('simulation.json'), after: read('after.json'), packet: read('unsigned-packet.json'), summary: read('summary.json') };
const clone = value => structuredClone(value);
const options = { now: Date.parse(captured.summary.verifiedAt) };
const OTHER = '0x' + 'a'.repeat(64);
const OTHER_DIGEST = '1'.repeat(32);
const effectsOf = value => value.response.data.simulateTransaction.effects;
const registryOf = value => value.response.data.registries.nodes[0];
const capOf = value => value.response.data.adminCaps.nodes[0];
const change = (effects, id) => effects.objectChanges.nodes.find(item => item.address === id);
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => { globalThis.fetch = async () => { networkAttempts += 1; throw new Error('Offline test cannot fetch'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
const preflight = () => validateInputs(clone(captured.inputs), clone(captured.proof), options);
const packet = () => loadReviewedStart(captured.packet.kindBase64);
async function rejectInputs(mutate, pattern) {
  const raw = clone(captured.inputs), proof = clone(captured.proof);
  mutate(raw, proof);
  await assert.rejects(() => validateInputs(raw, proof, options), pattern);
}
async function rejectSimulation(mutate, pattern) {
  const raw = clone(captured.simulation), loaded = await packet();
  mutate(raw, loaded);
  await assert.rejects(() => validateSimulation(raw, loaded, awaitPreflight, clone(captured.proof), options), pattern);
}
let awaitPreflight;
before(async () => { awaitPreflight = await preflight(); });
function mutateResolved(raw, mutate) {
  const effects = effectsOf(raw);
  const decoded = bcs.TransactionData.parse(fromBase64(effects.transaction.transactionBcs));
  mutate(decoded.V1);
  effects.transaction.transactionBcs = bcs.TransactionData.serialize(decoded).toBase64();
}
async function confirmedFixture() {
  const response = clone(captured.after);
  const data = response.response.data;
  const effects = clone(effectsOf(captured.simulation));
  effects.checkpoint = { sequenceNumber: data.checkpoint.sequenceNumber, timestamp: data.checkpoint.timestamp };
  const transactionBcs = effects.transaction.transactionBcs;
  const digest = await Transaction.from(transactionBcs).getDigest();
  data.transaction = { digest, sender: { address: EXPECTED.sender }, transactionBcs, effects };
  for (const [name, id] of [['registries', EXPECTED.registryId], ['adminCaps', EXPECTED.adminCapId]]) {
    const output = clone(change(effects, id).outputState);
    output.previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint: clone(effects.checkpoint) } };
    data[name].nodes[0] = output;
  }
  return { response, digest, proof: clone(captured.proof) };
}
async function rejectReceipt(mutate, pattern) {
  const fixture = await confirmedFixture();
  await mutate(fixture);
  await assert.rejects(() => validateConfirmedStart(fixture.response, fixture.digest, fixture.proof, options), pattern);
}
async function rewriteReceipt(fixture, mutate) {
  const tx = fixture.response.response.data.transaction;
  const decoded = bcs.TransactionData.parse(fromBase64(tx.transactionBcs));
  mutate(decoded.V1);
  tx.transactionBcs = bcs.TransactionData.serialize(decoded).toBase64();
  tx.digest = fixture.digest = await Transaction.from(tx.transactionBcs).getDigest();
  tx.effects.transaction.transactionBcs = tx.transactionBcs;
}

test('canonical origin and explicit administrator/mainnet are required', () => {
  assertExpectedOrigin(EXPECTED.origin); assertAdministrator(EXPECTED.sender);
  assert.throws(() => assertExpectedOrigin('https://example.net'), /treegrow/);
  assert.throws(() => assertAdministrator(OTHER), /administrator/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
});

test('captured mainnet proof verifies the exact empty first-test Registry', async () => {
  const result = await preflight();
  assert.equal(result.status, 'ready');
  assert.equal(result.currentState.seasonId, '0');
  assert.equal(result.currentState.rewardPoolMist, '0');
  assert.equal(result.currentState.treasuryMist, '0');
  assert.deepEqual(reference(result.adminCap), EXPECTED.adminCap);
  assert.equal(EXPECTED.wateringIntervalMs, '77760000');
});

test('browser packet is the captured single call with no final gas or expiration', async () => {
  const loaded = await packet();
  assert.equal(loaded.kindBase64, captured.packet.kindBase64);
  assert.deepEqual(loaded.simulationTransaction, captured.packet.simulationTransaction);
  assert.deepEqual(loaded.transaction.getData(), captured.packet.transactionData);
  assert.equal(await validateWalletTransaction(loaded.transaction), true);
});

test('changed packet or injected wallet command cannot reach wallet review', async () => {
  await assert.rejects(() => loadReviewedStart('B' + captured.packet.kindBase64.slice(1)), /packet|hash/);
  const loaded = await packet();
  loaded.transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::start_season`, arguments: [] });
  await assert.rejects(() => validateWalletTransaction(loaded.transaction), /reviewed.*call/);
});

test('app-selected gas or expiration is rejected before wallet review', async () => {
  const loaded = await packet();
  loaded.transaction.setGasBudget(10000000);
  await assert.rejects(() => validateWalletTransaction(loaded.transaction), /gas and expiration/);
});

test('captured checked simulation shows actual start and 24-hour cutoff separately from stored backdate', async () => {
  const result = await validateSimulation(clone(captured.simulation), await packet(), await preflight(), clone(captured.proof), options);
  assert.equal(result.status, 'simulated');
  assert.equal(result.gasEstimateMist, '100553');
  assert.equal(result.predictedRewardPoolMist, '0');
  assert.equal(result.predictedTreasuryMist, '0');
  assert.equal(BigInt(result.actualStartMs) - BigInt(result.storedStartMs), 29n * 86400000n);
  assert.equal(BigInt(result.cutoffMs) - BigInt(result.actualStartMs), 86400000n);
  assert.equal(BigInt(result.claimDeadlineMs) - BigInt(result.cutoffMs), 7n * 86400000n);
  assert.equal(BigInt(result.normalResetReadyMs) - BigInt(result.cutoffMs), 86400000n);
});

test('wrong network, stale proof and partial inventory cannot authorize a start', async () => {
  await rejectInputs((raw, proof) => { raw.response.data.genesis.digest = OTHER_DIGEST; proof.response.data.genesis.digest = OTHER_DIGEST; }, /mainnet/);
  await rejectInputs((raw, proof) => { proof.response.data.checkpoint.timestamp = new Date(options.now - EXPECTED.maxAgeMs - 1).toISOString(); }, /stale/);
  await rejectInputs(raw => { raw.response.data.registries.pageInfo.hasNextPage = true; }, /incomplete/);
});

test('a changed capability, binding or creation table is rejected', async () => {
  await rejectInputs(raw => { capOf(raw).owner.address.address = OTHER; }, /administrator/);
  await rejectInputs(raw => { contents(capOf(raw)).registry_id = OTHER; }, /bound|binding/);
  await rejectInputs(raw => { capOf(raw).version += 1; }, /input reference/);
  await rejectInputs(raw => { registryOf(raw).version += 1; contents(registryOf(raw)).seeds_by_owner.id = OTHER; }, /table identity/);
});

test('funded, paused or otherwise nonempty first Registry is rejected', async () => {
  for (const [field, value] of [['reward_pool', '1'], ['paused', true], ['eligible_growth_points', '1']]) {
    await rejectInputs(raw => { registryOf(raw).version += 1; contents(registryOf(raw))[field] = value; }, /no longer empty/);
  }
});

test('already-started discovery blocks replay and offers only a receipt candidate', async () => {
  const f = await confirmedFixture();
  delete f.response.response.data.transaction;
  const state = await inspectStartState(f.response, f.proof, options);
  assert.equal(state.status, 'already-started');
  assert.equal(state.digestCandidate, f.digest);
  await assert.rejects(() => validateInputs(f.response, f.proof, options), /already started/);
});

test('an archived/reset first season never becomes a fresh first-start again', async () => {
  const f = await confirmedFixture();
  delete f.response.response.data.transaction;
  registryOf(f.response).version += 1;
  contents(registryOf(f.response)).season_start_ms = '0';
  const state = await inspectStartState(f.response, f.proof, options);
  assert.equal(state.status, 'already-started');
});

test('extra commands or altered duration in resolved simulation are rejected', async () => {
  await rejectSimulation(raw => mutateResolved(raw, value => { const ptb = value.kind.ProgrammableTransaction; ptb.commands.push(clone(ptb.commands[0])); }), /kind changed/);
  await rejectSimulation(raw => mutateResolved(raw, value => { value.kind.ProgrammableTransaction.inputs[3].Pure.bytes = bcs.u64().serialize('43200000').toBase64(); }), /kind changed/);
});

test('sender and gas owner cannot be substituted in the resolved simulation', async () => {
  await rejectSimulation(raw => mutateResolved(raw, value => { value.sender = OTHER; }), /resolved sender/);
  await rejectSimulation(raw => mutateResolved(raw, value => { value.gasData.owner = OTHER; }), /gas owner/);
});

test('address-balance gas requires mainnet-bound expiration and proper epoch window', async () => {
  await rejectSimulation(raw => mutateResolved(raw, value => { value.expiration = { None: true, $kind: 'None' }; }), /ValidDuring|expiration kind/);
  await rejectSimulation(raw => mutateResolved(raw, value => { value.expiration.ValidDuring.chain = OTHER_DIGEST; }), /wrong chain/);
  await rejectSimulation(raw => mutateResolved(raw, value => { value.expiration.ValidDuring.maxEpoch = '9999'; }), /window differs/);
});

test('foreign gas objects, uncovered fee, and fee above review ceiling are rejected', async () => {
  await rejectSimulation(raw => mutateResolved(raw, value => { value.gasData.payment = [{ objectId: OTHER, version: '1', digest: OTHER_DIGEST }]; }), /gas object changes/);
  await rejectSimulation(raw => mutateResolved(raw, value => { value.gasData.budget = '1'; }), /exceeds.*budget/);
  await rejectSimulation(raw => {
    const effects = effectsOf(raw);
    effects.gasEffects.gasSummary.computationCost = '20000000';
    const gas = effects.gasEffects.gasSummary;
    const net = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
    effects.balanceChangesJson[0].amount = String(-net);
    mutateResolved(raw, value => { value.gasData.budget = '30000000'; });
  }, /0.01 SUI/);
});

test('only the actual Clock and exact SeasonStarted event are accepted', async () => {
  await rejectSimulation(raw => { effectsOf(raw).unchangedConsensusObjects.nodes.push(clone(effectsOf(raw).unchangedConsensusObjects.nodes[0])); }, /only.*Clock/);
  await rejectSimulation(raw => { effectsOf(raw).events.nodes.push(clone(effectsOf(raw).events.nodes[0])); }, /SeasonStarted/);
  await rejectSimulation(raw => { effectsOf(raw).events.nodes[0].contents.json.start_ms = '1'; }, /SeasonStarted/);
});

test('output Lamport version must be exactly maximum actual input version plus one', async () => {
  await rejectSimulation(raw => {
    const effects = effectsOf(raw); effects.lamportVersion += 1;
    for (const item of effects.objectChanges.nodes) item.outputState.version += 1;
  }, /Lamport version.*actual input/);
});

test('only season ID and stored backdate may change in the first-start Registry', async () => {
  await rejectSimulation(raw => { contents(change(effectsOf(raw), EXPECTED.registryId).outputState).reward_pool = '1'; }, /Registry state changes/);
  await rejectSimulation(raw => { contents(change(effectsOf(raw), EXPECTED.registryId).outputState).season_start_ms = effectsOf(raw).events.nodes[0].contents.json.start_ms; }, /Registry state changes/);
});

test('capability ownership, binding and non-gas balance changes remain protected', async () => {
  await rejectSimulation(raw => { change(effectsOf(raw), EXPECTED.adminCapId).outputState.owner.address.address = OTHER; }, /transferred/);
  await rejectSimulation(raw => { contents(change(effectsOf(raw), EXPECTED.adminCapId).outputState).registry_id = OTHER; }, /AdminCap fields/);
  await rejectSimulation(raw => { effectsOf(raw).balanceChangesJson.push({ address: OTHER, coinType: effectsOf(raw).balanceChangesJson[0].coinType, amount: '1' }); }, /only.*gas debit/i);
});

test('synthetic confirmed receipt validates full digest, start schedule and zero funding', async () => {
  const f = await confirmedFixture();
  const result = await validateConfirmedStart(f.response, f.digest, f.proof, options);
  assert.equal(result.status, 'confirmed'); assert.equal(result.digest, f.digest);
  assert.equal(result.seasonId, '1'); assert.equal(result.hasAdvanced, false);
  assert.equal(result.actualStartMs, captured.summary.simulated.simulatedActualStartMs);
  assert.equal(result.cutoffMs, captured.summary.simulated.predictedCutoffMs);
  assert.equal(result.currentState.rewardPoolMist, '0');
});

test('historical confirmed receipt remains valid after later legitimate season activity', async () => {
  const f = await confirmedFixture();
  const r = registryOf(f.response); r.version += 1; r.digest = OTHER_DIGEST;
  Object.assign(contents(r), { total_seeds: '1', total_growth_points: '10', reward_pool: '7000000' });
  const result = await validateConfirmedStart(f.response, f.digest, f.proof, options);
  assert.equal(result.hasAdvanced, true);
  assert.equal(result.predictedRewardPoolMist, '0');
  assert.equal(result.currentState.rewardPoolMist, '7000000');
});

test('confirmed first start remains historical after a subsequent season starts', async () => {
  const f = await confirmedFixture();
  const r = registryOf(f.response); r.version += 2; r.digest = OTHER_DIGEST;
  Object.assign(contents(r), { current_season_id: '2', season_start_ms: String(options.now) });
  const result = await validateConfirmedStart(f.response, f.digest, f.proof, options);
  assert.equal(result.seasonId, '1'); assert.equal(result.currentState.seasonId, '2');
});

test('simulation effects and unconfirmed receipts cannot be labeled confirmed', async () => {
  await rejectReceipt(f => { f.response.response.data.simulateTransaction = clone(captured.simulation.response.data.simulateTransaction); }, /Simulation data/);
  await rejectReceipt(f => { f.response.response.data.transaction.effects.checkpoint = null; }, /not yet visible/);
});

test('receipt digest must match full transaction bytes', async () => {
  await rejectReceipt(f => { f.response.response.data.transaction.digest = f.digest = OTHER_DIGEST; }, /bytes.*digest/);
});

test('recomputed digest cannot hide an extra command or foreign sender', async () => {
  await rejectReceipt(f => rewriteReceipt(f, value => { const ptb = value.kind.ProgrammableTransaction; ptb.commands.push(clone(ptb.commands[0])); }), /exact reviewed first-start/);
  await rejectReceipt(f => rewriteReceipt(f, value => { value.sender = OTHER; }), /resolved sender/);
});

test('receipt must start from exact empty inputs and preserve capability binding', async () => {
  await rejectReceipt(f => { contents(change(f.response.response.data.transaction.effects, EXPECTED.registryId).inputState).reward_pool = '1'; }, /exact empty/);
  await rejectReceipt(f => { contents(change(f.response.response.data.transaction.effects, EXPECTED.adminCapId).inputState).registry_id = OTHER; }, /binding/);
});

test('receipt rejects funding, wrong event time and additional events', async () => {
  await rejectReceipt(f => { contents(change(f.response.response.data.transaction.effects, EXPECTED.registryId).outputState).reward_pool = '1'; }, /Registry state changes/);
  await rejectReceipt(f => { f.response.response.data.transaction.effects.events.nodes[0].contents.json.start_ms = '1'; }, /SeasonStarted/);
  await rejectReceipt(f => { const e = f.response.response.data.transaction.effects; e.events.nodes.push(clone(e.events.nodes[0])); }, /SeasonStarted/);
});

test('receipt checkpoint must follow actual execution Clock and fresh observation must follow receipt', async () => {
  await rejectReceipt(f => { f.response.response.data.transaction.effects.checkpoint.timestamp = '2026-10-31T05:20:00.000Z'; }, /predates.*Clock/);
  await rejectReceipt(f => { f.response.response.data.transaction.effects.checkpoint.sequenceNumber += 1; }, /observation predates/);
});

test('same-version current data cannot contradict the receipt', async () => {
  await rejectReceipt(f => { contents(registryOf(f.response)).total_growth_points = '1'; }, /Same-version live contents/);
  await rejectReceipt(f => { capOf(f.response).digest = OTHER_DIGEST; }, /Same-version live object/);
});

test('ordinary wallet gas coins with None or Epoch expiration verify without address-balance assumptions', async () => {
  for (const expiration of [{ None: true, $kind: 'None' }, { Epoch: '1297', $kind: 'Epoch' }]) {
    const f = await confirmedFixture();
    const effects = f.response.response.data.transaction.effects;
    const sui = '0x' + '0'.repeat(63) + '2';
    const input = { address: OTHER, version: 5, digest: OTHER_DIGEST,
      owner: { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
      asMoveObject: { contents: { type: { repr: `${sui}::coin::Coin<${sui}::sui::SUI>` },
        json: { id: OTHER, balance: '10000000' } } } };
    const output = clone(input);
    output.version = effects.lamportVersion;
    output.digest = change(effects, EXPECTED.adminCapId).outputState.digest;
    output.asMoveObject.contents.json.balance = '9899447';
    effects.objectChanges.nodes.push({ address: OTHER, idCreated: false, idDeleted: false,
      inputState: input, outputState: output });
    await rewriteReceipt(f, value => { value.gasData.payment = [reference(input)]; value.expiration = expiration; });
    registryOf(f.response).previousTransaction.digest = f.digest;
    capOf(f.response).previousTransaction.digest = f.digest;
    const result = await validateConfirmedStart(f.response, f.digest, f.proof, options);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.resolvedGasPayments, 1);
    assert.equal(result.returnedGasObjectChanges, 1);
  }
});

test('a days-old first-start receipt is recoverable using fresh current observations', async () => {
  const f = await confirmedFixture();
  const now = options.now + 8 * 86400000;
  for (const raw of [f.response, f.proof]) {
    raw.response.data.checkpoint.sequenceNumber += 100000;
    raw.response.data.checkpoint.timestamp = new Date(now - 1000).toISOString();
  }
  contents(f.response.response.data.clock).timestamp_ms = String(now - 1000);
  const result = await validateConfirmedStart(f.response, f.digest, f.proof, { now });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.actualStartMs, captured.summary.simulated.simulatedActualStartMs);
});

test('same-version last-write metadata and same-season start contradictions are rejected', async () => {
  await rejectReceipt(f => { registryOf(f.response).previousTransaction.digest = OTHER_DIGEST; }, /names a different transaction/);
  await rejectReceipt(f => { registryOf(f.response).version += 1; contents(registryOf(f.response)).season_start_ms = '1'; }, /start contradicts/);
});

test('a wallet ValidDuring receipt can confirm in its second epoch but never outside its window', async () => {
  const f = await confirmedFixture();
  f.response.response.data.transaction.effects.epoch.epochId = 1298;
  const result = await validateConfirmedStart(f.response, f.digest, f.proof, options);
  assert.equal(result.status, 'confirmed');
  await rejectReceipt(value => { value.response.response.data.transaction.effects.epoch.epochId = 1299; }, /outside.*expiration/);
  await rejectSimulation(raw => { effectsOf(raw).epoch.epochId = 1298; }, /starts in another epoch/);
});

test('ambiguous wrappers and simulation-only markers cannot supply confirmed evidence', async () => {
  await rejectReceipt(f => { f.response.data = clone(f.response.response.data); }, /ambiguous wrapped/);
  await rejectReceipt(f => { f.response.response.simulatedIdsAreNotDeployedIds = true; }, /Simulation data/);
});
