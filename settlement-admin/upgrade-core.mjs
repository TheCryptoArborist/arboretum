// The approved upgrade has one identity. This module has no signer, network,
// storage, or DOM access. Browser WebCrypto and the locked Sui SDK are used only
// to decode, inspect, and reconstruct the exact transaction for a wallet.
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase58, fromBase64, toHex } from '@mysten/bcs';
import { LEGACY_TYPE_ORIGINS, SETTLEMENT_TYPE_NAMES } from './upgrade-constants.mjs';

const STD = '0x' + '0'.repeat(63) + '1';
const SUI = '0x' + '0'.repeat(63) + '2';
export const EXPECTED = Object.freeze({
  origin: 'https://www.treegrow.xyz', network: 'mainnet', chain: 'sui:mainnet',
  graphqlEndpoint: 'https://graphql.mainnet.sui.io/graphql', chainIdentifier: '35834a8a',
  sender: '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4',
  packageId: '0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724',
  originalPackageId: '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b',
  upgradeCap: Object.freeze({
    objectId: '0xe531607b0d737ab1a89c00bb16864c9696832e0b374f778e35b79aabc51e7db5',
    version: '990522281', digest: 'AL8rz2UmVAVijA5KiDufAKsn4VbYjDMFaYyHQ8kzPB22',
  }),
  legacyAdminCap: '0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3',
  legacyRegistry: '0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50',
  kindSha256: '1b62257103c3a67c36607a7471180cee64159115274b774149282da1d7b443e0',
  kindBytes: 40617,
  packageDigestHex: 'a4f84de8007a0d8b8f79ab9d0fa8bdb03a1926dc954b1d72d626783be04c29df',
  prepublicationHashes: Object.freeze({
    arboretum: '2ba0d52751229deb9af844ff28dfcc56bed069c7ce4a49d4e66091546fddd6f1',
    settlement: 'b7a04fde1df19d69cc09a2384f3abca0c4f8caa226ba738a6091dd7cda92f531',
  }),
  publishedHashes: Object.freeze({
    arboretum: '3ddcce6c26d7672f242cbe11f803972cc992c658e90dc8e2239b6839d67d4aa5',
    settlement: 'c0dd12db1e675d506fd52deb42b654562a84b7ca5dd0ebd60b3eb3bbf7378d0e',
  }),
  dependencies: Object.freeze([STD, SUI]), maxGasMist: '400000000', maxAgeMs: 120000,
});

