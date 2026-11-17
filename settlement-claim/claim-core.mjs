// Pure review of the direct season-one claim for the pinned v1 test Seed.
// No fetch, storage, wallet connection, signing or execution belongs here.
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase58, fromHex, toHex, toBase64 } from '@mysten/bcs';
import { stripIgnoredCharacters } from 'graphql';
import { sha256 } from '../settlement-admin/upgrade-core.mjs';
import { EXPECTED as WATER_EXPECTED } from '../settlement-watering/water-core.mjs';

export const EXPECTED = Object.freeze({
  ...WATER_EXPECTED, graceMs: '604800000', claimDeadlineMs: '1794175048277',
  expectedRewardPoolMist: '7000000', priceMist: '0', appChargeMist: '0',
});
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`, COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`, SEED_TYPE = `${EXPECTED.packageId}::settlement::Seed`;
const TABLES = Object.freeze({
  seeds_by_owner: ['0x3673f5b7888241d3702b07e8f39bd33931750582161a3cdbc3a30b3c4d36b89c', '1'],
  referrers: ['0x3204b2eb86f9c46ed7a462c910f2ff10ece7f8d957edcd2b2af821aa7320244b', '0'],
  referral_earnings: ['0x68c78c07080b15b8c074ba13bbaa0733309d029718521a79a3e3a8b50cf8d1a0', '0'],
  player_growth: ['0xbf70908372b68eb412fa74d4ea165ef39906f8606c71993bba3bc35b958cbfae', '1'],
  player_growth_season: ['0x46daf4a08dd974e14387cb9b8c0103ed450d131fca85fffc9fe48f3727178ff4', '1'],
  planted_saplings: ['0xe1b77d1747967b896adaafc51dd16427de03e651fa419f1563ba7fb7ad04c689', '1'],
});

export class ClaimReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'ClaimReviewError'; this.code = code; }
}
const requireThat = (value, message, code = 'REVIEW_MISMATCH') => {
  if (!value) throw new ClaimReviewError(code, message);
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (actual, expected, message = 'The reviewed values differ.') =>
  requireThat(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), message);
