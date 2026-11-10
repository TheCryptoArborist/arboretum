// Pure browser review and receipt validation for the first 24-hour v1 test season.
// No fetch, DOM, storage, wallet or signing method belongs in this module.
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase58, fromBase64, toBase64 } from '@mysten/bcs';
import { parse, print, stripIgnoredCharacters } from 'graphql';
import { sha256 } from '../settlement-admin/upgrade-core.mjs';
import { SETTLEMENT_DEPLOYMENT, REVIEW_ONLY } from '../settlement-integration/deployment-config.mjs';
import {
  SETUP_EXPECTED, CONFIRM_QUERY as SETUP_CONFIRM_QUERY, CONFIRM_VARIABLES as SETUP_CONFIRM_VARIABLES,
  validateConfirmedSetup,
} from '../settlement-setup/setup-core.mjs';

export class StartReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'StartReviewError'; this.code = code; }
}
function requireThat(value, message, code = 'REVIEW_MISMATCH') {
  if (!value) throw new StartReviewError(code, message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const assert = Object.freeze({
  ok: requireThat,
  equal: (a, b, message) => requireThat(a === b, message || 'Values differ.'),
  deepEqual: (a, b, message) => requireThat(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), message || 'Values differ.'),
  match: (value, pattern, message) => requireThat(typeof value === 'string' && pattern.test(value), message || 'Value has an invalid format.'),
});
export const START_EXPECTED = Object.freeze({
  endpoint: SETUP_EXPECTED.graphqlEndpoint,
  graphqlEndpoint: SETUP_EXPECTED.graphqlEndpoint,
  network: SETUP_EXPECTED.network, chain: SETUP_EXPECTED.chain,
  genesisDigest: SETUP_EXPECTED.genesisDigest,
  origin: SETUP_EXPECTED.origin,
  sender: SETUP_EXPECTED.sender,
  packageId: SETUP_EXPECTED.packageId,
  registryId: '0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9',
  adminCapId: '0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835',
  registryInitialSharedVersion: '986499448',
  setupDigest: '87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp',
  clockId: '0x' + '0'.repeat(63) + '6',
  durationMs: '86400000',
  wateringIntervalMs: '77760000',
  kindBytes: 258,
  kindSha256: '6c89e6e0c74aa30a0b258194805566947469a3ed4fc1cfef97e4d9ecc71922f1',
  adminCap: Object.freeze({
    objectId: '0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835',
    version: '986499448', digest: 'HDZcd13jb51WBb59PwTCW4oYk7rtchGYDtV6a5sajDUg',
  }),
  maxGasMist: '10000000',
  maximumDurationMs: '2592000000',
  claimWindowMs: '604800000',
  reviewWindowMs: '86400000',
  maxAgeMs: 120000,
});
const EXPECTED = START_EXPECTED;
const TABLE_NAMES = ['seeds_by_owner', 'referrers', 'referral_earnings', 'player_growth', 'player_growth_season', 'planted_saplings'];
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`;
const CAP_TYPE = `${EXPECTED.packageId}::settlement::AdminCap`;
const START_TYPE = `${EXPECTED.packageId}::settlement::SeasonStarted`;
export const contents = object => object?.asMoveObject?.contents?.json;
const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
const uint = value => {
  assert.ok((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), 'Malformed unsigned integer');
  return BigInt(value);
};
const address = value => {
  assert.match(value ?? '', /^0x[0-9a-f]{64}$/, 'Malformed object address');
  return value;
};
export function reference(object) {
  assert.equal(fromBase58(object?.digest ?? '').length, 32, 'Malformed object digest');
  return { objectId: address(object.address), version: String(uint(object.version)), digest: object.digest };
}
const complete = (value, label) => {
  assert.ok(Array.isArray(value?.nodes) && value.pageInfo?.hasNextPage === false, `Incomplete ${label}`);
  return value.nodes;
};
const dataOf = response => {
  requireThat(!(response?.response && response?.data), 'The response contains ambiguous wrapped and unwrapped data.');
  const raw = response?.response ?? response;
  assert.ok(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response');
  return raw.data;
};
function ownerIsAdministrator(object) {
  assert.deepEqual(object?.owner, { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
    'Object is not owned by the administrator');
}
function verifyClock(object, options = {}, historical = false) {
  reference(object);
  assert.equal(object.address, EXPECTED.clockId, 'Wrong Clock object');
  assert.equal(typeOf(object), `${SUI}::clock::Clock`, 'Wrong Clock type');
  assert.deepEqual(object.owner, { __typename: 'Shared', initialSharedVersion: 1 }, 'Wrong Clock shared ownership');
  const value = contents(object);
  assert.deepEqual(Object.keys(value).sort(), ['id', 'timestamp_ms'], 'Wrong Clock fields');
  assert.equal(value.id, EXPECTED.clockId);
  const time = uint(value.timestamp_ms), now = BigInt(options.now ?? Date.now());
  assert.ok(time > 0n, 'Invalid Clock timestamp');
  if (!historical) assert.ok(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'Stale or future Clock');
  return time;
}
const OBJECT_FIELDS = `address version digest
  owner { __typename ... on AddressOwner { address { address } } ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }`;
const CLOCK_FIELD = `clock: object(address: "${EXPECTED.clockId}") { ${OBJECT_FIELDS} }`;
// Reuse the existing, independently tested confirmed-setup query and validator.
// Its historical receipt proves the real IDs; its live inventory checks prove
// current authority. The old setup packet is never used to build this new call.
// Historical receipts are immutable, so fetch their proof once and join it to
// each fresh live-authority snapshot. Keeping those queries separate avoids the
// endpoint's 300-field query limit without dropping any receipt validation.
const confirmation = parse(SETUP_CONFIRM_QUERY).definitions[0];
const selectedFields = names => names.map(name => {
  const field = confirmation.selectionSet.selections.find(item => (item.alias?.value ?? item.name.value) === name);
  assert.ok(field, `Missing confirmed-setup field: ${name}`);
  return print(field);
}).join('\n');
const networkFields = selectedFields(['checkpoint', 'genesis']);
const liveFields = selectedFields(['upgradeCap', 'legacyAdminCap', 'registry', 'registries', 'adminCaps']);
const liveVariables = '$upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!, $registry: SuiAddress!, $registryType: String!, $adminCapType: String!';
export const PROOF_QUERY = stripIgnoredCharacters(`query OwnerTestSeasonProof($digest: String!, $upgradeDigest: String!) {
  ${networkFields}
  ${selectedFields(['transaction', 'upgradeTransaction'])}
}`);
export const PROOF_VARIABLES = Object.freeze({ digest: EXPECTED.setupDigest, upgradeDigest: SETUP_EXPECTED.upgradeDigest });
export const INPUTS_QUERY = stripIgnoredCharacters(`query OwnerTestSeasonInputs(${liveVariables}) {
  ${networkFields}
  ${liveFields}
  ${CLOCK_FIELD}
}`);
export const INPUT_VARIABLES = Object.freeze(Object.fromEntries(Object.entries(SETUP_CONFIRM_VARIABLES)
  .filter(([name]) => name !== 'upgradeDigest')));
export const SIMULATION_QUERY = stripIgnoredCharacters(`query OwnerTestSeasonSimulation($transaction: JSON!, ${liveVariables}) {
  ${networkFields}
  ${liveFields}
  ${CLOCK_FIELD}
  simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) {
    effects {
      status executionError { message } checkpoint { sequenceNumber timestamp } epoch { epochId } lamportVersion
      transaction { transactionBcs sender { address } }
      gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
      balanceChangesJson
      objectChanges(first: 50) { nodes { address idCreated idDeleted
        inputState { ${OBJECT_FIELDS} }
        outputState { ${OBJECT_FIELDS} }
      } pageInfo { hasNextPage endCursor } }
      events(first: 10) { nodes { sender { address } contents { type { repr } json } }
        pageInfo { hasNextPage endCursor } }
      unchangedConsensusObjects(first: 10) { nodes { __typename
        ... on ConsensusObjectRead { object { ${OBJECT_FIELDS} } }
      } pageInfo { hasNextPage endCursor } }
    }
  }
}`);

export const CONFIRM_VARIABLES = INPUT_VARIABLES;
export const CONFIRM_QUERY = stripIgnoredCharacters(`query OwnerTestSeasonConfirmation($digest: String!, ${liveVariables}) {
  ${networkFields}
  ${liveFields}
  ${CLOCK_FIELD}
  transaction(digest: $digest) {
    digest sender { address } transactionBcs
    effects {
      status executionError { message } checkpoint { sequenceNumber timestamp } epoch { epochId } lamportVersion
      transaction { transactionBcs sender { address } }
      gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
      balanceChangesJson
      objectChanges(first: 50) { nodes { address idCreated idDeleted
        inputState { ${OBJECT_FIELDS} }
        outputState { ${OBJECT_FIELDS} }
      } pageInfo { hasNextPage endCursor } }
      events(first: 10) { nodes { sender { address } contents { type { repr } json } }
        pageInfo { hasNextPage endCursor } }
      unchangedConsensusObjects(first: 10) { nodes { __typename
        ... on ConsensusObjectRead { object { ${OBJECT_FIELDS} } }
      } pageInfo { hasNextPage endCursor } }
    }
  }
}`);

export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin, 'Review this start only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet before reviewing the test season.', 'WRONG_NETWORK');
  requireThat(account === EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}
function checkpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0 &&
    Number.isFinite(Date.parse(value?.timestamp)), 'A confirmed blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  if (fresh) {
    const now = options.now ?? Date.now(), time = Date.parse(value.timestamp);
    requireThat(Number.isFinite(now) && time <= now + 30000 && now - time <= EXPECTED.maxAgeMs,
      'The chain review is stale or in the future. Refresh before continuing.', 'STALE_REVIEW');
  }
  return value;
}
function emptyCreation(proof) {
  const changes = complete(proof.transaction?.effects?.objectChanges, 'confirmed setup object changes');
  const created = changes.find(item => item.address === EXPECTED.registryId)?.outputState;
  requireThat(created?.address === EXPECTED.registryId, 'The confirmed setup Registry is unavailable.');
  return created;
}
function stateSummary(registry) {
  const value = contents(registry);
  return { seasonId: value.current_season_id, storedStartMs: value.season_start_ms,
    rewardPoolMist: value.reward_pool, treasuryMist: value.treasury,
    totalSeeds: value.total_seeds, growthPoints: value.total_growth_points,
    eligibleGrowthPoints: value.eligible_growth_points, paused: value.paused };
}
export async function inspectStartState(response, proofResponse, options = {}) {
  const live = dataOf(response), proof = dataOf(proofResponse);
  requireThat(!live.simulateTransaction && !live.transaction && !live.upgradeTransaction && !proof.simulateTransaction,
    'Live authority and historical proof must remain separate.');
  assert.deepEqual(proof.genesis, live.genesis, 'Receipt proof and live state identify different networks');
  checkpoint(live.checkpoint, options); checkpoint(proof.checkpoint, options);
  requireThat(proof.checkpoint.sequenceNumber <= live.checkpoint.sequenceNumber, 'Receipt proof checkpoint order differs.');
  const data = { ...live, transaction: proof.transaction, upgradeTransaction: proof.upgradeTransaction };
  const confirmed = await validateConfirmedSetup({ data }, EXPECTED.setupDigest, options);
  assert.deepEqual([confirmed.packageId, confirmed.registryId, confirmed.adminCapId],
    [EXPECTED.packageId, EXPECTED.registryId, EXPECTED.adminCapId], 'Wrong confirmed deployment');
  assert.equal(REVIEW_ONLY, true, 'The global gameplay review guard changed');
  assert.deepEqual([SETTLEMENT_DEPLOYMENT.enabled, SETTLEMENT_DEPLOYMENT.reviewEnabled,
    SETTLEMENT_DEPLOYMENT.PACKAGE_ID, SETTLEMENT_DEPLOYMENT.REGISTRY_ID, SETTLEMENT_DEPLOYMENT.ADMIN_CAP_ID],
  [false, true, EXPECTED.packageId, EXPECTED.registryId, EXPECTED.adminCapId], 'Application read-only binding changed');
  const registry = data.registries.nodes[0], adminCap = data.adminCaps.nodes[0];
  requireThat(String(registry.owner.initialSharedVersion) === EXPECTED.registryInitialSharedVersion,
    'The Registry initial shared version changed.');
  const created = emptyCreation(proof);
  for (const name of TABLE_NAMES) assert.equal(contents(registry)[name].id, contents(created)[name].id,
    'The live Registry table identity differs from its confirmed creation.');
  const clockMs = verifyClock(data.clock, options);
  const result = { checkpoint: data.checkpoint, registry, adminCap, clock: data.clock,
    upgradeCap: data.upgradeCap, legacyRegistry: data.registry, legacyAdminCap: data.legacyAdminCap,
    confirmedSetup: confirmed, clockMs: String(clockMs), registryId: EXPECTED.registryId,
    adminCapId: EXPECTED.adminCapId, packageId: EXPECTED.packageId, currentState: stateSummary(registry) };
  const season = uint(contents(registry).current_season_id), stored = uint(contents(registry).season_start_ms);
  requireThat(season > 0n || stored === 0n, 'The Registry start state is inconsistent.');
  if (season > 0n) {
    const previous = registry.previousTransaction;
    let digestCandidate = null;
    if (previous?.effects?.status === 'SUCCESS' && previous.effects.checkpoint) {
      try { checkpoint(previous.effects.checkpoint, {}, false);
        if (fromBase58(previous.digest).length === 32) digestCandidate = previous.digest;
      } catch { /* A recovery candidate is optional and never authorizes another request. */ }
    }
    return { ...result, status: 'already-started', digestCandidate };
  }
  requireThat(confirmed.currentEmpty === true, 'The first-season Registry is no longer empty.', 'START_STATE_CHANGED');
  assert.deepEqual(contents(registry), contents(created), 'Current Registry differs from exact empty creation contents');
  assert.deepEqual(reference(adminCap), EXPECTED.adminCap, 'The reviewed administrator capability input reference changed');
  requireThat(clockMs > uint(EXPECTED.maximumDurationMs) - uint(EXPECTED.durationMs), 'Clock is too early for this duration.');
  return { ...result, status: 'ready', digestCandidate: null };
}
export async function validateInputs(response, proofResponse, options = {}) {
  const result = await inspectStartState(response, proofResponse, options);
  requireThat(result.status === 'ready', 'The first test season has already started. Verify its receipt.', 'ALREADY_STARTED');
  return result;
}
function makeTransaction() {
  const transaction = new Transaction();
  transaction.setSender(EXPECTED.sender);
  transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::start_season_for_duration`, arguments: [
    transaction.objectRef(EXPECTED.adminCap),
    transaction.sharedObjectRef({ objectId: EXPECTED.registryId,
      initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    transaction.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
    transaction.pure.u64(EXPECTED.durationMs),
  ] });
  return transaction;
}
function simulationTransaction() {
  return { version: 1, kind: { programmableTransaction: {
    inputs: [
      { kind: 'IMMUTABLE_OR_OWNED', ...EXPECTED.adminCap },
      { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true },
      { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false },
      { kind: 'PURE', pure: bcs.u64().serialize(EXPECTED.durationMs).toBase64() },
    ], commands: [{ moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'start_season_for_duration',
      arguments: [0, 1, 2, 3].map(input => ({ kind: 'INPUT', input })) } }],
  } }, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender } };
}
export async function validateWalletTransaction(transaction) {
  requireThat(transaction instanceof Transaction, 'A Sui Transaction is required.');
  const data = transaction.getData();
  assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(value => value === null),
    'Final gas and expiration must be selected by the wallet.');
  requireThat(await sha256(await transaction.build({ onlyTransactionKind: true })) === EXPECTED.kindSha256,
    'The wallet transaction differs from the single reviewed first-start call.', 'PACKET_MISMATCH');
  return true;
}
export async function loadReviewedStart(kindBase64) {
  requireThat(typeof kindBase64 === 'string', 'The reviewed start packet is missing.', 'PACKET_MISMATCH');
  const encoded = kindBase64.trim();
  requireThat(encoded.length === Math.ceil(EXPECTED.kindBytes / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    'The start packet differs from the reviewed transaction.', 'PACKET_MISMATCH');
  const bytes = fromBase64(encoded);
  requireThat(bytes.length === EXPECTED.kindBytes && toBase64(bytes) === encoded &&
    await sha256(bytes) === EXPECTED.kindSha256, 'The start packet hash differs.', 'PACKET_MISMATCH');
  const transaction = makeTransaction();
  await validateWalletTransaction(transaction);
  requireThat(toBase64(await transaction.build({ onlyTransactionKind: true })) === encoded, 'The start packet is not the exact fixed call.');
  return { transaction, simulationTransaction: simulationTransaction(), kindBase64: encoded, kindSha256: EXPECTED.kindSha256 };
}

function sameLiveInputs(actual, previous) {
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']) {
    assert.deepEqual(reference(actual[name]), reference(previous[name]), `${name} input reference changed`);
    assert.deepEqual(actual[name].owner, previous[name].owner, `${name} input owner changed`);
    assert.equal(typeOf(actual[name]), typeOf(previous[name]), `${name} input type changed`);
    assert.deepEqual(contents(actual[name]), contents(previous[name]), `${name} input contents changed`);
  }
}
export async function validateSimulation(response, packet, previous, proofResponse, options = {}) {
  const data = dataOf(response);
  requireThat(!data.transaction && data.simulateTransaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...observed } = data;
  const current = await validateInputs({ data: observed }, proofResponse, options);
  sameLiveInputs(current, previous);
  requireThat(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation checkpoint moved backwards.');
  await validateWalletTransaction(packet.transaction);
  requireThat(packet.kindSha256 === EXPECTED.kindSha256 && packet.kindBase64 ===
    toBase64(await packet.transaction.build({ onlyTransactionKind: true })), 'The reviewed packet differs.');
  assert.deepEqual(packet.simulationTransaction, simulationTransaction(), 'The simulation proposal differs from the exact reviewed call');
  const result = await validateEffects(simulateTransaction.effects, packet, current, options);
  requireThat(uint(result.gasEstimateMist) <= uint(EXPECTED.maxGasMist),
    'The current estimate exceeds the 0.01 SUI review ceiling. Refresh or review the fee before continuing.', 'GAS_INCREASED');
  return result;
}
async function validateEffects(effects, packet, current, options = {}, actual = null) {
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The first-start transaction did not succeed.', 'TRANSACTION_FAILED');
  assert.equal(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false);
  else assert.equal(effects.checkpoint, null, 'Predicted effects must not be a confirmed transaction');
  const resolved = Transaction.from(actual?.transactionBcs ?? effects.transaction?.transactionBcs);
  const resolvedData = resolved.getData();
  assert.equal((actual ?? effects.transaction)?.sender?.address, EXPECTED.sender, 'Wrong simulated transaction sender');
  assert.equal(resolvedData.sender, EXPECTED.sender, 'Wrong resolved sender');
  assert.equal(resolvedData.gasData.owner, EXPECTED.sender, 'Wrong resolved gas owner');
  const gasBudget = uint(resolvedData.gasData.budget), gasPrice = uint(resolvedData.gasData.price);
  assert.ok(gasBudget > 0n && gasPrice > 0n, 'Resolved gas budget and price must be positive');
  // Automatic address-balance gas resolution adds a mainnet-bound ValidDuring
  // nonce even though the unsigned proposal leaves expiry/gas to a future wallet.
  // Validate that resolution; it is not an extra Move command or a signature.
  const expirationKind = resolvedData.expiration?.$kind;
  if (expirationKind === 'ValidDuring') {
    const expiry = resolvedData.expiration.ValidDuring, epoch = uint(effects.epoch?.epochId);
    const minEpoch = uint(expiry.minEpoch), maxEpoch = uint(expiry.maxEpoch);
    assert.equal(maxEpoch, minEpoch + 1n, 'Resolved expiration window differs');
    if (actual) requireThat(minEpoch <= epoch && epoch <= maxEpoch,
      'The confirmed execution epoch is outside the wallet expiration window.');
    else assert.equal(minEpoch, epoch, 'Resolved expiration starts in another epoch');
    assert.equal(expiry.minTimestamp, null); assert.equal(expiry.maxTimestamp, null);
    assert.equal(expiry.chain, SETUP_EXPECTED.genesisDigest, 'Resolved expiration has the wrong chain');
    assert.ok(Number.isInteger(expiry.nonce) && expiry.nonce >= 0 && expiry.nonce <= 0xffffffff, 'Invalid resolution nonce');
  } else if (actual && expirationKind === 'Epoch') {
    requireThat(uint(resolvedData.expiration.Epoch) >= uint(effects.epoch?.epochId),
      'The resolved transaction expired before its execution epoch.');
  } else {
    requireThat(resolvedData.expiration === null || (actual && expirationKind === 'None'), 'Unexpected resolved expiration kind');
  }
  assert.equal(toBase64(await resolved.build({ onlyTransactionKind: true })), packet.kindBase64, 'Resolved transaction kind changed');
  const payments = resolvedData.gasData.payment;
  assert.ok(Array.isArray(payments), 'Resolved gas-payment list is missing');
  if (payments.length === 0) {
    assert.equal(resolvedData.expiration?.$kind, 'ValidDuring',
      'Address-balance gas resolution requires a chain-bound ValidDuring expiration');
  }
  const paymentMap = new Map(payments.map(item => [address(item.objectId), item]));
  assert.equal(paymentMap.size, payments.length, 'Duplicate gas references');
  assert.ok([...paymentMap.keys()].every(id => ![EXPECTED.registryId, EXPECTED.adminCapId, EXPECTED.clockId].includes(id)),
    'A protocol input cannot be a gas coin');
  const unchanged = complete(effects.unchangedConsensusObjects, 'unchanged consensus objects');
  assert.equal(unchanged.length, 1, 'Expected only the read-only Clock consensus input');
  assert.equal(unchanged[0].__typename, 'ConsensusObjectRead');
  const actualClock = unchanged[0].object;
  const startedAt = verifyClock(actualClock, options, Boolean(actual));
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= startedAt, 'The confirmed checkpoint predates the actual execution Clock.');
  const storedStart = startedAt - (uint(EXPECTED.maximumDurationMs) - uint(EXPECTED.durationMs));
  const cutoff = startedAt + uint(EXPECTED.durationMs);
  const changes = complete(effects.objectChanges, 'simulation object changes');
  assert.equal(new Set(changes.map(item => address(item.address))).size, changes.length, 'Duplicate object changes');
  assert.ok(changes.every(item => item.idCreated === false), 'Start must not create protocol or coin objects');
  assert.ok(changes.every(item => item.idDeleted === false || item.idDeleted === true), 'An object deletion flag is missing');
  const registryChanges = changes.filter(item => item.address === EXPECTED.registryId);
  const capChanges = changes.filter(item => item.address === EXPECTED.adminCapId);
  assert.equal(registryChanges.length, 1, 'Exactly one existing Registry must change');
  assert.equal(capChanges.length, 1, 'Expected the owned AdminCap metadata update');
  const outputVersion = String(uint(effects.lamportVersion));
  const inputVersions = [current.registry.version, current.adminCap.version, actualClock.version,
    ...payments.map(item => item.version)].map(value => uint(value));
  const nextVersion = inputVersions.reduce((highest, value) => value > highest ? value : highest, 0n) + 1n;
  requireThat(uint(outputVersion) === nextVersion, 'The output Lamport version is not derived from the actual input versions.');
  for (const [change, input, type] of [[registryChanges[0], current.registry, REGISTRY_TYPE],
    [capChanges[0], current.adminCap, CAP_TYPE]]) {
    assert.equal(change.idDeleted, false, 'A protocol input was deleted');
    assert.equal(change.inputState?.address, input.address);
    assert.deepEqual(reference(change.inputState), reference(input), 'Simulation consumed a different input');
    assert.deepEqual(contents(change.inputState), contents(input), 'Simulation input contents changed');
    assert.deepEqual(change.inputState.owner, input.owner, 'Simulation input ownership changed');
    assert.equal(typeOf(change.inputState), type);
    const output = change.outputState;
    assert.equal(output?.address, input.address);
    assert.equal(typeOf(output), type);
    assert.deepEqual(output.owner, input.owner, 'Simulation transferred a protocol object');
    assert.equal(reference(output).version, outputVersion, 'Unexpected output Lamport version');
    assert.ok(uint(output.version) > uint(input.version), 'Output version did not advance');
    assert.ok(output.digest !== input.digest, 'Output digest did not change with its version');
  }
  assert.deepEqual(contents(capChanges[0].outputState), contents(current.adminCap), 'AdminCap fields changed');
  assert.deepEqual(contents(registryChanges[0].outputState), { ...contents(current.registry),
    current_season_id: '1', season_start_ms: String(storedStart) }, 'Unexpected Registry state changes');
  const gasChanges = changes.filter(item => ![EXPECTED.registryId, EXPECTED.adminCapId].includes(item.address));
  assert.deepEqual(gasChanges.map(item => item.address).sort(), [...paymentMap.keys()].sort(),
    'Returned gas object changes do not match the resolved payment list');
  for (const change of gasChanges) {
    const payment = paymentMap.get(change.address);
    assert.ok(payment, 'Unexpected object changed outside the start call and resolved gas list');
    assert.deepEqual(reference(change.inputState), { ...payment, version: String(payment.version) });
    ownerIsAdministrator(change.inputState); assert.equal(typeOf(change.inputState), COIN_TYPE);
    if (change.idDeleted) assert.equal(change.outputState, null);
    else {
      assert.equal(change.outputState?.address, change.address);
      ownerIsAdministrator(change.outputState); assert.equal(typeOf(change.outputState), COIN_TYPE);
      assert.equal(reference(change.outputState).version, outputVersion);
    }
  }
  const events = complete(effects.events, 'simulation events');
  assert.deepEqual(events, [{ sender: { address: EXPECTED.sender }, contents: { type: { repr: START_TYPE },
    json: { season_id: '1', start_ms: String(startedAt) } } }], 'Unexpected SeasonStarted event');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate);
  uint(gas?.nonRefundableStorageFee);
  assert.ok(net > 0n, 'Invalid gas estimate');
  assert.ok(net <= gasBudget, 'Estimated gas exceeds the resolved budget');
  assert.deepEqual(effects.balanceChangesJson, [{ address: EXPECTED.sender, coinType: SUI_TYPE, amount: String(-net) }],
    'Only the predicted administrator SUI gas debit is permitted');
  return { status: actual ? 'confirmed' : 'simulated', checkpoint: actual ? effects.checkpoint : current.checkpoint,
    registryId: EXPECTED.registryId, adminCapId: EXPECTED.adminCapId,
    predictedSeasonId: '1', proposedDurationMs: EXPECTED.durationMs,
    actualStartMs: String(startedAt), storedStartMs: String(storedStart),
    cutoffMs: String(cutoff), claimDeadlineMs: String(cutoff + uint(EXPECTED.claimWindowMs)),
    normalResetReadyMs: String(cutoff + uint(EXPECTED.reviewWindowMs)),
    gasEstimateMist: String(net), gasEstimateSui: `${net / 1000000000n}.${String(net % 1000000000n).padStart(9, '0')}`,
    simulatedGasBudgetMist: String(gasBudget), simulatedGasPriceMist: String(gasPrice),
    simulatedResolvedExpiration: resolvedData.expiration,
    resolvedGasPayments: payments.length, returnedGasObjectChanges: gasChanges.length,
    protocolObjectChanges: changes.length - gasChanges.length, protocolObjectsCreated: 0,
    predictedRewardPoolMist: '0', predictedTreasuryMist: '0', predictedPlantedSeeds: '0', predictedGrowthPoints: '0',
    exactKindSha256: packet.kindSha256, simulationClock: reference(actualClock),
    note: actual ? 'The confirmed first-start receipt contains no funding or player purchase.' :
      'Predicted state only. No signature, execution, season start, funding or gas payment occurred.' };
}

