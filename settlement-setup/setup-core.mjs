// Pure inspection of the one reviewed empty-Registry setup. No network, wallet,
// signer, storage, or DOM access belongs in this module. Simulated object IDs are
// deliberately returned only inside simulationOnly and never as deployed IDs.
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, fromBase64, toBase64, toHex } from '@mysten/bcs';
import { EXPECTED as UPGRADE, sha256, validateConfirmedUpgrade } from '../settlement-admin/upgrade-core.mjs';

const SUI = '0x' + '0'.repeat(63) + '2';
const PACKAGE = '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a';
const TABLE_NAMES = Object.freeze(['seeds_by_owner', 'referrers', 'referral_earnings',
  'player_growth', 'player_growth_season', 'planted_saplings']);
export const SETUP_EXPECTED = Object.freeze({
  origin: UPGRADE.origin, network: UPGRADE.network, chain: UPGRADE.chain,
  graphqlEndpoint: UPGRADE.graphqlEndpoint, chainIdentifier: UPGRADE.chainIdentifier,
  genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
  sender: UPGRADE.sender, originalPackageId: UPGRADE.originalPackageId,
  packageId: PACKAGE, typeOrigin: PACKAGE,
  upgradeDigest: 'GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU',
  upgradeCheckpoint: Object.freeze({ sequenceNumber: 340000251, timestamp: '2026-10-31T03:31:58.538Z' }),
  upgradeCap: Object.freeze({ objectId: UPGRADE.upgradeCap.objectId, version: '990522282',
    digest: '5WD8ag8pDpeHKMNc96eV5e9UTnW42L8KWk5jHZoS6a1W' }),
  legacyAdminCap: Object.freeze({ objectId: UPGRADE.legacyAdminCap, version: '986499447',
    digest: '36Cg64NBM7Pa2NEageUkzgZ8MZydWD4BtKavLb3ZgqWN' }),
  legacyRegistry: UPGRADE.legacyRegistry,
  registryType: `${PACKAGE}::settlement::Registry`, adminCapType: `${PACKAGE}::settlement::AdminCap`,
  eventType: `${PACKAGE}::settlement::SettlementRegistryCreated`,
  kindSha256: '2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b',
  kindBytes: 154, reviewedGasMist: '5632932', maxGasMist: '10000000', maxAgeMs: 120000,
});

export class SetupReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'SetupReviewError'; this.code = code; }
}
function requireThat(condition, message, code = 'REVIEW_MISMATCH') {
  if (!condition) throw new SetupReviewError(code, message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function same(actual, expected, message, code) {
  requireThat(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), message, code);
}
function address(value) {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Invalid or missing Sui address.');
  return value;
}
function digest(value) {
  requireThat(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value), 'Invalid or missing transaction/object digest.');
  requireThat(fromBase58(value).length === 32, 'Invalid transaction/object digest length.');
  return value;
}
function uint(value, label = 'Unsigned amount') {
  requireThat((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), `${label} is invalid.`);
  return BigInt(value);
}
function fields(object) { return object?.asMoveObject?.contents?.json; }
function typeOf(object) { return object?.asMoveObject?.contents?.type?.repr; }
function ref(object) {
  requireThat(object, 'A required object is unavailable.');
  return { objectId: address(object.address), version: String(uint(object.version, 'Object version')), digest: digest(object.digest) };
}
function owner(object, label) {
  requireThat(object?.owner?.__typename === 'AddressOwner' && object.owner.address?.address === SETUP_EXPECTED.sender,
    `${label} must remain owned by the administrator.`);
}
function complete(connection, label, code) {
  requireThat(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false,
    `The ${label} inventory is incomplete.`, code);
  return connection.nodes;
}
function dataOf(response) {
  const raw = response?.response ?? response;
  requireThat(raw && !raw.errors?.length && raw.data && typeof raw.data === 'object',
    'The blockchain response is incomplete or contains an error.', 'RPC_RESPONSE_ERROR');
  return raw.data;
}
function checkpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0 &&
    Number.isFinite(Date.parse(value?.timestamp)), 'A confirmed blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  if (fresh) {
    const now = options.now ?? Date.now(), age = options.maxAgeMs ?? SETUP_EXPECTED.maxAgeMs;
    requireThat(Number.isFinite(now) && Number.isFinite(age) && age > 0, 'Invalid checkpoint freshness limit.');
    const time = Date.parse(value.timestamp);
    requireThat(time <= now + 30000 && now - time <= age,
      'The blockchain observation is too old. Refresh the setup review.', 'STALE_REVIEW');
  }
  return value;
}
function network(data) {
  requireThat(data.genesis?.sequenceNumber === 0 && typeof data.genesis?.digest === 'string',
    'The endpoint did not identify Sui mainnet.', 'WRONG_NETWORK');
  requireThat(data.genesis.digest === SETUP_EXPECTED.genesisDigest &&
    toHex(fromBase58(digest(data.genesis.digest)).slice(0, 4)) === SETUP_EXPECTED.chainIdentifier,
    'The endpoint is not Sui mainnet.', 'WRONG_NETWORK');
}
function formatSui(value) { return `${value / 1000000000n}.${String(value % 1000000000n).padStart(9, '0')}`; }