export class UpgradeReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'UpgradeReviewError'; this.code = code; }
}
function requireThat(condition, message, code = 'REVIEW_MISMATCH') {
  if (!condition) throw new UpgradeReviewError(code, message);
}
function equal(a, b, message) { requireThat(JSON.stringify(a) === JSON.stringify(b), message); }
function normalizeAddress(value) {
  requireThat(typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value), 'Invalid Sui address.');
  return '0x' + value.slice(2).toLowerCase().padStart(64, '0');
}
function isAddress(value, expected) { return normalizeAddress(value) === normalizeAddress(expected); }
function typeName(value) {
  requireThat(typeof value === 'string', 'An object type is missing.');
  const pieces = value.split('::');
  requireThat(pieces.length === 3, 'Unexpected object type.');
  return `${normalizeAddress(pieces[0])}::${pieces[1]}::${pieces[2]}`;
}
function fields(object) {
  requireThat(object?.asMoveObject?.contents?.json, 'An expected Move object is unavailable.');
  return object.asMoveObject.contents.json;
}
function owner(object) {
  requireThat(object?.owner?.__typename === 'AddressOwner', 'An expected object is no longer address-owned.');
  return normalizeAddress(object.owner.address?.address);
}
function objectRef(object) {
  return { objectId: normalizeAddress(object.address), version: String(object.version), digest: object.digest };
}
function dataOf(response) {
  const result = response?.response ?? response;
  requireThat(result && !result.errors?.length, 'The blockchain response contains an error.', 'RPC_RESPONSE_ERROR');
  requireThat(result.data && typeof result.data === 'object', 'The blockchain response is incomplete.', 'RPC_RESPONSE_ERROR');
  return result.data;
}
function validateCheckpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0,
    'A real blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  const timestamp = Date.parse(value.timestamp);
  requireThat(Number.isFinite(timestamp), 'The checkpoint timestamp is invalid.');
  if (fresh) {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? EXPECTED.maxAgeMs;
    requireThat(Number.isFinite(now) && Number.isFinite(maxAgeMs) && maxAgeMs > 0, 'Invalid freshness limit.');
    requireThat(timestamp <= now + 30000 && now - timestamp <= maxAgeMs,
      'The blockchain observation is too old. Refresh the review before signing.', 'STALE_REVIEW');
  }
  return value;
}
function originsCanonical(origins) {
  requireThat(Array.isArray(origins), 'The package type origins are missing.');
  const result = origins.map(origin => {
    requireThat(typeof origin.module === 'string' && typeof origin.struct === 'string', 'Invalid type origin.');
    return { module: origin.module, struct: origin.struct, definingId: normalizeAddress(origin.definingId) };
  }).sort((a, b) => `${a.module}::${a.struct}`.localeCompare(`${b.module}::${b.struct}`));
  requireThat(new Set(result.map(x => `${x.module}::${x.struct}`)).size === result.length,
    'Duplicate package type origins.');
  return result;
}
const expectedLegacyOrigins = originsCanonical(LEGACY_TYPE_ORIGINS);
function validateLegacyOrigins(origins) {
  equal(originsCanonical(origins), expectedLegacyOrigins, 'The legacy asset type origins differ from the reviewed package.');
}
function requireComplete(connection, label) {
  requireThat(connection && Array.isArray(connection.nodes) && connection.pageInfo?.hasNextPage === false,
    `The ${label} inventory is incomplete.`);
  return connection.nodes;
}
function parseMist(value, label) {
  requireThat((typeof value === 'string' && /^\d+$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), `${label} is invalid.`);
  return BigInt(value);
}
function formatSui(mist) { return `${mist / 1000000000n}.${String(mist % 1000000000n).padStart(9, '0')}`; }
export async function sha256(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin,
    'This upgrade can be signed only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(address, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet before reviewing the upgrade.', 'WRONG_NETWORK');
  requireThat(isAddress(address, EXPECTED.sender),
    'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}

// Checks the BCS representation before constructing any wallet request. The
// canonical simulation payload is derived here, never trusted from a URL or file.
export async function loadReviewedUpgrade(kindBase64) {
  requireThat(typeof kindBase64 === 'string', 'The reviewed upgrade packet is missing.');
  const encoded = kindBase64.trim();
  requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'The upgrade packet is not valid base64.');
  requireThat(encoded.length === Math.ceil(EXPECTED.kindBytes / 3) * 4,
    'The upgrade packet differs from the transaction approved for review.', 'PACKET_MISMATCH');
  const bytes = fromBase64(encoded);
  requireThat(bytes.length === EXPECTED.kindBytes && await sha256(bytes) === EXPECTED.kindSha256,
    'The upgrade packet differs from the transaction approved for review.', 'PACKET_MISMATCH');
  const decoded = bcs.TransactionKind.parse(bytes);
  requireThat(decoded.$kind === 'ProgrammableTransaction', 'The reviewed transaction is not a programmable transaction.');
  const ptb = decoded.ProgrammableTransaction;
  equal(ptb.inputs[0]?.Object?.ImmOrOwnedObject, EXPECTED.upgradeCap, 'The upgrade authority input differs from the review.');
  requireThat(ptb.inputs.length === 3 && ptb.commands.length === 3, 'Unexpected upgrade commands or inputs.');
  const upgrade = ptb.commands[1]?.Upgrade;
  requireThat(upgrade && upgrade.modules.length === 2, 'The candidate module inventory differs.');
  for (const [index, name] of ['arboretum', 'settlement'].entries()) {
    requireThat(await sha256(fromBase64(upgrade.modules[index])) === EXPECTED.prepublicationHashes[name],
      `The ${name} module differs from the reviewed candidate.`);
  }
  const simulationTransaction = {
    version: 1,
    kind: { programmableTransaction: {
      inputs: [
        { kind: 'IMMUTABLE_OR_OWNED', ...EXPECTED.upgradeCap },
        { kind: 'PURE', pure: ptb.inputs[1].Pure.bytes },
        { kind: 'PURE', pure: ptb.inputs[2].Pure.bytes },
      ],
      commands: [
        { moveCall: { package: SUI, module: 'package', function: 'authorize_upgrade',
          arguments: [0, 1, 2].map(input => ({ kind: 'INPUT', input })) } },
        { upgrade: { modules: [...upgrade.modules], dependencies: [...EXPECTED.dependencies],
          package: EXPECTED.packageId, ticket: { kind: 'RESULT', result: 0, subresult: 0 } } },
        { moveCall: { package: SUI, module: 'package', function: 'commit_upgrade',
          arguments: [{ kind: 'INPUT', input: 0 }, { kind: 'RESULT', result: 1, subresult: 0 }] } },
      ],
    } },
    sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender },
  };
  const transaction = Transaction.fromKind(bytes);
  transaction.setSender(EXPECTED.sender);
  return { transaction, simulationTransaction, kindSha256: EXPECTED.kindSha256 };
}

