// Verification only: exact production candidate, public proof and unsigned
// simulation. No signer, wallet, execution method or application activation.
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, toBase64 } from '@mysten/bcs';
import { blake2b } from '@noble/hashes/blake2.js';
import { parse, print, stripIgnoredCharacters } from 'graphql';
import { buildUpgrade } from '../release/build-upgrade.mjs';
import { transactionToGrpcJson } from '../../node_modules/@mysten/sui/dist/client/transaction-resolver.mjs';
import { SETUP_EXPECTED } from '../../settlement-setup/setup-core.mjs';
import {
  EXPECTED as V1, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  validateInputs, sha256, contents, reference,
} from '../season-test/start-core.mjs';

export { PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES, validateInputs, sha256 };
const STD = '0x' + '0'.repeat(63) + '1';
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
export const EXPECTED = Object.freeze({
  endpoint: V1.endpoint, sender: V1.sender, packageId: V1.packageId,
  registryId: V1.registryId, adminCapId: V1.adminCapId,
  upgradeCapId: '0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5',
  genesisDigest: SETUP_EXPECTED.genesisDigest, currentPackageVersion: 12,
  predictedPackageVersion: 13, productionInventoryVersion: 2, maxAgeMs: 120000,
  sourceSha256: '091f774707d28a299bd85a0744d61187b16c9b7fe8997886c796c1db62b94df8',
  packageDigestHex: '1985543a00f6de289e170a0d16547b2a6cf709481ecb59bec7c85152393cfba9',
  dependencies: Object.freeze([STD, SUI]),
  prepublicationHashes: Object.freeze({
    arboretum: '2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1',
    settlement: '05ee666e294f1e3229d36bcaf1c0841370b67868798d92d5a2907f4a296a097c',
  }),
  publishedHashes: Object.freeze({
    arboretum: '3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5',
    settlement: '7ad14dd9f01d7c761b8ac9fde3965fd4af80bfabe31e17727716419d4da5c848',
  }),
});
const uint = value => {
  assert.ok((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), 'Malformed unsigned integer');
  return BigInt(value);
};
const address = value => { assert.match(value ?? '', /^0x[0-9a-f]{64}$/, 'Malformed address'); return value; };
const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
const dataOf = response => {
  const raw = response?.response ?? response;
  assert.ok(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response');
  return raw.data;
};
const complete = (connection, label) => {
  assert.ok(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false, `Incomplete ${label}`);
  return connection.nodes;
};
function checkpoint(value, options = {}) {
  assert.ok(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0, 'Invalid checkpoint');
  assert.equal(fromBase58(value.digest).length, 32, 'Invalid checkpoint digest');
  const timestamp = Date.parse(value.timestamp), now = options.now ?? Date.now();
  assert.ok(Number.isSafeInteger(timestamp) && timestamp <= now + 30000 && now - timestamp <= EXPECTED.maxAgeMs,
    'Stale or future checkpoint');
  return timestamp;
}
function network(data) {
  assert.deepEqual(data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest }, 'Wrong network');
}
function ownerIsAdministrator(object) {
  assert.deepEqual(object.owner, { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
    'Administrator ownership changed');
}
function origins(value) {
  assert.ok(Array.isArray(value), 'Missing type origins');
  const items = value.map(item => ({ module: item.module, struct: item.struct, definingId: address(item.definingId) }))
    .sort((a, b) => `${a.module}::${a.struct}`.localeCompare(`${b.module}::${b.struct}`));
  assert.equal(new Set(items.map(item => `${item.module}::${item.struct}`)).size, items.length, 'Duplicate type origins');
  return items;
}
function confirmedPackage(proofResponse) {
  const effects = dataOf(proofResponse).upgradeTransaction?.effects;
  const packages = complete(effects?.objectChanges, 'confirmed upgrade changes')
    .filter(item => item.address === EXPECTED.packageId && item.outputState?.asMovePackage);
  assert.equal(packages.length, 1, 'Confirmed v12 package is missing');
  return packages[0].outputState.asMovePackage;
}
export function validateCandidateBuild(build) {
  assert.equal(build.status, 'UNSIGNED_PRODUCTION_BUILD_VERIFIED');
  assert.equal(build.baselinePackage, EXPECTED.packageId);
  assert.equal(build.candidateObjectVersion, 2);
  assert.equal(build.freshProductionRegistryRequired, true);
  assert.equal(build.migratesExistingObjects, false);
  assert.equal(build.productionPricesApproved, true);
  assert.deepEqual(build.dependencies, EXPECTED.dependencies, 'Candidate dependency IDs changed');
  assert.equal(build.sourceSha256?.['settlement-integration/inventory-boundary/production/settlement.move'], EXPECTED.sourceSha256);
  assert.deepEqual(build.modules.map(item => item.name), ['arboretum', 'settlement'], 'Wrong candidate modules');
  const bytes = build.modules.map(item => {
    const value = Buffer.from(item.base64, 'base64');
    assert.equal(value.toString('base64'), item.base64, 'Noncanonical module encoding');
    assert.equal(value.length, item.size, 'Module size differs');
    assert.equal(sha256(value), EXPECTED.prepublicationHashes[item.name], 'Candidate module bytes changed');
    assert.equal(item.sha256, EXPECTED.prepublicationHashes[item.name]);
    return value;
  });
  const parts = bytes.map(value => Buffer.from(blake2b(value, { dkLen: 32 })));
  parts.push(...EXPECTED.dependencies.map(value => Buffer.from(value.slice(2), 'hex')));
  const computed = Buffer.from(blake2b(Buffer.concat(parts.sort(Buffer.compare)), { dkLen: 32 })).toString('hex');
  assert.equal(computed, EXPECTED.packageDigestHex, 'Package digest changed');
  assert.equal(build.packageDigestHex, computed, 'Build digest differs from module/dependency bytes');
  assert.equal(build.legacyBytecodeUnchanged, true);
  assert.equal(build.all39StructLayoutsPreserved, true);
  assert.equal(build.all85PublicAndEntryAbisPreserved, true);
  assert.equal(build.instructionStructurePreserved, true);
  assert.equal(build.signaturesProduced, 0); assert.equal(build.transactionsSubmitted, 0);
  return { modules: build.modules, packageDigestHex: computed };
}
export async function buildBoundaryUpgrade(inputs, build, proofResponse) {
  validateCandidateBuild(build);
  assert.equal(inputs.upgradeCap?.address, EXPECTED.upgradeCapId, 'Wrong UpgradeCap');
  ownerIsAdministrator(inputs.upgradeCap);
  assert.deepEqual(contents(inputs.upgradeCap), { id: EXPECTED.upgradeCapId,
    package: EXPECTED.packageId, version: '12', policy: 0 }, 'Current upgrade authority differs');
  assert.deepEqual(origins(build.existingTypeOriginsToPreserve), origins(confirmedPackage(proofResponse).typeOrigins),
    'Candidate origins do not match the confirmed v12 publication');
  const verified = { status: 'VERIFIED_UNSIGNED_RELEASE_INPUTS', network: 'mainnet', chainIdentifier: '35834a8a',
    upgradePolicy: 0, signaturesProduced: 0, transactionsSubmitted: 0,
    packageDigestHex: EXPECTED.packageDigestHex, modules: build.modules,
    sender: EXPECTED.sender, upgradeCap: reference(inputs.upgradeCap),
    dependencies: EXPECTED.dependencies, packageId: EXPECTED.packageId };
  const transaction = buildUpgrade(verified, build);
  const tx = transaction.getData();
  assert.equal(tx.commands.length, 3); assert.equal(tx.inputs.length, 3);
  assert.equal(tx.expiration, null);
  assert.ok(Object.values(tx.gasData).every(value => value === null), 'Proposal must leave final gas unset');
  const kind = await transaction.build({ onlyTransactionKind: true });
  return { purpose: 'Checked unsigned compatibility rehearsal only; not a signing request',
    kindBase64: toBase64(kind), kindSha256: sha256(kind), kindBytes: kind.length,
    packageDigestHex: EXPECTED.packageDigestHex, sender: EXPECTED.sender,
    transactionData: tx, simulationTransaction: transactionToGrpcJson(transaction),
    startsSeason: false, fundsPool: false, createsRegistry: false, convertsInventory: false,
    actualSignaturesRequested: 0, actualTransactionsSubmitted: 0 };
}

const OBJECT_FIELDS = `address version digest
  owner { __typename ... on AddressOwner { address { address } } ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }`;
const PACKAGE_FIELDS = `address version linkage { originalId upgradedId version }
  typeOrigins { module struct definingId }
  modules(first:50) { nodes { name bytes } pageInfo { hasNextPage endCursor } }`;
export const SIMULATION_QUERY = stripIgnoredCharacters(`query InventoryBoundaryUpgradeSimulation($transaction:JSON!) {
  checkpoint { sequenceNumber timestamp digest }
  genesis:checkpoint(sequenceNumber:0) { sequenceNumber digest }
  stdlib:object(address:"${STD}") { address version digest owner { __typename } }
  framework:object(address:"${SUI}") { address version digest owner { __typename } }
  simulateTransaction(transaction:$transaction,checksEnabled:true,doGasSelection:true) {
    effects { status executionError { message } checkpoint { sequenceNumber timestamp }
      epoch { epochId } lamportVersion transaction { transactionBcs sender { address } }
      gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
      balanceChangesJson
      objectChanges(first:20) { nodes { address idCreated idDeleted inputState { ${OBJECT_FIELDS} }
        outputState { ${OBJECT_FIELDS} asMovePackage { ${PACKAGE_FIELDS} } } }
        pageInfo { hasNextPage endCursor } }
      events(first:10) { nodes { sender { address } contents { type { repr } json } } pageInfo { hasNextPage endCursor } }
      unchangedConsensusObjects(first:10) { nodes { __typename } pageInfo { hasNextPage endCursor } }
    }
  }
}`);
const afterDefinition = parse(INPUTS_QUERY).definitions[0];
const extra = parse('query Extra($simulatedPackage:SuiAddress!){simulatedPackage:object(address:$simulatedPackage){address version}}').definitions[0];
afterDefinition.name.value = 'InventoryBoundaryAfter';
afterDefinition.variableDefinitions.push(...extra.variableDefinitions);
afterDefinition.selectionSet.selections.push(...extra.selectionSet.selections);
export const AFTER_QUERY = stripIgnoredCharacters(print(afterDefinition));

export async function validateUpgradeSimulation(response, packet, previous, build, proofResponse, options = {}) {
  const data = dataOf(response);
  network(data); checkpoint(data.checkpoint, options);
  checkpoint(previous.checkpoint, options);
  assert.ok(data.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation observation predates preflight');
  assert.deepEqual(packet, await buildBoundaryUpgrade(previous, build, proofResponse), 'Unsigned upgrade packet changed');
  const effects = data.simulateTransaction?.effects;
  assert.equal(effects?.status, 'SUCCESS', effects?.executionError?.message ?? 'Upgrade simulation failed');
  assert.equal(effects.executionError, null);
  assert.equal(effects.checkpoint, null, 'Simulation must not be presented as a confirmed transaction');
  const resolved = Transaction.from(effects.transaction?.transactionBcs), tx = resolved.getData();
  assert.equal(effects.transaction.sender?.address, EXPECTED.sender, 'Wrong simulated sender');
  assert.equal(tx.sender, EXPECTED.sender, 'Wrong resolved sender');
  assert.equal(tx.gasData.owner, EXPECTED.sender, 'Wrong resolved gas owner');
  assert.equal(toBase64(await resolved.build({ onlyTransactionKind: true })), packet.kindBase64,
    'Resolved transaction differs from the exact upgrade');
  const budget = uint(tx.gasData.budget), price = uint(tx.gasData.price);
  assert.ok(budget > 0n && price > 0n, 'Resolved gas budget and price must be positive');
  assert.ok(Array.isArray(tx.gasData.payment), 'Missing gas payment list');
  if (tx.expiration !== null || tx.gasData.payment.length === 0) {
    assert.equal(tx.expiration?.$kind, 'ValidDuring', 'Address-balance gas requires ValidDuring expiration');
    const expiry = tx.expiration.ValidDuring, epoch = uint(effects.epoch?.epochId);
    assert.equal(uint(expiry.minEpoch), epoch); assert.equal(uint(expiry.maxEpoch), epoch + 1n);
    assert.equal(expiry.minTimestamp, null); assert.equal(expiry.maxTimestamp, null);
    assert.equal(expiry.chain, EXPECTED.genesisDigest, 'Expiration has wrong chain');
    assert.ok(Number.isInteger(expiry.nonce) && expiry.nonce >= 0 && expiry.nonce <= 0xffffffff, 'Invalid expiration nonce');
  }
  const payments = new Map(tx.gasData.payment.map(item => [address(item.objectId), item]));
  assert.equal(payments.size, tx.gasData.payment.length, 'Duplicate gas inputs');
  const protectedIds = [EXPECTED.upgradeCapId, EXPECTED.packageId, EXPECTED.registryId, EXPECTED.adminCapId,
    previous.legacyRegistry.address, previous.legacyAdminCap.address, V1.clockId];
  assert.ok([...payments.keys()].every(id => !protectedIds.includes(id)), 'Protocol input cannot be gas');
  const changes = complete(effects.objectChanges, 'simulated changes');
  assert.equal(new Set(changes.map(item => address(item.address))).size, changes.length, 'Duplicate object changes');
  const created = changes.filter(item => item.outputState?.asMovePackage);
  assert.equal(created.length, 1, 'Expected exactly one predicted package');
  const change = created[0], output = change.outputState, pkg = output.asMovePackage;
  assert.equal(change.idCreated, true); assert.equal(change.idDeleted, false); assert.equal(change.inputState, null);
  assert.equal(change.address, output.address); assert.equal(pkg.address, output.address);
  assert.equal(output.asMoveObject, null); assert.deepEqual(output.owner, { __typename: 'Immutable' });
  assert.equal(output.version, 13); assert.equal(pkg.version, 13);
  reference(output);
  assert.ok(!protectedIds.includes(output.address), 'Predicted package reused an existing protocol ID');
  const modules = complete(pkg.modules, 'predicted package modules');
  assert.deepEqual(modules.map(item => item.name).sort(), ['arboretum', 'settlement']);
  for (const module of modules) {
    const bytes = Buffer.from(module.bytes, 'base64');
    assert.equal(bytes.toString('base64'), module.bytes, 'Noncanonical published module encoding');
    assert.equal(sha256(bytes), EXPECTED.publishedHashes[module.name], 'Predicted package bytes differ');
  }
  const priorOrigins = origins(confirmedPackage(proofResponse).typeOrigins);
  assert.equal(priorOrigins.length, 71);
  assert.deepEqual(origins(pkg.typeOrigins), priorOrigins, 'Existing type origins changed');
  const expectedLinks = [['stdlib', STD], ['framework', SUI]].map(([name, id]) => {
    const object = data[name]; assert.equal(object?.address, id); reference(object);
    assert.deepEqual(object.owner, { __typename: 'Immutable' });
    return { originalId: id, upgradedId: id, version: Number(uint(object.version)) };
  });
  assert.deepEqual([...pkg.linkage].sort((a, b) => a.originalId.localeCompare(b.originalId)), expectedLinks,
    'Predicted dependency linkage differs from the observed framework');
  const capChanges = changes.filter(item => item.address === EXPECTED.upgradeCapId);
  assert.equal(capChanges.length, 1, 'Expected one UpgradeCap mutation');
  const cap = capChanges[0];
  assert.equal(cap.idCreated, false); assert.equal(cap.idDeleted, false);
  assert.deepEqual(reference(cap.inputState), reference(previous.upgradeCap), 'UpgradeCap input reference changed');
  assert.deepEqual(contents(cap.inputState), contents(previous.upgradeCap));
  assert.deepEqual(cap.inputState.owner, previous.upgradeCap.owner);
  assert.equal(typeOf(cap.inputState), `${SUI}::package::UpgradeCap`);
  assert.equal(cap.outputState?.address, EXPECTED.upgradeCapId);
  assert.equal(typeOf(cap.outputState), typeOf(cap.inputState)); ownerIsAdministrator(cap.outputState);
  assert.equal(cap.outputState.asMovePackage, null);
  assert.equal(uint(cap.outputState.version), uint(effects.lamportVersion));
  assert.ok(uint(cap.outputState.version) > uint(cap.inputState.version)); reference(cap.outputState);
  assert.deepEqual(contents(cap.outputState), { ...contents(previous.upgradeCap), package: output.address, version: '13' },
    'Upgrade authority, policy or committed package changed unexpectedly');
  const gasChanges = changes.filter(item => item !== change && item !== cap);
  assert.deepEqual(gasChanges.map(item => item.address).sort(), [...payments.keys()].sort(), 'Unexpected non-upgrade object changes');
  for (const gasChange of gasChanges) {
    assert.equal(gasChange.idCreated, false);
    assert.deepEqual(reference(gasChange.inputState), { ...payments.get(gasChange.address), version: String(payments.get(gasChange.address).version) });
    ownerIsAdministrator(gasChange.inputState); assert.equal(typeOf(gasChange.inputState), COIN_TYPE);
    if (gasChange.idDeleted) assert.equal(gasChange.outputState, null);
    else {
      assert.equal(gasChange.idDeleted, false);
      assert.equal(gasChange.outputState?.address, gasChange.address); ownerIsAdministrator(gasChange.outputState);
      assert.equal(typeOf(gasChange.outputState), COIN_TYPE);
      assert.equal(uint(gasChange.outputState.version), uint(effects.lamportVersion)); reference(gasChange.outputState);
    }
  }
  assert.deepEqual(complete(effects.events, 'simulation events'), [], 'Upgrade must not emit gameplay or setup events');
  assert.deepEqual(complete(effects.unchangedConsensusObjects, 'consensus inputs'), [], 'Upgrade must not consume shared gameplay objects');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate);
  uint(gas?.nonRefundableStorageFee);
  assert.ok(net > 0n && net <= budget, 'Gas estimate must be positive and within resolved budget');
  assert.deepEqual(effects.balanceChangesJson, [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(-net) }],
    'Unexpected non-gas balance movement');
  const capturedAt = Date.parse(response.capturedAt), now = options.now ?? Date.now();
  assert.ok(Number.isSafeInteger(capturedAt) && capturedAt <= now + 30000 && now - capturedAt <= EXPECTED.maxAgeMs,
    'Missing or stale simulation capture time');
  return { status: 'UNSIGNED_NATIVE_UPGRADE_COMPATIBILITY_PASSED', checkpoint: data.checkpoint,
    kindSha256: packet.kindSha256, kindBytes: packet.kindBytes, packageDigestHex: EXPECTED.packageDigestHex,
    simulatedPackageIdForVerificationOnly: output.address, predictedPackageVersion: 13,
    productionInventoryVersion: 2, existingTypeOriginsPreserved: 71, newTypeOrigins: 0,
    legacyModuleBytesPreserved: true, candidateModuleBytesVerified: true,
    observedDependencyLinks: expectedLinks, upgradeCapOwnerAndPolicyPreserved: true,
    gasEstimateMist: String(net), gasEstimateSui: `${net / 1000000000n}.${String(net % 1000000000n).padStart(9, '0')}`,
    simulatedGasBudgetMist: String(budget), simulatedGasPriceMist: String(price),
    simulatedResolvedExpiration: tx.expiration, resolvedGasPayments: payments.size,
    postObservationNotBeforeMs: String(capturedAt),
    predictedRegistriesCreated: 0, predictedSeasonsStarted: 0, predictedInventoryConverted: 0,
    actualSignaturesRequested: 0, actualTransactionsSubmitted: 0, actualGasSpentMist: '0',
    newDeploymentPackageId: null, newProductionRegistryId: null };
}
export function validateAfter(previous, current, response, simulated) {
  const data = dataOf(response);
  assert.equal(simulated?.status, 'UNSIGNED_NATIVE_UPGRADE_COMPATIBILITY_PASSED');
  assert.equal(data.simulatedPackage, null, 'The predicted package unexpectedly exists on-chain');
  assert.ok(current.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber, 'Post-read checkpoint predates simulation');
  assert.ok(Date.parse(current.checkpoint.timestamp) >= Number(simulated.postObservationNotBeforeMs),
    'Post-read checkpoint predates the completed simulation request');
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']) {
    assert.deepEqual(reference(current[name]), reference(previous[name]), `${name} real reference changed`);
    assert.deepEqual(current[name].owner, previous[name].owner, `${name} real owner changed`);
    assert.equal(typeOf(current[name]), typeOf(previous[name]), `${name} real type changed`);
    assert.deepEqual(contents(current[name]), contents(previous[name]), `${name} real state changed`);
  }
  return { checkpoint: current.checkpoint, actualPackageVersion: contents(current.upgradeCap).version,
    actualRegistryVersion: contents(current.registry).version,
    actualSeasonId: contents(current.registry).current_season_id,
    actualSeasonStartMs: contents(current.registry).season_start_ms,
    actualRewardPoolMist: contents(current.registry).reward_pool, actualTreasuryMist: contents(current.registry).treasury,
    realProtocolObjectsUnchanged: true, simulatedPackageAbsentOnChain: true,
    observationAfterSimulationResponse: true, actualNewProductionRegistryId: null };
}