export function assertExpectedOrigin(origin) {
  requireThat(origin === SETUP_EXPECTED.origin,
    'This setup can be signed only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = SETUP_EXPECTED.chain) {
  requireThat(chain === SETUP_EXPECTED.chain, 'Select Sui mainnet before reviewing setup.', 'WRONG_NETWORK');
  requireThat(account === SETUP_EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}

function expectedSimulationTransaction() {
  return { version: 1, kind: { programmableTransaction: {
    inputs: [{ kind: 'IMMUTABLE_OR_OWNED', ...SETUP_EXPECTED.legacyAdminCap }],
    commands: [{ moveCall: { package: PACKAGE, module: 'settlement', function: 'create_settlement_registry',
      arguments: [{ kind: 'INPUT', input: 0 }] } }],
  } }, sender: SETUP_EXPECTED.sender, gasPayment: { owner: SETUP_EXPECTED.sender } };
}
export async function loadReviewedSetup(kindBase64) {
  requireThat(typeof kindBase64 === 'string', 'The reviewed setup packet is missing.', 'PACKET_MISMATCH');
  const encoded = kindBase64.trim();
  requireThat(encoded.length === Math.ceil(SETUP_EXPECTED.kindBytes / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    'The setup packet differs from the approved transaction.', 'PACKET_MISMATCH');
  const bytes = fromBase64(encoded);
  requireThat(bytes.length === SETUP_EXPECTED.kindBytes && toBase64(bytes) === encoded &&
    await sha256(bytes) === SETUP_EXPECTED.kindSha256,
    'The setup packet differs from the approved transaction.', 'PACKET_MISMATCH');
  const transaction = new Transaction();
  transaction.setSender(SETUP_EXPECTED.sender);
  transaction.moveCall({ target: `${PACKAGE}::settlement::create_settlement_registry`,
    arguments: [transaction.objectRef(SETUP_EXPECTED.legacyAdminCap)] });
  requireThat(toBase64(await transaction.build({ onlyTransactionKind: true })) === encoded,
    'The packet is not the single reviewed setup call.', 'PACKET_MISMATCH');
  return { transaction, simulationTransaction: expectedSimulationTransaction(), kindSha256: SETUP_EXPECTED.kindSha256 };
}
export async function validateWalletTransaction(transaction) {
  requireThat(transaction instanceof Transaction, 'A Sui Transaction instance is required.');
  const data = transaction.getData();
  assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(value => value === null),
    'Final gas and expiration must be selected by the wallet.');
  requireThat(await sha256(await transaction.build({ onlyTransactionKind: true })) === SETUP_EXPECTED.kindSha256,
    'The wallet transaction differs from the approved setup.', 'PACKET_MISMATCH');
  return true;
}

const BASE_OBJECT = `address version digest
  owner { __typename ... on AddressOwner { address { address } } ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }`;
const CURRENT_OBJECT = `${BASE_OBJECT}
  previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } }`;
const PACKAGE_FIELDS = `address version linkage { originalId upgradedId version }
  typeOrigins { module struct definingId }
  modules(first: 50) { nodes { name bytes } pageInfo { hasNextPage endCursor } }`;
const CHANGE_FIELDS = `nodes { address idCreated idDeleted
  inputState { ${BASE_OBJECT} }
  outputState { ${BASE_OBJECT} asMovePackage { ${PACKAGE_FIELDS} } }
} pageInfo { hasNextPage endCursor }`;
const EFFECT_FIELDS = `status executionError { message }
  gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
  balanceChangesJson objectChanges(first: 50) { ${CHANGE_FIELDS} }`;
const SETUP_EFFECT_FIELDS = `${EFFECT_FIELDS}
  events(first: 10) { nodes { sender { address } contents { type { repr } json } } pageInfo { hasNextPage endCursor } }`;
const NETWORK_FIELDS = `checkpoint { sequenceNumber timestamp digest }
  genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }`;
const AUTHORITY_FIELDS = `upgradeCap: object(address: $upgradeCap) { ${CURRENT_OBJECT} }
  legacyAdminCap: object(address: $legacyAdminCap) { ${CURRENT_OBJECT} }
  registry: object(address: $registry) { ${CURRENT_OBJECT} }
  registries: objects(first: 2, filter: { type: $registryType }) {
    nodes { ${CURRENT_OBJECT} } pageInfo { hasNextPage endCursor }
  }
  adminCaps: objects(first: 2, filter: { type: $adminCapType }) {
    nodes { ${CURRENT_OBJECT} } pageInfo { hasNextPage endCursor }
  }`;
const UPGRADE_FIELDS = `upgradeTransaction: transaction(digest: $upgradeDigest) { digest sender { address } transactionBcs
  effects { ${EFFECT_FIELDS} checkpoint { sequenceNumber timestamp } }
}`;
const ID_VARIABLES = `$upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!, $registry: SuiAddress!,
  $registryType: String!, $adminCapType: String!`;
export const TIP_QUERY = `query SetupTip { ${NETWORK_FIELDS} }`;
export const INPUT_VARIABLES = Object.freeze({
  upgradeDigest: SETUP_EXPECTED.upgradeDigest, upgradeCap: SETUP_EXPECTED.upgradeCap.objectId,
  legacyAdminCap: SETUP_EXPECTED.legacyAdminCap.objectId, registry: SETUP_EXPECTED.legacyRegistry,
  registryType: SETUP_EXPECTED.registryType, adminCapType: SETUP_EXPECTED.adminCapType,
});
// objects(filter:...) has no atCheckpoint parameter. The latest checkpoint and
// all live inventories use the same request snapshot; reviewCheckpoint binds the
// preceding TIP request without pretending the global inventory is historical.
export const INPUTS_QUERY = `query SetupInputs($checkpoint: UInt53!, $upgradeDigest: String!, ${ID_VARIABLES}) {
  ${NETWORK_FIELDS}
  reviewCheckpoint: checkpoint(sequenceNumber: $checkpoint) { sequenceNumber timestamp digest }
  ${UPGRADE_FIELDS}
  ${AUTHORITY_FIELDS}
}`;
// The caller supplies only transaction. The identities in the simulation query
// are constants, so an external payload cannot change what authority is checked.
const SIM_AUTHORITY_FIELDS = AUTHORITY_FIELDS.replace(/\$(upgradeCap|legacyAdminCap|registryType|adminCapType|registry)\b/g,
  (_, name) => JSON.stringify(INPUT_VARIABLES[name]));
export const SIMULATION_QUERY = `query SetupSimulation($transaction: JSON!) {
  ${NETWORK_FIELDS}
  ${SIM_AUTHORITY_FIELDS}
  simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) {
    effects { ${SETUP_EFFECT_FIELDS} checkpoint { sequenceNumber timestamp } }
  }
}`;
export const CONFIRM_VARIABLES = INPUT_VARIABLES;
export const CONFIRM_QUERY = `query SetupConfirmation($digest: String!, $upgradeDigest: String!, ${ID_VARIABLES}) {
  ${NETWORK_FIELDS}
  transaction(digest: $digest) { digest sender { address } transactionBcs
    effects { ${SETUP_EFFECT_FIELDS} checkpoint { sequenceNumber timestamp } }
  }
  ${UPGRADE_FIELDS}
  ${AUTHORITY_FIELDS}
}`;

function validateLegacyCap(object) {
  requireThat(object?.address === SETUP_EXPECTED.legacyAdminCap.objectId &&
    typeOf(object) === `${UPGRADE.originalPackageId}::arboretum::AdminCap`, 'The legacy AdminCap identity or type changed.');
  owner(object, 'The legacy AdminCap');
  same(fields(object), { id: SETUP_EXPECTED.legacyAdminCap.objectId }, 'The legacy AdminCap contents changed.');
  ref(object);
}
function validateCurrentAuthority(data) {
  const cap = data.upgradeCap;
  requireThat(cap?.address === SETUP_EXPECTED.upgradeCap.objectId && typeOf(cap) === `${SUI}::package::UpgradeCap`,
    'The UpgradeCap identity or type changed.', 'CONTRACT_CHANGED');
  owner(cap, 'The UpgradeCap');
  same(fields(cap), { id: SETUP_EXPECTED.upgradeCap.objectId, package: PACKAGE, version: '12', policy: 0 },
    'The confirmed package version or upgrade policy changed.', 'CONTRACT_CHANGED');
  same(ref(cap), SETUP_EXPECTED.upgradeCap, 'The confirmed UpgradeCap reference changed.', 'CONTRACT_CHANGED');
  validateLegacyCap(data.legacyAdminCap);
  const legacy = data.registry;
  requireThat(legacy?.address === SETUP_EXPECTED.legacyRegistry && legacy.owner?.__typename === 'Shared' &&
    typeOf(legacy) === `${UPGRADE.originalPackageId}::arboretum::Registry` &&
    fields(legacy)?.id === SETUP_EXPECTED.legacyRegistry && fields(legacy)?.admin === SETUP_EXPECTED.sender,
    'The legacy Registry identity or authority changed.');
}
async function validateKnownUpgrade(data) {
  requireThat(data.upgradeTransaction, 'The confirmed v12 upgrade receipt is unavailable.', 'CONFIRMATION_PENDING');
  const result = await validateConfirmedUpgrade({ data: { ...data, transaction: data.upgradeTransaction } }, SETUP_EXPECTED.upgradeDigest);
  requireThat(result.packageId === PACKAGE, 'The known upgrade did not publish the expected package.', 'CONTRACT_CHANGED');
  same(result.checkpoint, SETUP_EXPECTED.upgradeCheckpoint, 'The known upgrade checkpoint differs.');
  validateCurrentAuthority(data);
  return result;
}
function validateRegistryIdentity(registry, admin, empty) {
  ref(registry); ref(admin);
  requireThat(typeOf(registry) === SETUP_EXPECTED.registryType && registry.owner?.__typename === 'Shared',
    'The settlement Registry type or shared ownership differs.');
  requireThat(typeOf(admin) === SETUP_EXPECTED.adminCapType, 'The settlement AdminCap type differs.');
  owner(admin, 'The settlement AdminCap');
  requireThat(fields(registry)?.id === registry.address && fields(registry)?.admin === SETUP_EXPECTED.sender &&
    fields(registry)?.version === '1', 'The settlement Registry administrator or schema version differs.');
  same(fields(admin), { id: admin.address, version: '1', registry_id: registry.address },
    'The settlement AdminCap is not bound to the observed Registry.');
  requireThat(registry.address !== admin.address, 'The settlement Registry and AdminCap IDs overlap.');
  requireThat(uint(registry.owner.initialSharedVersion, 'Initial shared version') > 0n,
    'The Registry initial shared version is invalid.');
  const numericFields = ['current_season_id', 'season_start_ms', 'reward_pool', 'treasury',
    'total_seeds', 'total_growth_points', 'eligible_growth_points'];
  same(Object.keys(fields(registry)).sort(), ['id', 'version', 'admin', 'settlement', 'paused', ...numericFields, ...TABLE_NAMES].sort(),
    'The live Registry field inventory is malformed.');
  for (const name of numericFields) {
    requireThat(typeof fields(registry)[name] === 'string', `The live Registry ${name} value is malformed.`);
    uint(fields(registry)[name], `Registry ${name}`);
  }
  requireThat(typeof fields(registry).paused === 'boolean' && (fields(registry).settlement === null ||
    (typeof fields(registry).settlement === 'object' && !Array.isArray(fields(registry).settlement))),
    'The live Registry settlement/paused fields are malformed.');
  const tables = Object.fromEntries(TABLE_NAMES.map(name => {
    const table = fields(registry)[name];
    requireThat(table && typeof table.size === 'string', `The live Registry ${name} table is malformed.`);
    uint(table.size, 'Table size');
    same(Object.keys(table).sort(), ['id', 'size'], 'The live Registry table fields are malformed.');
    return [name, { id: address(table.id), size: '0' }];
  }));
  requireThat(new Set(Object.values(tables).map(table => table.id)).size === TABLE_NAMES.length,
    'The Registry has duplicate table IDs.');
  if (!empty) return;
  same(fields(registry), { id: registry.address, version: '1', admin: SETUP_EXPECTED.sender,
    current_season_id: '0', season_start_ms: '0', reward_pool: '0', treasury: '0', total_seeds: '0',
    total_growth_points: '0', eligible_growth_points: '0', settlement: null, paused: false, ...tables },
  'The Registry is not the exact empty, unstarted Registry from the reviewed setup.');
}
function inventory(data) {
  const code = 'EXISTING_SETUP_CONFLICT';
  const registries = complete(data.registries, 'settlement Registry', code);
  const caps = complete(data.adminCaps, 'settlement AdminCap', code);
  requireThat(registries.length <= 1 && caps.length <= 1 && registries.length === caps.length,
    'The settlement Registry/AdminCap inventory is inconsistent or contains multiple objects. Creation is disabled.', code);
  if (!registries.length) return null;
  try { validateRegistryIdentity(registries[0], caps[0], false); }
  catch (error) { throw new SetupReviewError(code, `An existing setup cannot be safely identified. Creation is disabled. ${error.message}`); }
  const previous = registries[0].previousTransaction;
  let candidate = null;
  if (previous?.effects?.status === 'SUCCESS' && previous.effects.checkpoint) {
    try { checkpoint(previous.effects.checkpoint, {}, false); candidate = digest(previous.digest); }
    catch { /* An unavailable recovery candidate never makes creation safe. */ }
  }
  return { registry: registries[0], adminCap: caps[0], digest: candidate };
}
export async function validateSetupPreflight(inputsResponse, tipResponse, options = {}) {
  const data = dataOf(inputsResponse), tip = dataOf(tipResponse);
  network(tip); network(data);
  checkpoint(tip.checkpoint, options); checkpoint(data.checkpoint, options);
  same(data.reviewCheckpoint, tip.checkpoint, 'The setup inputs do not match the requested review checkpoint.');
  requireThat(data.checkpoint.sequenceNumber >= tip.checkpoint.sequenceNumber,
    'The current Registry inventory predates the review checkpoint.');
  requireThat(data.checkpoint.sequenceNumber >= SETUP_EXPECTED.upgradeCheckpoint.sequenceNumber,
    'The chain observation predates the confirmed v12 upgrade.');
  await validateKnownUpgrade(data);
  const existing = inventory(data);
  if (existing) return { status: 'already-created', checkpoint: data.checkpoint,
    registryId: existing.registry.address, adminCapId: existing.adminCap.address, digest: existing.digest };
  same(ref(data.legacyAdminCap), SETUP_EXPECTED.legacyAdminCap,
    'The legacy AdminCap input reference changed. The approved setup cannot be submitted.', 'CONTRACT_CHANGED');
  return { status: 'ready', checkpoint: data.checkpoint, sender: SETUP_EXPECTED.sender,
    packageId: PACKAGE, legacyAdminCap: { ...SETUP_EXPECTED.legacyAdminCap } };
}

function validateGas(effects) {
  const summary = effects.gasEffects?.gasSummary;
  requireThat(summary, 'The transaction gas effects are missing.');
  const net = uint(summary.computationCost, 'Computation cost') + uint(summary.storageCost, 'Storage cost')
    - uint(summary.storageRebate, 'Storage rebate');
  uint(summary.nonRefundableStorageFee, 'Non-refundable storage fee');
  requireThat(net > 0n, 'The setup gas debit is invalid.');
  same(effects.balanceChangesJson, [{ address: SETUP_EXPECTED.sender, coinType: `${SUI}::sui::SUI`, amount: String(-net) }],
    'Unexpected token transfer or balance movement: only the administrator gas debit is authorized.');
  return { gasEstimateMist: String(net), gasEstimateSui: formatSui(net) };
}
function validateEffects(effects, gasPayments = [], actualDigest = null) {
  requireThat(effects?.status === 'SUCCESS' && !effects.executionError,
    effects?.executionError?.message ?? 'The setup transaction did not succeed.', 'TRANSACTION_FAILED');
  const changes = complete(effects.objectChanges, 'setup object changes');
  requireThat(new Set(changes.map(change => address(change.address))).size === changes.length, 'Duplicate setup object changes.');
  const registryChanges = changes.filter(change => typeOf(change.outputState) === SETUP_EXPECTED.registryType);
  const capChanges = changes.filter(change => typeOf(change.outputState) === SETUP_EXPECTED.adminCapType);
  requireThat(registryChanges.length === 1 && capChanges.length === 1,
    'Expected exactly one new settlement Registry and one bound AdminCap.');
  const registryChange = registryChanges[0], capChange = capChanges[0];
  const registry = registryChange.outputState, adminCap = capChange.outputState;
  validateRegistryIdentity(registry, adminCap, true);
  const payments = new Map(gasPayments.map(payment => [address(payment.objectId), payment]));
  requireThat(payments.size === gasPayments.length, 'Duplicate gas-payment object references.');
  let highestVersion = BigInt(SETUP_EXPECTED.legacyAdminCap.version);
  for (const payment of gasPayments) {
    digest(payment.digest);
    const version = uint(payment.version, 'Gas-payment input version');
    if (version > highestVersion) highestVersion = version;
  }
  const nextVersion = highestVersion + 1n;
  function output(object) {
    ref(object);
    requireThat(uint(object.version) === nextVersion, 'A setup object has an unexpected Lamport output version.');
    if (actualDigest && object.previousTransaction) requireThat(object.previousTransaction.digest === actualDigest,
      'An output object names a different setup transaction.');
  }
  for (const change of [registryChange, capChange]) {
    requireThat(change.idCreated === true && change.idDeleted === false && change.inputState === null &&
      change.address === change.outputState.address, 'The setup did not create the two expected new objects.');
    output(change.outputState);
  }
  requireThat(uint(registry.owner.initialSharedVersion) === nextVersion,
    'The shared Registry has an unexpected initial version.');
  const tableIds = TABLE_NAMES.map(name => fields(registry)[name].id).sort();
  const wrapped = changes.filter(change => change.idCreated === true && change.outputState === null);
  same(wrapped.map(change => change.address).sort(), tableIds, 'Wrapped IDs must be exactly the six empty Registry tables.');
  requireThat(wrapped.every(change => change.inputState === null && change.idDeleted === false),
    'Unexpected table creation or deletion.');
  const legacyChanges = changes.filter(change => change.address === SETUP_EXPECTED.legacyAdminCap.objectId);
  requireThat(legacyChanges.length === 1, 'The legacy AdminCap metadata update is missing.');
  const legacy = legacyChanges[0];
  requireThat(legacy.idCreated === false && legacy.idDeleted === false, 'The legacy AdminCap was created or deleted.');
  validateLegacyCap(legacy.inputState); validateLegacyCap(legacy.outputState);
  same(ref(legacy.inputState), SETUP_EXPECTED.legacyAdminCap, 'The setup consumed a different legacy AdminCap reference.');
  output(legacy.outputState);
  requireThat(legacy.outputState.digest !== legacy.inputState.digest, 'The legacy AdminCap version changed without a new digest.');
  const setupIds = new Set([registry.address, adminCap.address, SETUP_EXPECTED.legacyAdminCap.objectId, ...tableIds]);
  requireThat(setupIds.size === 9 && [...payments.keys()].every(id => !setupIds.has(id)),
    'Setup object IDs or gas-payment IDs overlap.');
  const gasChanges = changes.filter(change => !setupIds.has(change.address));
  requireThat(gasChanges.length === payments.size, 'Unexpected object changes outside setup and the exact gas-payment list.');
  for (const change of gasChanges) {
    const payment = payments.get(change.address);
    requireThat(payment && change.idCreated === false && (change.idDeleted === true || change.idDeleted === false),
      'An object outside the actual gas-payment list was changed.');
    same(ref(change.inputState), { ...payment, version: String(payment.version) }, 'The gas-payment input reference differs.');
    owner(change.inputState, 'The gas-payment coin');
    requireThat(typeOf(change.inputState) === `${SUI}::coin::Coin<${SUI}::sui::SUI>`, 'A non-SUI gas-payment object was changed.');
    if (change.idDeleted) requireThat(change.outputState === null, 'A deleted gas-payment object has output state.');
    else {
      requireThat(change.outputState?.address === change.address, 'The gas-payment output ID changed.');
      owner(change.outputState, 'The gas-payment coin');
      requireThat(typeOf(change.outputState) === typeOf(change.inputState), 'The gas-payment coin type changed.');
      output(change.outputState);
    }
  }
  requireThat(changes.length === 9 + payments.size, 'The setup object inventory differs from the exact reviewed call.');
  const events = complete(effects.events, 'setup events');
  same(events, [{ sender: { address: SETUP_EXPECTED.sender }, contents: { type: { repr: SETUP_EXPECTED.eventType },
    json: { registry_id: registry.address, admin: SETUP_EXPECTED.sender, legacy_cap_id: SETUP_EXPECTED.legacyAdminCap.objectId } } }],
  'Expected only the exact SettlementRegistryCreated event.');
  return { registry, adminCap, legacyAdminCap: legacy.outputState, ...validateGas(effects) };
}

export async function validateSetupSimulation(response, options = {}) {
  const data = dataOf(response);
  network(data); checkpoint(data.checkpoint, options);
  requireThat(!data.transaction && data.simulateTransaction?.effects && data.simulateTransaction.effects.checkpoint == null,
    'Expected only checked simulation effects, without a confirmed setup receipt.');
  validateCurrentAuthority(data);
  requireThat(!inventory(data), 'A settlement Registry already exists. Creation is disabled.', 'EXISTING_SETUP_CONFLICT');
  same(ref(data.legacyAdminCap), SETUP_EXPECTED.legacyAdminCap, 'The setup authority input reference changed.', 'CONTRACT_CHANGED');
  const checked = validateEffects(data.simulateTransaction.effects);
  const ceiling = uint(options.maxGasMist == null ? SETUP_EXPECTED.maxGasMist : String(options.maxGasMist), 'Gas review ceiling');
  requireThat(ceiling <= BigInt(SETUP_EXPECTED.maxGasMist), 'The setup gas review ceiling cannot exceed the approved 0.01 SUI.');
  requireThat(BigInt(checked.gasEstimateMist) <= ceiling,
    `The current setup estimate exceeds ${formatSui(ceiling)} SUI. A new fee review is required.`, 'GAS_INCREASED');
  return { status: 'simulated', checkpoint: data.checkpoint,
    gasEstimateMist: checked.gasEstimateMist, gasEstimateSui: checked.gasEstimateSui,
    simulationOnly: { registryId: checked.registry.address, adminCapId: checked.adminCap.address } };
}

export async function validateConfirmedSetup(response, expectedDigest, options = {}) {
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true,
    'Simulation data cannot establish a real setup.', 'CONFIRMATION_MISMATCH');
  network(data); checkpoint(data.checkpoint, options);
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint,
    'The setup transaction is not yet visible at a confirmed checkpoint.', 'CONFIRMATION_PENDING');
  checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(data.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber &&
    actual.effects.checkpoint.sequenceNumber >= SETUP_EXPECTED.upgradeCheckpoint.sequenceNumber,
    'The setup receipt or current-state checkpoint order differs.', 'CONFIRMATION_MISMATCH');
  requireThat(actual.digest === digest(expectedDigest), 'The receipt is for a different transaction.', 'CONFIRMATION_MISMATCH');
  const transaction = Transaction.from(actual.transactionBcs), tx = transaction.getData();
  requireThat(tx.sender === SETUP_EXPECTED.sender && actual.sender?.address === SETUP_EXPECTED.sender &&
    tx.gasData.owner === SETUP_EXPECTED.sender, 'The setup receipt has the wrong sender or gas owner.', 'CONFIRMATION_MISMATCH');
  requireThat(await transaction.getDigest() === expectedDigest,
    'The full setup transaction bytes have a different digest.', 'CONFIRMATION_MISMATCH');
  requireThat(await sha256(await transaction.build({ onlyTransactionKind: true })) === SETUP_EXPECTED.kindSha256,
    'The confirmed transaction differs from the exact approved setup.', 'PACKET_MISMATCH');
  requireThat(Array.isArray(tx.gasData.payment), 'The actual gas-payment list is unavailable.');
  const checked = validateEffects(actual.effects, tx.gasData.payment, expectedDigest);
  requireThat(BigInt(checked.gasEstimateMist) <= uint(tx.gasData.budget, 'Actual gas budget'),
    'The actual gas debit exceeds the transaction budget.');
  await validateKnownUpgrade(data);
  const existing = inventory(data);
  requireThat(existing && existing.registry.address === checked.registry.address && existing.adminCap.address === checked.adminCap.address,
    'The live Registry/AdminCap inventory does not match this setup receipt.', 'CONFIRMATION_MISMATCH');
  // The receipt proves empty creation. A later live read can legitimately show
  // season activity or a newer object version; that must never enable creation
  // again or rewrite the historical receipt as an unconfirmed operation.
  requireThat(uint(existing.registry.owner.initialSharedVersion) === uint(checked.registry.owner.initialSharedVersion),
    'The live Registry initial shared version contradicts the creation receipt.', 'CONFIRMATION_MISMATCH');
  let currentEmpty = true, hasAdvanced = false;
  try { validateRegistryIdentity(existing.registry, existing.adminCap, true); }
  catch { currentEmpty = false; }
  for (const [live, created] of [[existing.registry, checked.registry], [existing.adminCap, checked.adminCap],
    [data.legacyAdminCap, checked.legacyAdminCap]]) {
    const liveVersion = uint(live.version), createdVersion = uint(created.version);
    requireThat(liveVersion >= createdVersion, 'A live setup output predates the confirmed receipt.', 'CONFIRMATION_MISMATCH');
    if (liveVersion === createdVersion) {
      same(ref(live), ref(created), 'A live setup output contradicts the same-version receipt reference.', 'CONFIRMATION_MISMATCH');
      same(fields(live), fields(created), 'Live setup contents contradict the same-version receipt.', 'CONFIRMATION_MISMATCH');
    } else {
      hasAdvanced = true;
      if (live !== existing.registry) same(fields(live), fields(created),
        'A live capability changed its contents or Registry binding.', 'CONFIRMATION_MISMATCH');
    }
  }
  return { status: 'confirmed', digest: expectedDigest, registryId: checked.registry.address,
    adminCapId: checked.adminCap.address, packageId: PACKAGE, typeOrigin: PACKAGE,
    checkpoint: actual.effects.checkpoint, gasEstimateMist: checked.gasEstimateMist, gasEstimateSui: checked.gasEstimateSui,
    gasAboveReviewCeiling: BigInt(checked.gasEstimateMist) > BigInt(SETUP_EXPECTED.maxGasMist),
    currentEmpty, hasAdvanced };
}