export async function validateWalletTransaction(transaction) {
  requireThat(transaction instanceof Transaction, 'A Sui Transaction instance is required.');
  const data = transaction.getData();
  assertAdministrator(data.sender);
  requireThat(Object.values(data.gasData).every(value => value === null) && data.expiration === null,
    'Final gas and expiration must be selected by the wallet.');
  // Kind-only serialization does not select gas or construct a full transaction.
  requireThat(await sha256(await transaction.build({ onlyTransactionKind: true })) === EXPECTED.kindSha256,
    'The wallet request differs from the approved upgrade.', 'PACKET_MISMATCH');
  return true;
}

const BASE_OBJECT_FIELDS = `address version digest
  owner { __typename ... on AddressOwner { address { address } } ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }`;
const OBJECT_FIELDS = `${BASE_OBJECT_FIELDS}
  previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } }`;
export const TIP_QUERY = `query UpgradeReviewTip {
  checkpoint { sequenceNumber timestamp digest }
  genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }
}`;
export const INPUT_VARIABLES = Object.freeze({
  package: EXPECTED.packageId, original: EXPECTED.originalPackageId,
  upgradeCap: EXPECTED.upgradeCap.objectId, legacyAdminCap: EXPECTED.legacyAdminCap,
  registry: EXPECTED.legacyRegistry,
});
export const INPUTS_QUERY = `query UpgradeReviewInputs($checkpoint: UInt53!, $package: SuiAddress!,
  $original: SuiAddress!, $upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!, $registry: SuiAddress!) {
  checkpoint(sequenceNumber: $checkpoint) { sequenceNumber timestamp digest }
  upgradeCap: object(address: $upgradeCap, atCheckpoint: $checkpoint) { ${OBJECT_FIELDS} }
  legacyAdminCap: object(address: $legacyAdminCap, atCheckpoint: $checkpoint) { ${OBJECT_FIELDS} }
  registry: object(address: $registry, atCheckpoint: $checkpoint) { ${OBJECT_FIELDS} }
  deployed: object(address: $package, atCheckpoint: $checkpoint) {
    address version digest owner { __typename }
    asMovePackage { typeOrigins { module struct definingId }
      modules(first: 50) { nodes { name bytes } pageInfo { hasNextPage endCursor } } }
  }
  original: object(address: $original, atCheckpoint: $checkpoint) { address version digest }
  stdlib: object(address: "0x1", atCheckpoint: $checkpoint) { address version digest }
  framework: object(address: "0x2", atCheckpoint: $checkpoint) { address version digest }
}`;

