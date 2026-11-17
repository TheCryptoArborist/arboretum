import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSetupCapture, SETUP_EXPECTED, verifySetupCapture } from './verify-setup.mjs';

const directory = fileURLToPath(new URL('./evidence/20261031-empty-registry-review/', import.meta.url));
const original = readSetupCapture(directory);
const fixture = () => structuredClone(original);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const data = value => value.simulation.response.data;
const effects = value => data(value).simulateTransaction.effects;
const changes = value => effects(value).objectChanges.nodes;
const registry = value => changes(value).find(x => x.outputState?.asMoveObject?.contents?.type?.repr.endsWith('::settlement::Registry')).outputState;
const legacyChange = value => changes(value).find(x => x.address === SETUP_EXPECTED.legacyAdminCap.objectId);
const otherAddress = '0x' + '1'.repeat(64);
function changePacket(value, change) {
  const packet = JSON.parse(value.packetText);
  change(packet);
  value.packetText = JSON.stringify(packet, null, 2) + '\n';
  // Rebind the envelope so rejection must come from semantic validation, not
  // merely from forgetting to update a captured JSON checksum.
  value.simulation.unsignedPacketSha256 = sha256(value.packetText);
}
async function rejectChanges(mutators) {
  for (const mutate of mutators) {
    const value = fixture();
    mutate(value);
    await assert.rejects(verifySetupCapture(value), undefined, mutate.toString());
  }
}

test('captured setup verifies the empty Registry, wrapped tables and legitimate legacy capability metadata advance', async () => {
  const result = await verifySetupCapture(fixture());
  assert.equal(result.status, 'UNSIGNED_EMPTY_REGISTRY_SETUP_SIMULATION_VERIFIED');
  assert.equal(result.transactionKindBytes, 154);
  assert.equal(result.commandCount, 1);
  assert.equal(result.gasEstimateSui, '0.005632932');
  assert.deepEqual(result.objectChanges, { newRegistry: 1, newAdminCap: 1, wrappedEmptyTables: 6, legacyAdminCapVersionUpdate: 1 });
  assert.equal(result.legacyAdminCap.ownerTypeContentsUnchanged, true);
  assert.equal(result.legacyAdminCap.inputReference.version, '986499447');
  assert.equal(result.legacyAdminCap.simulatedOutputReference.version, '986499448');
  assert.notEqual(result.legacyAdminCap.inputReference.digest, result.legacyAdminCap.simulatedOutputReference.digest);
  assert.equal(result.simulatedIdsAreNotDeployedIds, true);
  assert.equal(result.newRegistryId, null);
  assert.equal(result.newAdminCapId, null);
  assert.equal(result.postSimulationObservation.liveReferencesAndContentsUnchanged, true);
  assert.equal(result.postSimulationObservation.simulatedRegistryAndAdminCapAbsent, true);
  assert.equal(result.requiresFreshReviewBeforeSigning, true);
  assert.equal(result.transactionsSubmitted, 0);
});

test('different sender, authority reference, target, extra call or gas owner cannot replace the reviewed setup', async () => {
  await rejectChanges([
    value => changePacket(value, p => { p.sender = otherAddress; }),
    value => changePacket(value, p => { p.legacyAdminCap.version = '986499448'; }),
    value => changePacket(value, p => { p.packageId = otherAddress; p.typeOrigin = otherAddress; }),
    value => changePacket(value, p => { p.transaction.kind.programmableTransaction.commands[0].moveCall.function = 'start_season'; }),
    value => changePacket(value, p => { p.transaction.kind.programmableTransaction.commands.push(p.transaction.kind.programmableTransaction.commands[0]); }),
    value => changePacket(value, p => { p.transaction.gasPayment.owner = otherAddress; }),
    value => { value.simulation.variables.transaction.sender = otherAddress; },
  ]);
});

test('tampered kind bytes and a modified or prefilled wallet transaction are rejected', async () => {
  await rejectChanges([
    value => { const bytes = Buffer.from(value.kindBase64, 'base64'); bytes[10] ^= 1; value.kindBase64 = bytes.toString('base64'); },
    value => { value.kindBase64 = Buffer.concat([Buffer.from(value.kindBase64, 'base64'), Buffer.from([0])]).toString('base64'); },
    value => { value.walletTransaction.sender = otherAddress; },
    value => { value.walletTransaction.gasData.budget = '6000000'; },
    value => { value.walletTransaction.commands[0].MoveCall.function = 'start_season'; },
    value => { value.walletTransaction.inputs[0].Object.ImmOrOwnedObject.digest = '1'.repeat(32); },
  ]);
});