const uint = value => {
  requireThat((typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) ||
    (Number.isSafeInteger(value) && value >= 0), 'Malformed unsigned integer.');
  const n = BigInt(value); requireThat(n <= 18446744073709551615n, 'Unsigned integer exceeds u64.'); return n;
};
const amount = value => {
  requireThat(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value), 'Malformed balance amount.'); return BigInt(value);
};
const address = value => { requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Malformed object address.'); return value; };
const digest = value => { requireThat(typeof value === 'string' && fromBase58(value).length === 32, 'Malformed transaction or object digest.'); return value; };
export const contents = object => object?.asMoveObject?.contents?.json;
const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
export function reference(object) {
  return { objectId: address(object?.address), version: String(uint(object?.version)), digest: digest(object?.digest) };
}
const dataOf = response => {
  requireThat(!(response?.response && response?.data), 'Ambiguous wrapped and unwrapped response.');
  const raw = response?.response ?? response;
  requireThat(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response.'); return raw.data;
};
const complete = (connection, label) => {
  requireThat(Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false, `Incomplete ${label}.`);
  return connection.nodes;
};
const nowOf = options => options.nowMs ?? options.now ?? Date.now();
function checkpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0 && Number.isFinite(Date.parse(value.timestamp)),
    'A confirmed blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  if (fresh) {
    const now = nowOf(options), time = Date.parse(value.timestamp);
    requireThat(Number.isSafeInteger(now) && time <= now + 30000 && now - time <= EXPECTED.maxAgeMs,
      'The chain review is stale. Refresh before continuing.', 'STALE_REVIEW');
  }
  return value;
}
function verifyClock(object, options = {}, historical = false) {
  reference(object); same(object.address, EXPECTED.clockId, 'Wrong Clock object.');
  same(typeOf(object), `${SUI}::clock::Clock`, 'Wrong Clock type.');
  same(object.owner, { __typename: 'Shared', initialSharedVersion: 1 }, 'Wrong Clock ownership.');
  const fields = contents(object); same(Object.keys(fields ?? {}).sort(), ['id', 'timestamp_ms'], 'Wrong Clock fields.');
  same(fields.id, EXPECTED.clockId); const time = uint(fields.timestamp_ms);
  if (!historical) {
    requireThat(Number.isSafeInteger(nowOf(options)), 'Invalid review time.');
    const now = BigInt(nowOf(options));
    requireThat(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'The execution Clock is stale.', 'STALE_REVIEW');
  }
  return time;
}
const owner = object => same(object?.owner, { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
  'The Seed, reward or gas object owner differs from the reviewed account.');
function registryIdentity(object) {
  reference(object); same(object.address, EXPECTED.registryId, 'Wrong Registry object.');
  same(typeOf(object), REGISTRY_TYPE, 'Wrong Registry type.');
  same(object.owner, { __typename: 'Shared', initialSharedVersion: Number(EXPECTED.registryInitialSharedVersion) }, 'Wrong Registry shared identity.');
  const r = contents(object);
  requireThat(r?.id === EXPECTED.registryId && r.version === '1' && r.admin === EXPECTED.sender, 'Wrong Registry version or administrator.');
  for (const key of ['current_season_id', 'season_start_ms', 'reward_pool', 'treasury', 'total_seeds', 'total_growth_points', 'eligible_growth_points']) uint(r[key]);
  requireThat(typeof r.paused === 'boolean', 'Missing Registry pause state.');
  for (const [key, [id]] of Object.entries(TABLES)) { same(r[key]?.id, id, `Wrong ${key} table.`); uint(r[key].size); }
  return r;
}
function seedIdentity(object) {
  reference(object); same(object.address, EXPECTED.seedId, 'Wrong Seed object.'); owner(object);
  same(typeOf(object), SEED_TYPE, 'Wrong Seed type.'); const s = contents(object);
  requireThat(s?.id === EXPECTED.seedId && s.version === '1' && s.registry_id === EXPECTED.registryId &&
    s.owner === EXPECTED.sender && s.sapling_id === EXPECTED.nftId && s.planted_at_ms === EXPECTED.plantedAtMs && s.season_id === '1',
  'The Seed identity, planting time, Registry or owner differs.');
  for (const key of ['growth_points', 'cutoff_growth_points', 'last_watered_ms', 'watering_streak', 'bottomless_can_expiry_ms', 'permanent_gp_bonus']) uint(s[key]);
  requireThat(typeof s.reward_processed === 'boolean', 'Missing Seed reward status.');
  return s;
}
function originalPoints(s) {
  requireThat(s.state === 0 && s.fertilizer_charges === 0 && s.miracle_grow_applied === false &&
    s.revival_charges === 0 && s.bottomless_can_expiry_ms === '0' && s.permanent_gp_bonus === '0',
  'The test Seed has unexpected care or tool changes.', 'SEED_STATE_CHANGED');
  const last = uint(s.last_watered_ms);
  let points;
  if (s.last_watered_ms === EXPECTED.plantedAtMs && s.watering_streak === '1') points = 10n;
  else {
    requireThat(last >= uint(EXPECTED.waterReadyMs) && last < uint(EXPECTED.cutoffMs) && s.watering_streak === '2',
      'Only the original 10 GP Seed or its first normal 24 GP watering is supported.', 'SEED_STATE_CHANGED');
    points = 24n;
  }
  // The contract evaluates death at season_end_ms, never at the claim Clock.
  // A later wilt/death display must not remove an earned cutoff entitlement.
  requireThat(last <= uint(EXPECTED.cutoffMs) && (uint(EXPECTED.cutoffMs) - last) / 86400000n < 10n,
    'The Seed was not eligible at the fixed season cutoff.');
  const stored = s.reward_processed ? '0' : String(points);
  requireThat(s.growth_points === stored && s.cutoff_growth_points === stored,
    'The Seed Growth Points or processed marker are inconsistent.', 'SEED_STATE_CHANGED');
  return points;
}
function claimInputs(registry, seed, processed = false) {
  const r = registryIdentity(registry), s = seedIdentity(seed), points = originalPoints(s);
  requireThat(s.reward_processed === processed, processed ? 'The current Seed is not reward-processed.' : 'This Seed reward was already processed.',
    processed ? 'CONFIRMATION_MISMATCH' : 'ALREADY_CLAIMED');
  requireThat(r.current_season_id === '1' && r.season_start_ms === EXPECTED.storedStartMs, 'This page supports only the original active Registry season.', 'WRONG_SEASON');
  requireThat(r.total_seeds === '1' && r.total_growth_points === String(points) && r.eligible_growth_points === String(points),
    'The single-Seed season totals changed.', 'SEED_STATE_CHANGED');
  for (const [key, [, size]] of Object.entries(TABLES)) same(r[key].size, size, `The ${key} inventory changed.`);
  requireThat(r.settlement === null || (r.settlement && typeof r.settlement === 'object' && !Array.isArray(r.settlement)), 'Malformed settlement snapshot.');
  requireThat(!processed || r.settlement !== null, 'A processed reward requires a finalized settlement.');
  const frozen = r.settlement ?? { season_id: '1', season_end_ms: EXPECTED.cutoffMs, claim_deadline_ms: EXPECTED.claimDeadlineMs,
    pool_mist: r.reward_pool, eligible_growth_points: String(points), paid_mist: '0', processed_growth_points: '0', processed_seeds: '0' };
  for (const value of Object.values(frozen)) uint(value);
  const pool = uint(frozen.pool_mist), denominator = uint(frozen.eligible_growth_points);
  const reward = points === 0n || denominator === 0n ? 0n : points * pool / denominator;
  const expectedFrozen = { season_id: '1', season_end_ms: EXPECTED.cutoffMs, claim_deadline_ms: EXPECTED.claimDeadlineMs,
    pool_mist: String(pool), eligible_growth_points: String(points), paid_mist: processed ? String(reward) : '0',
    processed_growth_points: processed ? String(points) : '0', processed_seeds: processed ? '1' : '0' };
  same(frozen, expectedFrozen, 'The frozen pool, denominator, deadline or processing totals are inconsistent.');
  requireThat(uint(r.reward_pool) + uint(frozen.paid_mist) === pool, 'The remaining reward pool does not balance with paid rewards.');
  return { r, s, points, pool, reward, frozen: expectedFrozen, finalized: r.settlement !== null };
}
function snapshot(data, options = {}) {
  same(data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest }, 'The endpoint is not Sui mainnet.');
  checkpoint(data.checkpoint, options); const clockMs = verifyClock(data.clock, options);
  requireThat(BigInt(Date.parse(data.checkpoint.timestamp)) >= clockMs, 'Checkpoint predates the read Clock.');
  registryIdentity(data.registry); seedIdentity(data.seed);
  return { checkpoint: data.checkpoint, clockMs: String(clockMs), registry: data.registry, seed: data.seed };
}
export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin, 'Review this reward claim only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet.', 'WRONG_NETWORK');
  requireThat(account === EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}
