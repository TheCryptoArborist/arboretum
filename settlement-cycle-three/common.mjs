// Shared, pure validation for the isolated third-season owner review.
// No network, storage, wallet, signing, or transaction execution lives here.
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase58, fromHex, toHex, toBase64 } from '@mysten/bcs';
import { parse, print, stripIgnoredCharacters } from 'graphql';
import { sha256 } from '../settlement-admin/upgrade-core.mjs';
import {
  PROOF_QUERY as SETUP_PROOF_QUERY, PROOF_VARIABLES,
  inspectStartState,
} from '../settlement-season/start-core.mjs';
import {
  PLANT_EXPECTED,
  INPUTS_QUERY as ALL_INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY as ALL_SIMULATION_QUERY,
  CONFIRM_QUERY as ALL_CONFIRM_QUERY, CONFIRM_VARIABLES,
} from '../settlement-gameplay/plant-core.mjs';
import { CONFIRM_QUERY as CLAIM_CONFIRM_QUERY } from '../settlement-claim/claim-core.mjs';

const {
  kindBytes: _oldKindBytes, kindSha256: _oldKindSha256, actualStartMs: _oldStart,
  storedStartMs: _oldStored, cutoffMs: _oldCutoff, claimDeadlineMs: _oldDeadline,
  startDigest: _oldStartDigest, ...fixed
} = PLANT_EXPECTED;
export const EXPECTED = Object.freeze({
  ...fixed,
  seasonId: '3', durationMs: '172800000', inventoryVersion: '1', maxGasMist: '50000000',
  previousSeasonId: '2', previousStoredStartMs: '1791729927707',
  previousCutoffMs: '1794321927707', previousClaimDeadlineMs: '1794926727707',
  previousClaimDigest: 'EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB',
  previousSeedId: '0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2',
  olderSeedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d',
  previousPlantedAtMs: '1794151496120',
  previousNftId: '0x04a937cd60e0cbcfc315b15d2dd08187d3f180ebb925d588223303ea52afbcc7',
});
export {
  PROOF_VARIABLES, INPUT_VARIABLES, CONFIRM_VARIABLES, sha256,
};
export const SUI = '0x' + '0'.repeat(63) + '2';
export const SUI_TYPE = `${SUI}::sui::SUI`;
export const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
export const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`;
export const CAP_TYPE = `${EXPECTED.packageId}::settlement::AdminCap`;
export const SEED_TYPE = `${EXPECTED.packageId}::settlement::Seed`;
export const ARCHIVE_TYPE = `${EXPECTED.packageId}::settlement::SeasonArchive`;
export const TABLE_NAMES = Object.freeze(['seeds_by_owner', 'referrers', 'referral_earnings', 'player_growth', 'player_growth_season', 'planted_saplings']);

export class CycleReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'CycleReviewError'; this.code = code; }
}
export const requireThat = (value, message, code = 'REVIEW_MISMATCH') => {
  if (!value) throw new CycleReviewError(code, message);
};
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const same = (actual, expected, message = 'The reviewed values differ.') =>
  requireThat(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), message);
export const uint = value => {
  requireThat((typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) ||
    (Number.isSafeInteger(value) && value >= 0), 'Malformed unsigned integer.');
  const n = BigInt(value); requireThat(n <= 18446744073709551615n, 'Unsigned integer exceeds u64.'); return n;
};
export const amount = value => {
  requireThat(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value), 'Malformed balance amount.'); return BigInt(value);
};
export const address = value => {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Malformed object address.'); return value;
};
export const digest = value => {
  requireThat(typeof value === 'string' && fromBase58(value).length === 32, 'Malformed transaction or object digest.'); return value;
};
export const contents = object => object?.asMoveObject?.contents?.json;
export const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
export const normalizedType = value => String(value ?? '').replace(/\s+/g, '');
export function reference(object) {
  return { objectId: address(object?.address), version: String(uint(object?.version)), digest: digest(object?.digest) };
}
export const dataOf = response => {
  requireThat(!(response?.response && response?.data), 'Ambiguous wrapped and unwrapped response.');
  const raw = response?.response ?? response;
  requireThat(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response.');
  if (Object.hasOwn(raw.data, 'cycleNft')) {
    requireThat(!Object.hasOwn(raw.data, 'ownedNFTs'), 'Ambiguous scoped and unscoped NFT inventory.');
    const { cycleNft, ...rest } = raw.data;
    return { ...rest, ownedNFTs: { nodes: cycleNft ? [cycleNft] : [],
      pageInfo: { hasNextPage: false, endCursor: null } } };
  }
  return raw.data;
};
export const complete = (connection, label) => {
  requireThat(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false, `Incomplete ${label}.`);
  return connection.nodes;
};
export const nowOf = options => options.nowMs ?? options.now ?? Date.now();
export function checkpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0 && Number.isFinite(Date.parse(value.timestamp)),
    'A confirmed blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  if (fresh) {
    const now = nowOf(options), time = Date.parse(value.timestamp);
    requireThat(Number.isSafeInteger(now) && time <= now + 30000 && now - time <= EXPECTED.maxAgeMs,
      'The chain review is stale. Refresh before continuing.', 'STALE_REVIEW');
  }
  return value;
}
export function verifyClock(object, options = {}, historical = false) {
  reference(object); same(object.address, EXPECTED.clockId, 'Wrong Clock object.');
  same(typeOf(object), `${SUI}::clock::Clock`, 'Wrong Clock type.');
  same(object.owner, { __typename: 'Shared', initialSharedVersion: 1 }, 'Wrong Clock ownership.');
  const value = contents(object); same(Object.keys(value ?? {}).sort(), ['id', 'timestamp_ms'], 'Wrong Clock fields.');
  same(value.id, EXPECTED.clockId); const time = uint(value.timestamp_ms); requireThat(time > 0n, 'Invalid Clock timestamp.');
  if (!historical) {
    const now = BigInt(nowOf(options));
    requireThat(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'The execution Clock is stale.', 'STALE_REVIEW');
  }
  return time;
}
export const owner = (object, expected = EXPECTED.sender) => same(object?.owner,
  { __typename: 'AddressOwner', address: { address: expected } }, 'The object owner differs from the reviewed recipient.');
export function formatSui(value) {
  value = BigInt(value); const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 1000000000n}.${String(abs % 1000000000n).padStart(9, '0')}`;
}
export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin, 'Review Season 3 only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet.', 'WRONG_NETWORK');
  requireThat(account === EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}
