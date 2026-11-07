// Pure, bounded review of the first normal watering of the confirmed test Seed.
// This module performs no fetch, storage, wallet connection, signing or execution.
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase58, fromHex, toHex, toBase64 } from '@mysten/bcs';
import { stripIgnoredCharacters } from 'graphql';
import { sha256 } from '../settlement-admin/upgrade-core.mjs';
import { PLANT_EXPECTED } from '../settlement-gameplay/plant-core.mjs';

export const EXPECTED = Object.freeze({
  ...PLANT_EXPECTED,
  seedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d',
  plantDigest: 'FM5QeE2Eb2tQwQeSsTKz8s4a81mZVqde5kF2HAEmyisB',
  nftId: '0x04a937cd60e0cbcfc315b15d2dd08187d3f180ebb925d588223303ea52afbcc7',
  plantedAtMs: '1793486441252', waterReadyMs: '1793564201252',
  previousGrowthPoints: '10', expectedGrowthPoints: '24', growthPointsAdded: '14',
  previousWateringStreak: '1', expectedWateringStreak: '2',
  priceMist: '0', appChargeMist: '0',
});
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`;
const SEED_TYPE = `${EXPECTED.packageId}::settlement::Seed`;
const WATER_EVENT = `${EXPECTED.packageId}::settlement::SeedWatered`;
const TABLES = Object.freeze({
  seeds_by_owner: ['0x3673f5b7888241d3702b07e8f39bd33931750582161a3cdbc3a30b3c4d36b89c', '1'],
  referrers: ['0x3204b2eb86f9c46ed7a462c910f2ff10ece7f8d957edcd2b2af821aa7320244b', '0'],
  referral_earnings: ['0x68c78c07080b15b8c074ba13bbaa0733309d029718521a79a3e3a8b50cf8d1a0', '0'],
  player_growth: ['0xbf70908372b68eb412fa74d4ea165ef39906f8606c71993bba3bc35b958cbfae', '1'],
  player_growth_season: ['0x46daf4a08dd974e14387cb9b8c0103ed450d131fca85fffc9fe48f3727178ff4', '1'],
  planted_saplings: ['0xe1b77d1747967b896adaafc51dd16427de03e651fa419f1563ba7fb7ad04c689', '1'],
});

export class WaterReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'WaterReviewError'; this.code = code; }
}
const requireThat = (value, message, code = 'REVIEW_MISMATCH') => {
  if (!value) throw new WaterReviewError(code, message);
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
  requireThat(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value), 'Malformed balance amount.');
  return BigInt(value);
};
const address = value => { requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Malformed object address.'); return value; };
export const contents = object => object?.asMoveObject?.contents?.json;
const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
const normalizedType = value => String(value ?? '').replace(/\s+/g, '');
export function reference(object) {
  requireThat(typeof object?.digest === 'string' && fromBase58(object.digest).length === 32, 'Malformed object digest.');
  return { objectId: address(object.address), version: String(uint(object.version)), digest: object.digest };
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
    requireThat(Number.isFinite(now) && time <= now + 30000 && now - time <= EXPECTED.maxAgeMs,
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
    const now = BigInt(nowOf(options));
    requireThat(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'The execution Clock is stale.', 'STALE_REVIEW');
  }
  return time;
}
const owner = object => same(object?.owner, { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
  'The Seed or gas object owner differs from the reviewed account.');
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
function noTools(s) {
  requireThat(s.state === 0 && s.fertilizer_charges === 0 && s.miracle_grow_applied === false &&
    s.revival_charges === 0 && s.bottomless_can_expiry_ms === '0' && s.permanent_gp_bonus === '0',
  'The first normal watering requires the unchanged healthy Seed without tools.', 'SEED_STATE_CHANGED');
}
function unwateredSeed(s) {
  noTools(s);
  requireThat(s.reward_processed === false && s.last_watered_ms === EXPECTED.plantedAtMs &&
    s.watering_streak === '1' && s.growth_points === '10' && s.cutoff_growth_points === '10',
  'The first watering input has changed or was already watered.', 'ALREADY_WATERED');
}
function firstWaterInputs(registry, seed) {
  const r = registryIdentity(registry), s = seedIdentity(seed); unwateredSeed(s);
  requireThat(r.current_season_id === '1' && r.season_start_ms === EXPECTED.storedStartMs && !r.paused && r.settlement === null,
    'The first test growing period is closed.', 'SEASON_CLOSED');
  requireThat(r.total_seeds === '1' && r.total_growth_points === '10' && r.eligible_growth_points === '10',
    'The one-Seed test totals changed. Refresh the test review.', 'SEED_STATE_CHANGED');
  for (const [key, [, size]] of Object.entries(TABLES)) same(r[key].size, size, `The ${key} inventory changed.`);
  return { r, s };
}
function snapshot(data, options = {}, allowMissingSeed = false) {
  same(data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest }, 'The endpoint is not Sui mainnet.');
  checkpoint(data.checkpoint, options); const clockMs = verifyClock(data.clock, options);
  requireThat(BigInt(Date.parse(data.checkpoint.timestamp)) >= clockMs, 'Checkpoint predates the read Clock.');
  registryIdentity(data.registry);
  if (data.seed) seedIdentity(data.seed); else requireThat(allowMissingSeed, 'The confirmed test Seed is unavailable.');
  return { checkpoint: data.checkpoint, clockMs: String(clockMs), registry: data.registry, seed: data.seed };
}

export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin, 'Review this watering only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet.', 'WRONG_NETWORK');
  requireThat(account === EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
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
export const INPUTS_QUERY = stripIgnoredCharacters(`query OwnerFirstWaterInputs($registry: SuiAddress!, $seed: SuiAddress!) { ${LIVE_FIELDS} }`);
export const SIMULATION_QUERY = stripIgnoredCharacters(`query OwnerFirstWaterSimulation($registry: SuiAddress!, $seed: SuiAddress!, $transaction: JSON!) {
  ${LIVE_FIELDS} simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) { effects { ${EFFECT_FIELDS} } } }`);
export const CONFIRM_QUERY = stripIgnoredCharacters(`query OwnerFirstWaterConfirmation($registry: SuiAddress!, $seed: SuiAddress!, $digest: String!) {
  ${LIVE_FIELDS} transaction(digest: $digest) { digest sender { address } transactionBcs effects { ${EFFECT_FIELDS} } } }`);

export function inspectWaterState(response, options = {}) {
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && !data.transaction, 'Live state and receipt or simulation must remain separate.');
  const state = snapshot(data, options), r = contents(state.registry), s = contents(state.seed), now = uint(state.clockMs);
  const result = { ...state, seedId: EXPECTED.seedId, growthPoints: s.growth_points, wateringStreak: s.watering_streak,
    plantedAtMs: EXPECTED.plantedAtMs, waterReadyMs: EXPECTED.waterReadyMs, cutoffMs: EXPECTED.cutoffMs,
    digestCandidate: state.seed.previousTransaction?.digest ?? null };
  if (r.current_season_id !== '1' || r.season_start_ms !== EXPECTED.storedStartMs || r.paused || r.settlement !== null || s.reward_processed)
    return { ...result, status: 'closed', reason: r.paused ? 'paused' : 'season-or-reward-closed' };
  if (s.last_watered_ms !== EXPECTED.plantedAtMs) {
    noTools(s);
    requireThat(uint(s.last_watered_ms) >= uint(EXPECTED.waterReadyMs) && uint(s.last_watered_ms) < uint(EXPECTED.cutoffMs) &&
      uint(s.last_watered_ms) <= now && s.growth_points === '24' && s.cutoff_growth_points === '24' && s.watering_streak === '2' &&
      uint(r.total_growth_points) >= 24n && uint(r.eligible_growth_points) >= 24n,
    'The Seed differs from the reviewed first normal watering.', 'SEED_STATE_CHANGED');
    return { ...result, status: 'watered', wateredAtMs: s.last_watered_ms };
  }
  if (now >= uint(EXPECTED.cutoffMs)) return { ...result, status: 'closed', reason: 'cutoff' };
  firstWaterInputs(state.registry, state.seed);
  requireThat(now >= uint(EXPECTED.plantedAtMs), 'The current Clock predates the confirmed planting.');
  return { ...result, status: now >= uint(EXPECTED.waterReadyMs) ? 'ready' : 'waiting', digestCandidate: null };
}
function transactionFor(seedReference) {
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::water_seed`, typeArguments: [], arguments: [
    tx.sharedObjectRef({ objectId: EXPECTED.registryId, initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    tx.objectRef(seedReference),
    tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
  ] });
  return tx;
}
function simulationFor(seedReference) {
  return { version: 1, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender }, kind: { programmableTransaction: {
    inputs: [
      { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true },
      { kind: 'IMMUTABLE_OR_OWNED', ...seedReference },
      { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false },
    ], commands: [{ moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'water_seed', typeArguments: [],
      arguments: [{ kind: 'INPUT', input: 0 }, { kind: 'INPUT', input: 1 }, { kind: 'INPUT', input: 2 }] } }],
  } } };
}
async function packetFor(seed) {
  const seedReference = reference(seed); same(seedReference.objectId, EXPECTED.seedId, 'Wrong Seed packet.');
  const transaction = transactionFor(seedReference), bytes = await transaction.build({ onlyTransactionKind: true });
  return { transaction, simulationTransaction: simulationFor(seedReference), seedReference, seedId: EXPECTED.seedId,
    kindBase64: toBase64(bytes), kindSha256: await sha256(bytes) };
}
export async function buildReviewedWater(state) {
  requireThat(state?.status === 'ready', 'Wait until the confirmed watering window and refresh before reviewing.', 'NOT_READY');
  firstWaterInputs(state.registry, state.seed);
  requireThat(uint(state.clockMs) >= uint(EXPECTED.waterReadyMs) && uint(state.clockMs) < uint(EXPECTED.cutoffMs),
    'Watering is outside the first test window.', 'NOT_READY');
  return packetFor(state.seed);
}
export async function validateWalletTransaction(transaction, packet) {
  requireThat(transaction instanceof Transaction && packet?.seedReference, 'A reviewed Sui watering Transaction is required.');
  const data = transaction.getData(); assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(x => x === null), 'Final gas and expiration must be selected by the wallet.');
  same(packet.seedReference.objectId, EXPECTED.seedId, 'Wrong Seed packet.');
  const expected = await transactionFor(packet.seedReference).build({ onlyTransactionKind: true });
  same(toBase64(await transaction.build({ onlyTransactionKind: true })), toBase64(expected), 'The wallet transaction differs from the exact single watering.');
  same(packet.kindBase64, toBase64(expected), 'The reviewed watering packet differs.');
  same(packet.kindSha256, await sha256(expected), 'The reviewed watering hash differs.'); return true;
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
  same(payment.objectId, '0x' + toHex(ownerId.map((value, i) => value ^ chain[i])), 'Virtual gas reservation belongs to another owner or network.');
  return true;
}
function formatSui(value) {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 1000000000n}.${String(abs % 1000000000n).padStart(9, '0')}`;
}
function inputOutput(change, input, outputVersion) {
  requireThat(change && !change.idCreated && !change.idDeleted && change.inputState && change.outputState, 'A required watering input was created, deleted or omitted.');
  same(reference(change.inputState), reference(input), 'A different object input was consumed.');
  same(contents(change.inputState), contents(input), 'An input object content changed.');
  same(change.inputState.owner, input.owner, 'An input owner differs.');
  same(typeOf(change.inputState), typeOf(input), 'An input type differs.');
  same(typeOf(change.outputState), typeOf(input), 'An output type differs.');
  same(change.outputState.owner, input.owner, 'A watering input was transferred.');
  same(reference(change.outputState).version, outputVersion, 'Wrong watering output version.');
}
async function validateEffects(effects, packet, current, options = {}, actual = null) {
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The watering transaction failed.', 'TRANSACTION_FAILED');
  same(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false); else same(effects.checkpoint, null, 'Simulation cannot be a confirmed receipt.');
  const bytes = actual?.transactionBcs ?? effects.transaction?.transactionBcs, tx = Transaction.from(bytes), data = tx.getData();
  same(data.sender, EXPECTED.sender, 'Wrong watering sender.'); same(data.gasData.owner, EXPECTED.sender, 'Wrong gas owner.');
  same((actual ?? effects.transaction)?.sender?.address, EXPECTED.sender, 'Wrong receipt sender.');
  if (actual) same(effects.transaction?.transactionBcs, bytes, 'Effects and receipt transaction bytes differ.');
  same(toBase64(await tx.build({ onlyTransactionKind: true })), packet.kindBase64, 'Resolved watering commands differ.');
  const gasBudget = uint(data.gasData.budget); requireThat(gasBudget > 0n && uint(data.gasData.price) > 0n, 'Invalid gas budget or price.');
  validateExpiration(data, effects, Boolean(actual));
  const payments = data.gasData.payment; requireThat(Array.isArray(payments), 'Missing gas-payment inventory.');
  if (!payments.length) requireThat(data.expiration?.$kind === 'ValidDuring', 'Address-balance gas requires mainnet-bound expiration.');
  requireThat(new Set(payments.map(x => address(x.objectId))).size === payments.length, 'Duplicate gas references.');
  requireThat(!payments.some(x => [EXPECTED.registryId, EXPECTED.seedId, EXPECTED.clockId].includes(x.objectId)), 'A protocol object cannot be a gas coin.');
  const reservations = payments.filter((x, index) => virtualGasReference(x, index, data));
  const ordinaryPayments = payments.filter(x => uint(x.version) > 0n), paymentMap = new Map(ordinaryPayments.map(x => [x.objectId, x]));
  const unchanged = complete(effects.unchangedConsensusObjects, 'unchanged consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead', 'Only the read-only Clock consensus input is expected.');
  const executionClock = unchanged[0].object, wateredAt = verifyClock(executionClock, options, Boolean(actual));
  requireThat(wateredAt >= uint(EXPECTED.waterReadyMs) && wateredAt < uint(EXPECTED.cutoffMs), 'Watering executed outside the allowed first test window.');
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= wateredAt, 'Receipt checkpoint predates execution.');
  const changes = complete(effects.objectChanges, 'watering object changes');
  requireThat(new Set(changes.map(x => address(x.address))).size === changes.length, 'Duplicate watering object changes.');
  for (const x of changes) {
    requireThat(typeof x.idCreated === 'boolean' && typeof x.idDeleted === 'boolean', 'Missing object-change flags.');
    for (const state of [x.inputState, x.outputState]) if (state) same(state.address, x.address, 'Object-change address differs.');
  }
  requireThat(reservations.every(payment => !changes.some(x => x.address === payment.objectId)), 'A virtual gas reservation is not a real coin change.');
  const { r, s } = firstWaterInputs(current.registry, current.seed), version = String(uint(effects.lamportVersion));
  requireThat(uint(version) > uint(current.registry.version) && uint(version) > uint(current.seed.version), 'Watering output did not advance the input version.');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId), seedChange = changes.find(x => x.address === EXPECTED.seedId);
  inputOutput(registryChange, current.registry, version); inputOutput(seedChange, current.seed, version);
  const expectedSeed = { ...s, last_watered_ms: String(wateredAt), watering_streak: '2', growth_points: '24', cutoff_growth_points: '24' };
  same(contents(seedChange.outputState), expectedSeed, 'Unexpected Seed changes during normal watering.');
  same(contents(registryChange.outputState), { ...r, total_growth_points: '24', eligible_growth_points: '24' }, 'Unexpected Registry changes or payment during watering.');
  const allowed = new Set([EXPECTED.seedId, EXPECTED.registryId]);
  for (const [table, before, after, required] of [['player_growth', '10', '24', true], ['player_growth_season', '1', '1', false]]) {
    const id = deriveDynamicFieldID(r[table].id, TypeTagSerializer.parseFromStr('address'), bcs.Address.serialize(EXPECTED.sender).toBytes());
    const change = changes.find(x => x.address === id);
    if (!change) { requireThat(!required, 'The player Growth Points record is missing.'); continue; }
    requireThat(!change.idCreated && !change.idDeleted && change.inputState && change.outputState, 'The player record was created or deleted.');
    for (const [obj, value] of [[change.inputState, before], [change.outputState, after]]) {
      reference(obj); same(normalizedType(typeOf(obj)), `${SUI}::dynamic_field::Field<address,u64>`, 'Wrong player record type.');
      same(obj.owner, { __typename: 'ObjectOwner', address: { address: r[table].id } }, 'Wrong player record parent.');
      same(contents(obj), { id, name: EXPECTED.sender, value }, 'Wrong player Growth Points or season record.');
    }
    if (required) same(reference(change.outputState).version, version, 'Wrong player Growth Points output version.');
    allowed.add(id);
  }
  let gasInputBalance = 0n, gasOutputBalance = 0n;
  for (const change of changes.filter(x => !allowed.has(x.address))) {
    const payment = paymentMap.get(change.address);
    requireThat(payment && !change.idCreated && change.inputState, 'Unexpected object, transfer or payment outside normal watering and gas.');
    same(reference(change.inputState), { ...payment, version: String(payment.version) }, 'A different gas input was consumed.');
    owner(change.inputState); same(typeOf(change.inputState), COIN_TYPE, 'Non-SUI gas input.');
    same(contents(change.inputState)?.id, change.address, 'Wrong gas input contents.');
    gasInputBalance += uint(contents(change.inputState).balance);
    if (change.idDeleted) same(change.outputState, null);
    else {
      owner(change.outputState); same(typeOf(change.outputState), COIN_TYPE); same(reference(change.outputState).version, version);
      same(contents(change.outputState)?.id, change.address, 'Wrong gas output contents.');
      gasOutputBalance += uint(contents(change.outputState).balance);
    }
  }
  for (const payment of ordinaryPayments) requireThat(changes.some(x => x.address === payment.objectId), 'A selected gas input is missing from effects.');
  same(complete(effects.events, 'watering events'), [{ sender: { address: EXPECTED.sender }, contents: { type: { repr: WATER_EVENT },
    json: { seed_id: EXPECTED.seedId, owner: EXPECTED.sender, streak: '2', growth_points: '24' } } }], 'Unexpected watering event.');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate); uint(gas?.nonRefundableStorageFee);
  requireThat(net <= gasBudget, 'Net gas exceeds its budget.');
  if (ordinaryPayments.length && !reservations.length)
    requireThat(gasInputBalance - gasOutputBalance === net, 'Gas coin balances differ from the reported network fee.');
  const balances = effects.balanceChangesJson;
  requireThat(Array.isArray(balances) && balances.length === 1, 'Only the watering sender gas balance may change.');
  same(balances[0].address, EXPECTED.sender, 'An unexpected recipient received funds.'); same(balances[0].coinType, SUI_TYPE, 'Only SUI gas may move.');
  requireThat(amount(balances[0].amount) === -net, 'The sender debit differs from network gas only.');
  return { status: actual ? 'confirmed' : 'simulated', checkpoint: actual ? effects.checkpoint : current.checkpoint,
    seedId: EXPECTED.seedId, packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, seasonId: '1',
    previousGrowthPoints: '10', growthPoints: '24', growthPointsAdded: '14', wateringStreak: '2',
    plantedAtMs: EXPECTED.plantedAtMs, wateredAtMs: String(wateredAt), waterReadyMs: EXPECTED.waterReadyMs,
    nextWaterReadyMs: String(wateredAt + uint(EXPECTED.wateringIntervalMs)), cutoffMs: EXPECTED.cutoffMs,
    appChargeMist: '0', priceMist: '0', gasEstimateMist: String(net), gasEstimateSui: formatSui(net),
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256, virtualGasReservations: reservations.length,
    gasAboveReviewCeiling: net > uint(EXPECTED.maxGasMist) };
}
export async function validateSimulation(response, packet, previous, options = {}) {
  const data = dataOf(response); requireThat(data.simulateTransaction && !data.transaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...live } = data, current = inspectWaterState({ data: live }, options);
  requireThat(current.status === 'ready' && previous?.status === 'ready', 'The first watering is not currently available.', 'NOT_READY');
  requireThat(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation checkpoint moved backwards.');
  for (const key of ['registry', 'seed']) {
    same(reference(current[key]), reference(previous[key]), `The ${key} reference changed before simulation.`);
    same(contents(current[key]), contents(previous[key]), `The ${key} contents changed before simulation.`);
  }
  await validateWalletTransaction(packet.transaction, packet);
  same(packet.seedReference, reference(current.seed), 'The reviewed Seed reference changed.');
  same(packet.simulationTransaction, simulationFor(packet.seedReference), 'The simulation proposal differs from the reviewed watering.');
  const result = await validateEffects(simulateTransaction.effects, packet, current, options);
  requireThat(!result.gasAboveReviewCeiling, 'The network fee exceeds the 0.05 SUI review ceiling.', 'GAS_INCREASED'); return result;
}

// A failed wallet return alone is never sufficient to clear an uncertain attempt.
// Recovery metadata is produced only from a complete, confirmed public receipt
// and fresh unwatered Seed state. The UI must also match its stored digest/kind.
async function confirmedFailure(actual, current, live, options) {
  const effects = actual.effects, tx = Transaction.from(actual.transactionBcs), data = tx.getData();
  same(effects.status, 'FAILURE', 'Failure recovery requires an actual failed transaction.');
  requireThat(typeof effects.executionError?.message === 'string' && effects.executionError.message.length > 0, 'The failed receipt lacks its execution error.');
  same(effects.transaction?.transactionBcs, actual.transactionBcs, 'Failure effects and receipt bytes differ.');
  same(data.sender, EXPECTED.sender, 'Wrong failed-transaction sender.'); same(data.gasData.owner, EXPECTED.sender, 'Wrong failed-transaction gas owner.');
  same(actual.sender?.address, EXPECTED.sender, 'Wrong failed receipt sender.');
  same(effects.transaction?.sender?.address, EXPECTED.sender, 'Wrong failed effects sender.');
  const seedInput = data.inputs?.[1]?.Object?.ImmOrOwnedObject;
  requireThat(seedInput?.objectId === EXPECTED.seedId, 'The failed transaction used a different Seed.');
  const packet = await packetFor({ address: seedInput.objectId, version: seedInput.version, digest: seedInput.digest });
  same(toBase64(await tx.build({ onlyTransactionKind: true })), packet.kindBase64, 'The failed transaction is not the exact reviewed watering.');
  const budget = uint(data.gasData.budget); requireThat(budget > 0n && uint(data.gasData.price) > 0n, 'Invalid failed-transaction gas budget.');
  validateExpiration(data, effects, true);
  const payments = data.gasData.payment; requireThat(Array.isArray(payments), 'The failed receipt lacks its gas inventory.');
  if (!payments.length) requireThat(data.expiration?.$kind === 'ValidDuring', 'Failed address-balance gas lacks chain-bound expiration.');
  requireThat(new Set(payments.map(x => address(x.objectId))).size === payments.length, 'Duplicate failed-transaction gas references.');
  requireThat(!payments.some(x => [EXPECTED.registryId, EXPECTED.seedId, EXPECTED.clockId].includes(x.objectId)), 'A protocol object cannot be failed-transaction gas.');
  const reservations = payments.filter((x, index) => virtualGasReference(x, index, data));
  const ordinaryPayments = payments.filter(x => uint(x.version) > 0n), paymentMap = new Map(ordinaryPayments.map(x => [x.objectId, x]));
  same(complete(effects.events, 'failed-transaction events'), [], 'A failed watering cannot include gameplay events.');
  const changes = complete(effects.objectChanges, 'failed-transaction object changes');
  requireThat(new Set(changes.map(x => address(x.address))).size === changes.length, 'Duplicate failed object changes.');
  requireThat(reservations.every(p => !changes.some(x => x.address === p.objectId)), 'A virtual gas reservation cannot be an object change.');
  const allowedProtocol = new Set([EXPECTED.registryId, EXPECTED.seedId]);
  for (const name of ['player_growth', 'player_growth_season'])
    allowedProtocol.add(deriveDynamicFieldID(TABLES[name][0], TypeTagSerializer.parseFromStr('address'), bcs.Address.serialize(EXPECTED.sender).toBytes()));
  let inputGas = 0n, outputGas = 0n;
  for (const change of changes) {
    requireThat(change.idCreated === false && typeof change.idDeleted === 'boolean' && change.inputState, 'Unexpected new object in failed watering.');
    for (const state of [change.inputState, change.outputState]) if (state) same(state.address, change.address, 'Failed object-change identity differs.');
    const payment = paymentMap.get(change.address);
    if (payment) {
      same(reference(change.inputState), { ...payment, version: String(payment.version) }, 'Failed gas input reference differs.');
      owner(change.inputState); same(typeOf(change.inputState), COIN_TYPE, 'Non-SUI failed gas input.');
      inputGas += uint(contents(change.inputState)?.balance);
      if (change.idDeleted) same(change.outputState, null);
      else {
        reference(change.outputState); owner(change.outputState); same(typeOf(change.outputState), COIN_TYPE, 'Non-SUI failed gas output.');
        outputGas += uint(contents(change.outputState)?.balance);
      }
    } else {
      requireThat(allowedProtocol.has(change.address) && !change.idDeleted && change.outputState, 'A failed watering changed an unexpected object.');
      reference(change.inputState); reference(change.outputState);
      same(contents(change.outputState), contents(change.inputState), 'A failed watering must not change gameplay contents.');
      same(typeOf(change.outputState), typeOf(change.inputState), 'A failed watering changed an object type.');
      same(change.outputState.owner, change.inputState.owner, 'A failed watering transferred a gameplay object.');
      if (change.address === EXPECTED.seedId) {
        unwateredSeed(seedIdentity(change.inputState)); seedIdentity(change.outputState);
        same(reference(change.inputState), seedInput, 'Failed Seed effects differ from the actual input.');
      }
      if (change.address === EXPECTED.registryId) { registryIdentity(change.inputState); registryIdentity(change.outputState); }
    }
  }
  for (const payment of ordinaryPayments) requireThat(changes.some(x => x.address === payment.objectId), 'Failed gas input is missing from effects.');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate); uint(gas?.nonRefundableStorageFee);
  requireThat(net <= budget, 'Failed-transaction gas exceeds its budget.');
  if (ordinaryPayments.length && !reservations.length) requireThat(inputGas - outputGas === net, 'Failed gas coin balances differ from the network fee.');
  const balances = effects.balanceChangesJson;
  requireThat(Array.isArray(balances) && balances.length === 1, 'Failed watering must have only a sender gas balance change.');
  same(balances[0].address, EXPECTED.sender, 'Failed watering has an unexpected recipient.'); same(balances[0].coinType, SUI_TYPE);
  requireThat(amount(balances[0].amount) === -net, 'Failed watering balance differs from gas only.');
  requireThat(current.seed, 'A missing Seed cannot authorize retry.'); unwateredSeed(seedIdentity(current.seed));
  requireThat(uint(current.seed.version) >= uint(seedInput.version), 'Current Seed predates the failed input.');
  if (uint(current.seed.version) === uint(seedInput.version)) same(reference(current.seed), seedInput, 'Current Seed reference differs from the failed input.');
  const state = inspectWaterState({ data: live }, options);
  requireThat(state.status !== 'watered', 'An already watered Seed cannot authorize retry.');
  return { status: 'failed', digest: actual.digest, kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256,
    seedId: EXPECTED.seedId, packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, checkpoint: effects.checkpoint,
    permitsRetry: state.status === 'ready', currentStatus: state.status,
    gasEstimateMist: String(net), gasEstimateSui: formatSui(net), message: effects.executionError.message };
}
export async function validateConfirmedWater(response, expectedDigest, options = {}) {
  const data = dataOf(response); requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true, 'Simulation cannot establish a confirmed watering.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint, 'The watering receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  requireThat(typeof expectedDigest === 'string' && fromBase58(expectedDigest).length === 32 && actual.digest === expectedDigest,
    'The receipt digest differs.', 'CONFIRMATION_MISMATCH');
  const tx = Transaction.from(actual.transactionBcs);
  requireThat(await tx.getDigest() === expectedDigest, 'Transaction bytes do not match the digest.', 'CONFIRMATION_MISMATCH');
  const current = snapshot(data, options, true);
  checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(current.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber, 'Current observation predates the receipt.', 'CONFIRMATION_PENDING');
  if (actual.effects.status === 'FAILURE') {
    const { transaction: ignored, ...live } = data;
    const failure = await confirmedFailure(actual, current, live, options);
    const error = new WaterReviewError('TRANSACTION_FAILED', failure.message);
    error.confirmedFailure = failure; throw error;
  }
  requireThat(actual.effects.status === 'SUCCESS', 'The receipt does not prove successful watering.', 'TRANSACTION_FAILED');
  const changes = complete(actual.effects.objectChanges, 'confirmed watering changes');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId), seedChange = changes.find(x => x.address === EXPECTED.seedId);
  requireThat(registryChange?.inputState && seedChange?.inputState, 'The receipt lacks the Registry or Seed input.');
  firstWaterInputs(registryChange.inputState, seedChange.inputState);
  const packet = await packetFor(seedChange.inputState);
  const checked = await validateEffects(actual.effects, packet, { ...current, registry: registryChange.inputState, seed: seedChange.inputState }, options, actual);
  let hasAdvanced = false;
  for (const [name, change] of [['registry', registryChange], ['seed', seedChange]]) {
    const object = current[name];
    if (!object) { requireThat(uint(current.registry.version) > uint(registryChange.outputState.version), 'Current Seed is missing at its receipt version.'); hasAdvanced = true; continue; }
    requireThat(uint(object.version) >= uint(change.outputState.version), `Current ${name} predates its receipt.`, 'CONFIRMATION_PENDING');
    if (uint(object.version) === uint(change.outputState.version)) {
      same(reference(object), reference(change.outputState), `Current ${name} does not match its confirmed output.`);
      same(contents(object), contents(change.outputState), `Current ${name} contents differ from its confirmed output.`);
    } else hasAdvanced = true;
  }
  return { ...checked, status: 'confirmed', digest: expectedDigest, hasAdvanced, currentSeedUnavailable: !current.seed };
}
