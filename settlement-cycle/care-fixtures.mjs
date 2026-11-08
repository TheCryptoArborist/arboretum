// Explicitly synthetic offline care fixtures. Never imported by the deployed page.
// Branded contexts are obtained by validating synthetic, actual-shaped receipts;
// none of the successful Season 2 transactions below is asserted to exist on chain.
import { Transaction } from '@mysten/sui/transactions';
import fs from 'node:fs';
import { toBase64 } from '@mysten/bcs';
import { EXPECTED, SUI_TYPE, COIN_TYPE, SEED_TYPE, contents, dataOf, inspectState } from './common.mjs';
import { createRolloverFixtures } from './rollover-fixtures.mjs';
import { attachPlantFields, preparePlant, prepareWater, prepareClaim,
  validateConfirmedPlant, validateConfirmedWater, validateConfirmedClaim } from './care-core.mjs';

const clone = value => structuredClone(value);
const recordedFields = JSON.parse(fs.readFileSync(new URL('./care-observed-fields-20261108.json', import.meta.url), 'utf8'));
export const observedCareFields = () => clone(recordedFields);
const D = '11111111111111111111111111111111';
const GAS_ID = '0x' + 'a'.repeat(64), SEED_ID = '0x' + 'b'.repeat(64);
const TREASURY_ID = '0x' + 'c'.repeat(64), DEVELOPER_ID = '0x' + 'd'.repeat(64), REWARD_ID = '0x' + 'e'.repeat(64);
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const owner = who => ({ __typename: 'AddressOwner', address: { address: who } });
const object = (id, version, type, json, ownedBy = owner(EXPECTED.sender), digest = D) => ({ address: id, version, digest,
  owner: ownedBy, asMoveObject: { contents: { type: { repr: type }, json } } });
const change = (before, after) => ({ address: (before ?? after).address, idCreated: before === null, idDeleted: after === null,
  inputState: clone(before), outputState: clone(after) });
const event = (name, json) => ({ sender: { address: EXPECTED.sender },
  contents: { type: { repr: `${EXPECTED.packageId}::settlement::${name}` }, json } });
