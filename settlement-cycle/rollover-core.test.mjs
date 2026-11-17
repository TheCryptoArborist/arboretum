import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { toBase64, toBase58, fromBase58, fromHex, toHex } from '@mysten/bcs';
import { parse, visit } from 'graphql';
import {
  EXPECTED, TABLE_NAMES, contents, dataOf, inspectState, assertAdministrator, assertExpectedOrigin,
  PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY, nextNFTPageVariables,
} from './common.mjs';
import {
  PREVIOUS_SETTLEMENT, prepareRollover, validateWalletTransaction, validateRolloverSimulation,
  validateConfirmedRollover, assertCycleReceipt,
} from './rollover-core.mjs';
import {
  observedRolloverProof, observedRolloverSimulation, observedRolloverInputs,
  createRolloverFixtures, makeConfirmedRolloverFailure,
} from './rollover-fixtures.mjs';

const clone = value => structuredClone(value);
const registry = data => data.registries.nodes[0];
const cap = data => data.adminCaps.nodes[0];
const changed = (effects, id) => effects.objectChanges.nodes.find(x => x.address === id);
const checkSim = (f, response = f.simulation) => validateRolloverSimulation(response, f.packet, f.state, f.proof, { nowMs: f.now });
const checkReceipt = (f, response = f.confirmation) => validateConfirmedRollover(response, f.digest, f.proof, { nowMs: f.now });
const inspect = (f, response = f.inputs, proof = f.proof) => inspectState(response, proof, { nowMs: f.now });

test('captured checked unsigned mainnet rollover passes exact archive, timing, and gas review', async () => {
  const proof = observedRolloverProof(), simulation = observedRolloverSimulation();
  const now = Date.parse(simulation.capturedAt);
  const state = await inspectState(observedRolloverInputs(), proof, { nowMs: now });
  const packet = await prepareRollover(state);
  const result = await validateRolloverSimulation(simulation, packet, state, proof, { nowMs: now });
  assert.equal(state.status, 'rollover-ready');
  assert.equal(result.status, 'simulated');
  assert.equal(BigInt(result.cutoffMs) - BigInt(result.actualStartMs), 172800000n);
  assert.equal(BigInt(result.cutoffMs) - BigInt(result.storedStartMs), 2592000000n);
  assert.equal(result.previousClaimDigest, EXPECTED.previousClaimDigest);
  assert.deepEqual(contents(result.archiveOutput).settlement, PREVIOUS_SETTLEMENT);
  assert.equal(result.archivedUnclaimedMist, '0');
  assert.equal(result.gasEstimateMist, '2509802');
  assert.equal(result.virtualGasReservations, 0);
  for (const name of TABLE_NAMES) assert.deepEqual(contents(result.registryOutput)[name], contents(state.registry)[name]);
});