export function registryIdentity(object) {
  reference(object); same(object.address, EXPECTED.registryId, 'Wrong Registry object.');
  same(typeOf(object), REGISTRY_TYPE, 'Wrong Registry type.');
  same(object.owner, { __typename: 'Shared', initialSharedVersion: Number(EXPECTED.registryInitialSharedVersion) }, 'Wrong Registry shared identity.');
  const r = contents(object);
  requireThat(r?.id === EXPECTED.registryId && r.version === '1' && r.admin === EXPECTED.sender, 'Wrong Registry version or administrator.');
  for (const key of ['current_season_id', 'season_start_ms', 'reward_pool', 'treasury', 'total_seeds', 'total_growth_points', 'eligible_growth_points']) uint(r[key]);
  requireThat(typeof r.paused === 'boolean', 'Missing Registry pause state.');
  for (const key of TABLE_NAMES) { address(r[key]?.id); uint(r[key]?.size); }
  return r;
}
export function nftIdentity(object) {
  reference(object); owner(object); same(typeOf(object), EXPECTED.nftType, 'Select an NFT from the exact NFTree collection.');
  requireThat(contents(object)?.id === object.address, 'Incomplete NFTree contents.'); return object;
}
export function seedIdentity(object) {
  reference(object); owner(object); same(typeOf(object), SEED_TYPE, 'Unexpected Seed type.');
  const s = contents(object);
  requireThat(s?.id === object.address && s.version === '1' && s.registry_id === EXPECTED.registryId && s.owner === EXPECTED.sender,
    'The Seed has a different Registry, version, or owner.');
  for (const key of ['season_id', 'planted_at_ms', 'last_watered_ms', 'growth_points', 'cutoff_growth_points', 'watering_streak', 'bottomless_can_expiry_ms', 'permanent_gp_bonus']) uint(s[key]);
  address(s.sapling_id); requireThat(typeof s.reward_processed === 'boolean', 'Missing Seed reward status.'); return object;
}

