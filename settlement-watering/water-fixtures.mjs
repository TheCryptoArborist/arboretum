// Explicitly synthetic future-success fixtures for offline tests only.
// Never imported by the deployed UI. No successful mainnet watering is claimed.
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { toBase64 } from '@mysten/bcs';
import { EXPECTED, contents, inspectWaterState, buildReviewedWater } from './water-core.mjs';

const observed = JSON.parse(fs.readFileSync(new URL('./verification/observed-inputs-20261031.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const GAS_ID = '0x' + 'a'.repeat(64);
const makeObject = (id, version, digest, owner, type, json) => ({ address: id, version, digest, owner,
  asMoveObject: { contents: { type: { repr: type }, json } } });
export const observedWaterInput = () => clone(observed);
export async function createWaterFixtures() {
  const now = Number(EXPECTED.waterReadyMs) + 10000;
  const inputs = { data: clone(observed.response.data) };
  inputs.data.checkpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber + 400000,
    timestamp: new Date(now).toISOString() };
  contents(inputs.data.clock).timestamp_ms = String(now);
  inputs.data.clock.version += 400000;
  const state = inspectWaterState(inputs, { nowMs: now }), packet = await buildReviewedWater(state);
  const sender = { __typename: 'AddressOwner', address: { address: EXPECTED.sender } };
  const inputDigest = inputs.data.seed.digest;
  const gasInput = makeObject(GAS_ID, 100, inputDigest, sender, `${SUI}::coin::Coin<${SUI_TYPE}>`, { id: GAS_ID, balance: '1000000000' });
  const transaction = Transaction.fromKind(packet.kindBase64);
  transaction.setSender(EXPECTED.sender); transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasBudget(1000000); transaction.setGasPrice(1000);
  transaction.setGasPayment([{ objectId: GAS_ID, version: '100', digest: inputDigest }]);
  const bytes = toBase64(await transaction.build()), digest = await transaction.getDigest();
  const version = Math.max(inputs.data.registry.version, inputs.data.seed.version, inputs.data.clock.version) + 1;
  const outputDigest = '11111111111111111111111111111111';
  const registryOut = clone(inputs.data.registry), seedOut = clone(inputs.data.seed);
  for (const object of [registryOut, seedOut]) { object.version = version; object.digest = outputDigest; delete object.previousTransaction; }
  Object.assign(contents(registryOut), { total_growth_points: '24', eligible_growth_points: '24' });
  Object.assign(contents(seedOut), { last_watered_ms: String(now), growth_points: '24', cutoff_growth_points: '24', watering_streak: '2' });
  const parent = contents(inputs.data.registry).player_growth.id;
  const fieldId = deriveDynamicFieldID(parent, TypeTagSerializer.parseFromStr('address'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const fieldOwner = { __typename: 'ObjectOwner', address: { address: parent } };
  const fieldIn = makeObject(fieldId, inputs.data.seed.version, inputDigest, fieldOwner,
    `${SUI}::dynamic_field::Field<address, u64>`, { id: fieldId, name: EXPECTED.sender, value: '10' });
  const fieldOut = clone(fieldIn); fieldOut.version = version; fieldOut.digest = outputDigest; contents(fieldOut).value = '24';
  const gasOut = clone(gasInput); gasOut.version = version; gasOut.digest = outputDigest; contents(gasOut).balance = '999899349';
  const change = (inputState, outputState) => ({ address: inputState.address, idCreated: false, idDeleted: false, inputState: clone(inputState), outputState });
  const effects = { status: 'SUCCESS', executionError: null, checkpoint: null, epoch: { epochId: 1300 }, lamportVersion: version,
    transaction: { transactionBcs: bytes, sender: { address: EXPECTED.sender } },
    gasEffects: { gasSummary: { computationCost: 100000, storageCost: 6513200, storageRebate: 6512549, nonRefundableStorageFee: 651 } },
    balanceChangesJson: [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: '-100651' }],
    objectChanges: { nodes: [change(inputs.data.registry, registryOut), change(inputs.data.seed, seedOut), change(fieldIn, fieldOut), change(gasInput, gasOut)],
      pageInfo: { hasNextPage: false, endCursor: null } },
    events: { nodes: [{ sender: { address: EXPECTED.sender }, contents: { type: { repr: `${EXPECTED.packageId}::settlement::SeedWatered` },
      json: { seed_id: EXPECTED.seedId, owner: EXPECTED.sender, streak: '2', growth_points: '24' } } }], pageInfo: { hasNextPage: false, endCursor: null } },
    unchangedConsensusObjects: { nodes: [{ __typename: 'ConsensusObjectRead', object: clone(inputs.data.clock) }],
      pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const simulation = { data: { ...clone(inputs.data), simulateTransaction: { effects: clone(effects) } } };
  const confirmedCheckpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber + 1, timestamp: new Date(now).toISOString() };
  const receiptEffects = clone(effects); receiptEffects.checkpoint = confirmedCheckpoint;
  const confirmation = { data: { ...clone(inputs.data), checkpoint: confirmedCheckpoint,
    registry: { ...clone(registryOut), previousTransaction: { digest } }, seed: { ...clone(seedOut), previousTransaction: { digest } },
    transaction: { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: receiptEffects } } };
  return { synthetic: true, now, inputs, simulation, confirmation, packet, digest, bytes, seedId: EXPECTED.seedId,
    seedReference: packet.seedReference, state, fieldId, gasId: GAS_ID };
}
