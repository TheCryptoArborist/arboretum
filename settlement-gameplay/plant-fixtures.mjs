// Synthetic offline test fixture factory. Never imported by the published app.
// Actual immutable setup/start proofs are retained. The planting simulation is
// deliberately promoted into synthetic receipt-shaped data only for tests.
import fs from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { EXPECTED, validateInputs, buildReviewedPlant, validateConfirmedPlant } from './plant-core.mjs';
const directory = new URL('./verification/mainnet/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name + '.json', directory), 'utf8'));
const captured = { proof: read('proof'), inputs: read('inputs-complete'), simulation: read('simulation-complete'), packet: read('packet') };
const clone = value => structuredClone(value);
function small(response) {
  const data = clone(response.response.data);
  data.ownedNFTs.nodes = data.ownedNFTs.nodes.slice(0, 2);
  data.ownedNFTs.pageInfo = { hasNextPage: false, endCursor: null };
  delete data.nftPageCursors;
  return { data };
}
export async function createPlantFixtures() {
  const now = Date.parse(captured.simulation.capturedAt);
  const proof = { data: clone(captured.proof.response.data) };
  const inputs = small(captured.inputs), simulation = small(captured.simulation);
  const state = await validateInputs(inputs, proof, { now });
  const packet = await buildReviewedPlant(captured.packet.nftId, state);
  const effects = clone(simulation.data.simulateTransaction.effects);
  const executionTime = effects.unchangedConsensusObjects.nodes[0].object.asMoveObject.contents.json.timestamp_ms;
  const sequenceNumber = simulation.data.checkpoint.sequenceNumber + 1;
  const checkpoint = { sequenceNumber, timestamp: new Date(Math.max(now, Number(executionTime))).toISOString() };
  effects.checkpoint = checkpoint;
  const bytes = effects.transaction.transactionBcs, digest = await Transaction.from(bytes).getDigest();
  const confirmation = small(captured.simulation);
  delete confirmation.data.simulateTransaction;
  confirmation.data.checkpoint = { ...confirmation.data.checkpoint, ...checkpoint };
  confirmation.data.transaction = { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects };
  const registry = clone(effects.objectChanges.nodes.find(x => x.address === EXPECTED.registryId).outputState);
  registry.previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint } };
  confirmation.data.registries.nodes[0] = registry;
  const seed = clone(effects.objectChanges.nodes.find(x => x.outputState?.asMoveObject?.contents?.type?.repr === `${EXPECTED.packageId}::settlement::Seed`).outputState);
  seed.previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint } };
  confirmation.data.ownedSeeds = { nodes: [seed], pageInfo: { hasNextPage: false, endCursor: null } };
  const nft = clone(effects.objectChanges.nodes.find(x => x.address === packet.nftId).outputState);
  confirmation.data.ownedNFTs.nodes[0] = nft;
  const parsedReceipt = await validateConfirmedPlant(confirmation, digest, proof, { now });
  return { synthetic: true, now, inputs, proof, simulation, confirmation, digest, bytes, packet,
    nftId: packet.nftId, seedId: seed.address, parsedReceipt };
}