export async function validatePreflight(inputsResponse, tipResponse, options = {}) {
  const data = dataOf(inputsResponse), tip = dataOf(tipResponse);
  validateCheckpoint(tip.checkpoint, options);
  equal(data.checkpoint, tip.checkpoint, 'The review inputs are not from one checkpoint.');
  requireThat(tip.genesis?.sequenceNumber === 0 &&
    toHex(fromBase58(tip.genesis.digest).slice(0, 4)) === EXPECTED.chainIdentifier,
    'The endpoint is not Sui mainnet.', 'WRONG_NETWORK');
  const cap = data.upgradeCap;
  requireThat(cap && isAddress(cap.address, EXPECTED.upgradeCap.objectId), 'The UpgradeCap is unavailable.');
  requireThat(typeName(cap.asMoveObject?.contents?.type?.repr) === `${SUI}::package::UpgradeCap`, 'Wrong UpgradeCap type.');
  requireThat(owner(cap) === EXPECTED.sender, 'The upgrade authority owner has changed.');
  const capFields = fields(cap);
  requireThat(isAddress(capFields.id, EXPECTED.upgradeCap.objectId), 'The UpgradeCap content ID is inconsistent.');
  requireThat(capFields.policy === 0, 'The upgrade policy has changed.');
  if (String(capFields.version) === '12') {
    requireThat(!isAddress(capFields.package, EXPECTED.packageId), 'The UpgradeCap version and package disagree.');
    const digest = cap.previousTransaction?.digest;
    requireThat(typeof digest === 'string', 'The current upgrade receipt is unavailable.');
    return { status: 'already-upgraded', packageId: normalizeAddress(capFields.package), digest,
      checkpoint: data.checkpoint };
  }
  requireThat(String(capFields.version) === '11' && isAddress(capFields.package, EXPECTED.packageId),
    'The contract version has changed. This upgrade must not be submitted again.', 'CONTRACT_CHANGED');
  equal(objectRef(cap), EXPECTED.upgradeCap, 'The UpgradeCap reference has changed. Refresh the reviewed packet.');
  requireThat(isAddress(data.legacyAdminCap?.address, EXPECTED.legacyAdminCap) &&
    owner(data.legacyAdminCap) === EXPECTED.sender, 'The legacy administrator identity has changed.');
  requireThat(typeName(data.legacyAdminCap.asMoveObject?.contents?.type?.repr) ===
    `${EXPECTED.originalPackageId}::arboretum::AdminCap`, 'Wrong legacy administrator capability type.');
  requireThat(isAddress(data.registry?.address, EXPECTED.legacyRegistry) && data.registry.owner?.__typename === 'Shared',
    'The legacy Registry identity has changed.');
  requireThat(typeName(data.registry.asMoveObject?.contents?.type?.repr) ===
    `${EXPECTED.originalPackageId}::arboretum::Registry` && isAddress(fields(data.registry).admin, EXPECTED.sender),
    'The legacy Registry administrator or type has changed.');
  const deployed = data.deployed;
  requireThat(isAddress(deployed?.address, EXPECTED.packageId) && deployed.version === 11 &&
    deployed.owner?.__typename === 'Immutable', 'The source package identity differs from the review.');
  requireThat(isAddress(data.original?.address, EXPECTED.originalPackageId) && data.original.version === 1,
    'The original package lineage differs from the review.');
  const modules = requireComplete(deployed.asMovePackage?.modules, 'source module');
  requireThat(modules.length === 1 && modules[0].name === 'arboretum' &&
    await sha256(fromBase64(modules[0].bytes)) === EXPECTED.publishedHashes.arboretum,
    'The live legacy module differs from the reviewed bytecode.');
  validateLegacyOrigins(deployed.asMovePackage.typeOrigins);
  requireThat(isAddress(data.stdlib?.address, STD) && isAddress(data.framework?.address, SUI),
    'The dependency identities differ from the review.');
  return { status: 'ready', checkpoint: data.checkpoint, sender: EXPECTED.sender,
    upgradeCap: objectRef(cap), packageId: EXPECTED.packageId, packageVersion: 11 };
}

const PACKAGE_FIELDS = `address version linkage { originalId upgradedId version }
  typeOrigins { module struct definingId }
  modules(first: 50) { nodes { name bytes } pageInfo { hasNextPage endCursor } }`;
const CHANGES_FIELDS = `nodes { address idCreated idDeleted
  inputState { ${BASE_OBJECT_FIELDS} }
  outputState { ${BASE_OBJECT_FIELDS} asMovePackage { ${PACKAGE_FIELDS} } }
} pageInfo { hasNextPage endCursor }`;
const EFFECT_FIELDS = `status executionError { message }
  gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
  balanceChangesJson objectChanges(first: 50) { ${CHANGES_FIELDS} }`;
export const SIMULATION_QUERY = `query SimulateApprovedUpgrade($transaction: JSON!) {
  checkpoint { sequenceNumber timestamp digest }
  simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) {
    effects { ${EFFECT_FIELDS} }
  }
}`;
export const CONFIRM_VARIABLES = Object.freeze({
  upgradeCap: EXPECTED.upgradeCap.objectId, adminCap: EXPECTED.legacyAdminCap,
  registry: EXPECTED.legacyRegistry,
});
export const CONFIRM_QUERY = `query ConfirmApprovedUpgrade($digest: String!, $adminCap: SuiAddress!,
  $upgradeCap: SuiAddress!, $registry: SuiAddress!) {
  checkpoint { sequenceNumber timestamp digest }
  transaction(digest: $digest) { digest sender { address } transactionBcs
    effects { ${EFFECT_FIELDS} checkpoint { sequenceNumber timestamp } }
  }
  upgradeCap: object(address: $upgradeCap) { ${OBJECT_FIELDS} }
  legacyAdminCap: object(address: $adminCap) { ${OBJECT_FIELDS} }
  registry: object(address: $registry) { ${OBJECT_FIELDS} }
}`;