test('the prerequisite must be the real confirmed reviewed upgrade, with exact published bytecode and types', async () => {
  await rejectChanges([
    value => { value.confirmation.response.data.simulateTransaction = {}; },
    value => { value.confirmation.response.data.transaction.effects.checkpoint = null; },
    value => { value.confirmation.response.data.transaction.digest = '1'.repeat(44); },
    value => { value.confirmation.response.data.transaction.sender.address = otherAddress; },
    value => {
      const tx = value.confirmation.response.data.transaction;
      const bytes = Buffer.from(tx.transactionBcs, 'base64'); bytes[10] ^= 1; tx.transactionBcs = bytes.toString('base64');
    },
    value => {
      const pkg = value.confirmation.response.data.transaction.effects.objectChanges.nodes.find(x => x.outputState?.asMovePackage).outputState.asMovePackage;
      const bytes = Buffer.from(pkg.modules.nodes[1].bytes, 'base64'); bytes[20] ^= 1; pkg.modules.nodes[1].bytes = bytes.toString('base64');
    },
    value => {
      const pkg = value.confirmation.response.data.transaction.effects.objectChanges.nodes.find(x => x.outputState?.asMovePackage).outputState.asMovePackage;
      pkg.typeOrigins[0].definingId = otherAddress;
    },
    value => { value.confirmation.response.data.upgradeCap.asMoveObject.contents.json.version = '13'; },
  ]);
});

test('source drift, another network and an existing or incomplete Registry inventory stop the review', async () => {
  await rejectChanges([
    value => { value.sourceText = value.sourceText.replace('current_season_id: 0', 'current_season_id: 1'); },
    value => { value.simulation.endpoint = 'https://graphql.testnet.sui.io/graphql'; },
    value => { data(value).genesis.digest = '1'.repeat(32); },
    value => { value.existingRegistryCheck.response.data.objects.nodes.push({ address: otherAddress }); },
    value => { data(value).existingRegistries.nodes.push({ address: otherAddress }); },
    value => { data(value).existingRegistries.pageInfo.hasNextPage = true; },
    value => { value.existingRegistryCheck.variables.type = `${otherAddress}::settlement::Registry`; },
  ]);
});

test('disabled checks, response errors, failed execution and incomplete effects are rejected', async () => {
  await rejectChanges([
    value => { value.simulation.query = value.simulation.query.replace('checksEnabled: true', 'checksEnabled: false'); },
    value => { value.simulation.query = value.simulation.query.replace('doGasSelection: true', 'doGasSelection: false'); },
    value => { value.simulation.unsignedPacketSha256 = '0'.repeat(64); },
    value => { value.simulation.response.errors = [{ message: 'partial results' }]; },
    value => { effects(value).status = 'FAILURE'; },
    value => { effects(value).executionError = { message: 'aborted' }; },
    value => { effects(value).objectChanges.pageInfo.hasNextPage = true; },
    value => { effects(value).events.pageInfo.hasNextPage = true; },
  ]);
});

test('funded, started, populated, settled, paused, wrongly owned or mismatched Registry state is rejected', async () => {
  await rejectChanges([
    value => { registry(value).asMoveObject.contents.json.reward_pool = '1'; },
    value => { registry(value).asMoveObject.contents.json.treasury = '1'; },
    value => { registry(value).asMoveObject.contents.json.current_season_id = '1'; },
    value => { registry(value).asMoveObject.contents.json.season_start_ms = '1234'; },
    value => { registry(value).asMoveObject.contents.json.total_seeds = '1'; },
    value => { registry(value).asMoveObject.contents.json.eligible_growth_points = '1'; },
    value => { registry(value).asMoveObject.contents.json.settlement = {}; },
    value => { registry(value).asMoveObject.contents.json.paused = true; },
    value => { registry(value).asMoveObject.contents.json.seeds_by_owner.size = '1'; },
    value => { registry(value).owner = { __typename: 'AddressOwner', address: { address: otherAddress } }; },
    value => {
      const cap = changes(value).find(x => x.outputState?.asMoveObject?.contents?.type?.repr.endsWith('::settlement::AdminCap'));
      cap.outputState.asMoveObject.contents.json.registry_id = otherAddress;
    },
  ]);
});

