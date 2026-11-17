// Offline fixtures only. Never imported by the deployed page.
// Captures are public, unsigned mainnet simulations; every confirmed receipt
// constructed here is synthetic and proves no on-chain Season 2 transaction.
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/bcs';
import { EXPECTED, COIN_TYPE, SUI_TYPE, contents, dataOf, inspectState } from './common.mjs';
import { prepareRollover, validateConfirmedRollover } from './rollover-core.mjs';

const folder = './verification/mainnet-scoped-20261108/';
const load = name => JSON.parse(fs.readFileSync(new URL(folder + name + '.json', import.meta.url), 'utf8'));
const capturedProof = load('proof'), capturedSimulation = load('simulation-complete');
const clone = value => structuredClone(value);
const GAS_ID = '0x' + 'a'.repeat(64), OUTPUT_DIGEST = '11111111111111111111111111111111';
export const observedRolloverProof = () => clone(capturedProof);
export const observedRolloverSimulation = () => clone(capturedSimulation);
export const observedRolloverInputs = () => {
  const { simulateTransaction: _sim, ...data } = clone(dataOf(capturedSimulation));
  return { data };
};
const change = (inputState, outputState) => ({ address: inputState.address, idCreated: false,
  idDeleted: false, inputState: clone(inputState), outputState: clone(outputState) });
export async function createRolloverFixtures(options = {}) {
  const gasMode = options.gasMode ?? 'address';
  if (!['address', 'coin'].includes(gasMode)) throw new Error('Use address or coin fixture gas.');
  const now = options.nowMs ?? Date.parse(capturedSimulation.capturedAt) + 10000;
  const inputs = observedRolloverInputs(), proof = { data: clone(dataOf(capturedProof)) };
  const template = clone(dataOf(capturedSimulation).simulateTransaction.effects);
  const checkpoint = { sequenceNumber: inputs.data.checkpoint.sequenceNumber + 100,
    timestamp: new Date(now).toISOString() };
  inputs.data.checkpoint = checkpoint;
  proof.data.checkpoint = { ...checkpoint, sequenceNumber: checkpoint.sequenceNumber - 1 };
  inputs.data.clock.version = template.unchangedConsensusObjects.nodes[0].object.version + 10;
  contents(inputs.data.clock).timestamp_ms = String(now);
  const state = await inspectState(inputs, proof, { nowMs: now });
  const packet = await prepareRollover(state);
  const tx = Transaction.fromKind(packet.kindBase64);
  tx.setSender(EXPECTED.sender); tx.setGasOwner(EXPECTED.sender); tx.setGasBudget(50000000); tx.setGasPrice(100);
  if (gasMode === 'coin') tx.setGasPayment([{ objectId: GAS_ID, version: '100', digest: state.adminCap.digest }]);
  else {
    tx.setGasPayment([]);
    tx.setExpiration({ ValidDuring: { minEpoch: template.epoch.epochId, maxEpoch: template.epoch.epochId + 1,
      minTimestamp: null, maxTimestamp: null, chain: EXPECTED.genesisDigest, nonce: 123 } });
  }
  const bytes = toBase64(await tx.build()), digest = await tx.getDigest();
  const version = Math.max(state.registry.version, state.adminCap.version, inputs.data.clock.version) + 1;
  const output = object => {
    const result = clone(object); result.version = version; result.digest = OUTPUT_DIGEST;
    delete result.previousTransaction; return result;
  };
  const registryOut = output(state.registry), capOut = output(state.adminCap);
  Object.assign(contents(registryOut), { current_season_id: '2',
    season_start_ms: String(BigInt(now) - (BigInt(EXPECTED.maximumDurationMs) - BigInt(EXPECTED.durationMs))),
    total_seeds: '0', total_growth_points: '0', eligible_growth_points: '0', settlement: null });
  const archiveOut = output(template.objectChanges.nodes.find(x => x.idCreated).outputState), archiveId = archiveOut.address;
  archiveOut.owner.initialSharedVersion = version; contents(archiveOut).finalized_at_ms = String(now);
  const changes = [change(state.registry, registryOut), change(state.adminCap, capOut),
    { address: archiveId, idCreated: true, idDeleted: false, inputState: null, outputState: archiveOut }];
  const gas = template.gasEffects.gasSummary;
  const net = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  if (gasMode === 'coin') {
    const gasIn = { address: GAS_ID, version: 100, digest: state.adminCap.digest,
      owner: { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
      asMoveObject: { contents: { type: { repr: COIN_TYPE }, json: { id: GAS_ID, balance: '1000000000' } } } };
    const gasOut = output(gasIn); contents(gasOut).balance = String(1000000000n - net);
    changes.push(change(gasIn, gasOut));
  }
  template.checkpoint = null; template.lamportVersion = version;
  template.transaction = { transactionBcs: bytes, sender: { address: EXPECTED.sender } };
  template.objectChanges.nodes = changes;
  template.balanceChangesJson = [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(-net) }];
  template.unchangedConsensusObjects.nodes[0].object = clone(inputs.data.clock);
  template.events.nodes[0].contents.json.finalized_at_ms = String(now);
  template.events.nodes[2].contents.json.start_ms = String(now);
  const simulation = { data: { ...clone(inputs.data), simulateTransaction: { effects: clone(template) } } };
  const receiptCheckpoint = { ...checkpoint, sequenceNumber: checkpoint.sequenceNumber + 1 };
  const receiptEffects = clone(template); receiptEffects.checkpoint = receiptCheckpoint;
  const confirmation = { data: { ...clone(inputs.data), checkpoint: receiptCheckpoint,
    transaction: { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: receiptEffects } } };
  confirmation.data.registries.nodes = [{ ...clone(registryOut), previousTransaction: { digest } }];
  confirmation.data.adminCaps.nodes = [{ ...clone(capOut), previousTransaction: { digest } }];
  const receipt = await validateConfirmedRollover(confirmation, digest, proof, { nowMs: now });
  return { synthetic: true, now, proof, inputs, simulation, confirmation, digest, bytes, packet, state,
    receipt, parsedReceipt: receipt, gasId: gasMode === 'coin' ? GAS_ID : null, archiveId };
}
export function makeConfirmedRolloverFailure(fixture) {
  const data = fixture.confirmation.data, effects = data.transaction.effects;
  effects.status = 'FAILURE'; effects.executionError = { message: 'Synthetic confirmed atomic rollover abort for recovery testing.' };
  effects.events.nodes = []; effects.objectChanges.nodes = effects.objectChanges.nodes.filter(x => !x.idCreated);
  for (const [connection, id] of [['registries', EXPECTED.registryId], ['adminCaps', EXPECTED.adminCapId]]) {
    const item = effects.objectChanges.nodes.find(x => x.address === id);
    item.outputState.asMoveObject.contents.json = clone(contents(item.inputState));
    data[connection].nodes = [{ ...clone(item.outputState), previousTransaction: { digest: fixture.digest } }];
  }
  delete fixture.receipt; delete fixture.parsedReceipt;
  return fixture;
}
