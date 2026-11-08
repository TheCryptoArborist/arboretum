// Shared, pure validation for the isolated second-season owner review.
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
import { CONFIRM_QUERY as CLAIM_CONFIRM_QUERY, validateConfirmedClaim } from '../settlement-claim/claim-core.mjs';

const {
  kindBytes: _oldKindBytes, kindSha256: _oldKindSha256, actualStartMs: _oldStart,
  storedStartMs: _oldStored, cutoffMs: _oldCutoff, claimDeadlineMs: _oldDeadline,
  startDigest: _oldStartDigest, ...fixed
} = PLANT_EXPECTED;
export const EXPECTED = Object.freeze({
  ...fixed,
  seasonId: '2', durationMs: '172800000', inventoryVersion: '1', maxGasMist: '50000000',
  previousSeasonId: '1', previousStoredStartMs: '1790978248277',
  previousCutoffMs: '1793570248277', previousClaimDeadlineMs: '1794175048277',
  previousClaimDigest: '8PitEh5UEu5WeFKbZ2kZcr1QRixFZeq1NBXX7mxkSm9R',
  previousSeedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d',
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
  requireThat(origin === EXPECTED.origin, 'Review Season 2 only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
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

// One immutable prior claim is checked with the existing claim verifier. Its
// exact historical output is passed as the verifier's post-claim observation;
// current authority and current objects are checked separately below. This
// remains valid after the live Registry has legitimately rolled into Season 2.
const proofDefinition = parse(SETUP_PROOF_QUERY).definitions[0];
const priorClaimField = structuredClone(parse(CLAIM_CONFIRM_QUERY).definitions[0].selectionSet.selections.find(x => x.name.value === 'transaction'));
priorClaimField.alias = { kind: 'Name', value: 'priorClaimTransaction' };
priorClaimField.arguments[0].value = { kind: 'StringValue', value: EXPECTED.previousClaimDigest, block: false };
proofDefinition.name.value = 'SecondSeasonProof';
proofDefinition.selectionSet.selections.push(priorClaimField);
export const PROOF_QUERY = stripIgnoredCharacters(print(proofDefinition));

// The isolated second cycle reuses the known, previously planted NFT. Asking
// for its exact current object avoids enumerating this owner's 1,077 NFTs on
// every freshness check. Type and owner are independently verified below.
function scopedQuery(query) {
  const definition = structuredClone(parse(query).definitions[0]);
  definition.name.value = definition.name.value.replace('OwnerPlant', 'OwnerCycle');
  const field = definition.selectionSet.selections.find(x => x.alias?.value === 'ownedNFTs');
  const selectionSet = field.selectionSet.selections.find(x => x.name.value === 'nodes').selectionSet;
  field.alias.value = 'cycleNft'; field.name.value = 'object';
  field.arguments = [{ kind: 'Argument', name: { kind: 'Name', value: 'address' },
    value: { kind: 'StringValue', value: EXPECTED.previousNftId, block: false } }];
  field.selectionSet = selectionSet;
  return stripIgnoredCharacters(print(definition));
}
export const INPUTS_QUERY = scopedQuery(ALL_INPUTS_QUERY);
export const SIMULATION_QUERY = scopedQuery(ALL_SIMULATION_QUERY);
export const CONFIRM_QUERY = scopedQuery(ALL_CONFIRM_QUERY);
// Kept for the controller's shared read API. This single-NFT scope never pages.
export const NFT_PAGE_QUERY = INPUTS_QUERY;
export function nextNFTPageVariables(response) {
  const inventory = complete(dataOf(response).ownedNFTs, 'scoped NFTree review');
  requireThat(inventory.length <= 1 && inventory.every(x => x.address === EXPECTED.previousNftId),
    'Only the previously planted NFTree is supported in this isolated second cycle.');
  return null;
}
export function appendNFTPage() {
  throw new CycleReviewError('REVIEW_MISMATCH', 'The exact second-cycle NFT review does not paginate.');
}

async function previousClaimProof(proof, live, options) {
  const transaction = proof.priorClaimTransaction;
  requireThat(transaction?.digest === EXPECTED.previousClaimDigest, 'The confirmed Season 1 claim proof is missing.');
  const changes = complete(transaction.effects?.objectChanges, 'prior claim changes');
  const registryOutput = changes.find(x => x.address === EXPECTED.registryId)?.outputState;
  const seedOutput = changes.find(x => x.address === EXPECTED.previousSeedId)?.outputState;
  requireThat(registryOutput && seedOutput, 'The prior claim output objects are missing.');
  const withReceipt = object => ({ ...structuredClone(object), previousTransaction: { digest: EXPECTED.previousClaimDigest } });
  const receipt = await validateConfirmedClaim({ data: {
    genesis: live.genesis, checkpoint: live.checkpoint, clock: live.clock,
    registry: withReceipt(registryOutput), seed: withReceipt(seedOutput), transaction,
  } }, EXPECTED.previousClaimDigest, { ...options, now: nowOf(options) });
  requireThat(receipt.status === 'confirmed' && receipt.rewardMist === '7000000' && receipt.eligibleGrowthPoints === '10' && receipt.rewardProcessed,
    'Season 1 does not have its expected completed 10-GP reward claim.');
  return { receipt, registryOutput, seedOutput };
}
export async function inspectState(response, proofResponse, options = {}) {
  const live = dataOf(response), proof = dataOf(proofResponse);
  requireThat(!live.transaction && !live.simulateTransaction && !live.startTransaction,
    'Live state and transaction proof must remain separate.');
  const { priorClaimTransaction: _claim, ...setup } = proof;
  const base = await inspectStartState({ data: live }, { data: setup }, { ...options, now: nowOf(options) });
  const previous = await previousClaimProof(proof, live, options);
  const r = registryIdentity(base.registry);
  requireThat(uint(base.registry.version) >= uint(previous.registryOutput.version), 'Current Registry predates the confirmed Season 1 payout.');
  const nfts = complete(live.ownedNFTs, 'owned NFTree inventory').map(nftIdentity);
  requireThat(nfts.length <= 1 && nfts.every(x => x.address === EXPECTED.previousNftId),
    'Only the previously planted NFTree is supported in this isolated second cycle.');
  const ownedSeeds = complete(live.ownedSeeds, 'owned Seed inventory').map(seedIdentity);
  for (const [items, label] of [[nfts, 'NFTree'], [ownedSeeds, 'Seed']])
    requireThat(new Set(items.map(x => x.address)).size === items.length, `Duplicate ${label} inventory.`);
  const oldSeed = ownedSeeds.find(x => x.address === EXPECTED.previousSeedId);
  requireThat(oldSeed, 'The processed Season 1 Seed is missing from this owner.');
  requireThat(uint(oldSeed.version) >= uint(previous.seedOutput.version), 'Current Seed predates the Season 1 payout.');
  same(contents(oldSeed), contents(previous.seedOutput), 'The processed Season 1 Seed changed after its verified payout.');
  if (uint(oldSeed.version) === uint(previous.seedOutput.version)) same(reference(oldSeed), reference(previous.seedOutput));
  const seasonSeeds = ownedSeeds.filter(x => contents(x).season_id === EXPECTED.seasonId);
  let status = 'closed';
  if (r.current_season_id === EXPECTED.previousSeasonId) {
    same(contents(base.registry), contents(previous.registryOutput), 'Season 1 state differs from the completed reward claim.');
    if (uint(base.registry.version) === uint(previous.registryOutput.version)) same(reference(base.registry), reference(previous.registryOutput));
    requireThat(seasonSeeds.length === 0, 'A second-season Seed exists before the rollover.');
    status = 'rollover-ready';
  } else if (r.current_season_id === EXPECTED.seasonId && uint(r.season_start_ms) > 0n) status = 'season-two';
  const ownedNFTs = nfts.map(nft => ({ ...reference(nft), objectType: EXPECTED.nftType,
    name: typeof contents(nft).name === 'string' ? contents(nft).name : 'NFTree ' + nft.address.slice(0, 10) }));
  return { ...base, status, nfts, ownedNFTs, ownedSeeds, seasonSeeds, oldSeed,
    confirmedPreviousClaim: previous.receipt, previousRegistryOutput: previous.registryOutput,
    previousSeedOutput: previous.seedOutput,
    digestCandidate: base.registry.previousTransaction?.digest ?? null };
}
export function sameSnapshot(current, previous, keys = ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap', 'oldSeed']) {
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
