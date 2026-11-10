// Verification-only first-season rehearsal. No wallet, key, signer, storage,
// execution method or application activation is present in this module.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, toBase64 } from '@mysten/bcs';
import { parse, print, stripIgnoredCharacters } from 'graphql';
import { transactionToGrpcJson } from '../../node_modules/@mysten/sui/dist/client/transaction-resolver.mjs';
import { SETTLEMENT_DEPLOYMENT, REVIEW_ONLY } from '../deployment-config.mjs';
import {
  SETUP_EXPECTED, CONFIRM_QUERY, CONFIRM_VARIABLES, validateConfirmedSetup,
} from '../../settlement-setup/setup-core.mjs';

export const EXPECTED = Object.freeze({
  endpoint: SETUP_EXPECTED.graphqlEndpoint,
  origin: SETUP_EXPECTED.origin,
  sender: SETUP_EXPECTED.sender,
  packageId: SETUP_EXPECTED.packageId,
  registryId: '0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9',
  adminCapId: '0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835',
  registryInitialSharedVersion: '986499448',
  setupDigest: '87FdmWtG7aGWzLaQ1deEdf39xwSasPZR8qKg6cRTnaGp',
  clockId: '0x' + '0'.repeat(63) + '6',
  durationMs: '86400000',
  maximumDurationMs: '2592000000',
  claimWindowMs: '604800000',
  reviewWindowMs: '86400000',
  maxAgeMs: 120000,
});
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`;
const CAP_TYPE = `${EXPECTED.packageId}::settlement::AdminCap`;
const START_TYPE = `${EXPECTED.packageId}::settlement::SeasonStarted`;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
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
  const raw = response?.response ?? response;
  assert.ok(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response');
  return raw.data;
};
function ownerIsAdministrator(object) {
  assert.deepEqual(object?.owner, { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
    'Object is not owned by the administrator');
}
function verifyClock(object, options = {}) {
  reference(object);
  assert.equal(object.address, EXPECTED.clockId, 'Wrong Clock object');
  assert.equal(typeOf(object), `${SUI}::clock::Clock`, 'Wrong Clock type');
  assert.deepEqual(object.owner, { __typename: 'Shared', initialSharedVersion: 1 }, 'Wrong Clock shared ownership');
  const value = contents(object);
  assert.deepEqual(Object.keys(value).sort(), ['id', 'timestamp_ms'], 'Wrong Clock fields');
  assert.equal(value.id, EXPECTED.clockId);
  const time = uint(value.timestamp_ms), now = BigInt(options.now ?? Date.now());
  assert.ok(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'Stale or future Clock');
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
const confirmation = parse(CONFIRM_QUERY).definitions[0];
const selectedFields = names => names.map(name => {
  const field = confirmation.selectionSet.selections.find(item => (item.alias?.value ?? item.name.value) === name);
  assert.ok(field, `Missing confirmed-setup field: ${name}`);
  return print(field);
}).join('\n');
const networkFields = selectedFields(['checkpoint', 'genesis']);
const liveFields = selectedFields(['upgradeCap', 'legacyAdminCap', 'registry', 'registries', 'adminCaps']);
const liveVariables = '$upgradeCap: SuiAddress!, $legacyAdminCap: SuiAddress!, $registry: SuiAddress!, $registryType: String!, $adminCapType: String!';
export const PROOF_QUERY = stripIgnoredCharacters(`query SeasonStartRehearsalProof($digest: String!, $upgradeDigest: String!) {
  ${networkFields}
  ${selectedFields(['transaction', 'upgradeTransaction'])}
}`);
export const PROOF_VARIABLES = Object.freeze({ digest: EXPECTED.setupDigest, upgradeDigest: SETUP_EXPECTED.upgradeDigest });
export const INPUTS_QUERY = stripIgnoredCharacters(`query SeasonStartRehearsalInputs(${liveVariables}) {
  ${networkFields}
  ${liveFields}
  ${CLOCK_FIELD}
}`);
export const INPUT_VARIABLES = Object.freeze(Object.fromEntries(Object.entries(CONFIRM_VARIABLES)
  .filter(([name]) => name !== 'upgradeDigest')));
export const SIMULATION_QUERY = stripIgnoredCharacters(`query SeasonStartRehearsalSimulation($transaction: JSON!, ${liveVariables}) {
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

export async function validateInputs(response, proofResponse, options = {}) {
  const live = dataOf(response), proof = dataOf(proofResponse);
  assert.ok(!live.simulateTransaction && !live.transaction && !live.upgradeTransaction && !proof.simulateTransaction,
    'Live authority and confirmed receipt proof must remain distinct from simulation');
  assert.deepEqual(proof.genesis, live.genesis, 'Receipt proof and live state identify different networks');
  assert.ok(Number.isSafeInteger(proof.checkpoint?.sequenceNumber) &&
    proof.checkpoint.sequenceNumber <= live.checkpoint?.sequenceNumber, 'Receipt proof checkpoint order differs');
  const proofTime = Date.parse(proof.checkpoint.timestamp), now = options.now ?? Date.now();
  assert.ok(Number.isFinite(proofTime) && proofTime <= now + 30000 && now - proofTime <= EXPECTED.maxAgeMs,
    'Receipt proof observation is stale or in the future');
  const data = { ...live, transaction: proof.transaction, upgradeTransaction: proof.upgradeTransaction };
  const confirmed = await validateConfirmedSetup({ data }, EXPECTED.setupDigest, options);
  assert.equal(confirmed.currentEmpty, true, 'The first-season Registry is no longer empty');
  assert.deepEqual([confirmed.packageId, confirmed.registryId, confirmed.adminCapId],
    [EXPECTED.packageId, EXPECTED.registryId, EXPECTED.adminCapId], 'Wrong confirmed deployment');
  assert.equal(REVIEW_ONLY, true);
  assert.deepEqual([SETTLEMENT_DEPLOYMENT.enabled, SETTLEMENT_DEPLOYMENT.reviewEnabled,
    SETTLEMENT_DEPLOYMENT.PACKAGE_ID, SETTLEMENT_DEPLOYMENT.REGISTRY_ID, SETTLEMENT_DEPLOYMENT.ADMIN_CAP_ID],
  [false, true, EXPECTED.packageId, EXPECTED.registryId, EXPECTED.adminCapId], 'Application read-only binding changed');
  const registry = data.registries.nodes[0], adminCap = data.adminCaps.nodes[0];
  const created = data.transaction.effects.objectChanges.nodes.find(item => item.address === EXPECTED.registryId)?.outputState;
  assert.deepEqual(contents(registry), contents(created), 'Current Registry differs from its exact empty creation contents');
  assert.equal(String(registry.owner.initialSharedVersion), EXPECTED.registryInitialSharedVersion);
  const clockMs = verifyClock(data.clock, options);
  assert.ok(clockMs > uint(EXPECTED.maximumDurationMs) - uint(EXPECTED.durationMs));
  return { checkpoint: data.checkpoint, registry, adminCap, clock: data.clock,
    upgradeCap: data.upgradeCap, legacyRegistry: data.registry, legacyAdminCap: data.legacyAdminCap,
    confirmedSetup: confirmed, clockMs: String(clockMs) };
}

export async function buildStartRehearsal(inputs) {
  assert.equal(inputs.registry?.address, EXPECTED.registryId, 'Wrong rehearsal Registry');
  assert.equal(inputs.adminCap?.address, EXPECTED.adminCapId, 'Wrong rehearsal AdminCap');
  assert.equal(String(inputs.registry.owner?.initialSharedVersion), EXPECTED.registryInitialSharedVersion);
  const transaction = new Transaction();
  transaction.setSender(EXPECTED.sender);
  transaction.moveCall({ target: `${EXPECTED.packageId}::settlement::start_season_for_duration`, arguments: [
    transaction.objectRef(reference(inputs.adminCap)),
    transaction.sharedObjectRef({ objectId: EXPECTED.registryId,
      initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    transaction.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
    transaction.pure.u64(EXPECTED.durationMs),
  ] });
  const data = transaction.getData();
  assert.equal(data.inputs.length, 4); assert.equal(data.commands.length, 1);
  assert.equal(data.expiration, null);
  assert.ok(Object.values(data.gasData).every(value => value === null), 'Unsigned packet must not select final gas');
  const bytes = await transaction.build({ onlyTransactionKind: true });
  return { kindBase64: toBase64(bytes), kindSha256: sha256(bytes), kindBytes: bytes.length,
    proposedDurationMs: EXPECTED.durationMs, transactionData: data,
    simulationTransaction: transactionToGrpcJson(transaction) };
}

function sameLiveInputs(actual, previous) {
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']) {
    assert.deepEqual(reference(actual[name]), reference(previous[name]), `${name} input reference changed`);
    assert.deepEqual(actual[name].owner, previous[name].owner, `${name} input owner changed`);
    assert.equal(typeOf(actual[name]), typeOf(previous[name]), `${name} input type changed`);
    assert.deepEqual(contents(actual[name]), contents(previous[name]), `${name} input contents changed`);
  }
}
export function validateUnchangedAfter(previous, current, simulated) {
  sameLiveInputs(current, previous);
  assert.ok(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Checkpoint moved backwards');
  assert.equal(simulated?.status, 'SIMULATION_ONLY_SUCCESS', 'A validated simulation observation is required');
  assert.ok(current.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber,
    'The post-rehearsal read predates the simulation observation');
  const observedAt = Date.parse(current.checkpoint.timestamp);
  assert.ok(Number.isSafeInteger(observedAt) && BigInt(observedAt) >= uint(simulated.simulatedActualStartMs),
    'The post-rehearsal checkpoint predates the Clock used by simulation');
  return { actualRegistryUnchanged: true, actualAdminCapUnchanged: true,
    upgradeAndLegacyObjectsUnchanged: true, actualSeasonId: contents(current.registry).current_season_id,
    actualSeasonStartMs: contents(current.registry).season_start_ms,
    actualRewardPoolMist: contents(current.registry).reward_pool, actualTreasuryMist: contents(current.registry).treasury,
    observedAtOrAfterSimulatedClock: true, simulatedClockMs: simulated.simulatedActualStartMs,
    checkpoint: current.checkpoint };
}

export async function validateSimulation(response, packet, previous, proofResponse, options = {}) {
  const data = dataOf(response);
  const { simulateTransaction, ...observed } = data;
  const current = await validateInputs({ data: observed }, proofResponse, options);
  sameLiveInputs(current, previous);
  assert.ok(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation checkpoint moved backwards');
  const rebuilt = await buildStartRehearsal(current);
  assert.deepEqual(packet, rebuilt, 'Rehearsal packet differs from the exact single start call');
  const effects = simulateTransaction?.effects;
  assert.equal(effects?.status, 'SUCCESS', effects?.executionError?.message ?? 'Rehearsal did not succeed');
  assert.equal(effects.executionError, null);
  assert.equal(effects.checkpoint, null, 'Predicted effects must not be a confirmed transaction');
  const resolved = Transaction.from(effects.transaction?.transactionBcs);
  const resolvedData = resolved.getData();
  assert.equal(effects.transaction.sender?.address, EXPECTED.sender, 'Wrong simulated transaction sender');
  assert.equal(resolvedData.sender, EXPECTED.sender, 'Wrong resolved sender');
  assert.equal(resolvedData.gasData.owner, EXPECTED.sender, 'Wrong resolved gas owner');
  const gasBudget = uint(resolvedData.gasData.budget), gasPrice = uint(resolvedData.gasData.price);
  assert.ok(gasBudget > 0n && gasPrice > 0n, 'Resolved gas budget and price must be positive');
  // Automatic address-balance gas resolution adds a mainnet-bound ValidDuring
  // nonce even though the unsigned proposal leaves expiry/gas to a future wallet.
  // Validate that resolution; it is not an extra Move command or a signature.
  if (resolvedData.expiration !== null) {
    assert.equal(resolvedData.expiration.$kind, 'ValidDuring', 'Unexpected resolved expiration kind');
    const expiry = resolvedData.expiration.ValidDuring, epoch = uint(effects.epoch?.epochId);
    assert.equal(uint(expiry.minEpoch), epoch, 'Resolved expiration starts in another epoch');
    assert.equal(uint(expiry.maxEpoch), epoch + 1n, 'Resolved expiration window differs');
    assert.equal(expiry.minTimestamp, null); assert.equal(expiry.maxTimestamp, null);
    assert.equal(expiry.chain, SETUP_EXPECTED.genesisDigest, 'Resolved expiration has the wrong chain');
    assert.ok(Number.isInteger(expiry.nonce) && expiry.nonce >= 0 && expiry.nonce <= 0xffffffff, 'Invalid resolution nonce');
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
  const startedAt = verifyClock(actualClock, options);
  const storedStart = startedAt - (uint(EXPECTED.maximumDurationMs) - uint(EXPECTED.durationMs));
  const cutoff = startedAt + uint(EXPECTED.durationMs);
  const changes = complete(effects.objectChanges, 'simulation object changes');
  assert.equal(new Set(changes.map(item => address(item.address))).size, changes.length, 'Duplicate object changes');
  assert.ok(changes.every(item => item.idCreated === false), 'Start must not create protocol or coin objects');
  const registryChanges = changes.filter(item => item.address === EXPECTED.registryId);
  const capChanges = changes.filter(item => item.address === EXPECTED.adminCapId);
  assert.equal(registryChanges.length, 1, 'Exactly one existing Registry must change');
  assert.equal(capChanges.length, 1, 'Expected the owned AdminCap metadata update');
  const outputVersion = String(uint(effects.lamportVersion));
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
  return { status: 'SIMULATION_ONLY_SUCCESS', checkpoint: current.checkpoint,
    registryId: EXPECTED.registryId, adminCapId: EXPECTED.adminCapId,
    predictedSeasonId: '1', proposedDurationMs: EXPECTED.durationMs,
    simulatedActualStartMs: String(startedAt), predictedStoredStartMs: String(storedStart),
    predictedCutoffMs: String(cutoff), predictedClaimDeadlineMs: String(cutoff + uint(EXPECTED.claimWindowMs)),
    predictedNormalResetReadyMs: String(cutoff + uint(EXPECTED.reviewWindowMs)),
    gasEstimateMist: String(net), gasEstimateSui: `${net / 1000000000n}.${String(net % 1000000000n).padStart(9, '0')}`,
    simulatedGasBudgetMist: String(gasBudget), simulatedGasPriceMist: String(gasPrice),
    simulatedResolvedExpiration: resolvedData.expiration,
    resolvedGasPayments: payments.length, returnedGasObjectChanges: gasChanges.length,
    protocolObjectChanges: changes.length - gasChanges.length, protocolObjectsCreated: 0,
    predictedRewardPoolMist: '0', predictedTreasuryMist: '0', predictedPlantedSeeds: '0', predictedGrowthPoints: '0',
    exactKindSha256: packet.kindSha256, simulationClock: reference(actualClock),
    note: 'Predicted state only. No signature, execution, season start, funding or gas payment occurred.' };
}
