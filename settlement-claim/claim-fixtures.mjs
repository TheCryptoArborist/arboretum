// Offline fixtures only; never imported by the deployed UI.
// The captured mainnet simulation is real and unsigned. All confirmed receipts
// constructed below are explicitly synthetic and prove no on-chain claim.
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/bcs';
import { EXPECTED, contents, inspectClaimState, buildReviewedClaim } from './claim-core.mjs';

const captured = JSON.parse(fs.readFileSync(new URL('./verification/initial-mainnet-simulation-20261105.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const SUI = '0x' + '0'.repeat(63) + '2', SUI_TYPE = `${SUI}::sui::SUI`, COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
const GAS_ID = '0x' + 'a'.repeat(64), REWARD_ID = '0x' + 'c'.repeat(64);
const makeObject = (id, version, digest, owner, type, json) => ({ address: id, version, digest, owner,
  asMoveObject: { contents: { type: { repr: type }, json } } });
export const observedClaimSimulation = () => clone(captured);
export function observedClaimInput() {
  const { simulateTransaction: ignored, ...data } = clone(captured.response.data);
  return { capturedAt: captured.observedAt, response: { data } };
}
export async function createClaimFixtures(options = {}) {
  const { growthPoints = '10', finalized = false, poolMist = '7000000', paused = false, gasMode = 'coin' } = options;
  if (!['10', '24'].includes(growthPoints)) throw new Error('Synthetic fixtures support 10 or 24 GP.');
  if (!['coin', 'address'].includes(gasMode)) throw new Error('Use coin or address fixture gas.');
  const now = options.nowMs ?? Date.parse(captured.observedAt) + 10000;
  const inputs = { data: observedClaimInput().response.data };
  inputs.data.checkpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber + 10, timestamp: new Date(now).toISOString() };
  contents(inputs.data.clock).timestamp_ms = String(now); inputs.data.clock.version += 10;
  const r = contents(inputs.data.registry), s = contents(inputs.data.seed);
  Object.assign(r, { reward_pool: poolMist, paused, total_growth_points: growthPoints, eligible_growth_points: growthPoints });
  Object.assign(s, { growth_points: growthPoints, cutoff_growth_points: growthPoints,
    last_watered_ms: growthPoints === '10' ? EXPECTED.plantedAtMs : String(BigInt(EXPECTED.waterReadyMs) + 10000n),
    watering_streak: growthPoints === '10' ? '1' : '2' });
  const frozen = { season_id: '1', season_end_ms: EXPECTED.cutoffMs, claim_deadline_ms: EXPECTED.claimDeadlineMs,
    pool_mist: poolMist, eligible_growth_points: growthPoints, paid_mist: '0', processed_growth_points: '0', processed_seeds: '0' };
  r.settlement = finalized ? clone(frozen) : null;
  const state = inspectClaimState(inputs, { nowMs: now }), packet = await buildReviewedClaim(state);
  const sender = { __typename: 'AddressOwner', address: { address: EXPECTED.sender } }, inputDigest = inputs.data.seed.digest;
  const tx = Transaction.fromKind(packet.kindBase64); tx.setSender(EXPECTED.sender); tx.setGasOwner(EXPECTED.sender);
  tx.setGasBudget(10000000); tx.setGasPrice(100);
  if (gasMode === 'coin') tx.setGasPayment([{ objectId: GAS_ID, version: '100', digest: inputDigest }]);
  else {
    tx.setGasPayment([]); tx.setExpiration({ ValidDuring: { minEpoch: 1302, maxEpoch: 1303, minTimestamp: null, maxTimestamp: null,
      chain: EXPECTED.genesisDigest, nonce: 123 } });
  }
  const bytes = toBase64(await tx.build()), digest = await tx.getDigest();
  const version = Math.max(inputs.data.registry.version, inputs.data.seed.version, inputs.data.clock.version) + 1;
  const outputDigest = '11111111111111111111111111111111', registryOut = clone(inputs.data.registry), seedOut = clone(inputs.data.seed);
  for (const obj of [registryOut, seedOut]) { obj.version = version; obj.digest = outputDigest; delete obj.previousTransaction; }
  Object.assign(contents(registryOut), { reward_pool: '0', settlement: { ...frozen, paid_mist: poolMist, processed_growth_points: growthPoints, processed_seeds: '1' } });
  Object.assign(contents(seedOut), { growth_points: '0', cutoff_growth_points: '0', reward_processed: true });
  const change = (inputState, outputState) => ({ address: inputState.address, idCreated: false, idDeleted: false, inputState: clone(inputState), outputState });
  const changes = [change(inputs.data.registry, registryOut), change(inputs.data.seed, seedOut)];
  if (BigInt(poolMist) > 0n) changes.push({ address: REWARD_ID, idCreated: true, idDeleted: false, inputState: null,
    outputState: makeObject(REWARD_ID, version, outputDigest, sender, COIN_TYPE, { id: REWARD_ID, balance: poolMist }) });
  const net = 1575051n;
  if (gasMode === 'coin') {
    const gasInput = makeObject(GAS_ID, 100, inputDigest, sender, COIN_TYPE, { id: GAS_ID, balance: '1000000000' });
    const gasOut = makeObject(GAS_ID, version, outputDigest, sender, COIN_TYPE, { id: GAS_ID, balance: String(1000000000n - net) });
    changes.push(change(gasInput, gasOut));
  }
  const event = (name, json) => ({ sender: { address: EXPECTED.sender }, contents: { type: { repr: `${EXPECTED.packageId}::settlement::${name}` }, json } });
  const events = [];
  if (!finalized) events.push(event('RewardSettlementFinalized', { registry_id: EXPECTED.registryId, season_id: '1', season_end_ms: EXPECTED.cutoffMs,
    claim_deadline_ms: EXPECTED.claimDeadlineMs, pool_mist: poolMist, eligible_growth_points: growthPoints }));
  events.push(event('RewardEntitlementProcessed', { registry_id: EXPECTED.registryId, season_id: '1', seed_id: EXPECTED.seedId,
    owner: EXPECTED.sender, eligible_growth_points: growthPoints, amount_mist: poolMist }));
  if (BigInt(poolMist) > 0n) events.push(event('RewardClaimed', { owner: EXPECTED.sender, amount_mist: poolMist }));
  const effects = { status: 'SUCCESS', executionError: null, checkpoint: null, epoch: { epochId: 1302 }, lamportVersion: version,
    transaction: { transactionBcs: bytes, sender: { address: EXPECTED.sender } },
    gasEffects: { gasSummary: { computationCost: 100000, storageCost: 7987600, storageRebate: 6512549, nonRefundableStorageFee: 651 } },
    balanceChangesJson: [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(BigInt(poolMist) - net) }],
    objectChanges: { nodes: changes, pageInfo: { hasNextPage: false, endCursor: null } },
    events: { nodes: events, pageInfo: { hasNextPage: false, endCursor: null } },
    unchangedConsensusObjects: { nodes: [{ __typename: 'ConsensusObjectRead', object: clone(inputs.data.clock) }], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const simulation = { data: { ...clone(inputs.data), simulateTransaction: { effects: clone(effects) } } };
  const receiptCheckpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber + 1, timestamp: new Date(now).toISOString() };
  const receiptEffects = clone(effects); receiptEffects.checkpoint = receiptCheckpoint;
  const confirmation = { data: { ...clone(inputs.data), checkpoint: receiptCheckpoint,
    registry: { ...clone(registryOut), previousTransaction: { digest } }, seed: { ...clone(seedOut), previousTransaction: { digest } },
    transaction: { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: receiptEffects } } };
  return { synthetic: true, now, inputs, simulation, confirmation, packet, digest, bytes, state,
    seedId: EXPECTED.seedId, seedReference: packet.seedReference, gasId: GAS_ID, rewardCoinId: BigInt(poolMist) > 0n ? REWARD_ID : null };
}
export function makeConfirmedClaimFailure(fixture) {
  const data = fixture.confirmation.data, effects = data.transaction.effects;
  effects.status = 'FAILURE'; effects.executionError = { message: 'Synthetic confirmed claim abort for offline recovery testing.' };
  effects.events.nodes = [];
  effects.objectChanges.nodes = effects.objectChanges.nodes.filter(x => !x.idCreated);
  for (const name of ['registry', 'seed']) {
    const id = name === 'registry' ? EXPECTED.registryId : EXPECTED.seedId;
    const change = effects.objectChanges.nodes.find(x => x.address === id);
    change.outputState.asMoveObject.contents.json = clone(contents(change.inputState));
    data[name] = { ...clone(change.outputState), previousTransaction: { digest: fixture.digest } };
  }
  const g = effects.gasEffects.gasSummary;
  effects.balanceChangesJson[0].amount = String(-(BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate)));
  return fixture;
}