// The proof binds the existing setup/upgrade and the exact immutable Season 2
// claim. Current authority and live objects are checked independently below.
const proofDefinition = parse(SETUP_PROOF_QUERY).definitions[0];
const priorClaimField = structuredClone(parse(CLAIM_CONFIRM_QUERY).definitions[0].selectionSet.selections.find(x => x.name.value === 'transaction'));
priorClaimField.alias = { kind: 'Name', value: 'priorClaimTransaction' };
priorClaimField.arguments[0].value = { kind: 'StringValue', value: EXPECTED.previousClaimDigest, block: false };
proofDefinition.name.value = 'ThirdSeasonProof';
proofDefinition.selectionSet.selections.push(priorClaimField);
export const PROOF_QUERY = stripIgnoredCharacters(print(proofDefinition));

// The isolated third cycle reuses the known, previously planted NFT. Asking
// for its exact current object avoids enumerating this owner's 1,077 NFTs on
// every freshness check. Type and owner are independently verified below.
function scopedQuery(query, includeRuntimeEffects = false) {
  const definition = structuredClone(parse(query).definitions[0]);
  definition.name.value = definition.name.value.replace('OwnerPlant', 'OwnerCycle');
  const field = definition.selectionSet.selections.find(x => x.alias?.value === 'ownedNFTs');
  const selectionSet = field.selectionSet.selections.find(x => x.name.value === 'nodes').selectionSet;
  field.alias.value = 'cycleNft'; field.name.value = 'object';
  field.arguments = [{ kind: 'Argument', name: { kind: 'Name', value: 'address' },
    value: { kind: 'StringValue', value: EXPECTED.previousNftId, block: false } }];
  field.selectionSet = selectionSet;
  if (includeRuntimeEffects) {
    const execution = definition.selectionSet.selections.find(x =>
      ['simulateTransaction', 'transaction'].includes(x.name.value));
    const effects = execution?.selectionSet.selections.find(x => x.name.value === 'effects');
    requireThat(effects, 'The care query must contain transaction effects.');
    effects.selectionSet.selections.push({ kind: 'Field', name: { kind: 'Name', value: 'effectsJson' } });
  }
  return stripIgnoredCharacters(print(definition));
}
export const INPUTS_QUERY = scopedQuery(ALL_INPUTS_QUERY);
export const SIMULATION_QUERY = scopedQuery(ALL_SIMULATION_QUERY, true);
export const CONFIRM_QUERY = scopedQuery(ALL_CONFIRM_QUERY, true);
// Kept for the controller's shared read API. This single-NFT scope never pages.
export const NFT_PAGE_QUERY = INPUTS_QUERY;
export function nextNFTPageVariables(response) {
  const inventory = complete(dataOf(response).ownedNFTs, 'scoped NFTree review');
  requireThat(inventory.length <= 1 && inventory.every(x => x.address === EXPECTED.previousNftId),
    'Only the previously planted NFTree is supported in this isolated third cycle.');
  return null;
}
export function appendNFTPage() {
  throw new CycleReviewError('REVIEW_MISMATCH', 'The exact third-cycle NFT review does not paginate.');
}