export async function validateConfirmedStart(response, expectedDigest, proofResponse, options = {}) {
  const data = dataOf(response), proof = dataOf(proofResponse);
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true,
    'Simulation data cannot establish a confirmed season.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint,
    'The first-start receipt is not yet visible at a confirmed checkpoint.', 'CONFIRMATION_PENDING');
  checkpoint(data.checkpoint, options); checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(data.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber,
    'The current observation predates the confirmed receipt.', 'CONFIRMATION_MISMATCH');
  requireThat(typeof expectedDigest === 'string' && fromBase58(expectedDigest).length === 32 && actual.digest === expectedDigest,
    'The receipt is for a different transaction.', 'CONFIRMATION_MISMATCH');
  const resolved = Transaction.from(actual.transactionBcs);
  requireThat(await resolved.getDigest() === expectedDigest,
    'The full transaction bytes have a different digest.', 'CONFIRMATION_MISMATCH');
  const kind = await resolved.build({ onlyTransactionKind: true });
  requireThat(await sha256(kind) === EXPECTED.kindSha256,
    'The confirmed transaction differs from the exact reviewed first-start call.', 'PACKET_MISMATCH');
  const { transaction: ignored, ...live } = data;
  const current = await inspectStartState({ data: live }, proofResponse, options);
  requireThat(current.status === 'already-started', 'The live Registry does not yet reflect a started season.', 'CONFIRMATION_PENDING');
  requireThat(actual.effects.checkpoint.sequenceNumber >= proof.transaction.effects.checkpoint.sequenceNumber,
    'The first-start receipt predates the confirmed empty setup.');
  const changes = complete(actual.effects.objectChanges, 'confirmed first-start object changes');
  const registryChange = changes.find(item => item.address === EXPECTED.registryId);
  const capChange = changes.find(item => item.address === EXPECTED.adminCapId);
  const inputRegistry = registryChange?.inputState, inputCap = capChange?.inputState;
  const created = emptyCreation(proof);
  requireThat(inputRegistry && inputCap, 'The confirmed first-start inputs are missing.');
  assert.equal(inputRegistry.address, EXPECTED.registryId, 'Wrong receipt Registry input');
  assert.equal(typeOf(inputRegistry), REGISTRY_TYPE, 'Wrong receipt Registry input type');
  assert.deepEqual(inputRegistry.owner, created.owner, 'Receipt Registry input ownership differs');
  assert.deepEqual(contents(inputRegistry), contents(created), 'Receipt Registry was not the exact empty creation state');
  requireThat(uint(inputRegistry.version) >= uint(created.version), 'Receipt Registry input predates creation.');
  if (uint(inputRegistry.version) === uint(created.version)) assert.deepEqual(reference(inputRegistry), reference(created),
    'Same-version receipt input differs from confirmed creation');
  assert.deepEqual(reference(inputCap), EXPECTED.adminCap, 'The receipt consumed a different AdminCap input');
  ownerIsAdministrator(inputCap);
  assert.equal(typeOf(inputCap), CAP_TYPE, 'Wrong receipt AdminCap input type');
  assert.deepEqual(contents(inputCap), { id: EXPECTED.adminCapId, version: '1', registry_id: EXPECTED.registryId },
    'Wrong receipt AdminCap binding');
  const packet = { kindBase64: toBase64(kind), kindSha256: EXPECTED.kindSha256 };
  const checked = await validateEffects(actual.effects, packet, { registry: inputRegistry, adminCap: inputCap }, options, actual);
  let hasAdvanced = false;
  for (const [liveObject, change] of [[current.registry, registryChange], [current.adminCap, capChange]]) {
    const output = change.outputState;
    requireThat(uint(liveObject.version) >= uint(output.version), 'A live object predates the confirmed first-start receipt.', 'CONFIRMATION_PENDING');
    if (uint(liveObject.version) === uint(output.version)) {
      assert.deepEqual(reference(liveObject), reference(output), 'Same-version live object contradicts the first-start receipt');
      assert.deepEqual(contents(liveObject), contents(output), 'Same-version live contents contradict the first-start receipt');
      if (liveObject.previousTransaction) assert.equal(liveObject.previousTransaction.digest, expectedDigest,
        'Same-version live object names a different transaction');
    } else {
      hasAdvanced = true;
      if (liveObject === current.adminCap) assert.deepEqual(contents(liveObject), contents(output), 'The live AdminCap binding changed');
    }
    assert.deepEqual(liveObject.owner, output.owner, 'The live first-start object ownership changed');
    if (output.previousTransaction) assert.equal(output.previousTransaction.digest, expectedDigest, 'Receipt output names another transaction');
  }
  requireThat(uint(current.currentState.seasonId) >= 1n, 'The live season counter contradicts the first start.');
  if (current.currentState.seasonId === '1') requireThat(current.currentState.storedStartMs === '0' ||
    current.currentState.storedStartMs === checked.storedStartMs, 'The live first-season start contradicts its receipt.');
  return { ...checked, digest: expectedDigest, packageId: EXPECTED.packageId, typeOrigin: EXPECTED.packageId,
    seasonId: '1', currentState: current.currentState, hasAdvanced,
    gasAboveReviewCeiling: uint(checked.gasEstimateMist) > uint(EXPECTED.maxGasMist) };
}
