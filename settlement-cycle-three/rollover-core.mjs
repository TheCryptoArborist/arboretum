// Exact, atomic Season 2 archive + 48-hour Season 3 start review.
// This module never connects a wallet, signs, or submits a transaction.
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { toBase64 } from '@mysten/bcs';
import {
  EXPECTED, CAP_TYPE, ARCHIVE_TYPE, CycleReviewError, requireThat, same, uint, digest,
  contents, typeOf, reference, owner, complete, dataOf, checkpoint, verifyClock,
  registryIdentity, inspectState, sameSnapshot, packetFrom, assertWalletPacket,
  resolvedTransaction, objectChanges, inputOutput, gasAndBalances, deepFreeze,
} from './common.mjs';

export const PREVIOUS_SETTLEMENT = Object.freeze({
  season_id: EXPECTED.previousSeasonId, season_end_ms: EXPECTED.previousCutoffMs,
  claim_deadline_ms: EXPECTED.previousClaimDeadlineMs, pool_mist: '7000000',
  eligible_growth_points: '10', paid_mist: '7000000', processed_growth_points: '10', processed_seeds: '1',
});
const confirmedContexts = new WeakSet();
export function assertCycleReceipt(receipt) {
  requireThat(receipt && confirmedContexts.has(receipt) && receipt.status === 'confirmed' &&
    receipt.action === 'rollover' && receipt.seasonId === EXPECTED.seasonId,
  'Reverify the actual Season 3 rollover receipt before preparing a gameplay transaction.', 'ROLLOVER_PROOF_REQUIRED');
  return receipt;
}
function capIdentity(object) {
  reference(object); same(object.address, EXPECTED.adminCapId, 'Wrong administrator capability.'); owner(object);
  same(typeOf(object), CAP_TYPE, 'Wrong administrator capability type.');
  same(contents(object), { id: EXPECTED.adminCapId, version: '1', registry_id: EXPECTED.registryId },
    'The administrator capability is not bound to this Registry.'); return object;
}
function paidPreviousRegistry(registry) {
  const r = registryIdentity(registry);
  requireThat(r.current_season_id === EXPECTED.previousSeasonId && r.season_start_ms === EXPECTED.previousStoredStartMs,
    'Season 2 has already rolled forward or its schedule changed.', 'ALREADY_STARTED');
  same(r.settlement, PREVIOUS_SETTLEMENT, 'Season 2 must have its exact, fully processed 10-GP payout.');
  same([r.reward_pool, r.treasury, r.total_seeds, r.total_growth_points, r.eligible_growth_points, r.paused],
    ['0', '0', '1', '10', '10', false], 'The completed Season 2 balances or totals changed.');
  return r;
}
function readyState(state) {
  requireThat(state?.status === 'rollover-ready', 'Refresh the completed Season 2 before preparing its rollover.', 'NOT_READY');
  paidPreviousRegistry(state.registry); capIdentity(state.adminCap);
  same(contents(state.registry), contents(state.previousRegistryOutput), 'The Registry differs from its verified Season 2 claim output.');
  requireThat(state.confirmedPreviousClaim?.digest === EXPECTED.previousClaimDigest &&
    state.confirmedPreviousClaim.status === 'confirmed' && state.ownedSeeds.length === 2,
  'The isolated rollover requires the verified Season 2 claim and the two processed previous Seeds.');
  requireThat(uint(state.clockMs) >= uint(EXPECTED.previousCutoffMs) + uint(EXPECTED.reviewWindowMs),
    'The ordinary season rollover review window is still active.', 'ROLLOVER_NOT_READY');
  return state;
}
function transactionFor(capReference) {
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  const cap = tx.objectRef(capReference);
  const registry = tx.sharedObjectRef({ objectId: EXPECTED.registryId,
    initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true });
  const clock = tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false });
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::reset_season`, typeArguments: [], arguments: [cap, registry, clock] });
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::start_season_for_duration`, typeArguments: [],
    arguments: [cap, registry, clock, tx.pure.u64(EXPECTED.durationMs)] });
  return tx;
}
function simulationFor(capReference) {
  const input = n => ({ kind: 'INPUT', input: n });
  return { version: 1, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender }, kind: { programmableTransaction: {
    inputs: [
      { kind: 'IMMUTABLE_OR_OWNED', ...capReference },
      { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true },
      { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false },
      { kind: 'PURE', pure: bcs.u64().serialize(EXPECTED.durationMs).toBase64() },
    ], commands: [
      { moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'reset_season', typeArguments: [], arguments: [0, 1, 2].map(input) } },
      { moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'start_season_for_duration', typeArguments: [], arguments: [0, 1, 2, 3].map(input) } },
    ],
  } } };
}
async function packetFor(cap) {
  capIdentity(cap); const adminCapReference = reference(cap);
  return packetFrom(transactionFor(adminCapReference), simulationFor(adminCapReference),
    { action: 'rollover', adminCapReference, seasonId: EXPECTED.seasonId, durationMs: EXPECTED.durationMs });
}
export async function prepareRollover(state) {
  readyState(state); return packetFor(state.adminCap);
}
export async function validateWalletTransaction(transaction, packet) {
  requireThat(packet?.action === 'rollover' && packet.adminCapReference?.objectId === EXPECTED.adminCapId,
    'The reviewed rollover packet is missing.');
  reference({ address: packet.adminCapReference.objectId, version: packet.adminCapReference.version, digest: packet.adminCapReference.digest });
  same(packet.durationMs, EXPECTED.durationMs, 'The third test season must last exactly 48 hours.');
  same(packet.seasonId, EXPECTED.seasonId, 'This page supports only Season 3.');
  return assertWalletPacket(transaction, packet, transactionFor(packet.adminCapReference));
}
const event = (name, json) => ({ sender: { address: EXPECTED.sender },
  contents: { type: { repr: `${EXPECTED.packageId}::settlement::${name}` }, json } });