test('scoped queries remain below the hosted 300-field limit and do not enumerate NFT holdings', () => {
  for (const query of [PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    let fields = 0; visit(parse(query), { Field() { fields++; } });
    assert.ok(fields <= 300, 'Hosted GraphQL field ceiling exceeded.');
    assert.doesNotMatch(query, /\bmutation\b|\bexecuteTransaction\b/);
  }
  for (const query of [INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    assert.ok(query.includes(`cycleNft:object(address:"${EXPECTED.previousNftId}")`));
    assert.ok(!query.includes('ownedNFTs:objects'));
  }
  assert.ok(SIMULATION_QUERY.includes('checksEnabled:true'));
  assert.ok(SIMULATION_QUERY.includes('doGasSelection:true'));
  assert.equal(nextNFTPageVariables(observedRolloverSimulation()), null);
});

test('wrong origin, account, network, ambiguous response, and JSON receipt impersonation fail closed', () => {
  assert.throws(() => assertExpectedOrigin('https://treegrow.xyz'), /treegrow/);
  assert.throws(() => assertAdministrator('0x' + '1'.repeat(64)), /administrator/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
  assert.throws(() => dataOf({ data: {}, response: { data: {} } }), /Ambiguous/);
  assert.throws(() => assertCycleReceipt({ action: 'rollover', status: 'confirmed', seasonId: '2' }), /Reverify/);
});

for (const gasMode of ['address', 'coin']) {
  test(`${gasMode} gas: confirmed receipt is exact, frozen, branded and blocks another rollover`, async () => {
    const f = await createRolloverFixtures({ gasMode }), result = await checkSim(f);
    const receipt = await checkReceipt(f);
    assert.equal(result.status, 'simulated'); assert.equal(receipt.status, 'confirmed');
    assert.equal(assertCycleReceipt(receipt), receipt);
    assert.equal(receipt.digest, f.digest); assert.equal(receipt.kindSha256, f.packet.kindSha256);
    assert.equal(receipt.netReceiveMist, '-' + receipt.gasEstimateMist);
    assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.registryOutput.asMoveObject.contents.json));
    assert.throws(() => assertCycleReceipt(JSON.parse(JSON.stringify(receipt))), /Reverify/);
    const { transaction: _actual, ...live } = f.confirmation.data;
    const current = await inspect(f, { data: live });
    assert.equal(current.status, 'season-two');
    await assert.rejects(() => prepareRollover(current), /Refresh the completed Season 1/);
  });

  test(`${gasMode} gas: only a bound, indexed failed atomic rollover permits controlled retry`, async () => {
    const f = makeConfirmedRolloverFailure(await createRolloverFixtures({ gasMode }));
    await assert.rejects(() => checkReceipt(f), error => {
      assert.equal(error.code, 'TRANSACTION_FAILED');
      assert.equal(error.confirmedFailure?.permitsRetry, true);
      assert.equal(error.confirmedFailure.digest, f.digest);
      assert.equal(error.confirmedFailure.kindSha256, f.packet.kindSha256);
      assert.equal(error.confirmedFailure.currentStatus, 'rollover-ready'); return true;
    });
    const { transaction: _actual, ...live } = f.confirmation.data;
    const current = await inspect(f, { data: live });
    const retry = await prepareRollover(current);
    assert.notEqual(retry.kindSha256, f.packet.kindSha256, 'Retry must use its advanced capability reference.');
  });
}

test('wallet request contains exactly reset then 48-hour start, with no final gas or expiration', async () => {
  const f = await createRolloverFixtures(), tx = f.packet.transaction.getData();
  assert.equal(await validateWalletTransaction(f.packet.transaction, f.packet), true);
  assert.deepEqual(tx.commands.map(x => x.MoveCall.function), ['reset_season', 'start_season_for_duration']);
  assert.equal(tx.inputs.length, 4);
  assert.equal(bcs.u64().parse(Buffer.from(tx.inputs[3].Pure.bytes, 'base64')), EXPECTED.durationMs);
  assert.equal(tx.expiration, null); assert.ok(Object.values(tx.gasData).every(x => x === null));
  for (const mutate of [
    t => t.setGasBudget(10000000), t => t.setGasOwner(EXPECTED.sender),
    t => t.setExpiration({ Epoch: 1306 }), t => t.setSender('0x' + '1'.repeat(64)),
    t => t.moveCall({ target: `${EXPECTED.packageId}::settlement::reset_season`, arguments: [] }),
  ]) {
    const changedTx = Transaction.fromKind(f.packet.kindBase64); changedTx.setSender(EXPECTED.sender); mutate(changedTx);
    await assert.rejects(() => validateWalletTransaction(changedTx, f.packet));
  }
  const altered = clone(tx); altered.inputs[3].Pure.bytes = bcs.u64().serialize('86400000').toBase64();
  await assert.rejects(() => validateWalletTransaction(Transaction.from(JSON.stringify(altered)), f.packet), /differs/);
  await assert.rejects(() => validateWalletTransaction(f.packet.transaction, { ...f.packet, durationMs: '86400000' }), /48 hours/);
});

for (const [name, mutate] of [
  ['wrong genesis', (i) => { i.data.genesis.digest = '11111111111111111111111111111111'; }],
  ['stale checkpoint', (i) => { i.data.checkpoint.timestamp = '2020-01-01T00:00:00.000Z'; }],
  ['future clock', (i, _p, f) => { contents(i.data.clock).timestamp_ms = String(f.now + 120000); }],
  ['wrong administrator capability', (i) => { cap(i.data).owner.address.address = '0x' + '1'.repeat(64); }],
  ['unsupported inventory version', (i) => { contents(registry(i.data)).version = '2'; }],
  ['unpaid reward pool', (i) => { contents(registry(i.data)).reward_pool = '1'; }],
  ['incomplete reward processing', (i) => { contents(registry(i.data)).settlement.processed_growth_points = '9'; }],
  ['incomplete owned Seed inventory', (i) => { i.data.ownedSeeds.pageInfo.hasNextPage = true; }],
  ['missing processed first Seed', (i) => { i.data.ownedSeeds.nodes = []; }],
  ['mutated old Seed', (i) => { contents(i.data.ownedSeeds.nodes[0]).reward_processed = false; }],
  ['wrong NFT identity', (i) => { i.data.ownedNFTs.nodes[0].address = '0x' + '1'.repeat(64); }],
  ['wrong NFT owner', (i) => { i.data.ownedNFTs.nodes[0].owner.address.address = '0x' + '1'.repeat(64); }],
  ['missing prior claim', (_i, p) => { delete p.data.priorClaimTransaction; }],
  ['wrong prior claim digest', (_i, p) => { p.data.priorClaimTransaction.digest = '11111111111111111111111111111111'; }],
  ['prior claim accounting tamper', (_i, p) => { p.data.priorClaimTransaction.effects.balanceChangesJson[0].amount = '7000000'; }],
]) test(`live readiness rejects ${name}`, async () => {
  const f = await createRolloverFixtures(), inputs = clone(f.inputs), proof = clone(f.proof);
  mutate(inputs, proof, f); await assert.rejects(() => inspect(f, inputs, proof));
});

for (const [name, mutate] of [
  ['a different simulation request', (_e, _s, f) => { f.packet.simulationTransaction.kind.programmableTransaction.commands.reverse(); }],
  ['unexpected consensus inputs', e => { e.unchangedConsensusObjects.nodes.push(clone(e.unchangedConsensusObjects.nodes[0])); }],
  ['mismatched live input', e => { contents(changed(e, EXPECTED.registryId).inputState).treasury = '1'; }],
  ['wrong new season', e => { contents(changed(e, EXPECTED.registryId).outputState).current_season_id = '3'; }],
  ['wrong duration', e => { contents(changed(e, EXPECTED.registryId).outputState).season_start_ms = '1'; }],
  ['lost old owner indexes', e => { contents(changed(e, EXPECTED.registryId).outputState).seeds_by_owner.size = '0'; }],
  ['archive payout changed', e => { contents(e.objectChanges.nodes.find(x => x.idCreated).outputState).settlement.paid_mist = '0'; }],
  ['archive deadline changed', e => { contents(e.objectChanges.nodes.find(x => x.idCreated).outputState).claim_deadline_ms = '1'; }],
  ['archive retained funds', e => { contents(e.objectChanges.nodes.find(x => x.idCreated).outputState).reward_pool = '1'; }],
  ['archive ownership changed', e => { e.objectChanges.nodes.find(x => x.idCreated).outputState.owner = { __typename: 'AddressOwner', address: { address: EXPECTED.sender } }; }],
  ['event order changed', e => { e.events.nodes.reverse(); }],
  ['event season changed', e => { e.events.nodes[2].contents.json.season_id = '3'; }],
  ['unexpected created object', e => { const c = clone(e.objectChanges.nodes.find(x => x.idCreated)); c.address = c.outputState.address = '0x' + 'd'.repeat(64); e.objectChanges.nodes.push(c); }],
  ['hidden object pages', e => { e.objectChanges.pageInfo.hasNextPage = true; }],
  ['owner balance gain', e => { e.balanceChangesJson[0].amount = '1'; }],
  ['wrong gas recipient', e => { e.balanceChangesJson[0].address = EXPECTED.treasuryWallet; }],
  ['gas above reviewed ceiling', e => { e.gasEffects.gasSummary.computationCost = 100000000; }],
]) test(`simulation rejects ${name}`, async () => {
  const f = await createRolloverFixtures(), simulation = clone(f.simulation);
  mutate(simulation.data.simulateTransaction.effects, simulation, f);
  await assert.rejects(() => checkSim(f, simulation));
});

test('ordinary gas must consume exact owned SUI references and reconcile its net coin balance', async () => {
  const f = await createRolloverFixtures({ gasMode: 'coin' });
  for (const mutate of [
    e => { contents(changed(e, f.gasId).outputState).balance = '1000000000'; },
    e => { changed(e, f.gasId).inputState.version++; },
    e => { e.objectChanges.nodes = e.objectChanges.nodes.filter(x => x.address !== f.gasId); },
    e => { changed(e, f.gasId).outputState.owner.address.address = EXPECTED.treasuryWallet; },
  ]) {
    const response = clone(f.simulation); mutate(response.data.simulateTransaction.effects);
    await assert.rejects(() => checkSim(f, response));
  }
});

test('virtual address-balance gas reservations remain bound to this owner, mainnet, and epoch', async () => {
  const f = await createRolloverFixtures(), original = f.simulation.data.simulateTransaction.effects;
  const bytes = new Uint8Array(32).fill(0xac), view = new DataView(bytes.buffer);
  view.setBigUint64(0, 50000000n, true); view.setUint32(8, original.epoch.epochId, true);
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'),
    bcs.Address.serialize(EXPECTED.sender).toBytes());
  const owner = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  const objectId = '0x' + toHex(owner.map((value, index) => value ^ chain[index]));
  async function withPayment(mutate = () => {}) {
    const response = clone(f.simulation), e = response.data.simulateTransaction.effects;
    const data = Transaction.from(e.transaction.transactionBcs).getData();
    data.gasData.payment = [{ objectId, version: '0', digest: toBase58(bytes) }];
    mutate(data);
    e.transaction.transactionBcs = toBase64(await Transaction.from(JSON.stringify(data)).build());
    return response;
  }
  assert.equal((await checkSim(f, await withPayment())).virtualGasReservations, 1);
  for (const mutate of [
    d => { d.gasData.payment[0].objectId = '0x' + 'b'.repeat(64); },
    d => { d.gasData.payment[0].digest = '11111111111111111111111111111111'; },
    d => { d.expiration.ValidDuring.chain = '11111111111111111111111111111111'; },
    d => { d.expiration.ValidDuring.maxEpoch = String(BigInt(d.expiration.ValidDuring.minEpoch) + 2n); },
    d => { d.gasData.payment.push(clone(d.gasData.payment[0])); },
    d => { const invalid = bytes.slice(); new DataView(invalid.buffer).setBigUint64(0, 0n, true); d.gasData.payment[0].digest = toBase58(invalid); },
    d => { const invalid = bytes.slice(); new DataView(invalid.buffer).setUint32(8, original.epoch.epochId - 1, true); d.gasData.payment[0].digest = toBase58(invalid); },
  ]) await assert.rejects(() => withPayment(mutate).then(response => checkSim(f, response)));
});

