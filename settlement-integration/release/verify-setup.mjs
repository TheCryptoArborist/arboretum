// Offline verification of the captured empty-Registry proposal. This module has
// no network, signing, submission, or file-writing path. A verified historical
// simulation is not a live setup receipt and does not authorize a wallet action.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58 } from '@mysten/bcs';
import { EXPECTED as UPGRADE } from '../../settlement-admin/upgrade-core.mjs';
import { LEGACY_TYPE_ORIGINS, SETTLEMENT_TYPE_NAMES } from '../../settlement-admin/upgrade-constants.mjs';

export const SETUP_EXPECTED = Object.freeze({
  packageId: '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a',
  upgradeDigest: 'GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU',
  upgradeCheckpoint: Object.freeze({ sequenceNumber: 340000251, timestamp: '2026-10-31T03:31:58.538Z' }),
  legacyAdminCap: Object.freeze({ objectId: UPGRADE.legacyAdminCap, version: '986499447',
    digest: '36Cg64NBM7Pa2NEageUkzgZ8MZydWD4BtKavLb3ZgqWN' }),
  kindSha256: '2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b',
  kindBytes: 154,
  // Recorded in contract-payout/evidence/verification-summary.json for the
  // source that produced the reviewed and now-confirmed settlement module.
  sourceSha256: '91c9b8c7e74187107f005a164c898e77658dfefe86fb13f22b8a6abaeff28edb',
  simulationQuerySha256: '4cea7b883c4ef238673bfbe38cde79c56563c13a2e1a26d4649a611dc7db832a',
  reviewedGasMist: '5632932',
});
const SUI = '0x' + '0'.repeat(63) + '2';
const TABLES = ['seeds_by_owner', 'referrers', 'referral_earnings', 'player_growth', 'player_growth_season', 'planted_saplings'];
const OWNER = { __typename: 'AddressOwner', address: { address: UPGRADE.sender } };
const legacyCapType = `${UPGRADE.originalPackageId}::arboretum::AdminCap`;
const registryType = `${SETUP_EXPECTED.packageId}::settlement::Registry`;
const capType = `${SETUP_EXPECTED.packageId}::settlement::AdminCap`;
const eventType = `${SETUP_EXPECTED.packageId}::settlement::SettlementRegistryCreated`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fields = object => object?.asMoveObject?.contents?.json;
const objectType = object => object?.asMoveObject?.contents?.type?.repr;
const ref = object => ({ objectId: object?.address, version: String(object?.version), digest: object?.digest });
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);
function address(value) { assert.match(value ?? '', /^0x[0-9a-f]{64}$/, 'Invalid object address'); return value; }
function digest(value) { assert.equal(fromBase58(value ?? '').length, 32, 'Invalid digest'); return value; }
function checkpoint(value) {
  assert.ok(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0, 'Missing checkpoint');
  assert.ok(Number.isFinite(Date.parse(value.timestamp)), 'Invalid checkpoint timestamp');
  return value;
}
function complete(connection, label) {
  assert.ok(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false, `Incomplete ${label}`);
  return connection.nodes;
}
function captureData(capture, label) {
  assert.equal(capture?.endpoint, UPGRADE.graphqlEndpoint, `${label}: wrong endpoint`);
  assert.equal(capture.transactionsSubmitted, 0, `${label}: submitted transaction`);
  assert.equal(capture.signaturesProduced, 0, `${label}: signed transaction`);
  assert.match(capture.query ?? '', /^query\s/, `${label}: not an explicit query`);
  assert.ok(!/\bmutation\b|\bexecuteTransaction\b/.test(capture.query), `${label}: not read-only`);
  assert.ok(!capture.response?.errors?.length && capture.response?.data, `${label}: GraphQL error or missing data`);
  const data = capture.response.data;
  checkpoint(data.checkpoint);
  const retrieved = Date.parse(capture.retrievedAt);
  assert.ok(Number.isFinite(retrieved) && Date.parse(data.checkpoint.timestamp) <= retrieved + 30000,
    `${label}: inconsistent capture time`);
  return data;
}
function assertLegacyCap(object) {
  assert.equal(object?.address, UPGRADE.legacyAdminCap, 'Wrong legacy AdminCap');
  same(object.owner, OWNER, 'Legacy AdminCap owner changed');
  assert.equal(objectType(object), legacyCapType, 'Legacy AdminCap type changed');
  same(fields(object), { id: UPGRADE.legacyAdminCap }, 'Legacy AdminCap contents changed');
}
function assertUpgradeCap(object) {
  assert.equal(object?.address, UPGRADE.upgradeCap.objectId, 'Wrong UpgradeCap');
  same(object.owner, OWNER, 'UpgradeCap owner changed');
  assert.equal(objectType(object), `${SUI}::package::UpgradeCap`, 'Wrong UpgradeCap type');
  same(fields(object), { id: UPGRADE.upgradeCap.objectId, package: SETUP_EXPECTED.packageId, version: '12', policy: 0 },
    'Confirmed upgrade has been superseded or its policy changed');
}
const canonicalOrigins = origins => origins.map(x => ({ module: x.module, struct: x.struct, definingId: x.definingId }))
  .sort((a, b) => `${a.module}::${a.struct}`.localeCompare(`${b.module}::${b.struct}`));