async function verifyUpgradedPackage(object) {
  requireThat(object?.owner?.__typename === 'Immutable' && object.version === 12,
    'The upgraded package has an unexpected version or owner.');
  const pkg = object.asMovePackage;
  requireThat(pkg && isAddress(pkg.address, object.address) && pkg.version === 12,
    'The new package identity is inconsistent.');
  const packageId = normalizeAddress(pkg.address);
  requireThat(packageId !== EXPECTED.packageId && packageId !== EXPECTED.originalPackageId,
    'The upgrade did not introduce a new package.');
  const modules = requireComplete(pkg.modules, 'upgraded module');
  equal(modules.map(m => m.name).sort(), ['arboretum', 'settlement'], 'The upgraded module inventory differs.');
  for (const module of modules) {
    requireThat(await sha256(fromBase64(module.bytes)) === EXPECTED.publishedHashes[module.name],
      `The published ${module.name} bytecode differs from the reviewed candidate.`);
  }
  const origins = originsCanonical(pkg.typeOrigins);
  requireThat(origins.length === 71, 'Unexpected upgraded type inventory.');
  validateLegacyOrigins(origins.filter(origin => origin.module === 'arboretum'));
  const settlementOrigins = origins.filter(origin => origin.module === 'settlement');
  equal(settlementOrigins.map(origin => origin.struct).sort(), [...SETTLEMENT_TYPE_NAMES],
    'The settlement type inventory differs from the review.');
  requireThat(settlementOrigins.every(origin => origin.definingId === packageId),
    'New settlement types do not originate from the new package.');
  return packageId;
}

function validateCapOutput(cap, packageId) {
  requireThat(isAddress(cap?.address, EXPECTED.upgradeCap.objectId) && owner(cap) === EXPECTED.sender,
    'The upgrade authority was transferred or replaced.');
  requireThat(typeName(cap.asMoveObject?.contents?.type?.repr) === `${SUI}::package::UpgradeCap`,
    'The resulting upgrade authority has the wrong type.');
  const values = fields(cap);
  requireThat(isAddress(values.id, EXPECTED.upgradeCap.objectId) && isAddress(values.package, packageId) &&
    String(values.version) === '12' && values.policy === 0,
    'The upgrade receipt was not committed to the expected capability.');
}
function validateGas(effects) {
  const gas = effects.gasEffects?.gasSummary;
  requireThat(gas, 'Gas effects are missing.');
  const net = parseMist(gas.computationCost, 'Computation cost') + parseMist(gas.storageCost, 'Storage cost')
    - parseMist(gas.storageRebate, 'Storage rebate');
  requireThat(net > 0n, 'The simulated gas debit is unexpected.');
  const changes = effects.balanceChangesJson;
  requireThat(Array.isArray(changes) && changes.length === 1 &&
    isAddress(changes[0].address, EXPECTED.sender) &&
    typeName(changes[0].coinType) === `${SUI}::sui::SUI` && changes[0].amount === String(-net),
    'An unexpected balance movement was found.');
  return { gasEstimateMist: String(net), gasEstimateSui: formatSui(net) };
}
async function validateEffects(effects, allowedGasObjects = []) {
  requireThat(effects?.status === 'SUCCESS' && !effects.executionError,
    effects?.executionError?.message ?? 'The upgrade did not succeed.', 'TRANSACTION_FAILED');
  const changes = requireComplete(effects.objectChanges, 'object-change');
  requireThat(new Set(changes.map(change => normalizeAddress(change.address))).size === changes.length,
    'Duplicate object changes.');
  const packages = changes.filter(change => change.outputState?.asMovePackage);
  requireThat(packages.length === 1 && packages[0].idCreated === true && packages[0].idDeleted === false &&
    packages[0].inputState === null && isAddress(packages[0].address, packages[0].outputState.address),
    'Expected exactly one new package creation.');
  const packageId = await verifyUpgradedPackage(packages[0].outputState);
  const caps = changes.filter(change => isAddress(change.address, EXPECTED.upgradeCap.objectId));
  requireThat(caps.length === 1 && caps[0].idCreated === false && caps[0].idDeleted === false,
    'Expected exactly one UpgradeCap update.');
  equal(objectRef(caps[0].inputState), EXPECTED.upgradeCap, 'The input UpgradeCap differs from the approved reference.');
  validateCapOutput(caps[0].outputState, packageId);
  const gasSet = new Set(allowedGasObjects.map(normalizeAddress));
  for (const change of changes) {
    if (change === packages[0] || change === caps[0]) continue;
    requireThat(gasSet.has(normalizeAddress(change.address)) && change.idCreated === false && change.inputState,
      'An unexpected object would be changed by this upgrade.');
    requireThat(owner(change.inputState) === EXPECTED.sender &&
      change.inputState.asMoveObject?.contents?.type?.repr === `${SUI}::coin::Coin<${SUI}::sui::SUI>`,
      'An unexpected gas-payment input was changed.');
    if (change.idDeleted) requireThat(change.outputState === null, 'A deleted gas input has an output state.');
    else requireThat(change.outputState && owner(change.outputState) === EXPECTED.sender &&
      change.outputState.asMoveObject?.contents?.type?.repr === `${SUI}::coin::Coin<${SUI}::sui::SUI>`,
      'An unexpected gas-payment output was changed.');
  }
  return { packageId, ...validateGas(effects) };
}