export function formatSui(value) {
  value = BigInt(value); const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 1000000000n}.${String(abs % 1000000000n).padStart(9, '0')}`;
}
const OBJECT_FIELDS = `address version digest owner { __typename ... on AddressOwner { address { address } }
  ... on ObjectOwner { address { address } } ... on Shared { initialSharedVersion } }
  asMoveObject { contents { type { repr } json } }`;
const LIVE_FIELDS = `checkpoint { sequenceNumber timestamp } genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }
  registry: object(address: $registry) { ${OBJECT_FIELDS} previousTransaction { digest } }
  seed: object(address: $seed) { ${OBJECT_FIELDS} previousTransaction { digest } }
  clock: object(address: "${EXPECTED.clockId}") { ${OBJECT_FIELDS} }`;
const EFFECT_FIELDS = `status executionError { message } checkpoint { sequenceNumber timestamp } epoch { epochId } lamportVersion
  transaction { transactionBcs sender { address } } gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
  balanceChangesJson objectChanges(first: 50) { nodes { address idCreated idDeleted inputState { ${OBJECT_FIELDS} } outputState { ${OBJECT_FIELDS} } } pageInfo { hasNextPage endCursor } }
  events(first: 10) { nodes { sender { address } contents { type { repr } json } } pageInfo { hasNextPage endCursor } }
  unchangedConsensusObjects(first: 10) { nodes { __typename ... on ConsensusObjectRead { object { ${OBJECT_FIELDS} } } } pageInfo { hasNextPage endCursor } }`;
export const INPUT_VARIABLES = Object.freeze({ registry: EXPECTED.registryId, seed: EXPECTED.seedId });
export const CONFIRM_VARIABLES = INPUT_VARIABLES;
export const INPUTS_QUERY = stripIgnoredCharacters(`query OwnerFirstClaimInputs($registry: SuiAddress!, $seed: SuiAddress!) { ${LIVE_FIELDS} }`);
export const SIMULATION_QUERY = stripIgnoredCharacters(`query OwnerFirstClaimSimulation($registry: SuiAddress!, $seed: SuiAddress!, $transaction: JSON!) {
  ${LIVE_FIELDS} simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) { effects { ${EFFECT_FIELDS} } } }`);
export const CONFIRM_QUERY = stripIgnoredCharacters(`query OwnerFirstClaimConfirmation($registry: SuiAddress!, $seed: SuiAddress!, $digest: String!) {
  ${LIVE_FIELDS} transaction(digest: $digest) { digest sender { address } transactionBcs effects { ${EFFECT_FIELDS} } } }`);

export function inspectClaimState(response, options = {}) {
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && !data.transaction, 'Live state and receipt or simulation must remain separate.');
  const state = snapshot(data, options), r = contents(state.registry), s = contents(state.seed), now = uint(state.clockMs);
  const base = { ...state, seedId: EXPECTED.seedId, growthPoints: s.growth_points, wateringStreak: s.watering_streak,
    cutoffMs: EXPECTED.cutoffMs, claimDeadlineMs: EXPECTED.claimDeadlineMs, paused: r.paused,
    settlementFinalized: r.settlement !== null, rewardProcessed: s.reward_processed, digestCandidate: null };
  if (r.current_season_id !== '1' || r.season_start_ms !== EXPECTED.storedStartMs)
    return { ...base, status: 'closed', reason: 'season-changed-or-archived', rewardMist: null, rewardSui: null };
  const checked = claimInputs(state.registry, state.seed, s.reward_processed);
  requireThat(now >= uint(EXPECTED.plantedAtMs), 'The current Clock predates the confirmed planting.');
  requireThat(!checked.finalized || now >= uint(EXPECTED.cutoffMs), 'Settlement cannot be finalized before the season cutoff.');
  const result = { ...base, eligibleGrowthPoints: String(checked.points), totalEligibleGrowthPoints: checked.frozen.eligible_growth_points,
    poolMist: String(checked.pool), rewardMist: String(checked.reward), rewardSui: formatSui(checked.reward) };
  if (s.reward_processed) return { ...result, status: 'claimed', digestCandidate: digest(state.seed.previousTransaction?.digest) };
  if (now < uint(EXPECTED.cutoffMs)) return { ...result, status: 'waiting' };
  if (now > uint(EXPECTED.claimDeadlineMs)) return { ...result, status: 'expired' };
  // Gameplay pause does not gate claim_reward in this deployed contract.
  return { ...result, status: 'ready' };
}
function transactionFor(seedReference) {
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::claim_reward`, typeArguments: [], arguments: [
    tx.sharedObjectRef({ objectId: EXPECTED.registryId, initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    tx.objectRef(seedReference),
    tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
  ] }); return tx;
}
function simulationFor(seedReference) {
  return { version: 1, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender }, kind: { programmableTransaction: {
    inputs: [
      { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true },
      { kind: 'IMMUTABLE_OR_OWNED', ...seedReference },
      { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false },
    ], commands: [{ moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'claim_reward', typeArguments: [],
      arguments: [{ kind: 'INPUT', input: 0 }, { kind: 'INPUT', input: 1 }, { kind: 'INPUT', input: 2 }] } }],
  } } };
}
async function packetFor(seed) {
  const seedReference = reference(seed); same(seedReference.objectId, EXPECTED.seedId, 'Wrong Seed packet.');
  const transaction = transactionFor(seedReference), bytes = await transaction.build({ onlyTransactionKind: true });
  return { transaction, simulationTransaction: simulationFor(seedReference), seedReference, seedId: EXPECTED.seedId,
    kindBase64: toBase64(bytes), kindSha256: await sha256(bytes) };
}
export async function buildReviewedClaim(state) {
  requireThat(state?.status === 'ready', 'Refresh an unprocessed reward inside its claim window before reviewing.', 'NOT_READY');
  const checked = claimInputs(state.registry, state.seed);
  requireThat(uint(state.clockMs) >= uint(EXPECTED.cutoffMs) && uint(state.clockMs) <= uint(EXPECTED.claimDeadlineMs),
    'The reward claim is outside its fixed window.', 'NOT_READY');
  return { ...await packetFor(state.seed), rewardMist: String(checked.reward), eligibleGrowthPoints: String(checked.points) };
}
export async function validateWalletTransaction(transaction, packet) {
  requireThat(transaction instanceof Transaction && packet?.seedReference, 'A reviewed Sui claim Transaction is required.');
  const data = transaction.getData(); assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(x => x === null), 'Final gas and expiration must be selected by the wallet.');
  same(packet.seedReference.objectId, EXPECTED.seedId, 'Wrong Seed packet.');
  const expected = await transactionFor(packet.seedReference).build({ onlyTransactionKind: true });
  same(toBase64(await transaction.build({ onlyTransactionKind: true })), toBase64(expected), 'The wallet transaction differs from the exact single reward claim.');
  same(packet.kindBase64, toBase64(expected), 'The reviewed claim packet differs.');
  same(packet.kindSha256, await sha256(expected), 'The reviewed claim hash differs.'); return true;
}
function validateExpiration(data, effects, actual) {
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
  const bytes = fromBase58(payment.digest); requireThat(bytes.length === 32 && bytes.slice(12).every(x => x === 0xac), 'Invalid virtual gas reservation digest.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireThat(view.getBigUint64(0, true) > 0n && BigInt(view.getUint32(8, true)) === uint(data.expiration.ValidDuring.minEpoch), 'Invalid gas reservation amount or epoch.');
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const ownerId = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  same(payment.objectId, '0x' + toHex(ownerId.map((value, i) => value ^ chain[i])), 'Virtual gas reservation belongs to another owner or network.'); return true;
}
async function resolvedTransaction(effects, packet, actual = null) {
  const bytes = actual?.transactionBcs ?? effects.transaction?.transactionBcs;
  requireThat(typeof bytes === 'string' && bytes.length > 0, 'Missing resolved transaction bytes.');
  const tx = Transaction.from(bytes), data = tx.getData();
  same(data.sender, EXPECTED.sender, 'Wrong claim sender.'); same(data.gasData.owner, EXPECTED.sender, 'Wrong gas owner.');
  same(effects.transaction?.sender?.address, EXPECTED.sender, 'Wrong effects sender.');
  if (actual) { same(actual.sender?.address, EXPECTED.sender, 'Wrong receipt sender.'); same(effects.transaction?.transactionBcs, bytes, 'Effects and receipt transaction bytes differ.'); }
  same(toBase64(await tx.build({ onlyTransactionKind: true })), packet.kindBase64, 'Resolved claim commands differ.');
  const budget = uint(data.gasData.budget); requireThat(budget > 0n && uint(data.gasData.price) > 0n, 'Invalid gas budget or price.');
  validateExpiration(data, effects, Boolean(actual));
  const payments = data.gasData.payment; requireThat(Array.isArray(payments), 'Missing gas-payment inventory.');
  if (!payments.length) requireThat(data.expiration?.$kind === 'ValidDuring', 'Address-balance gas requires mainnet-bound expiration.');
  requireThat(new Set(payments.map(x => address(x.objectId))).size === payments.length, 'Duplicate gas references.');
  requireThat(!payments.some(x => [EXPECTED.registryId, EXPECTED.seedId, EXPECTED.clockId].includes(x.objectId)), 'A protocol object cannot be a gas coin.');
  const reservations = payments.filter((x, index) => virtualGasReference(x, index, data));
  const ordinary = payments.filter(x => uint(x.version) > 0n);
  return { data, budget, reservations, ordinary };
}
function objectChanges(effects) {
  const changes = complete(effects.objectChanges, 'claim object changes');
  requireThat(new Set(changes.map(x => address(x.address))).size === changes.length, 'Duplicate claim object changes.');
  for (const x of changes) {
    requireThat(typeof x.idCreated === 'boolean' && typeof x.idDeleted === 'boolean' && !(x.idCreated && x.idDeleted), 'Invalid object-change flags.');
    if (x.idCreated) same(x.inputState, null, 'A created object cannot have an input.');
    if (x.idDeleted) same(x.outputState, null, 'A deleted object cannot have an output.');
    for (const state of [x.inputState, x.outputState]) if (state) { reference(state); same(state.address, x.address, 'Object-change address differs.'); }
  }
  return changes;
}
function inputOutput(change, input, outputVersion) {
  requireThat(change && !change.idCreated && !change.idDeleted && change.inputState && change.outputState, 'A required claim input was created, deleted or omitted.');
  same(reference(change.inputState), reference(input), 'A different object input was consumed.');
  same(contents(change.inputState), contents(input), 'An input object content changed.');
  same(change.inputState.owner, input.owner, 'An input owner differs.'); same(typeOf(change.inputState), typeOf(input), 'An input type differs.');
  same(typeOf(change.outputState), typeOf(input), 'An output type differs.'); same(change.outputState.owner, input.owner, 'A claim input was transferred.');
  same(reference(change.outputState).version, outputVersion, 'Wrong claim output version.');
}
function gasAndBalances(effects, resolved, changes, allowed, payout, version) {
  const { ordinary, reservations, budget } = resolved, paymentMap = new Map(ordinary.map(x => [x.objectId, x]));
  requireThat(reservations.every(p => !changes.some(x => x.address === p.objectId)), 'A virtual gas reservation is not a real object change.');
  let before = 0n, after = 0n;
  for (const change of changes.filter(x => !allowed.has(x.address))) {
    const payment = paymentMap.get(change.address);
    requireThat(payment && !change.idCreated && change.inputState, 'Unexpected object, transfer or payment outside the reward claim and gas.');
    same(reference(change.inputState), { ...payment, version: String(payment.version) }, 'A different gas input was consumed.');
    owner(change.inputState); same(typeOf(change.inputState), COIN_TYPE, 'Non-SUI gas input.');
    same(contents(change.inputState), { id: change.address, balance: String(uint(contents(change.inputState)?.balance)) }, 'Wrong gas input contents.');
    before += uint(contents(change.inputState).balance);
    if (!change.idDeleted) {
      reference(change.outputState); owner(change.outputState); same(typeOf(change.outputState), COIN_TYPE, 'Non-SUI gas output.');
      same(reference(change.outputState).version, version, 'Wrong gas output version.');
      same(contents(change.outputState), { id: change.address, balance: String(uint(contents(change.outputState)?.balance)) }, 'Wrong gas output contents.');
      after += uint(contents(change.outputState).balance);
    }
  }
  for (const payment of ordinary) requireThat(changes.some(x => x.address === payment.objectId), 'A selected gas input is missing from effects.');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate); uint(gas?.nonRefundableStorageFee);
  requireThat(net <= budget, 'Net gas exceeds its budget.');
  if (ordinary.length && !reservations.length) requireThat(before - after === net, 'Gas coin balances differ from the reported network fee.');
  const balances = effects.balanceChangesJson, received = payout - net;
  requireThat(Array.isArray(balances) && (balances.length === 1 || (received === 0n && balances.length === 0)), 'Only the claim owner balance may change.');
  if (balances.length) {
    same(balances[0].address, EXPECTED.sender, 'An unexpected recipient received funds.'); same(balances[0].coinType, SUI_TYPE, 'Only SUI reward and gas may move.');
    requireThat(amount(balances[0].amount) === received, 'The owner balance differs from the exact reward minus network gas.');
  }
  return { gasEstimateMist: String(net), gasEstimateSui: formatSui(net), netReceiveMist: String(received), netReceiveSui: formatSui(received),
    virtualGasReservations: reservations.length, gasAboveReviewCeiling: net > uint(EXPECTED.maxGasMist) };
}
function claimEvents(checked) {
  const event = (type, json) => ({ sender: { address: EXPECTED.sender }, contents: { type: { repr: `${EXPECTED.packageId}::settlement::${type}` }, json } });
  const result = [];
  if (!checked.finalized) result.push(event('RewardSettlementFinalized', { registry_id: EXPECTED.registryId, season_id: '1',
    season_end_ms: EXPECTED.cutoffMs, claim_deadline_ms: EXPECTED.claimDeadlineMs, pool_mist: String(checked.pool), eligible_growth_points: String(checked.points) }));
  result.push(event('RewardEntitlementProcessed', { registry_id: EXPECTED.registryId, season_id: '1', seed_id: EXPECTED.seedId,
    owner: EXPECTED.sender, eligible_growth_points: String(checked.points), amount_mist: String(checked.reward) }));
  if (checked.reward > 0n) result.push(event('RewardClaimed', { owner: EXPECTED.sender, amount_mist: String(checked.reward) }));
  return result;
}
async function validateEffects(effects, packet, current, options = {}, actual = null) {
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The reward claim failed.', 'TRANSACTION_FAILED');
  same(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false); else same(effects.checkpoint, null, 'Simulation cannot be a confirmed receipt.');
  const resolved = await resolvedTransaction(effects, packet, actual);
  const unchanged = complete(effects.unchangedConsensusObjects, 'unchanged consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead', 'Only the read-only Clock consensus input is expected.');
  const claimedAt = verifyClock(unchanged[0].object, options, Boolean(actual));
  requireThat(claimedAt >= uint(EXPECTED.cutoffMs) && claimedAt <= uint(EXPECTED.claimDeadlineMs), 'Claim executed outside the fixed reward window.');
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= claimedAt, 'Receipt checkpoint predates execution.');
  const checked = claimInputs(current.registry, current.seed), { r, s, reward, points } = checked;
  const version = String(uint(effects.lamportVersion)), changes = objectChanges(effects);
  requireThat(uint(version) > uint(current.registry.version) && uint(version) > uint(current.seed.version), 'Claim output did not advance its inputs.');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId), seedChange = changes.find(x => x.address === EXPECTED.seedId);
  inputOutput(registryChange, current.registry, version); inputOutput(seedChange, current.seed, version);
  same(contents(seedChange.outputState), { ...s, reward_processed: true, growth_points: '0', cutoff_growth_points: '0' }, 'Unexpected Seed changes during reward claim.');
  same(contents(registryChange.outputState), { ...r, reward_pool: String(uint(r.reward_pool) - reward), settlement: {
    ...checked.frozen, paid_mist: String(reward), processed_growth_points: String(points), processed_seeds: '1',
  } }, 'Unexpected Registry settlement or reward-pool changes.');
  const created = changes.filter(x => x.idCreated), allowed = new Set([EXPECTED.registryId, EXPECTED.seedId]);
  requireThat(created.length === (reward > 0n ? 1 : 0), 'A positive claim must create exactly one reward coin.');
  let rewardCoinId = null;
  if (reward > 0n) {
    const change = created[0]; requireThat(!change.idDeleted && change.outputState, 'The reward coin is missing.');
    owner(change.outputState); same(typeOf(change.outputState), COIN_TYPE, 'Wrong reward coin type.');
    same(reference(change.outputState).version, version, 'Wrong reward coin version.');
    same(contents(change.outputState), { id: change.address, balance: String(reward) }, 'The reward coin amount differs from the entitlement.');
    requireThat(!resolved.ordinary.some(p => p.objectId === change.address), 'A reward coin cannot be a gas input.');
    rewardCoinId = change.address; allowed.add(change.address);
  }
  same(complete(effects.events, 'reward claim events'), claimEvents(checked), 'Unexpected reward claim events or entitlement amount.');
  const fees = gasAndBalances(effects, resolved, changes, allowed, reward, version);
  return { status: actual ? 'confirmed' : 'simulated', checkpoint: actual ? effects.checkpoint : current.checkpoint,
    seedId: EXPECTED.seedId, packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, seasonId: '1',
    previousGrowthPoints: String(points), growthPoints: '0', eligibleGrowthPoints: String(points), totalEligibleGrowthPoints: checked.frozen.eligible_growth_points,
    wateringStreak: s.watering_streak, rewardMist: String(reward), rewardSui: formatSui(reward), poolMist: String(checked.pool), rewardCoinId,
    rewardProcessed: true, claimedAtMs: String(claimedAt), cutoffMs: EXPECTED.cutoffMs, claimDeadlineMs: EXPECTED.claimDeadlineMs,
    settlementFinalized: true, finalizedByClaim: !checked.finalized, appChargeMist: '0', priceMist: '0', ...fees,
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256 };
}
export async function validateSimulation(response, packet, previous, options = {}) {
  const data = dataOf(response); requireThat(data.simulateTransaction && !data.transaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...live } = data, current = inspectClaimState({ data: live }, options);
  requireThat(current.status === 'ready' && previous?.status === 'ready', 'The reward is not currently available to claim.', 'NOT_READY');
  requireThat(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation checkpoint moved backwards.');
  for (const key of ['registry', 'seed']) {
    same(reference(current[key]), reference(previous[key]), `The ${key} reference changed before simulation.`);
    same(contents(current[key]), contents(previous[key]), `The ${key} contents changed before simulation.`);
  }
  await validateWalletTransaction(packet.transaction, packet);
  same(packet.seedReference, reference(current.seed), 'The reviewed Seed reference changed.');
  same(packet.simulationTransaction, simulationFor(packet.seedReference), 'The simulation proposal differs from the reviewed claim.');
  const result = await validateEffects(simulateTransaction.effects, packet, current, options);
  requireThat(!result.gasAboveReviewCeiling, 'The network fee exceeds the 0.05 SUI review ceiling.', 'GAS_INCREASED'); return result;
}

// Only an actual failed receipt plus fresh unprocessed state may expose recovery.
// The UI must additionally match both digest and kind to its persisted attempt.
async function confirmedFailure(actual, current, live, options) {
  const effects = actual.effects;
  requireThat(typeof effects.executionError?.message === 'string' && effects.executionError.message.length > 0, 'The failed receipt lacks its execution error.');
  const data = Transaction.from(actual.transactionBcs).getData(), input = data.inputs?.[1]?.Object?.ImmOrOwnedObject;
  requireThat(input?.objectId === EXPECTED.seedId, 'The failed claim used a different Seed.');
  const packet = await packetFor({ address: input.objectId, version: input.version, digest: input.digest });
  const resolved = await resolvedTransaction(effects, packet, actual), changes = objectChanges(effects), version = String(uint(effects.lamportVersion));
  same(complete(effects.events, 'failed claim events'), [], 'A failed claim cannot include reward events.');
  const unchanged = complete(effects.unchangedConsensusObjects, 'failed unchanged consensus objects');
  requireThat(unchanged.length <= 1, 'Unexpected consensus objects in failed claim.');
  if (unchanged.length) {
    requireThat(unchanged[0].__typename === 'ConsensusObjectRead', 'Unexpected failed consensus read.');
    const time = verifyClock(unchanged[0].object, {}, true);
    requireThat(time <= BigInt(Date.parse(effects.checkpoint.timestamp)), 'Failed receipt checkpoint predates its Clock.');
  }
  const allowed = new Set();
  for (const id of [EXPECTED.registryId, EXPECTED.seedId]) {
    const change = changes.find(x => x.address === id); if (!change) continue;
    requireThat(change.inputState && uint(version) > uint(change.inputState.version), 'A failed claim did not advance its input version.');
    inputOutput(change, change.inputState, version);
    same(contents(change.outputState), contents(change.inputState), 'A failed claim must not change reward contents.');
    if (id === EXPECTED.seedId) {
      const s = seedIdentity(change.inputState); originalPoints(s); requireThat(!s.reward_processed, 'A processed reward cannot authorize retry.');
      same(reference(change.inputState), input, 'Failed Seed effects differ from the actual transaction input.'); seedIdentity(change.outputState);
    } else { registryIdentity(change.inputState); registryIdentity(change.outputState); }
    allowed.add(id);
  }
  const fees = gasAndBalances(effects, resolved, changes, allowed, 0n, version);
  claimInputs(current.registry, current.seed);
  requireThat(uint(current.seed.version) >= uint(input.version), 'Current Seed predates the failed claim input.');
  if (uint(current.seed.version) === uint(input.version)) same(reference(current.seed), input, 'Current Seed differs from the failed input.');
  for (const [name, id] of [['registry', EXPECTED.registryId], ['seed', EXPECTED.seedId]]) {
    const output = changes.find(x => x.address === id)?.outputState; if (!output) continue;
    requireThat(uint(current[name].version) >= uint(output.version), 'Current state predates the failed claim effects.');
    if (uint(current[name].version) === uint(output.version)) {
      same(reference(current[name]), reference(output), 'Current object differs from the failed claim output.');
      same(contents(current[name]), contents(output), 'Current contents differ from the failed claim output.');
      same(current[name].previousTransaction?.digest, actual.digest, 'Current object does not identify the failed receipt.');
    }
  }
  const state = inspectClaimState({ data: live }, options);
  return { status: 'failed', digest: actual.digest, kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256,
    seedId: EXPECTED.seedId, packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, checkpoint: effects.checkpoint,
    permitsRetry: state.status === 'ready', currentStatus: state.status, ...fees, message: effects.executionError.message };
}
export async function validateConfirmedClaim(response, expectedDigest, options = {}) {
  const data = dataOf(response); requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true && response?.operation !== 'unsigned-claim-simulation',
  'Simulation cannot establish a confirmed reward claim.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint, 'The reward receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  requireThat(digest(expectedDigest) === actual.digest, 'The receipt digest differs.', 'CONFIRMATION_MISMATCH');
  const tx = Transaction.from(actual.transactionBcs);
  requireThat(await tx.getDigest() === expectedDigest, 'Transaction bytes do not match the digest.', 'CONFIRMATION_MISMATCH');
  const current = snapshot(data, options); checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(current.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber &&
    Date.parse(current.checkpoint.timestamp) >= Date.parse(actual.effects.checkpoint.timestamp), 'Current observation predates the receipt.', 'CONFIRMATION_PENDING');
  if (actual.effects.status === 'FAILURE') {
    let failure;
    try { const { transaction: ignored, ...live } = data; failure = await confirmedFailure(actual, current, live, options); }
    catch (cause) { throw new ClaimReviewError('TRANSACTION_FAILED', `The indexed claim failed; retry remains locked because ${cause.message}`); }
    const error = new ClaimReviewError('TRANSACTION_FAILED', failure.message); error.confirmedFailure = failure; throw error;
  }
  requireThat(actual.effects.status === 'SUCCESS', 'The receipt does not prove a successful reward claim.', 'TRANSACTION_FAILED');
  const changes = objectChanges(actual.effects), registryChange = changes.find(x => x.address === EXPECTED.registryId), seedChange = changes.find(x => x.address === EXPECTED.seedId);
  requireThat(registryChange?.inputState && seedChange?.inputState, 'The receipt lacks the Registry or Seed input.');
  claimInputs(registryChange.inputState, seedChange.inputState);
  const packet = await packetFor(seedChange.inputState);
  const checked = await validateEffects(actual.effects, packet, { ...current, registry: registryChange.inputState, seed: seedChange.inputState }, options, actual);
  claimInputs(current.registry, current.seed, true);
  let hasAdvanced = false;
  for (const [name, change] of [['registry', registryChange], ['seed', seedChange]]) {
    const object = current[name]; requireThat(uint(object.version) >= uint(change.outputState.version), `Current ${name} predates its receipt.`, 'CONFIRMATION_PENDING');
    if (uint(object.version) === uint(change.outputState.version)) {
      same(reference(object), reference(change.outputState), `Current ${name} does not match its confirmed output.`);
      same(contents(object), contents(change.outputState), `Current ${name} contents differ from its confirmed output.`);
      same(object.previousTransaction?.digest, expectedDigest, `Current ${name} does not identify the confirmed claim digest.`);
    } else {
      hasAdvanced = true;
      // Later failed attempts may advance versions. The permanent processed
      // Seed and frozen entitlement must still match the proven successful claim.
      if (name === 'seed') same(contents(object), contents(change.outputState), 'The current processed Seed differs from its confirmed claim.');
      else same(contents(object).settlement, contents(change.outputState).settlement, 'The current frozen settlement differs from its confirmed claim.');
    }
  }
  return { ...checked, status: 'confirmed', digest: expectedDigest, hasAdvanced };
}