async function verifyConfirmation(confirmation) {
  const data = captureData(confirmation, 'Actual upgrade confirmation');
  assert.ok(!data.simulateTransaction && confirmation.simulatedIdsAreNotDeployedIds !== true,
    'A simulation cannot establish the deployed package');
  assert.equal(confirmation.variables?.digest, SETUP_EXPECTED.upgradeDigest);
  const actual = data.transaction;
  assert.equal(actual?.digest, SETUP_EXPECTED.upgradeDigest, 'Wrong actual upgrade digest');
  assert.equal(actual.sender?.address, UPGRADE.sender, 'Wrong actual upgrade sender');
  assert.equal(actual.effects?.status, 'SUCCESS');
  assert.equal(actual.effects.executionError, null);
  same(checkpoint(actual.effects.checkpoint), SETUP_EXPECTED.upgradeCheckpoint, 'Wrong actual upgrade checkpoint');
  const tx = Transaction.from(actual.transactionBcs);
  assert.equal(tx.getData().sender, UPGRADE.sender);
  assert.equal(tx.getData().gasData.owner, UPGRADE.sender);
  assert.equal(await tx.getDigest(), SETUP_EXPECTED.upgradeDigest, 'Actual upgrade bytes/digest differ');
  assert.equal(sha256(await tx.build({ onlyTransactionKind: true })), UPGRADE.kindSha256, 'Actual upgrade kind differs');
  const packages = complete(actual.effects.objectChanges, 'actual upgrade changes').filter(x => x.outputState?.asMovePackage);
  assert.equal(packages.length, 1);
  const created = packages[0], pkg = created.outputState.asMovePackage;
  assert.equal(created.idCreated, true); assert.equal(created.idDeleted, false);
  assert.equal(created.address, SETUP_EXPECTED.packageId);
  assert.equal(created.outputState.address, SETUP_EXPECTED.packageId);
  assert.equal(created.outputState.version, 12);
  assert.equal(pkg.address, SETUP_EXPECTED.packageId); assert.equal(pkg.version, 12);
  const modules = complete(pkg.modules, 'published modules');
  same(modules.map(x => x.name).sort(), ['arboretum', 'settlement']);
  for (const module of modules) assert.equal(sha256(Buffer.from(module.bytes, 'base64')), UPGRADE.publishedHashes[module.name],
    `Published ${module.name} bytes differ`);
  same(canonicalOrigins(pkg.typeOrigins), canonicalOrigins([
    ...LEGACY_TYPE_ORIGINS,
    ...SETTLEMENT_TYPE_NAMES.map(struct => ({ module: 'settlement', struct, definingId: SETUP_EXPECTED.packageId })),
  ]), 'Published type origins differ');
  assertUpgradeCap(data.upgradeCap);
  assertLegacyCap(data.legacyAdminCap);
  same(ref(data.legacyAdminCap), SETUP_EXPECTED.legacyAdminCap, 'Legacy AdminCap input reference changed');
  return data;
}