export async function validateSimulation(response, options = {}) {
  const data = dataOf(response);
  validateCheckpoint(data.checkpoint, options);
  requireThat(!data.transaction && data.simulateTransaction?.effects,
    'Expected a simulation response.');
  const checked = await validateEffects(data.simulateTransaction.effects);
  const ceiling = parseMist(options.maxGasMist == null ? EXPECTED.maxGasMist : String(options.maxGasMist), 'Gas review limit');
  requireThat(BigInt(checked.gasEstimateMist) <= ceiling,
    `The current estimated fee exceeds ${formatSui(ceiling)} SUI. A new fee review is required.`, 'GAS_INCREASED');
  return { status: 'simulated', checkpoint: data.checkpoint,
    simulatedPackageIdNeverDeployed: checked.packageId,
    gasEstimateMist: checked.gasEstimateMist, gasEstimateSui: checked.gasEstimateSui };
}

export async function validateConfirmedUpgrade(response, expectedDigest) {
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true,
    'Simulation data cannot establish a live deployment.');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint,
    'The transaction is not yet visible at a confirmed checkpoint.', 'CONFIRMATION_PENDING');
  validateCheckpoint(actual.effects.checkpoint, {}, false);
  requireThat(typeof expectedDigest === 'string' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(expectedDigest) &&
    actual.digest === expectedDigest, 'The receipt is for a different transaction.');
  const transaction = Transaction.from(actual.transactionBcs);
  const txData = transaction.getData();
  requireThat(txData.sender === EXPECTED.sender && actual.sender?.address === EXPECTED.sender &&
    txData.gasData.owner === EXPECTED.sender, 'The confirmed transaction has the wrong sender or gas owner.');
  requireThat(await transaction.getDigest() === expectedDigest, 'The confirmed transaction bytes have the wrong digest.');
  requireThat(await sha256(await transaction.build({ onlyTransactionKind: true })) === EXPECTED.kindSha256,
    'The confirmed transaction differs from the approved upgrade.', 'PACKET_MISMATCH');
  const gasObjects = (txData.gasData.payment ?? []).map(payment => payment.objectId);
  const checked = await validateEffects(actual.effects, gasObjects);
  validateCapOutput(data.upgradeCap, checked.packageId);
  requireThat(isAddress(data.legacyAdminCap?.address, EXPECTED.legacyAdminCap) &&
    owner(data.legacyAdminCap) === EXPECTED.sender &&
    typeName(data.legacyAdminCap.asMoveObject?.contents?.type?.repr) === `${EXPECTED.originalPackageId}::arboretum::AdminCap`,
    'The legacy administrator identity changed.');
  requireThat(isAddress(data.registry?.address, EXPECTED.legacyRegistry) && data.registry.owner?.__typename === 'Shared' &&
    typeName(data.registry.asMoveObject?.contents?.type?.repr) === `${EXPECTED.originalPackageId}::arboretum::Registry` &&
    isAddress(fields(data.registry).admin, EXPECTED.sender), 'The legacy Registry identity changed.');
  return { status: 'confirmed', digest: actual.digest, packageId: checked.packageId,
    typeOrigin: checked.packageId, checkpoint: actual.effects.checkpoint,
    gasEstimateMist: checked.gasEstimateMist, gasEstimateSui: checked.gasEstimateSui };
}