// Independently verify the immutable Season 2 payout. This uses historical
// input/output objects and the exact transaction bytes, so a later rollover or
// changed current Registry cannot impersonate the required paid predecessor.
async function previousClaimProof(proof, live, options) {
  const actual = proof.priorClaimTransaction, effects = actual?.effects;
  requireThat(actual?.transactionBcs && effects?.checkpoint, 'The confirmed Season 2 claim proof is missing.');
  same(digest(actual.digest), EXPECTED.previousClaimDigest, 'The prior claim digest differs.');
  const actualTransaction = Transaction.from(actual.transactionBcs);
  same(await actualTransaction.getDigest(), EXPECTED.previousClaimDigest, 'The prior claim bytes do not match its digest.');
  checkpoint(effects.checkpoint, {}, false);
  requireThat(live.checkpoint.sequenceNumber >= effects.checkpoint.sequenceNumber &&
    Date.parse(live.checkpoint.timestamp) >= Date.parse(effects.checkpoint.timestamp),
    'Current observation predates the Season 2 claim.');
  same(effects.status, 'SUCCESS', 'The prior claim did not succeed.'); same(effects.executionError, null);
  const changes = objectChanges(effects);
  const registryChange = changes.find(x => x.address === EXPECTED.registryId);
  const seedChange = changes.find(x => x.address === EXPECTED.previousSeedId);
  requireThat(registryChange?.inputState && seedChange?.inputState, 'The prior claim lacks its Registry or Seed input.');
  const inputRegistry = registryChange.inputState, inputSeed = seedChange.inputState;
  const r = registryIdentity(inputRegistry); seedIdentity(inputSeed);
  const s = contents(inputSeed);
  same(s, { id: EXPECTED.previousSeedId, version: '1', registry_id: EXPECTED.registryId,
    cutoff_growth_points: '10', reward_processed: false, sapling_id: EXPECTED.previousNftId,
    season_id: EXPECTED.previousSeasonId, owner: EXPECTED.sender, planted_at_ms: EXPECTED.previousPlantedAtMs,
    last_watered_ms: EXPECTED.previousPlantedAtMs, watering_streak: '1', growth_points: '10',
    state: 0, fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0,
    bottomless_can_expiry_ms: '0', permanent_gp_bonus: '0' }, 'The Season 2 claim input differs from its original 10-GP Seed.');
  const liveRegistry = registryIdentity(complete(live.registries, 'current Registry inventory')[0]);
  const tables = Object.fromEntries(TABLE_NAMES.map(name => [name,
    { id: liveRegistry[name].id, size: ['referrers', 'referral_earnings'].includes(name) ? '0' : '1' }]));
  same(r, { id: EXPECTED.registryId, version: '1', admin: EXPECTED.sender,
    current_season_id: EXPECTED.previousSeasonId, season_start_ms: EXPECTED.previousStoredStartMs,
    reward_pool: '7000000', treasury: '0', total_seeds: '1', total_growth_points: '10', eligible_growth_points: '10',
    settlement: null, paused: false, ...tables }, 'The Season 2 claim input Registry differs from its one-Seed reward.');
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::claim_reward`, typeArguments: [], arguments: [
    tx.sharedObjectRef({ objectId: EXPECTED.registryId, initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    tx.objectRef(reference(inputSeed)),
    tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
  ] });
  const packet = await packetFrom(tx, null);
  const resolved = await resolvedTransaction(effects, packet, actual, { excludeIds: [EXPECTED.previousSeedId] });
  const unchanged = complete(effects.unchangedConsensusObjects, 'prior claim consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead',
    'Only the read-only Clock is expected in the Season 2 claim.');
  const executionClock = unchanged[0].object, claimedAt = verifyClock(executionClock, {}, true);
  requireThat(claimedAt >= uint(EXPECTED.previousCutoffMs) && claimedAt <= uint(EXPECTED.previousClaimDeadlineMs),
    'The Season 2 claim executed outside its original window.');
  requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= claimedAt, 'The prior claim checkpoint predates execution.');
  const version = String(uint(effects.lamportVersion));
  const inputVersions = [inputRegistry.version, inputSeed.version, executionClock.version,
    ...resolved.payments.map(x => x.version), ...changes.filter(x => x.inputState).map(x => x.inputState.version)].map(uint);
  requireThat(uint(version) === inputVersions.reduce((maximum, value) => value > maximum ? value : maximum, 0n) + 1n,
    'The prior claim output version differs from its exact inputs.');
  inputOutput(registryChange, inputRegistry, version); inputOutput(seedChange, inputSeed, version);
  const settlement = { season_id: EXPECTED.previousSeasonId, season_end_ms: EXPECTED.previousCutoffMs,
    claim_deadline_ms: EXPECTED.previousClaimDeadlineMs, pool_mist: '7000000', eligible_growth_points: '10',
    paid_mist: '7000000', processed_growth_points: '10', processed_seeds: '1' };
  same(contents(registryChange.outputState), { ...r, reward_pool: '0', settlement },
    'The prior claim did not pay the complete Season 2 reward.');
  same(contents(seedChange.outputState), { ...s, reward_processed: true, growth_points: '0', cutoff_growth_points: '0' },
    'The prior claim did not process the exact Season 2 Seed.');
  const created = changes.filter(x => x.idCreated);
  requireThat(created.length === 1 && !created[0].idDeleted && created[0].outputState,
    'The prior claim must create exactly one reward coin.');
  const reward = created[0]; owner(reward.outputState); same(typeOf(reward.outputState), COIN_TYPE, 'The prior reward is not SUI.');
  same(reference(reward.outputState).version, version, 'Wrong prior reward coin version.');
  same(contents(reward.outputState), { id: reward.address, balance: '7000000' }, 'The prior reward coin amount differs.');
  const event = (name, json) => ({ sender: { address: EXPECTED.sender },
    contents: { type: { repr: `${EXPECTED.packageId}::settlement::${name}` }, json } });
  same(complete(effects.events, 'prior claim events'), [
    event('RewardSettlementFinalized', { registry_id: EXPECTED.registryId, season_id: EXPECTED.previousSeasonId,
      season_end_ms: EXPECTED.previousCutoffMs, claim_deadline_ms: EXPECTED.previousClaimDeadlineMs,
      pool_mist: '7000000', eligible_growth_points: '10' }),
    event('RewardEntitlementProcessed', { registry_id: EXPECTED.registryId, season_id: EXPECTED.previousSeasonId,
      seed_id: EXPECTED.previousSeedId, owner: EXPECTED.sender, eligible_growth_points: '10', amount_mist: '7000000' }),
    event('RewardClaimed', { owner: EXPECTED.sender, amount_mist: '7000000' }),
  ], 'The prior claim events differ from the Season 2 payout.');
  const fees = gasAndBalances(effects, resolved, changes,
    new Set([EXPECTED.registryId, EXPECTED.previousSeedId, reward.address]), version, { ownerDeltaBeforeGas: '7000000' });
  const receipt = deepFreeze({ status: 'confirmed', action: 'claim', digest: actual.digest,
    checkpoint: effects.checkpoint, seasonId: EXPECTED.previousSeasonId, seedId: EXPECTED.previousSeedId,
    rewardMist: '7000000', eligibleGrowthPoints: '10', rewardProcessed: true, claimedAtMs: String(claimedAt), ...fees });
  return { receipt, registryOutput: registryChange.outputState, seedOutput: seedChange.outputState };
}
export async function inspectState(response, proofResponse, options = {}) {
  const live = dataOf(response), proof = dataOf(proofResponse);
  requireThat(!live.transaction && !live.simulateTransaction && !live.startTransaction,
    'Live state and transaction proof must remain separate.');
  const { priorClaimTransaction: _claim, ...setup } = proof;
  const base = await inspectStartState({ data: live }, { data: setup }, { ...options, now: nowOf(options) });
  const previous = await previousClaimProof(proof, live, options);
  const r = registryIdentity(base.registry);
  requireThat(uint(base.registry.version) >= uint(previous.registryOutput.version), 'Current Registry predates the confirmed Season 2 payout.');
  const nfts = complete(live.ownedNFTs, 'owned NFTree inventory').map(nftIdentity);
  requireThat(nfts.length <= 1 && nfts.every(x => x.address === EXPECTED.previousNftId),
    'Only the previously planted NFTree is supported in this isolated third cycle.');
  const ownedSeeds = complete(live.ownedSeeds, 'owned Seed inventory').map(seedIdentity);
  for (const [items, label] of [[nfts, 'NFTree'], [ownedSeeds, 'Seed']])
    requireThat(new Set(items.map(x => x.address)).size === items.length, `Duplicate ${label} inventory.`);
  const oldSeed = ownedSeeds.find(x => x.address === EXPECTED.previousSeedId);
  requireThat(oldSeed, 'The processed Season 2 Seed is missing from this owner.');
  requireThat(uint(oldSeed.version) >= uint(previous.seedOutput.version), 'Current Seed predates the Season 2 payout.');
  same(contents(oldSeed), contents(previous.seedOutput), 'The processed Season 2 Seed changed after its verified payout.');
  if (uint(oldSeed.version) === uint(previous.seedOutput.version)) same(reference(oldSeed), reference(previous.seedOutput));
  const olderSeed = ownedSeeds.find(x => x.address === EXPECTED.olderSeedId);
  requireThat(olderSeed && contents(olderSeed).season_id === '1' && contents(olderSeed).sapling_id === EXPECTED.previousNftId &&
    contents(olderSeed).reward_processed && contents(olderSeed).growth_points === '0' && contents(olderSeed).cutoff_growth_points === '0',
    'The completed Season 1 Seed must remain in this owner inventory.');
  const seasonSeeds = ownedSeeds.filter(x => contents(x).season_id === EXPECTED.seasonId);
  let status = 'closed';
  if (r.current_season_id === EXPECTED.previousSeasonId) {
    same(contents(base.registry), contents(previous.registryOutput), 'Season 2 state differs from the completed reward claim.');
    if (uint(base.registry.version) === uint(previous.registryOutput.version)) same(reference(base.registry), reference(previous.registryOutput));
    requireThat(seasonSeeds.length === 0, 'A third-season Seed exists before the rollover.');
    status = uint(base.clockMs) < uint(EXPECTED.previousCutoffMs) + uint(EXPECTED.reviewWindowMs) ? 'rollover-wait' : 'rollover-ready';
  } else if (r.current_season_id === EXPECTED.seasonId && uint(r.season_start_ms) > 0n) status = 'season-three';
  const ownedNFTs = nfts.map(nft => ({ ...reference(nft), objectType: EXPECTED.nftType,
    name: typeof contents(nft).name === 'string' ? contents(nft).name : 'NFTree ' + nft.address.slice(0, 10) }));
  return { ...base, status, nfts, ownedNFTs, ownedSeeds, seasonSeeds, oldSeed, olderSeed,
    resetReadyMs: String(uint(EXPECTED.previousCutoffMs) + uint(EXPECTED.reviewWindowMs)),
    confirmedPreviousClaim: previous.receipt, previousRegistryOutput: previous.registryOutput,
    previousSeedOutput: previous.seedOutput,
    digestCandidate: base.registry.previousTransaction?.digest ?? null };
}
export function sameSnapshot(current, previous, keys = ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap', 'oldSeed', 'olderSeed']) {
  requireThat(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Observation checkpoint moved backwards.');
  for (const name of keys) {
    same(reference(current[name]), reference(previous[name]), `The ${name} input reference changed.`);
    same(contents(current[name]), contents(previous[name]), `The ${name} input contents changed.`);
    same(current[name].owner, previous[name].owner, `The ${name} owner changed.`);
    same(typeOf(current[name]), typeOf(previous[name]), `The ${name} type changed.`);
  }
}
export async function packetFrom(transaction, simulationTransaction, metadata = {}) {
  const bytes = await transaction.build({ onlyTransactionKind: true });
  return { ...metadata, transaction, simulationTransaction, kindBase64: toBase64(bytes), kindSha256: await sha256(bytes) };
}
export async function assertWalletPacket(transaction, packet, expectedTransaction) {
  requireThat(transaction instanceof Transaction && expectedTransaction instanceof Transaction, 'A reviewed Sui Transaction is required.');
  const data = transaction.getData(); assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(x => x === null), 'Final gas and expiration must be selected by the wallet.');
  const expected = await expectedTransaction.build({ onlyTransactionKind: true });
  same(toBase64(await transaction.build({ onlyTransactionKind: true })), toBase64(expected), 'The wallet transaction differs from the exact reviewed operation.');
  same(packet.kindBase64, toBase64(expected), 'The reviewed packet differs.');
  same(packet.kindSha256, await sha256(expected), 'The reviewed packet hash differs.'); return true;
}
export function validateExpiration(data, effects, actual) {
  const expiry = data.expiration, kind = expiry?.$kind, epoch = uint(effects.epoch?.epochId);
  if (kind === 'ValidDuring') {
    const v = expiry.ValidDuring, min = uint(v.minEpoch), max = uint(v.maxEpoch);
    requireThat(max === min + 1n && (actual ? min <= epoch && epoch <= max : min === epoch), 'Invalid mainnet expiration window.');
    same(v.chain, EXPECTED.genesisDigest, 'Wrong expiration chain.'); same(v.minTimestamp, null); same(v.maxTimestamp, null);
    requireThat(Number.isInteger(v.nonce) && v.nonce >= 0 && v.nonce <= 0xffffffff, 'Invalid transaction nonce.');
  } else if (actual && kind === 'Epoch') requireThat(uint(expiry.Epoch) >= epoch, 'The confirmed transaction expired before execution.');
  else requireThat(expiry === null || kind === 'None', 'Unexpected transaction expiration.');
}
function virtualGasReference(payment, index, data) {
  if (uint(payment.version) !== 0n) return false;
  requireThat(index === 0 && data.expiration?.$kind === 'ValidDuring', 'A virtual gas reservation must be first and mainnet-bound.');
  const bytes = fromBase58(payment.digest);
  requireThat(bytes.length === 32 && bytes.slice(12).every(x => x === 0xac), 'Invalid virtual gas reservation digest.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireThat(view.getBigUint64(0, true) > 0n && BigInt(view.getUint32(8, true)) === uint(data.expiration.ValidDuring.minEpoch), 'Invalid gas reservation amount or epoch.');
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const ownerId = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  same(payment.objectId, '0x' + toHex(ownerId.map((value, i) => value ^ chain[i])), 'Virtual gas reservation belongs to another owner or network.'); return true;
}
export async function resolvedTransaction(effects, packet, actual = null, { excludeIds = [] } = {}) {
  const bytes = actual?.transactionBcs ?? effects.transaction?.transactionBcs;
  requireThat(typeof bytes === 'string' && bytes.length > 0, 'Missing resolved transaction bytes.');
  const tx = Transaction.from(bytes), data = tx.getData();
  same(data.sender, EXPECTED.sender, 'Wrong transaction sender.'); same(data.gasData.owner, EXPECTED.sender, 'Wrong gas owner.');
  same(effects.transaction?.sender?.address, EXPECTED.sender, 'Wrong effects sender.');
  if (actual) {
    same(actual.sender?.address, EXPECTED.sender, 'Wrong receipt sender.');
    same(effects.transaction?.transactionBcs, bytes, 'Effects and receipt transaction bytes differ.');
  }
  same(toBase64(await tx.build({ onlyTransactionKind: true })), packet.kindBase64, 'Resolved transaction commands differ.');
  const budget = uint(data.gasData.budget); requireThat(budget > 0n && uint(data.gasData.price) > 0n, 'Invalid gas budget or price.');
  validateExpiration(data, effects, Boolean(actual));
  const payments = data.gasData.payment; requireThat(Array.isArray(payments), 'Missing gas-payment inventory.');
  if (!payments.length) requireThat(data.expiration?.$kind === 'ValidDuring', 'Address-balance gas requires mainnet-bound expiration.');
  requireThat(new Set(payments.map(x => address(x.objectId))).size === payments.length, 'Duplicate gas references.');
  requireThat(!payments.some(x => [EXPECTED.registryId, EXPECTED.adminCapId, EXPECTED.clockId, ...excludeIds].includes(x.objectId)), 'A protocol object cannot be a gas coin.');
  const reservations = payments.filter((x, index) => virtualGasReference(x, index, data));
  const ordinary = payments.filter(x => uint(x.version) > 0n);
  return { transaction: tx, data, budget, payments, reservations, ordinary };
}
export function objectChanges(effects) {
  const changes = complete(effects.objectChanges, 'transaction object changes');
  requireThat(new Set(changes.map(x => address(x.address))).size === changes.length, 'Duplicate transaction object changes.');
  for (const x of changes) {
    requireThat(typeof x.idCreated === 'boolean' && typeof x.idDeleted === 'boolean' && !(x.idCreated && x.idDeleted), 'Invalid object-change flags.');
    if (x.idCreated) same(x.inputState, null, 'A created object cannot have an input.');
    if (x.idDeleted) same(x.outputState, null, 'A deleted object cannot have an output.');
    for (const state of [x.inputState, x.outputState]) if (state) { reference(state); same(state.address, x.address, 'Object-change address differs.'); }
  }
  return changes;
}
export function inputOutput(change, input, outputVersion) {
  requireThat(change && !change.idCreated && !change.idDeleted && change.inputState && change.outputState,
    'A required input was created, deleted, or omitted.');
  same(reference(change.inputState), reference(input), 'A different object input was consumed.');
  same(contents(change.inputState), contents(input), 'An input object content changed.');
  same(change.inputState.owner, input.owner, 'An input owner differs.'); same(typeOf(change.inputState), typeOf(input), 'An input type differs.');
  same(typeOf(change.outputState), typeOf(input), 'An output type differs.'); same(change.outputState.owner, input.owner, 'An input object was transferred.');
  same(reference(change.outputState).version, String(outputVersion), 'Wrong output version.');
  requireThat(uint(outputVersion) > uint(input.version), 'Output version did not advance.');
}
export function gasAndBalances(effects, resolved, changes, allowed, version, {
  ownerDeltaBeforeGas = '0', otherBalances = {}, gasCoinDebitBeforeGas = '0',
} = {}) {
  const { ordinary, reservations, budget } = resolved;
  const paymentMap = new Map(ordinary.map(x => [x.objectId, x]));
  requireThat(ordinary.every(x => !allowed.has(x.objectId)), 'A protocol input or output cannot be selected as a gas coin.');
  requireThat(reservations.every(p => !changes.some(x => x.address === p.objectId)), 'A virtual gas reservation is not a real object change.');
  let before = 0n, after = 0n;
  for (const change of changes.filter(x => !allowed.has(x.address))) {
    const payment = paymentMap.get(change.address);
    requireThat(payment && !change.idCreated && change.inputState, 'Unexpected object, transfer, or payment outside the reviewed operation and gas.');
    same(reference(change.inputState), { ...payment, version: String(payment.version) }, 'A different gas input was consumed.');
    owner(change.inputState); same(typeOf(change.inputState), COIN_TYPE, 'Non-SUI gas input.');
    same(contents(change.inputState), { id: change.address, balance: String(uint(contents(change.inputState)?.balance)) }, 'Wrong gas input contents.');
    before += uint(contents(change.inputState).balance);
    if (!change.idDeleted) {
      reference(change.outputState); owner(change.outputState); same(typeOf(change.outputState), COIN_TYPE, 'Non-SUI gas output.');
      same(reference(change.outputState).version, String(version), 'Wrong gas output version.');
      same(contents(change.outputState), { id: change.address, balance: String(uint(contents(change.outputState)?.balance)) }, 'Wrong gas output contents.');
      after += uint(contents(change.outputState).balance);
    }
  }
  for (const payment of ordinary) requireThat(changes.some(x => x.address === payment.objectId), 'A selected gas input is missing from effects.');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate); uint(gas?.nonRefundableStorageFee);
  requireThat(net <= budget, 'Net gas exceeds its budget.');
  if (ordinary.length && !reservations.length) requireThat(before - after === net + BigInt(gasCoinDebitBeforeGas), 'Gas coin balances differ from the reported network fee and payment.');
  const balances = effects.balanceChangesJson;
  requireThat(Array.isArray(balances), 'Missing balance changes.');
  const expected = new Map([[EXPECTED.sender, BigInt(ownerDeltaBeforeGas) - net],
    ...Object.entries(otherBalances).map(([who, value]) => [address(who), BigInt(value)])]);
  for (const [who, value] of expected) if (value === 0n) expected.delete(who);
  requireThat(balances.length === expected.size, 'Unexpected balance-change inventory.');
  for (const item of balances) {
    requireThat(expected.has(address(item.address)), 'Unexpected balance recipient.');
    same(item.coinType, SUI_TYPE, 'Only the reviewed SUI payment and gas may move.');
    requireThat(amount(item.amount) === expected.get(item.address), 'The balance change differs from the exact payment and network gas.');
    expected.delete(item.address);
  }
  return { gasEstimateMist: String(net), gasEstimateSui: formatSui(net),
    netReceiveMist: String(BigInt(ownerDeltaBeforeGas) - net), netReceiveSui: formatSui(BigInt(ownerDeltaBeforeGas) - net),
    virtualGasReservations: reservations.length, gasAboveReviewCeiling: net > uint(EXPECTED.maxGasMist) };
}
export const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