test('simulation bytes or unindexed effects cannot establish a confirmed rollover', async () => {
  const f = await createRolloverFixtures();
  await assert.rejects(() => checkReceipt(f, f.simulation), /simulation/);
  for (const mutate of [
    r => { r.simulatedIdsAreNotDeployedIds = true; },
    r => { r.data.transaction.effects.checkpoint = null; },
    r => { r.data.transaction.digest = '11111111111111111111111111111111'; },
    r => { r.data.transaction.transactionBcs = r.data.transaction.transactionBcs.slice(5); },
    r => { r.data.transaction.effects.transaction.transactionBcs = ''; },
    r => { r.data.checkpoint = { ...r.data.checkpoint, sequenceNumber: r.data.transaction.effects.checkpoint.sequenceNumber - 1 }; },
    r => { registry(r.data).digest = '11111111111111111111111111111112'; },
  ]) {
    const response = clone(f.confirmation); mutate(response); await assert.rejects(() => checkReceipt(f, response));
  }
});

test('a verified historical rollover remains verifiable after later Registry progress', async () => {
  const f = await createRolloverFixtures(), response = clone(f.confirmation);
  const live = registry(response.data); live.version++; live.digest = '11111111111111111111111111111112';
  Object.assign(contents(live), { total_seeds: '1', total_growth_points: '10', eligible_growth_points: '10', reward_pool: '7000000' });
  live.previousTransaction = { digest: '11111111111111111111111111111113' };
  const receipt = await checkReceipt(f, response);
  assert.equal(receipt.hasAdvanced, true); assert.equal(receipt.digest, f.digest);
  assert.equal(contents(receipt.registryOutput).total_seeds, '0');
  contents(live).season_start_ms = '1';
  await assert.rejects(() => checkReceipt(f, response), /schedule/);
});