async function validateEffects(effects, packet, current, options = {}, actual = null) {
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The rollover did not succeed.', 'TRANSACTION_FAILED');
  same(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false);
  else same(effects.checkpoint, null, 'A simulation is not a confirmed rollover.');
  const resolved = await resolvedTransaction(effects, packet, actual);
  const unchanged = complete(effects.unchangedConsensusObjects, 'unchanged consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead',
    'Only the read-only Clock consensus input is expected.');
  const executionClock = unchanged[0].object, started = verifyClock(executionClock, options, Boolean(actual));
  requireThat(started >= uint(EXPECTED.previousCutoffMs) + uint(EXPECTED.reviewWindowMs),
    'The rollover executed before the ordinary review window ended.');
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= started, 'The receipt checkpoint predates execution.');
  const r = paidPreviousRegistry(current.registry); capIdentity(current.adminCap);
  same(packet.adminCapReference, reference(current.adminCap), 'The rollover used a different capability input.');
  const changes = objectChanges(effects), version = String(uint(effects.lamportVersion));
  const inputVersions = [current.registry.version, current.adminCap.version, executionClock.version,
    ...resolved.payments.map(x => x.version)].map(uint);
  requireThat(uint(version) === inputVersions.reduce((a, b) => a > b ? a : b, 0n) + 1n,
    'Output Lamport version differs from the actual rollover inputs.');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId);
  const capChange = changes.find(x => x.address === EXPECTED.adminCapId);
  inputOutput(registryChange, current.registry, version); inputOutput(capChange, current.adminCap, version);
  same(contents(capChange.outputState), contents(current.adminCap), 'The administrator capability contents changed.');
  const storedStart = started - (uint(EXPECTED.maximumDurationMs) - uint(EXPECTED.durationMs));
  const cutoff = started + uint(EXPECTED.durationMs);
  const expectedRegistry = { ...r, current_season_id: EXPECTED.seasonId, season_start_ms: String(storedStart),
    total_seeds: '0', total_growth_points: '0', eligible_growth_points: '0', settlement: null };
  same(contents(registryChange.outputState), expectedRegistry, 'Unexpected Registry changes during the Season 3 rollover.');
  const created = changes.filter(x => x.idCreated);
  requireThat(created.length === 1 && typeOf(created[0].outputState) === ARCHIVE_TYPE && !created[0].idDeleted,
    'The rollover must create exactly one Season 2 archive.');
  const archiveChange = created[0], archive = archiveChange.outputState, archiveId = archive.address;
  same(reference(archive).version, version, 'Wrong archive output version.');
  same(archive.owner, { __typename: 'Shared', initialSharedVersion: Number(version) }, 'The season archive must be shared.');
  const expectedArchive = {
    id: archiveId, version: '1', registry_id: EXPECTED.registryId, settlement: PREVIOUS_SETTLEMENT,
    admin: EXPECTED.sender, season_id: EXPECTED.previousSeasonId, season_start_ms: EXPECTED.previousStoredStartMs,
    season_end_ms: EXPECTED.previousCutoffMs, finalized_at_ms: String(started),
    claim_deadline_ms: EXPECTED.previousClaimDeadlineMs, total_growth_points: '10', total_seeds: '1',
    reward_pool: '0', swept: false,
  };
  same(contents(archive), expectedArchive, 'The archive does not preserve the exact paid Season 2 settlement.');
  same(complete(effects.events, 'rollover events'), [
    event('SeasonArchived', { archive_id: archiveId, season_id: EXPECTED.previousSeasonId, finalized_at_ms: String(started),
      claim_deadline_ms: EXPECTED.previousClaimDeadlineMs, reward_pool_mist: '0', total_growth_points: '10', total_seeds: '1' }),
    event('SeasonReset', { season_id: EXPECTED.previousSeasonId }),
    event('SeasonStarted', { season_id: EXPECTED.seasonId, start_ms: String(started) }),
  ], 'Unexpected season archive, reset, or start events.');
  const fees = gasAndBalances(effects, resolved, changes,
    new Set([EXPECTED.registryId, EXPECTED.adminCapId, archiveId]), version);
  return { action: 'rollover', status: actual ? 'confirmed' : 'simulated',
    checkpoint: actual ? effects.checkpoint : current.checkpoint,
    packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, adminCapId: EXPECTED.adminCapId,
    seasonId: EXPECTED.seasonId, inventoryVersion: '1', durationMs: EXPECTED.durationMs, proposedDurationMs: EXPECTED.durationMs,
    actualStartMs: String(started), storedStartMs: String(storedStart), cutoffMs: String(cutoff),
    claimDeadlineMs: String(cutoff + uint(EXPECTED.claimWindowMs)),
    normalResetReadyMs: String(cutoff + uint(EXPECTED.reviewWindowMs)),
    previousClaimDigest: EXPECTED.previousClaimDigest, archiveId, archiveSeasonId: EXPECTED.previousSeasonId,
    previousRewardPaidMist: '7000000', previousGrowthPoints: '10', archivedUnclaimedMist: '0',
    predictedRewardPoolMist: '0', predictedTreasuryMist: '0', predictedPlantedSeeds: '0', predictedGrowthPoints: '0',
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256,
    registryOutput: structuredClone(registryChange.outputState), archiveOutput: structuredClone(archive),
    appChargeMist: '0', priceMist: '0', ...fees };
}
export async function validateRolloverSimulation(response, packet, previous, proofResponse, options = {}) {
  const data = dataOf(response);
  requireThat(data.simulateTransaction && !data.transaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...live } = data;
  const current = readyState(await inspectState({ data: live }, proofResponse, options)); readyState(previous);
  sameSnapshot(current, previous); await validateWalletTransaction(packet.transaction, packet);
  same(packet.adminCapReference, reference(current.adminCap), 'The capability reference changed before simulation.');
  same(packet.simulationTransaction, simulationFor(packet.adminCapReference), 'The simulation differs from the exact reviewed two-call rollover.');
  const result = await validateEffects(simulateTransaction.effects, packet, current, options);
  requireThat(!result.gasAboveReviewCeiling, 'The network fee exceeds the 0.05 SUI review ceiling.', 'GAS_INCREASED');
  return result;
}
function receiptAdvance(live, output, expectedDigest, label) {
  requireThat(uint(live.version) >= uint(output.version), `Current ${label} predates the confirmed rollover.`, 'CONFIRMATION_PENDING');
  same(live.owner, output.owner, `Current ${label} ownership changed.`); same(typeOf(live), typeOf(output), `Current ${label} type changed.`);
  if (uint(live.version) === uint(output.version)) {
    same(reference(live), reference(output), `Current ${label} contradicts the confirmed rollover output.`);
    same(contents(live), contents(output), `Current ${label} contents contradict its receipt.`);
    if (live.previousTransaction) same(live.previousTransaction.digest, expectedDigest, `Current ${label} names a different transaction.`);
    return false;
  }
  return true;
}
async function confirmedFailure(actual, current) {
  const effects = actual.effects;
  requireThat(typeof effects.executionError?.message === 'string' && effects.executionError.message.length > 0, 'The failed receipt lacks its execution error.');
  readyState(current);
  const decoded = Transaction.from(actual.transactionBcs).getData();
  const owned = decoded.inputs.filter(x => x.Object?.ImmOrOwnedObject).map(x => x.Object.ImmOrOwnedObject);
  requireThat(owned.length === 1 && owned[0].objectId === EXPECTED.adminCapId, 'The failed rollover input differs.');
  const adminCapReference = { ...owned[0], version: String(owned[0].version) };
  const packet = await packetFrom(transactionFor(adminCapReference), simulationFor(adminCapReference),
    { action: 'rollover', adminCapReference, seasonId: EXPECTED.seasonId, durationMs: EXPECTED.durationMs });
  const resolved = await resolvedTransaction(effects, packet, actual), changes = objectChanges(effects);
  same(complete(effects.events, 'failed rollover events'), [], 'A failed rollover cannot emit successful season events.');
  requireThat(changes.every(x => !x.idCreated), 'A failed rollover cannot create an archive or another object.');
  const allowed = new Set(), version = String(uint(effects.lamportVersion));
  for (const [id, currentObject, validate] of [
    [EXPECTED.registryId, current.registry, paidPreviousRegistry],
    [EXPECTED.adminCapId, current.adminCap, capIdentity],
  ]) {
    const change = changes.find(x => x.address === id);
    if (!change) continue;
    requireThat(change.inputState && change.outputState && !change.idDeleted, 'A failed rollover lost a protocol input.');
    validate(change.inputState); validate(change.outputState);
    same(contents(change.inputState), contents(change.outputState), 'A failed rollover changed protocol state.');
    inputOutput(change, change.inputState, version);
    if (id === EXPECTED.adminCapId) same(reference(change.inputState), adminCapReference, 'The failed capability input differs from its bytes.');
    receiptAdvance(currentObject, change.outputState, actual.digest, 'failed rollover input');
    allowed.add(id);
  }
  requireThat(uint(current.adminCap.version) >= uint(adminCapReference.version), 'Current capability predates the failed rollover.');
  if (uint(current.adminCap.version) === uint(adminCapReference.version)) same(reference(current.adminCap), adminCapReference, 'Current capability differs from the failed input.');
  const fees = gasAndBalances(effects, resolved, changes, allowed, version);
  return { action: 'rollover', status: 'failed', digest: actual.digest, kindSha256: packet.kindSha256,
    exactKindSha256: packet.kindSha256, checkpoint: effects.checkpoint, permitsRetry: true,
    currentStatus: current.status, message: effects.executionError.message, ...fees };
}
export async function validateConfirmedRollover(response, expectedDigest, proofResponse, options = {}) {
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true,
  'A simulation cannot establish a confirmed third season.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint, 'The rollover receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  same(digest(expectedDigest), actual.digest, 'The receipt digest differs.');
  const resolved = Transaction.from(actual.transactionBcs);
  same(await resolved.getDigest(), expectedDigest, 'Transaction bytes do not match the requested digest.');
  checkpoint(actual.effects.checkpoint, {}, false);
  const { transaction: _transaction, ...live } = data;
  const current = await inspectState({ data: live }, proofResponse, options);
  requireThat(current.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber &&
    Date.parse(current.checkpoint.timestamp) >= Date.parse(actual.effects.checkpoint.timestamp),
  'Current observation predates the rollover receipt.', 'CONFIRMATION_PENDING');
  if (actual.effects.status === 'FAILURE') {
    let failure;
    try { failure = await confirmedFailure(actual, current); }
    catch (cause) { throw new CycleReviewError('TRANSACTION_FAILED', `The indexed rollover failed; retry remains locked because ${cause.message}`); }
    const error = new CycleReviewError('TRANSACTION_FAILED', failure.message); error.confirmedFailure = failure; throw error;
  }
  requireThat(actual.effects.status === 'SUCCESS', 'The receipt does not prove a successful rollover.', 'TRANSACTION_FAILED');
  const changes = objectChanges(actual.effects);
  const registryChange = changes.find(x => x.address === EXPECTED.registryId), capChange = changes.find(x => x.address === EXPECTED.adminCapId);
  requireThat(registryChange?.inputState && capChange?.inputState, 'The rollover receipt lacks its Registry or capability input.');
  paidPreviousRegistry(registryChange.inputState); capIdentity(capChange.inputState);
  same(contents(registryChange.inputState), contents(current.previousRegistryOutput), 'The rollover input differs from the verified completed Season 2 claim.');
  requireThat(uint(registryChange.inputState.version) >= uint(current.previousRegistryOutput.version), 'Rollover predates the verified Season 2 payout.');
  if (uint(registryChange.inputState.version) === uint(current.previousRegistryOutput.version))
    same(reference(registryChange.inputState), reference(current.previousRegistryOutput), 'The paid Registry input reference differs.');
  const packet = await packetFor(capChange.inputState);
  const checked = await validateEffects(actual.effects, packet,
    { ...current, registry: registryChange.inputState, adminCap: capChange.inputState }, options, actual);
  const hasAdvanced = [
    receiptAdvance(current.registry, registryChange.outputState, expectedDigest, 'Registry'),
    receiptAdvance(current.adminCap, capChange.outputState, expectedDigest, 'administrator capability'),
  ].some(Boolean);
  same(contents(current.adminCap), contents(capChange.outputState), 'Current capability binding changed after the rollover.');
  const r = contents(current.registry);
  requireThat(uint(r.current_season_id) >= uint(EXPECTED.seasonId), 'Current season counter contradicts the rollover.');
  if (r.current_season_id === EXPECTED.seasonId) requireThat(r.season_start_ms === checked.storedStartMs || r.season_start_ms === '0',
    'The current Season 3 schedule contradicts its receipt.');
  const receipt = deepFreeze(structuredClone({ ...checked, digest: expectedDigest, hasAdvanced,
    currentState: current.currentState, gasAboveReviewCeiling: BigInt(checked.gasEstimateMist) > uint(EXPECTED.maxGasMist) }));
  confirmedContexts.add(receipt); return receipt;
}