export function careLiveInput(confirmation, now) {
  const { transaction: _transaction, simulateTransaction: _simulation, ...data } = clone(dataOf(confirmation));
  data.checkpoint = { sequenceNumber: data.checkpoint.sequenceNumber + 100,
    timestamp: new Date(now).toISOString() };
  data.clock.version += 100; contents(data.clock).timestamp_ms = String(now);
  return { data };
}
export function careFieldsResponse(snapshot, fields) {
  return { data: { genesis: { sequenceNumber: 0, digest: EXPECTED.genesisDigest },
    checkpoint: { ...clone(snapshot.checkpoint), query: clone(fields) } } };
}
function initialFields(snapshot) {
  const fields = clone(recordedFields.response.data.checkpoint.query);
  // Rollover keeps every existing table and field unchanged. Bind the captured
  // values to this synthetic post-rollover checkpoint for fixture construction.
  return attachPlantFields(snapshot, careFieldsResponse(snapshot, fields), EXPECTED.previousNftId).careFields;
}
async function caseFixture(action, inputs, proof, cycle, planting, fields, gasMode, now, options = {}) {
  proof = clone(proof);
  proof.data.checkpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber - 1, timestamp: new Date(now).toISOString() };
  const rawState = await inspectState(inputs, proof, { nowMs: now });
  const fieldResponse = fields ? careFieldsResponse(rawState, fields) : null;
  const state = fields ? attachPlantFields(rawState, fieldResponse, EXPECTED.previousNftId) : rawState;
  const packet = action === 'plant' ? await preparePlant(state, EXPECTED.previousNftId, cycle, { nowMs: now }) :
    action === 'water' ? await prepareWater(state, cycle, planting, { nowMs: now }) : await prepareClaim(state, cycle, planting, { nowMs: now });
  const transaction = Transaction.fromKind(packet.kindBase64); transaction.setSender(EXPECTED.sender);
  transaction.setGasOwner(EXPECTED.sender); transaction.setGasBudget(50000000); transaction.setGasPrice(100);
  if (gasMode === 'coin') transaction.setGasPayment([{ objectId: GAS_ID, version: '100', digest: D }]);
  else {
    transaction.setGasPayment([]); transaction.setExpiration({ ValidDuring: { minEpoch: 1300, maxEpoch: 1301,
      minTimestamp: null, maxTimestamp: null, chain: EXPECTED.genesisDigest, nonce: { plant: 101, water: 102, claim: 103 }[action] } });
  }
  const bytes = toBase64(await transaction.build()), digest = await transaction.getDigest();
  const version = Math.max(state.registry.version, inputs.data.clock.version,
    ...state.nfts.map(x => x.version), ...state.ownedSeeds.map(x => x.version),
    ...Object.values(fields ?? {}).filter(Boolean).map(x => x.version)) + 1;
  const output = item => { const result = clone(item); result.version = version; result.digest = D; delete result.previousTransaction; return result; };
  const registryOut = output(state.registry), r = contents(registryOut), changes = [], events = [];
  let seedOut, nftOut, fieldOutputs = clone(fields), reward = 0n, delta = 0n, gasDebit = 0n;
  const gasNet = BigInt(options.gasNetMist ?? (action === 'plant' ? '3200000' : action === 'water' ? '100651' : '1575051'));
  if (action === 'plant') {
    nftOut = output(state.nfts[0]); changes.push(change(state.nfts[0], nftOut));
    seedOut = object(SEED_ID, version, SEED_TYPE, { id: SEED_ID, version: '1', registry_id: EXPECTED.registryId,
      cutoff_growth_points: '10', reward_processed: false, sapling_id: EXPECTED.previousNftId, season_id: '2', owner: EXPECTED.sender,
      planted_at_ms: String(now), last_watered_ms: String(now), watering_streak: '1', growth_points: '10', state: 0,
      fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0, bottomless_can_expiry_ms: '0', permanent_gp_bonus: '0' });
    changes.push(change(null, seedOut));
    const values = { seedsByOwner: [...contents(fields.seedsByOwner).value, SEED_ID], playerGrowth: '10', playerGrowthSeason: '2', plantedSapling: '2' };
    for (const [alias, field] of Object.entries(fields)) { const out = output(field); contents(out).value = values[alias]; fieldOutputs[alias] = out; changes.push(change(field, out)); }
    Object.assign(r, { total_seeds: '1', total_growth_points: '10', eligible_growth_points: '10', reward_pool: '7000000' });
    for (const [id, who, amount] of [[TREASURY_ID, EXPECTED.treasuryWallet, '2800000'], [DEVELOPER_ID, EXPECTED.sender, '200000']])
      changes.push(change(null, object(id, version, COIN_TYPE, { id, balance: amount }, owner(who))));
    events.push(event('SeedPlanted', { seed_id: SEED_ID, owner: EXPECTED.sender, sapling_id: EXPECTED.previousNftId }));
    delta = -9800000n; gasDebit = 10000000n;
  } else {
    const seedIn = state.ownedSeeds.find(x => x.address === planting.seedId); seedOut = output(seedIn);
    if (action === 'water') {
      Object.assign(contents(seedOut), { last_watered_ms: String(now), watering_streak: '2', growth_points: '24', cutoff_growth_points: '24' });
      Object.assign(r, { total_growth_points: '24', eligible_growth_points: '24' });
      const growth = output(fields.playerGrowth); contents(growth).value = '24'; fieldOutputs.playerGrowth = growth;
      changes.push(change(fields.playerGrowth, growth));
      events.push(event('SeedWatered', { seed_id: planting.seedId, owner: EXPECTED.sender, streak: '2', growth_points: '24' }));
    } else {
      const points = contents(seedIn).cutoff_growth_points; reward = BigInt(r.settlement?.pool_mist ?? r.reward_pool); delta = reward;
      const frozen = { season_id: '2', season_end_ms: cycle.cutoffMs, claim_deadline_ms: cycle.claimDeadlineMs, pool_mist: String(reward),
        eligible_growth_points: points, paid_mist: String(reward), processed_growth_points: points, processed_seeds: '1' };
      if (r.settlement === null) events.push(event('RewardSettlementFinalized', { registry_id: EXPECTED.registryId, season_id: '2',
        season_end_ms: cycle.cutoffMs, claim_deadline_ms: cycle.claimDeadlineMs, pool_mist: String(reward), eligible_growth_points: points }));
      Object.assign(contents(seedOut), { reward_processed: true, growth_points: '0', cutoff_growth_points: '0' });
      r.reward_pool = String(BigInt(r.reward_pool) - reward); r.settlement = frozen;
      events.push(event('RewardEntitlementProcessed', { registry_id: EXPECTED.registryId, season_id: '2', seed_id: planting.seedId,
        owner: EXPECTED.sender, eligible_growth_points: points, amount_mist: String(reward) }));
      if (reward > 0n) { changes.push(change(null, object(REWARD_ID, version, COIN_TYPE, { id: REWARD_ID, balance: String(reward) })));
        events.push(event('RewardClaimed', { owner: EXPECTED.sender, amount_mist: String(reward) })); }
    }
    changes.push(change(seedIn, seedOut));
  }
  changes.unshift(change(state.registry, registryOut));
  if (gasMode === 'coin') {
    const gasInput = object(GAS_ID, 100, COIN_TYPE, { id: GAS_ID, balance: '1000000000' }), gasOut = output(gasInput);
    contents(gasOut).balance = String(1000000000n - gasDebit - gasNet); changes.push(change(gasInput, gasOut));
  }
  const balances = delta === gasNet ? [] : [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(delta - gasNet) }];
  if (action === 'plant') balances.push({ address: EXPECTED.treasuryWallet, coinType: SUI_TYPE, amount: '2800000' });
  const effects = { status: 'SUCCESS', executionError: null, checkpoint: null, epoch: { epochId: 1300 }, lamportVersion: version,
    transaction: { transactionBcs: bytes, sender: { address: EXPECTED.sender } },
    gasEffects: { gasSummary: { computationCost: gasNet < 0n ? 0 : Number(gasNet), storageCost: 0,
      storageRebate: gasNet < 0n ? Number(-gasNet) : 0, nonRefundableStorageFee: 0 } },
    balanceChangesJson: balances, objectChanges: connection(changes), events: connection(events),
    unchangedConsensusObjects: connection([{ __typename: 'ConsensusObjectRead', object: clone(inputs.data.clock) }]) };
  const simulation = { data: { ...clone(inputs.data), simulateTransaction: { effects: clone(effects) } } };
  const confirmedCheckpoint = { ...inputs.data.checkpoint, sequenceNumber: inputs.data.checkpoint.sequenceNumber + 1 };
  const receiptEffects = clone(effects); receiptEffects.checkpoint = confirmedCheckpoint;
  const confirmation = { data: { ...clone(inputs.data), checkpoint: confirmedCheckpoint,
    transaction: { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: receiptEffects } } };
  const withDigest = item => ({ ...clone(item), previousTransaction: { digest } });
  confirmation.data.registries.nodes = [withDigest(registryOut)];
  confirmation.data.ownedSeeds.nodes = [clone(state.oldSeed), withDigest(seedOut)];
  if (nftOut) confirmation.data.ownedNFTs.nodes = [withDigest(nftOut)];
  const receipt = action === 'plant' ? await validateConfirmedPlant(confirmation, digest, proof, cycle, { nowMs: now }) :
    action === 'water' ? await validateConfirmedWater(confirmation, digest, proof, cycle, planting, { nowMs: now }) :
      await validateConfirmedClaim(confirmation, digest, proof, cycle, planting, { nowMs: now });
  return { synthetic: true, action, now, inputs, proof, cycle, planting, state, fields, fieldResponse, fieldOutputs,
    packet, simulation, confirmation, digest, bytes, receipt, seedId: seedOut.address, gasId: gasMode === 'coin' ? GAS_ID : null };
}
export async function createCareFixtures(options = {}) {
  const gasMode = options.gasMode ?? 'coin', growthPoints = options.growthPoints ?? '24';
  if (!['coin', 'address'].includes(gasMode) || !['10', '24'].includes(growthPoints)) throw new Error('Invalid synthetic care fixture options.');
  const rollover = await createRolloverFixtures({ gasMode, ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }) });
  const cycle = rollover.receipt, proof = clone(rollover.proof), now = rollover.now + 10000;
  const input = careLiveInput(rollover.confirmation, now), snapshot = await inspectState(input, proof, { nowMs: now });
  const plant = await caseFixture('plant', input, proof, cycle, null, initialFields(snapshot), gasMode, now, options);
  const waterNow = Number(plant.receipt.waterReadyMs) + 1000;
  const water = await caseFixture('water', careLiveInput(plant.confirmation, waterNow), proof, cycle, plant.receipt,
    clone(plant.fieldOutputs), gasMode, waterNow, options);
  const claimNow = Number(cycle.cutoffMs) + 1000;
  const claimInput = careLiveInput(growthPoints === '24' ? water.confirmation : plant.confirmation, claimNow);
  if (options.paused) contents(claimInput.data.registries.nodes[0]).paused = true;
  if (options.poolMist !== undefined) contents(claimInput.data.registries.nodes[0]).reward_pool = String(options.poolMist);
  if (options.finalized) {
    const r = contents(claimInput.data.registries.nodes[0]); r.settlement = { season_id: '2', season_end_ms: cycle.cutoffMs,
      claim_deadline_ms: cycle.claimDeadlineMs, pool_mist: r.reward_pool, eligible_growth_points: growthPoints,
      paid_mist: '0', processed_growth_points: '0', processed_seeds: '0' };
  }
  if (options.paused || options.poolMist !== undefined || options.finalized) {
    claimInput.data.registries.nodes[0].version += 1; delete claimInput.data.registries.nodes[0].previousTransaction;
  }
  const claim = await caseFixture('claim', claimInput, proof, cycle, plant.receipt, null, gasMode, claimNow, options);
  return { synthetic: true, cycle, proof, rollover, plant, water, claim, growthPoints };
}
export function makeConfirmedCareFailure(fixture) {
  const data = fixture.confirmation.data, effects = data.transaction.effects;
  effects.status = 'FAILURE'; effects.executionError = { message: `Synthetic confirmed ${fixture.action} abort.` };
  effects.events.nodes = []; effects.objectChanges.nodes = effects.objectChanges.nodes.filter(x => !x.idCreated);
  for (const item of effects.objectChanges.nodes) {
    if (item.address === fixture.gasId) continue;
    item.outputState.asMoveObject.contents.json = clone(contents(item.inputState));
  }
  const gas = effects.gasEffects.gasSummary, net = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  const gasChange = effects.objectChanges.nodes.find(x => x.address === fixture.gasId);
  if (gasChange) contents(gasChange.outputState).balance = String(BigInt(contents(gasChange.inputState).balance) - net);
  effects.balanceChangesJson = net === 0n ? [] : [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(-net) }];
  const liveOutput = id => { const item = effects.objectChanges.nodes.find(x => x.address === id);
    return item ? { ...clone(item.outputState), previousTransaction: { digest: fixture.digest } } : null; };
  data.registries.nodes = [liveOutput(EXPECTED.registryId)];
  data.ownedSeeds.nodes = fixture.action === 'plant' ? [clone(fixture.state.oldSeed)] :
    [clone(fixture.state.oldSeed), liveOutput(fixture.planting.seedId)];
  if (fixture.action === 'plant') data.ownedNFTs.nodes = [liveOutput(EXPECTED.previousNftId)];
  delete fixture.receipt; return fixture;
}