test('failed receipts stay locked on changed state, created objects, missing proof, or wrong kind', async () => {
  for (const mutate of [
    f => { contents(registry(f.confirmation.data)).reward_pool = '1'; },
    f => { f.confirmation.data.transaction.effects.events.nodes.push({}); },
    f => { f.confirmation.data.transaction.effects.objectChanges.nodes.push(clone(f.simulation.data.simulateTransaction.effects.objectChanges.nodes.find(x => x.idCreated))); },
    f => { f.confirmation.data.transaction.effects.executionError = null; },
    f => { f.confirmation.data.transaction.effects.balanceChangesJson[0].amount = '0'; },
  ]) {
    const f = makeConfirmedRolloverFailure(await createRolloverFixtures()); mutate(f);
    await assert.rejects(() => checkReceipt(f), error => !error.confirmedFailure?.permitsRetry);
  }
  const f = makeConfirmedRolloverFailure(await createRolloverFixtures());
  const tx = Transaction.from(f.bytes), input = tx.getData();
  input.inputs[3].Pure.bytes = bcs.u64().serialize('86400000').toBase64();
  const altered = Transaction.from(JSON.stringify(input)), bytes = toBase64(await altered.build());
  f.digest = await altered.getDigest(); f.confirmation.data.transaction.digest = f.digest;
  f.confirmation.data.transaction.transactionBcs = bytes;
  f.confirmation.data.transaction.effects.transaction.transactionBcs = bytes;
  for (const connection of ['registries', 'adminCaps']) f.confirmation.data[connection].nodes[0].previousTransaction.digest = f.digest;
  await assert.rejects(() => checkReceipt(f), error => !error.confirmedFailure?.permitsRetry);
});