function expectedPayload() {
  return { version: 1, kind: { programmableTransaction: {
    inputs: [{ kind: 'IMMUTABLE_OR_OWNED', ...SETUP_EXPECTED.legacyAdminCap }],
    commands: [{ moveCall: { package: SETUP_EXPECTED.packageId, module: 'settlement',
      function: 'create_settlement_registry', arguments: [{ kind: 'INPUT', input: 0 }] } }],
  } }, sender: UPGRADE.sender, gasPayment: { owner: UPGRADE.sender } };
}

export async function verifySetupCapture({ packetText, kindBase64, walletTransaction, simulation,
  confirmation, existingRegistryCheck, postSimulationState, sourceText }) {
  assert.equal(sha256(sourceText), SETUP_EXPECTED.sourceSha256, 'Reviewed settlement source differs');
  const confirmed = await verifyConfirmation(confirmation);
  const packet = JSON.parse(packetText);
  same({ packageId: packet.packageId, typeOrigin: packet.typeOrigin, sender: packet.sender,
    legacyAdminCap: packet.legacyAdminCap, actualUpgradeDigest: packet.actualUpgradeDigest,
    actualUpgradeCheckpoint: packet.actualUpgradeCheckpoint }, {
    packageId: SETUP_EXPECTED.packageId, typeOrigin: SETUP_EXPECTED.packageId, sender: UPGRADE.sender,
    legacyAdminCap: SETUP_EXPECTED.legacyAdminCap, actualUpgradeDigest: SETUP_EXPECTED.upgradeDigest,
    actualUpgradeCheckpoint: SETUP_EXPECTED.upgradeCheckpoint,
  }, 'Unsigned packet identity differs');
  for (const key of ['startsSeason', 'fundsPool', 'importsLegacyState']) assert.equal(packet[key], false, key);
  for (const key of ['newRegistryId', 'newAdminCapId']) assert.equal(packet[key], null, 'Simulated IDs are not deployed IDs');
  for (const key of ['transactionsSubmitted', 'signaturesProduced']) assert.equal(packet[key], 0, key);
  assert.equal(packet.checksEnabled, true); assert.equal(packet.doGasSelection, true);
  same(packet.transaction, expectedPayload(), 'Unexpected setup commands, inputs, sender or gas owner');
  const encoded = kindBase64.trim();
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
  const kind = Buffer.from(encoded, 'base64');
  assert.equal(kind.toString('base64'), encoded, 'Noncanonical kind encoding');
  assert.equal(kind.length, SETUP_EXPECTED.kindBytes);
  assert.equal(sha256(kind), SETUP_EXPECTED.kindSha256, 'Setup kind bytes differ');
  assert.equal(packet.transactionKindSha256, SETUP_EXPECTED.kindSha256);
  const tx = new Transaction();
  tx.setSender(UPGRADE.sender);
  tx.moveCall({ target: `${SETUP_EXPECTED.packageId}::settlement::create_settlement_registry`,
    arguments: [tx.objectRef(SETUP_EXPECTED.legacyAdminCap)] });
  same(Buffer.from(await tx.build({ onlyTransactionKind: true })), kind, 'Kind is not the single expected setup call');
  const walletTx = Transaction.from(JSON.stringify(walletTransaction));
  const walletData = walletTx.getData();
  assert.equal(walletData.sender, UPGRADE.sender);
  same(walletData.gasData, { budget: null, price: null, owner: null, payment: null }, 'Wallet gas must remain unset');
  assert.equal(walletData.expiration, null);
  assert.equal(sha256(await walletTx.build({ onlyTransactionKind: true })), SETUP_EXPECTED.kindSha256, 'Wallet kind differs');

  const existing = captureData(existingRegistryCheck, 'Existing Registry check');
  assert.equal(existingRegistryCheck.variables?.type, registryType);
  assert.equal(complete(existing.objects, 'existing Registries').length, 0, 'A settlement Registry already exists');
  const data = captureData(simulation, 'Setup simulation');
  assert.ok(!data.transaction && simulation.simulatedIdsAreNotDeployedIds === true, 'Expected simulation-only evidence');
  assert.equal(sha256(packetText), simulation.unsignedPacketSha256, 'Simulation used a different packet');
  assert.equal(simulation.transactionKindSha256, SETUP_EXPECTED.kindSha256);
  // Pin the reviewed query as well as its variables: comments or an unselected
  // second operation cannot disguise disabled simulation checks.
  assert.equal(sha256(simulation.query), SETUP_EXPECTED.simulationQuerySha256, 'Simulation query/checks differ');
  same(simulation.variables, { transaction: expectedPayload(), adminCap: UPGRADE.legacyAdminCap,
    upgradeCap: UPGRADE.upgradeCap.objectId, legacyRegistry: UPGRADE.legacyRegistry, registryType }, 'Simulation variables differ');
  assert.equal(data.genesis?.sequenceNumber, 0);
  assert.equal(Buffer.from(fromBase58(data.genesis.digest)).subarray(0, 4).toString('hex'), UPGRADE.chainIdentifier, 'Wrong network');
  assert.ok(data.checkpoint.sequenceNumber >= existing.checkpoint.sequenceNumber &&
    existing.checkpoint.sequenceNumber >= SETUP_EXPECTED.upgradeCheckpoint.sequenceNumber, 'Capture checkpoint order differs');
  assert.equal(complete(data.existingRegistries, 'simulation Registry inventory').length, 0, 'A settlement Registry already exists');
  assertLegacyCap(data.legacyAdminCap);
  same(ref(data.legacyAdminCap), SETUP_EXPECTED.legacyAdminCap);
  assertUpgradeCap(data.upgradeCap);
  same(ref(data.upgradeCap), ref(confirmed.upgradeCap), 'Current UpgradeCap reference changed');
  assert.equal(data.legacyRegistry?.address, UPGRADE.legacyRegistry);
  assert.equal(data.legacyRegistry.owner?.__typename, 'Shared');
  assert.equal(objectType(data.legacyRegistry), `${UPGRADE.originalPackageId}::arboretum::Registry`);
  assert.equal(fields(data.legacyRegistry)?.id, UPGRADE.legacyRegistry);
  assert.equal(fields(data.legacyRegistry)?.admin, UPGRADE.sender);

  const effects = data.simulateTransaction?.effects;
  assert.equal(effects?.status, 'SUCCESS', 'Setup simulation failed');
  assert.equal(effects.executionError, null);
  assert.ok(effects.checkpoint == null, 'A simulation is not a confirmed setup receipt');
  const changes = complete(effects.objectChanges, 'simulated object changes');
  assert.equal(changes.length, 9, 'Expected two new objects, six wrapped tables and one legacy capability version update');
  assert.equal(new Set(changes.map(x => address(x.address))).size, 9, 'Duplicate object changes');
  const registryChanges = changes.filter(x => objectType(x.outputState) === registryType);
  const adminChanges = changes.filter(x => objectType(x.outputState) === capType);
  assert.equal(registryChanges.length, 1, 'Expected one new settlement Registry');
  assert.equal(adminChanges.length, 1, 'Expected one new settlement AdminCap');
  const registry = registryChanges[0].outputState, admin = adminChanges[0].outputState;
  const nextVersion = Number(BigInt(SETUP_EXPECTED.legacyAdminCap.version) + 1n);
  const simulatedDigest = digest(registry.previousTransaction?.digest);
  function outputState(object) {
    address(object.address); digest(object.digest);
    assert.equal(object.version, nextVersion, 'Unexpected simulated output version');
    same(object.previousTransaction, { digest: simulatedDigest, effects: { status: 'SUCCESS', checkpoint: null } },
      'Simulated output carries an unexpected transaction/checkpoint');
  }
  for (const change of [registryChanges[0], adminChanges[0]]) {
    assert.equal(change.idCreated, true); assert.equal(change.idDeleted, false); assert.equal(change.inputState, null);
    assert.equal(change.address, change.outputState.address); outputState(change.outputState);
  }
  same(registry.owner, { __typename: 'Shared', initialSharedVersion: nextVersion }, 'New Registry must be shared');
  same(admin.owner, OWNER, 'New settlement AdminCap must remain with the administrator');
  const tableValues = Object.fromEntries(TABLES.map(name => {
    const table = fields(registry)?.[name];
    return [name, { id: address(table?.id), size: '0' }];
  }));
  same(fields(registry), { id: registry.address, version: '1', admin: UPGRADE.sender,
    current_season_id: '0', season_start_ms: '0', reward_pool: '0', treasury: '0', total_seeds: '0',
    total_growth_points: '0', eligible_growth_points: '0', settlement: null, paused: false, ...tableValues },
  'Registry is not the exact empty, unstarted Registry from the reviewed source');
  same(fields(admin), { id: admin.address, version: '1', registry_id: registry.address }, 'New AdminCap linkage differs');
  const tables = Object.values(tableValues).map(x => x.id).sort();
  assert.equal(new Set(tables).size, 6, 'Registry table IDs must be distinct');
  const wrapped = changes.filter(x => x.idCreated === true && x.outputState === null);
  same(wrapped.map(x => x.address).sort(), tables, 'Wrapped object IDs must be exactly the six Registry tables');
  for (const change of wrapped) { assert.equal(change.inputState, null); assert.equal(change.idDeleted, false); }
  const capChanges = changes.filter(x => x.address === UPGRADE.legacyAdminCap);
  assert.equal(capChanges.length, 1);
  const cap = capChanges[0];
  assert.equal(cap.idCreated, false); assert.equal(cap.idDeleted, false);
  assertLegacyCap(cap.inputState); assertLegacyCap(cap.outputState);
  same(ref(cap.inputState), SETUP_EXPECTED.legacyAdminCap, 'Legacy capability input ref differs');
  outputState(cap.outputState);
  assert.notEqual(cap.outputState.digest, cap.inputState.digest, 'Capability version advance must change its digest');
  // Owner/type/contents stay identical; Sui advances this owned input's metadata
  // even though the Move function accepts &LegacyAdminCap. Do not equate refs.
  const allowed = new Set([registry.address, admin.address, UPGRADE.legacyAdminCap, ...tables]);
  assert.equal(allowed.size, 9); assert.ok(changes.every(x => allowed.has(x.address)), 'Unexpected object change');
  const events = complete(effects.events, 'simulation events');
  same(events, [{ sender: { address: UPGRADE.sender }, contents: { type: { repr: eventType },
    json: { registry_id: registry.address, admin: UPGRADE.sender, legacy_cap_id: UPGRADE.legacyAdminCap } } }],
  'Expected only the exact SettlementRegistryCreated event');
  const gas = effects.gasEffects?.gasSummary;
  function mist(value) {
    assert.ok((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === 'string' && /^\d+$/.test(value)), 'Invalid gas amount');
    return BigInt(value);
  }
  const net = mist(gas?.computationCost) + mist(gas?.storageCost) - mist(gas?.storageRebate);
  mist(gas.nonRefundableStorageFee);
  assert.equal(String(net), SETUP_EXPECTED.reviewedGasMist, 'Captured gas estimate changed; review the new estimate');
  same(effects.balanceChangesJson, [{ address: UPGRADE.sender, coinType: `${SUI}::sui::SUI`, amount: String(-net) }],
    'Expected only the administrator gas debit');

  const post = captureData(postSimulationState, 'Post-simulation observation');
  assert.ok(!post.transaction && !post.simulateTransaction, 'Post-state must be a real read, not execution scope');
  assert.ok(post.checkpoint.sequenceNumber >= data.checkpoint.sequenceNumber, 'Post-state predates simulation');
  same(postSimulationState.variables, { adminCap: UPGRADE.legacyAdminCap, upgradeCap: UPGRADE.upgradeCap.objectId,
    registry: UPGRADE.legacyRegistry, type: registryType, simulatedRegistry: registry.address, simulatedAdmin: admin.address },
  'Post-state checked different identities');
  for (const name of ['legacyAdminCap', 'upgradeCap', 'legacyRegistry'])
    same(post[name], data[name], `Live ${name} changed after the simulation`);
  assert.equal(complete(post.existingRegistries, 'post-simulation Registry inventory').length, 0,
    'A live settlement Registry now exists');
  assert.equal(post.simulatedRegistry, null, 'Simulated Registry was found on-chain');
  assert.equal(post.simulatedAdmin, null, 'Simulated AdminCap was found on-chain');
  assert.equal(postSimulationState.simulatedIdsAreNotDeployedIds, true);
  assert.equal(postSimulationState.newRegistryId, null); assert.equal(postSimulationState.newAdminCapId, null);

  return { status: 'UNSIGNED_EMPTY_REGISTRY_SETUP_SIMULATION_VERIFIED', packageId: SETUP_EXPECTED.packageId,
    actualUpgradeDigest: SETUP_EXPECTED.upgradeDigest, actualUpgradeCheckpoint: SETUP_EXPECTED.upgradeCheckpoint,
    sourceSha256: SETUP_EXPECTED.sourceSha256, transactionKindSha256: SETUP_EXPECTED.kindSha256,
    transactionKindBytes: kind.length, unsignedPacketSha256: sha256(packetText), checkpoint: data.checkpoint,
    command: `${SETUP_EXPECTED.packageId}::settlement::create_settlement_registry`, commandCount: 1,
    event: eventType, gasEstimateMist: String(net), gasEstimateSui: '0.005632932',
    objectChanges: { newRegistry: 1, newAdminCap: 1, wrappedEmptyTables: 6, legacyAdminCapVersionUpdate: 1 },
    legacyAdminCap: { ownerTypeContentsUnchanged: true, simulatedReferenceAdvanced: true,
      inputReference: ref(cap.inputState), simulatedOutputReference: ref(cap.outputState) },
    simulationOnly: { registryId: registry.address, adminCapId: admin.address, wrappedTableIds: tables },
    simulatedIdsAreNotDeployedIds: true, newRegistryId: null, newAdminCapId: null,
    postSimulationObservation: { checkpoint: post.checkpoint, liveReferencesAndContentsUnchanged: true,
      existingRegistryCount: 0, simulatedRegistryAndAdminCapAbsent: true },
    existingRegistryCountAtCapture: 0, startsSeason: false, fundsPool: false, importsLegacyState: false,
    legacyRegistryInTransaction: false, requiresFreshReviewBeforeSigning: true,
    transactionsSubmitted: 0, signaturesProduced: 0 };
}

export function readSetupCapture(directory) {
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  return { packetText: read('unsigned-setup.json'), kindBase64: read('setup-kind.b64'),
    walletTransaction: JSON.parse(read('wallet-transaction.json')), simulation: JSON.parse(read('setup-simulation.json')),
    confirmation: JSON.parse(read('actual-upgrade-confirmation.json')),
    existingRegistryCheck: JSON.parse(read('existing-registry-check.json')),
    postSimulationState: JSON.parse(read('post-simulation-state.json')),
    sourceText: fs.readFileSync(new URL('../../contract-payout/source/settlement.move', import.meta.url), 'utf8') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node verify-setup.mjs <captured-setup-directory>');
  console.log(JSON.stringify(await verifySetupCapture(readSetupCapture(path.resolve(process.argv[2]))), null, 2));
}