test('legacy capability authorization may advance metadata but cannot change owner, type, contents or input reference', async () => {
  await rejectChanges([
    value => { legacyChange(value).outputState.owner.address.address = otherAddress; },
    value => { legacyChange(value).outputState.asMoveObject.contents.json.id = otherAddress; },
    value => { legacyChange(value).outputState.asMoveObject.contents.json.extra = 'unreviewed'; },
    value => { legacyChange(value).outputState.asMoveObject.contents.type.repr = `${otherAddress}::arboretum::AdminCap`; },
    value => { legacyChange(value).inputState.version += 1; },
    value => { legacyChange(value).outputState.version = legacyChange(value).inputState.version; },
    value => { legacyChange(value).outputState.version += 1; },
    value => { legacyChange(value).outputState.digest = legacyChange(value).inputState.digest; },
    value => { legacyChange(value).idDeleted = true; },
  ]);
});

test('wrapped table IDs must exactly cover six distinct empty tables without hidden writes or extra objects', async () => {
  await rejectChanges([
    value => { registry(value).asMoveObject.contents.json.referrers.id = registry(value).asMoveObject.contents.json.seeds_by_owner.id; },
    value => { changes(value).find(x => x.outputState === null).address = otherAddress; },
    value => { changes(value).find(x => x.outputState === null).outputState = {}; },
    value => { changes(value).find(x => x.outputState === null).inputState = { address: otherAddress }; },
    value => { changes(value).find(x => x.outputState === null).idDeleted = true; },
    value => { changes(value).push({ address: otherAddress, idCreated: false, idDeleted: false, inputState: {}, outputState: {} }); },
    value => { changes(value)[1].address = changes(value)[0].address; },
  ]);
});

test('unexpected event, recipient, balance movement or fee cannot be accepted as empty setup', async () => {
  await rejectChanges([
    value => { effects(value).events.nodes[0].contents.type.repr = `${SETUP_EXPECTED.packageId}::settlement::SeasonStarted`; },
    value => { effects(value).events.nodes[0].sender.address = otherAddress; },
    value => { effects(value).events.nodes[0].contents.json.legacy_cap_id = otherAddress; },
    value => { effects(value).events.nodes.push(structuredClone(effects(value).events.nodes[0])); },
    value => { effects(value).balanceChangesJson[0].address = otherAddress; },
    value => { effects(value).balanceChangesJson[0].amount = '-1'; },
    value => { effects(value).balanceChangesJson.push({ address: otherAddress, coinType: '0x2::sui::SUI', amount: '1' }); },
    value => { effects(value).gasEffects.gasSummary.computationCost += 1; },
  ]);
});

test('simulation evidence cannot be promoted to a real setup or a signed/submitted packet', async () => {
  await rejectChanges([
    value => { value.simulation.simulatedIdsAreNotDeployedIds = false; },
    value => { effects(value).checkpoint = { sequenceNumber: 340001425, timestamp: '2026-10-31T03:36:45Z' }; },
    value => { registry(value).previousTransaction.effects.checkpoint = { sequenceNumber: 340001425 }; },
    value => { value.simulation.transactionsSubmitted = 1; },
    value => { value.simulation.signaturesProduced = 1; },
    value => changePacket(value, p => { p.newRegistryId = registry(value).address; }),
    value => changePacket(value, p => { p.startsSeason = true; }),
  ]);
});

test('the real post-simulation read must preserve live state and independently find no setup objects', async () => {
  await rejectChanges([
    value => { value.postSimulationState.response.data.legacyAdminCap.version += 1; },
    value => { value.postSimulationState.response.data.upgradeCap.asMoveObject.contents.json.version = '13'; },
    value => { value.postSimulationState.response.data.legacyRegistry.asMoveObject.contents.json.reward_pool = '0'; },
    value => { value.postSimulationState.response.data.existingRegistries.nodes.push({ address: otherAddress }); },
    value => { value.postSimulationState.response.data.existingRegistries.pageInfo.hasNextPage = true; },
    value => { value.postSimulationState.response.data.simulatedRegistry = { address: registry(value).address }; },
    value => { value.postSimulationState.response.data.simulatedAdmin = { address: otherAddress }; },
    value => { value.postSimulationState.variables.simulatedRegistry = otherAddress; },
  ]);
});
