// Pure, receipt-bound care for the isolated 48-hour Season 3 owner cycle.
// No fetch, storage, wallet connection, signing, or execution belongs here.
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { stripIgnoredCharacters } from 'graphql';
import {
  EXPECTED, SUI, SUI_TYPE, COIN_TYPE, SEED_TYPE, TABLE_NAMES, CycleReviewError,
  requireThat, same, uint, address, digest, contents, typeOf, normalizedType,
  reference, complete, dataOf, checkpoint, verifyClock, owner, formatSui,
  registryIdentity, nftIdentity, seedIdentity, inspectState, sameSnapshot,
  packetFrom, assertWalletPacket, resolvedTransaction, objectChanges, inputOutput, gasAndBalances,
} from './common.mjs';
import { assertCycleReceipt } from './rollover-core.mjs';

export { EXPECTED, contents };
const clone = value => structuredClone(value);
const plantReceipts = new WeakSet();
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function assertPlantReceipt(receipt, cycleReceipt) {
  assertCycleReceipt(cycleReceipt);
  requireThat(receipt && plantReceipts.has(receipt) && receipt.status === 'confirmed' && receipt.action === 'plant' &&
    receipt.cycleDigest === cycleReceipt.digest, 'Reverify the actual Season 3 planting receipt before continuing.', 'PLANT_PROOF_REQUIRED');
  return receipt;
}

const FIELD_SPECS = Object.freeze([
  ['seedsByOwner', 'seeds_by_owner', 'address', `vector<${SUI}::object::ID>`],
  ['playerGrowth', 'player_growth', 'address', 'u64'],
  ['playerGrowthSeason', 'player_growth_season', 'address', 'u64'],
  ['plantedSapling', 'planted_saplings', `${SUI}::object::ID`, 'u64'],
]);
const OBJECT_FIELDS = `address version digest owner { __typename
  ... on AddressOwner { address { address } } ... on ObjectOwner { address { address } }
  ... on Shared { initialSharedVersion } } asMoveObject { contents { type { repr } json } }`;
export const PLANT_FIELDS_QUERY = stripIgnoredCharacters(`query ThirdSeasonCareFields(
  $checkpoint: UInt53!, $seedsByOwner: SuiAddress!, $playerGrowth: SuiAddress!,
  $playerGrowthSeason: SuiAddress!, $plantedSapling: SuiAddress!) {
  genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }
  checkpoint(sequenceNumber: $checkpoint) { sequenceNumber timestamp query {
    seedsByOwner: object(address: $seedsByOwner) { ${OBJECT_FIELDS} }
    playerGrowth: object(address: $playerGrowth) { ${OBJECT_FIELDS} }
    playerGrowthSeason: object(address: $playerGrowthSeason) { ${OBJECT_FIELDS} }
    plantedSapling: object(address: $plantedSapling) { ${OBJECT_FIELDS} }
  } }
}`);
// An unchanged runtime-loaded field is absent from objectChanges. Its receipt
// names the exact object version; recovery reads that historical version rather
// than borrowing a later player-growth value from the current season.
export const PLANT_RECEIPT_FIELD_QUERY = stripIgnoredCharacters(`query ThirdSeasonPlantReceiptField(
  $objectId: SuiAddress!, $version: UInt53!) {
  genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }
  playerGrowth: object(address: $objectId, version: $version) { ${OBJECT_FIELDS} }
}`);
function fieldDescriptors(registry, nftId) {
  address(nftId); const r = registryIdentity(registry);
  return FIELD_SPECS.map(([alias, table, keyType, valueType]) => {
    const name = table === 'planted_saplings' ? nftId : EXPECTED.sender;
    const parent = address(r[table].id);
    return { alias, table, name, parent, keyType, valueType,
      id: deriveDynamicFieldID(parent, TypeTagSerializer.parseFromStr(keyType), bcs.Address.serialize(name).toBytes()),
      type: `${SUI}::dynamic_field::Field<${keyType},${valueType}>` };
  });
}
export function plantFieldVariables(snapshot, nftId) {
  checkpoint(snapshot?.checkpoint, {}, false);
  return Object.fromEntries([['checkpoint', snapshot.checkpoint.sequenceNumber],
    ...fieldDescriptors(snapshot.registry, nftId).map(field => [field.alias, field.id])]);
}
function validateField(object, descriptor, required = false) {
  if (object === null) { requireThat(!required, `The existing ${descriptor.table} owner record is missing.`); return null; }
  requireThat(object, `The ${descriptor.table} observation is missing.`);
  reference(object); same(object.address, descriptor.id, `Wrong ${descriptor.table} dynamic-field ID.`);
  same(normalizedType(typeOf(object)), normalizedType(descriptor.type), `Wrong ${descriptor.table} type.`);
  same(object.owner, { __typename: 'ObjectOwner', address: { address: descriptor.parent } }, `Wrong ${descriptor.table} parent.`);
  const value = contents(object);
  same(Object.keys(value ?? {}).sort(), ['id', 'name', 'value'], `Wrong ${descriptor.table} fields.`);
  same(value.id, descriptor.id); same(value.name, descriptor.name, `Wrong ${descriptor.table} key.`);
  if (descriptor.table === 'seeds_by_owner') {
    requireThat(Array.isArray(value.value) && value.value.length <= 5000, 'Malformed owner Seed index.');
    value.value.forEach(address);
    requireThat(new Set(value.value).size === value.value.length, 'Duplicate Seed IDs in owner index.');
  } else uint(value.value);
  return object;
}
export function attachPlantFields(snapshot, response, nftId) {
  const data = dataOf(response), variables = plantFieldVariables(snapshot, nftId);
  same(data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest }, 'Care fields identify another network.');
  same(data.checkpoint?.sequenceNumber, variables.checkpoint, 'Care fields changed checkpoint.');
  same(Date.parse(data.checkpoint?.timestamp), Date.parse(snapshot.checkpoint.timestamp), 'Care fields changed checkpoint time.');
  const observed = data.checkpoint?.query; requireThat(observed && typeof observed === 'object', 'Missing care field observations.');
  const fields = {};
  for (const field of fieldDescriptors(snapshot.registry, nftId)) {
    const required = field.table !== 'planted_saplings' || nftId === EXPECTED.previousNftId;
    fields[field.alias] = clone(validateField(observed[field.alias], field, required));
  }
  requireThat([EXPECTED.olderSeedId, EXPECTED.previousSeedId].every(id => contents(fields.seedsByOwner).value.includes(id)),
    'Both processed previous Seeds must remain in the owner index.');
  return { ...snapshot, careFields: freeze(fields), careFieldNftId: nftId,
    careFieldCheckpoint: snapshot.checkpoint.sequenceNumber, careFieldRegistry: freeze(reference(snapshot.registry)) };
}
function observedFields(snapshot, nftId) {
  same(snapshot.careFieldNftId, nftId, 'Read the selected NFTree’s current care fields.');
  same(snapshot.careFieldCheckpoint, snapshot.checkpoint.sequenceNumber, 'Care fields are from a different checkpoint.');
  same(snapshot.careFieldRegistry, reference(snapshot.registry), 'Care fields are from a different Registry observation.');
  const fields = snapshot.careFields;
  for (const field of fieldDescriptors(snapshot.registry, nftId))
    validateField(fields?.[field.alias], field, field.table !== 'planted_saplings' || nftId === EXPECTED.previousNftId);
  return fields;
}

function cycleState(snapshot, cycle, options = {}) {
  assertCycleReceipt(cycle); checkpoint(snapshot?.checkpoint, options);
  requireThat(snapshot.checkpoint.sequenceNumber >= cycle.checkpoint.sequenceNumber, 'The state predates the verified rollover.');
  const r = registryIdentity(snapshot.registry), clockMs = uint(snapshot.clockMs);
  requireThat(clockMs <= BigInt(Date.parse(snapshot.checkpoint.timestamp)), 'Checkpoint predates the observed Clock.');
  requireThat(uint(snapshot.registry.version) >= uint(cycle.registryOutput.version), 'Registry predates the rollover output.');
  if (uint(snapshot.registry.version) === uint(cycle.registryOutput.version)) {
    same(reference(snapshot.registry), reference(cycle.registryOutput)); same(r, contents(cycle.registryOutput));
  }
  for (const name of TABLE_NAMES) same(r[name].id, contents(cycle.registryOutput)[name].id, `The ${name} table changed after rollover.`);
  requireThat(Array.isArray(snapshot.ownedSeeds) && new Set(snapshot.ownedSeeds.map(x => x.address)).size === snapshot.ownedSeeds.length,
    'Incomplete or duplicate owned Seed inventory.');
  snapshot.ownedSeeds.forEach(seedIdentity);
  return { r, clockMs, seeds: snapshot.ownedSeeds.filter(x => contents(x).season_id === EXPECTED.seasonId) };
}
function seedProgress(seed, cycle, planting, clockMs = null) {
  assertPlantReceipt(planting, cycle); seedIdentity(seed); const s = contents(seed);
  same(seed.address, planting.seedId, 'This is not the verified Season 3 Seed.');
  same([s.sapling_id, s.planted_at_ms, s.season_id], [planting.nftId, planting.plantedAtMs, EXPECTED.seasonId],
    'The Seed planting, NFTree, or season differs from its verified receipt.');
  requireThat(uint(seed.version) >= uint(planting.seedOutput.version), 'Seed predates its verified planting.');
  if (uint(seed.version) === uint(planting.seedOutput.version)) {
    same(reference(seed), reference(planting.seedOutput), 'The initial Seed reference contradicts its planting receipt.');
    same(contents(seed), contents(planting.seedOutput), 'The initial Seed contents contradict its planting receipt.');
  }
  const planted = uint(planting.plantedAtMs), watered = uint(s.last_watered_ms);
  let points;
  if (s.last_watered_ms === planting.plantedAtMs && s.watering_streak === '1') points = '10';
  else {
    requireThat(s.watering_streak === '2' && watered >= uint(planting.waterReadyMs) && watered < uint(cycle.cutoffMs) &&
      watered - planted < 172800000n, 'Only the first normal Season 3 watering is supported.', 'SEED_STATE_CHANGED');
    points = '24';
  }
  if (clockMs !== null) requireThat(clockMs >= watered, 'The current Clock predates the Seed’s care.');
  const stored = s.reward_processed ? '0' : points;
  same(s, { ...contents(planting.seedOutput), last_watered_ms: s.last_watered_ms, watering_streak: s.watering_streak,
    growth_points: stored, cutoff_growth_points: stored, reward_processed: s.reward_processed },
  'The Seed has unsupported care, tools, or processed Growth Points.', 'SEED_STATE_CHANGED');
  return { s, points, watered: points === '24' };
}
function claimInputs(registry, seed, cycle, planting) {
  const r = registryIdentity(registry), { s, points } = seedProgress(seed, cycle, planting);
  same([r.current_season_id, r.season_start_ms], [EXPECTED.seasonId, cycle.storedStartMs], 'The Registry no longer matches Season 3.');
  same([r.total_seeds, r.total_growth_points, r.eligible_growth_points], ['1', points, points], 'The single-Seed season totals changed.');
  const plantedRegistry = contents(planting.registryOutput);
  for (const name of TABLE_NAMES) same(r[name], plantedRegistry[name], `The ${name} inventory changed after planting.`);
  same(r.treasury, plantedRegistry.treasury, 'The Registry treasury changed.');
  same(r, { ...plantedRegistry, total_growth_points: points, eligible_growth_points: points,
    reward_pool: r.reward_pool, settlement: r.settlement, paused: r.paused }, 'The Registry has unsupported changes after planting.');
  requireThat(r.settlement === null || (r.settlement && typeof r.settlement === 'object' && !Array.isArray(r.settlement)), 'Malformed settlement.');
  requireThat(!s.reward_processed || r.settlement !== null, 'A processed reward requires a finalized settlement.');
  const pool = uint(r.settlement?.pool_mist ?? r.reward_pool), reward = pool;
  const frozen = { season_id: EXPECTED.seasonId, season_end_ms: cycle.cutoffMs, claim_deadline_ms: cycle.claimDeadlineMs,
    pool_mist: String(pool), eligible_growth_points: points, paid_mist: s.reward_processed ? String(reward) : '0',
    processed_growth_points: s.reward_processed ? points : '0', processed_seeds: s.reward_processed ? '1' : '0' };
  if (r.settlement !== null) same(r.settlement, frozen, 'The frozen settlement differs from this one-Seed season.');
  requireThat(uint(r.reward_pool) + uint(frozen.paid_mist) === pool, 'The remaining pool and paid rewards do not balance.');
  return { r, s, points, pool, reward, frozen, finalized: r.settlement !== null };
}
export function inspectCare(snapshot, cycle, planting = null, options = {}) {
  const { r, clockMs, seeds } = cycleState(snapshot, cycle, options);
  const result = { ...snapshot, cycleDigest: cycle.digest, seasonId: EXPECTED.seasonId, action: null, canAct: false,
    cutoffMs: cycle.cutoffMs, claimDeadlineMs: cycle.claimDeadlineMs, actualStartMs: cycle.actualStartMs,
    storedStartMs: cycle.storedStartMs, seed: seeds[0] ?? null, seedId: seeds[0]?.address ?? null,
    growthPoints: seeds[0] ? contents(seeds[0]).growth_points : '0', wateringStreak: seeds[0] ? contents(seeds[0]).watering_streak : '0',
    waterReadyMs: planting?.waterReadyMs ?? null, digestCandidate: seeds[0]?.previousTransaction?.digest ?? null };
  if (r.current_season_id !== EXPECTED.seasonId || r.season_start_ms !== cycle.storedStartMs)
    return { ...result, status: 'closed', reason: 'season-changed' };
  requireThat(clockMs >= uint(cycle.actualStartMs), 'The current Clock predates the verified Season 3 start.');
  requireThat(seeds.length <= 1, 'More than one Season 3 Seed exists. This page supports one test Seed.', 'UNSUPPORTED_STATE');
  if (!seeds.length) {
    requireThat(!planting, 'The verified Season 3 Seed is missing from the complete owner inventory.', 'SEED_STATE_CHANGED');
    same({ ...r, paused: contents(cycle.registryOutput).paused }, contents(cycle.registryOutput), 'The empty Season 3 Registry changed before its one planting.');
    if (clockMs >= uint(cycle.cutoffMs) || r.paused) return { ...result, status: 'closed', reason: r.paused ? 'paused' : 'cutoff' };
    const lastPlantForWaterMs = String(uint(cycle.cutoffMs) - uint(EXPECTED.wateringIntervalMs));
    if (clockMs >= uint(lastPlantForWaterMs)) return { ...result, status: 'plant-window-closed', lastPlantForWaterMs,
      reason: 'The remaining season is too short for the planned first watering.' };
    return { ...result, status: 'plant-ready', action: 'plant', canAct: true,
      lastPlantForWaterMs };
  }
  if (!planting) return { ...result, status: 'needs-plant-receipt', reason: 'Verify this Season 3 Seed’s planting receipt.' };
  const checked = claimInputs(snapshot.registry, seeds[0], cycle, planting);
  seedProgress(seeds[0], cycle, planting, clockMs);
  Object.assign(result, { plantDigest: planting.digest, nftId: planting.nftId, waterReadyMs: planting.waterReadyMs,
    eligibleGrowthPoints: checked.points, totalEligibleGrowthPoints: checked.points,
    rewardMist: String(checked.reward), rewardSui: formatSui(checked.reward), poolMist: String(checked.pool),
    rewardProcessed: checked.s.reward_processed, settlementFinalized: checked.finalized });
  if (checked.finalized) requireThat(clockMs >= uint(cycle.cutoffMs), 'Settlement finalized before the cutoff.');
  if (checked.s.reward_processed) return { ...result, status: 'claimed', reason: 'The Season 3 reward is already processed.' };
  if (clockMs > uint(cycle.claimDeadlineMs)) return { ...result, status: 'expired', reason: 'The claim deadline has passed.' };
  if (clockMs >= uint(cycle.cutoffMs)) return { ...result, status: 'claim-ready', action: 'claim', canAct: true };
  if (r.paused) return { ...result, status: 'closed', reason: 'paused' };
  if (checked.points === '24') return { ...result, status: 'watered', wateredAtMs: checked.s.last_watered_ms };
  if (clockMs < uint(planting.waterReadyMs)) return { ...result, status: 'waiting-water' };
  return { ...result, status: 'water-ready', action: 'water', canAct: true };
}

function transactionFor(action, ref) {
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  const registry = () => tx.sharedObjectRef({ objectId: EXPECTED.registryId, initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true });
  const clock = () => tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false });
  if (action === 'plant') {
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(EXPECTED.priceMist)]);
    tx.moveCall({ target: `${EXPECTED.packageId}::settlement::plant_seed_with_nftree`, typeArguments: [EXPECTED.nftType],
      arguments: [registry(), tx.objectRef(ref), payment, tx.pure.option('address', null), clock()] });
  } else {
    requireThat(['water', 'claim'].includes(action), 'Unsupported care action.');
    tx.moveCall({ target: `${EXPECTED.packageId}::settlement::${action === 'water' ? 'water_seed' : 'claim_reward'}`,
      arguments: [registry(), tx.objectRef(ref), clock()] });
  }
  return tx;
}
function simulationFor(action, ref) {
  const registry = { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true };
  const clock = { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false };
  const input = { kind: 'IMMUTABLE_OR_OWNED', ...ref };
  const kind = action === 'plant' ? {
    inputs: [{ kind: 'PURE', pure: bcs.u64().serialize(EXPECTED.priceMist).toBase64() }, registry, input,
      { kind: 'PURE', pure: bcs.option(bcs.Address).serialize(null).toBase64() }, clock],
    commands: [{ splitCoins: { coin: { kind: 'GAS' }, amounts: [{ kind: 'INPUT', input: 0 }] } },
      { moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'plant_seed_with_nftree', typeArguments: [EXPECTED.nftType],
        arguments: [{ kind: 'INPUT', input: 1 }, { kind: 'INPUT', input: 2 }, { kind: 'RESULT', result: 0, subresult: 0 },
          { kind: 'INPUT', input: 3 }, { kind: 'INPUT', input: 4 }] } }],
  } : {
    inputs: [registry, input, clock], commands: [{ moveCall: { package: EXPECTED.packageId, module: 'settlement',
      function: action === 'water' ? 'water_seed' : 'claim_reward', typeArguments: [],
      arguments: [{ kind: 'INPUT', input: 0 }, { kind: 'INPUT', input: 1 }, { kind: 'INPUT', input: 2 }] } }],
  };
  return { version: 1, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender }, kind: { programmableTransaction: kind } };
}
async function packetFor(action, ref, cycle, planting = null, extra = {}) {
  return packetFrom(transactionFor(action, ref), simulationFor(action, ref), { action, cycleDigest: cycle.digest,
    plantDigest: planting?.digest ?? null, seasonId: EXPECTED.seasonId, ...extra,
    ...(action === 'plant' ? { nftId: ref.objectId, nftReference: ref } : { seedId: ref.objectId, seedReference: ref }) });
}
export async function preparePlant(snapshot, nftId, cycle, options = {}) {
  same(nftId, EXPECTED.previousNftId, 'This isolated cycle reuses the verified Season 2 NFTree.');
  const care = inspectCare(snapshot, cycle, null, options);
  requireThat(care.action === 'plant' && care.canAct, 'A fresh empty Season 3 planting window is required.', 'NOT_READY');
  const nft = snapshot.nfts.find(x => x.address === address(nftId)); requireThat(nft, 'Select one verified owned NFTree.'); nftIdentity(nft);
  const fields = observedFields(snapshot, nftId), planted = contents(fields.plantedSapling)?.value;
  requireThat(planted !== EXPECTED.seasonId, 'This NFTree is already planted in Season 3.', 'ALREADY_PLANTED');
  same([planted, contents(fields.playerGrowthSeason).value, contents(fields.playerGrowth).value],
    [EXPECTED.previousSeasonId, EXPECTED.previousSeasonId, '10'], 'The owner and NFTree must retain their completed Season 2 growth records.');
  same(contents(fields.seedsByOwner).value, [EXPECTED.olderSeedId, EXPECTED.previousSeedId],
    'The pre-plant owner index must contain exactly the two processed previous Seeds.');
  return packetFor('plant', reference(nft), cycle, null, { fieldInputs: clone(fields), priceMist: EXPECTED.priceMist });
}
export async function prepareWater(snapshot, cycle, planting, options = {}) {
  const care = inspectCare(snapshot, cycle, planting, options);
  requireThat(care.action === 'water' && care.canAct, 'The first normal watering is not eligible.', 'NOT_READY');
  const fields = observedFields(snapshot, planting.nftId);
  same([contents(fields.playerGrowth).value, contents(fields.playerGrowthSeason).value], ['10', EXPECTED.seasonId], 'Owner Growth Points differ from this first watering.');
  return packetFor('water', reference(care.seed), cycle, planting, { fieldInputs: clone(fields), growthPoints: '24', previousGrowthPoints: '10' });
}
export async function prepareClaim(snapshot, cycle, planting, options = {}) {
  const care = inspectCare(snapshot, cycle, planting, options);
  requireThat(care.action === 'claim' && care.canAct, 'The Season 3 reward is not currently claimable.', 'NOT_READY');
  return packetFor('claim', reference(care.seed), cycle, planting, { rewardMist: care.rewardMist, eligibleGrowthPoints: care.eligibleGrowthPoints });
}
export async function validateCareWalletTransaction(transaction, packet, cycle, planting = null) {
  assertCycleReceipt(cycle); same(packet?.cycleDigest, cycle.digest, 'The packet belongs to a different rollover.');
  requireThat(['plant', 'water', 'claim'].includes(packet.action), 'Unsupported care packet.');
  if (packet.action !== 'plant') {
    assertPlantReceipt(planting, cycle); same(packet.plantDigest, planting.digest, 'The packet belongs to a different planting.');
    same(packet.seedId, planting.seedId, 'The packet targets another Seed.');
    same(packet.seedReference?.objectId, planting.seedId);
  } else {
    same(packet.nftId, EXPECTED.previousNftId, 'This isolated cycle reuses the verified Season 2 NFTree.');
    same(packet.nftId, packet.nftReference?.objectId, 'The selected NFTree identity differs.');
  }
  const ref = packet.action === 'plant' ? packet.nftReference : packet.seedReference;
  same(packet.simulationTransaction, simulationFor(packet.action, ref), 'The simulation proposal differs from the exact care action.');
  return assertWalletPacket(transaction, packet, transactionFor(packet.action, ref));
}
export const validateWalletTransaction = validateCareWalletTransaction;

const event = (name, json) => ({ sender: { address: EXPECTED.sender }, contents: {
  type: { repr: `${EXPECTED.packageId}::settlement::${name}` }, json } });
function fieldChange(changes, descriptor, input, value, version, allowed, unchanged = null) {
  const change = changes.find(x => x.address === descriptor.id);
  if (!change && unchanged) {
    requireThat(descriptor.alias === 'playerGrowth' && value === '10', 'Only unchanged first-plant Growth Points may omit an update.');
    validateField(input, descriptor, true);
    same({ objectId: input.address, version: String(uint(input.version)) }, unchanged,
      'The unchanged player_growth reference differs from the verified input.');
    same(contents(input), { id: descriptor.id, name: descriptor.name, value },
      'The omitted player_growth field does not already contain the exact expected value.');
    requireThat(uint(input.version) < uint(version), 'The unchanged player_growth version must precede this transaction.');
    return clone(input);
  }
  requireThat(change?.outputState && !change.idDeleted, `The ${descriptor.table} output is missing.`);
  if (input === null) requireThat(change.idCreated && change.inputState === null, `The ${descriptor.table} field must be newly created.`);
  else inputOutput(change, input, version);
  validateField(change.outputState, descriptor, true);
  same(reference(change.outputState).version, version, `Wrong ${descriptor.table} output version.`);
  same(contents(change.outputState), { id: descriptor.id, name: descriptor.name, value }, `Wrong ${descriptor.table} output value.`);
  allowed.add(change.address); return change.outputState;
}
async function unchangedPlantGrowth(effects, changes, descriptor, transactionDigest) {
  const metadata = effects.effectsJson;
  if (changes.some(x => x.address === descriptor.id)) {
    requireThat(!metadata?.unchangedLoadedRuntimeObjects?.some?.(x => x.objectId === descriptor.id),
      'The player_growth field cannot be both changed and unchanged.');
    return null;
  }
  requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata),
    'The omitted player_growth field requires its unchanged runtime proof.');
  same(String(uint(metadata.version)), '2', 'Unsupported unchanged runtime proof version.');
  same(metadata.status, { success: true }, 'The unchanged runtime proof does not describe a successful transaction.');
  same(digest(metadata.transactionDigest), transactionDigest, 'The unchanged runtime proof belongs to another transaction.');
  same(String(uint(metadata.lamportVersion)), String(uint(effects.lamportVersion)), 'The unchanged runtime proof has another output version.');
  same(String(uint(metadata.epoch)), String(uint(effects.epoch?.epochId)), 'The unchanged runtime proof has another execution epoch.');
  const rows = metadata.unchangedLoadedRuntimeObjects;
  requireThat(Array.isArray(rows) && rows.length === 1, 'Exactly one unchanged player_growth runtime reference is required.');
  const row = rows[0];
  same(Object.keys(row ?? {}).sort(), ['objectId', 'version'], 'Malformed unchanged player_growth reference.');
  same(address(row.objectId), descriptor.id, 'The unchanged runtime proof names another field.');
  requireThat(uint(row.version) > 0n && uint(row.version) < uint(effects.lamportVersion),
    'The unchanged player_growth version is invalid.');
  requireThat(Array.isArray(metadata.changedObjects) && !metadata.changedObjects.some(x => x.objectId === descriptor.id),
    'The omitted player_growth field is marked as changed in the runtime proof.');
  return { objectId: row.objectId, version: String(uint(row.version)) };
}
function expectedEmptyRegistry(registry, cycle) {
  const r = registryIdentity(registry);
  same(r, contents(cycle.registryOutput), 'Planting requires the verified empty, unpaused Season 3 Registry.');
  requireThat(uint(registry.version) >= uint(cycle.registryOutput.version), 'Planting predates rollover.');
  if (uint(registry.version) === uint(cycle.registryOutput.version)) same(reference(registry), reference(cycle.registryOutput));
  return r;
}
function verifyCreatedCoin(change, recipient, amountMist, version) {
  requireThat(change?.idCreated && !change.idDeleted && change.inputState === null && change.outputState,
    'An expected payment coin was not created.');
  owner(change.outputState, recipient); same(typeOf(change.outputState), COIN_TYPE, 'An expected payment is not a SUI coin.');
  same(reference(change.outputState).version, version, 'Wrong payment coin version.');
  same(contents(change.outputState), { id: change.address, balance: String(amountMist) }, 'The payment coin amount differs.');
}
async function validateEffects(effects, packet, input, cycle, planting, options = {}, actual = null) {
  assertCycleReceipt(cycle);
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The care transaction failed.', 'TRANSACTION_FAILED');
  same(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false); else same(effects.checkpoint, null, 'A simulation cannot be a confirmed receipt.');
  const ref = packet.action === 'plant' ? packet.nftReference : packet.seedReference;
  const resolved = await resolvedTransaction(effects, packet, actual, { excludeIds: [ref.objectId] });
  const unchanged = complete(effects.unchangedConsensusObjects, 'care unchanged consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead', 'Only the read-only Clock consensus input is expected.');
  const executionClock = unchanged[0].object, executed = verifyClock(executionClock, options, Boolean(actual));
  requireThat(executed >= uint(cycle.actualStartMs), 'Care execution predates the verified Season 3 start.');
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= executed &&
    effects.checkpoint.sequenceNumber >= cycle.checkpoint.sequenceNumber, 'The receipt predates its execution Clock or rollover.');
  const changes = objectChanges(effects), version = String(uint(effects.lamportVersion));
  const inputVersions = [input.registry.version, ref.version, executionClock.version,
    ...resolved.payments.map(x => x.version), ...changes.filter(x => x.inputState).map(x => x.inputState.version),
    ...Object.values(packet.fieldInputs ?? {}).filter(Boolean).map(x => x.version)].map(uint);
  requireThat(uint(version) === inputVersions.reduce((maximum, value) => value > maximum ? value : maximum, 0n) + 1n,
    'Output Lamport version differs from the exact care inputs.');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId);
  inputOutput(registryChange, input.registry, version);
  const allowed = new Set([EXPECTED.registryId]), r = registryIdentity(input.registry);
  let output, fees, detail;
  if (packet.action === 'plant') {
    expectedEmptyRegistry(input.registry, cycle);
    requireThat(executed < uint(cycle.cutoffMs), 'Planting executed after the growing cutoff.');
    const nft = input.nfts.find(x => x.address === packet.nftId); requireThat(nft, 'The NFTree input is missing.'); nftIdentity(nft);
    same(reference(nft), packet.nftReference, 'The receipt NFTree differs from the packet.');
    const nftChange = changes.find(x => x.address === packet.nftId); inputOutput(nftChange, nft, version);
    nftIdentity(nftChange.outputState); same(contents(nftChange.outputState), contents(nft), 'The NFTree was modified.'); allowed.add(packet.nftId);
    const seeds = changes.filter(x => typeOf(x.outputState) === SEED_TYPE);
    requireThat(seeds.length === 1 && seeds[0].idCreated && !seeds[0].idDeleted && seeds[0].inputState === null,
      'Exactly one fresh Season 3 Seed must be created.');
    output = seeds[0].outputState; const seedId = address(output.address); owner(output); same(reference(output).version, version);
    requireThat(![EXPECTED.olderSeedId, EXPECTED.previousSeedId].includes(seedId), 'A new planting cannot reuse a previous Seed ID.');
    same(contents(output), { id: seedId, version: '1', registry_id: EXPECTED.registryId, cutoff_growth_points: '10', reward_processed: false,
      sapling_id: packet.nftId, season_id: EXPECTED.seasonId, owner: EXPECTED.sender, planted_at_ms: String(executed), last_watered_ms: String(executed),
      watering_streak: '1', growth_points: '10', state: 0, fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0,
      bottomless_can_expiry_ms: '0', permanent_gp_bonus: '0' }, 'The created Seed differs from one fresh Season 3 planting.');
    allowed.add(seedId);
    const descriptors = fieldDescriptors(input.registry, packet.nftId), fields = packet.fieldInputs;
    for (const field of descriptors) validateField(fields?.[field.alias], field, field.table !== 'planted_saplings' || packet.nftId === EXPECTED.previousNftId);
    same(contents(fields.seedsByOwner).value, [EXPECTED.olderSeedId, EXPECTED.previousSeedId],
      'The pre-plant owner index must contain exactly the two processed previous Seeds.');
    requireThat(!contents(fields.seedsByOwner).value.includes(seedId), 'The new Seed already appears in the owner index.');
    same([contents(fields.playerGrowthSeason).value, contents(fields.plantedSapling).value, contents(fields.playerGrowth).value],
      [EXPECTED.previousSeasonId, EXPECTED.previousSeasonId, '10'], 'The prior owner and NFTree growth records differ from Season 2.');
    const values = { seedsByOwner: [...contents(fields.seedsByOwner).value, seedId], playerGrowth: '10',
      playerGrowthSeason: EXPECTED.seasonId, plantedSapling: EXPECTED.seasonId };
    const unchangedGrowth = await unchangedPlantGrowth(effects, changes,
      descriptors.find(x => x.alias === 'playerGrowth'), await resolved.transaction.getDigest());
    const expectedRegistry = clone(r), fieldOutputs = {};
    Object.assign(expectedRegistry, { reward_pool: String(uint(r.reward_pool) + uint(EXPECTED.rewardShareMist)),
      total_seeds: '1', total_growth_points: '10', eligible_growth_points: '10' });
    for (const descriptor of descriptors) {
      const before = fields[descriptor.alias];
      fieldOutputs[descriptor.alias] = fieldChange(changes, descriptor, before, values[descriptor.alias], version, allowed,
        descriptor.alias === 'playerGrowth' ? unchangedGrowth : null);
      if (before === null) expectedRegistry[descriptor.table].size = String(uint(expectedRegistry[descriptor.table].size) + 1n);
    }
    same(contents(registryChange.outputState), expectedRegistry, 'Unexpected Registry changes during Season 3 planting.');
    const coins = changes.filter(x => x.idCreated && typeOf(x.outputState) === COIN_TYPE);
    requireThat(coins.length === 2, 'The planting must create exactly its treasury and developer payment coins.');
    const treasury = coins.find(x => x.outputState.owner?.address?.address === EXPECTED.treasuryWallet);
    const developer = coins.find(x => x.outputState.owner?.address?.address === EXPECTED.sender);
    verifyCreatedCoin(treasury, EXPECTED.treasuryWallet, EXPECTED.treasuryShareMist, version);
    verifyCreatedCoin(developer, EXPECTED.sender, EXPECTED.developerShareMist, version);
    allowed.add(treasury.address); allowed.add(developer.address);
    same(complete(effects.events, 'planting events'), [event('SeedPlanted', { seed_id: seedId, owner: EXPECTED.sender, sapling_id: packet.nftId })],
      'Unexpected planting event.');
    fees = gasAndBalances(effects, resolved, changes, allowed, version, {
      ownerDeltaBeforeGas: String(-uint(EXPECTED.priceMist) + uint(EXPECTED.developerShareMist)),
      otherBalances: { [EXPECTED.treasuryWallet]: EXPECTED.treasuryShareMist }, gasCoinDebitBeforeGas: EXPECTED.priceMist,
    });
    detail = { seedId, nftId: packet.nftId, growthPoints: '10', wateringStreak: '1', plantedAtMs: String(executed),
      waterReadyMs: String(executed + uint(EXPECTED.wateringIntervalMs)),
      canWaterBeforeCutoff: executed + uint(EXPECTED.wateringIntervalMs) < uint(cycle.cutoffMs),
      priceMist: EXPECTED.priceMist, rewardShareMist: EXPECTED.rewardShareMist, treasuryShareMist: EXPECTED.treasuryShareMist,
      developerShareMist: EXPECTED.developerShareMist, fieldOutputs, nftOutput: nftChange.outputState };
  } else {
    assertPlantReceipt(planting, cycle); same(packet.seedId, planting.seedId);
    const seed = input.seed, checked = claimInputs(input.registry, seed, cycle, planting), s = checked.s;
    same(reference(seed), packet.seedReference, 'The Seed input differs from the reviewed care packet.');
    requireThat(!s.reward_processed, 'This Seed’s reward was already processed.', 'ALREADY_CLAIMED');
    const seedChange = changes.find(x => x.address === planting.seedId); inputOutput(seedChange, seed, version);
    output = seedChange.outputState; allowed.add(planting.seedId);
    if (packet.action === 'water') {
      requireThat(!r.paused && r.settlement === null && checked.points === '10', 'The first normal watering input is no longer eligible.');
      requireThat(executed >= uint(planting.waterReadyMs) && executed < uint(cycle.cutoffMs) &&
        executed - uint(planting.plantedAtMs) < 172800000n, 'Watering executed outside its first normal watering window.');
      same(contents(output), { ...s, last_watered_ms: String(executed), watering_streak: '2', growth_points: '24', cutoff_growth_points: '24' },
        'Unexpected Seed changes during its first watering.');
      same(contents(registryChange.outputState), { ...r, total_growth_points: '24', eligible_growth_points: '24' },
        'Unexpected Registry changes during watering.');
      const descriptors = fieldDescriptors(input.registry, planting.nftId), fields = packet.fieldInputs;
      for (const alias of ['playerGrowth', 'playerGrowthSeason']) validateField(fields?.[alias], descriptors.find(x => x.alias === alias), true);
      same([contents(fields.playerGrowth).value, contents(fields.playerGrowthSeason).value], ['10', EXPECTED.seasonId], 'Wrong owner growth input.');
      fieldChange(changes, descriptors.find(x => x.alias === 'playerGrowth'), fields.playerGrowth, '24', version, allowed);
      const seasonField = descriptors.find(x => x.alias === 'playerGrowthSeason'), seasonChange = changes.find(x => x.address === seasonField.id);
      if (seasonChange) {
        requireThat(!seasonChange.idCreated && !seasonChange.idDeleted && seasonChange.inputState && seasonChange.outputState, 'The owner season field changed identity.');
        same(reference(seasonChange.inputState), reference(fields.playerGrowthSeason));
        for (const state of [seasonChange.inputState, seasonChange.outputState]) {
          validateField(state, seasonField, true); same(contents(state), contents(fields.playerGrowthSeason), 'The owner season changed during watering.');
        }
        requireThat(uint(seasonChange.outputState.version) >= uint(seasonChange.inputState.version) && uint(seasonChange.outputState.version) <= uint(version), 'Wrong owner season version.');
        allowed.add(seasonField.id);
      }
      same(complete(effects.events, 'watering events'), [event('SeedWatered', { seed_id: planting.seedId, owner: EXPECTED.sender,
        streak: '2', growth_points: '24' })], 'Unexpected watering event.');
      fees = gasAndBalances(effects, resolved, changes, allowed, version);
      detail = { seedId: planting.seedId, nftId: planting.nftId, previousGrowthPoints: '10', growthPoints: '24', growthPointsAdded: '14',
        wateringStreak: '2', plantedAtMs: planting.plantedAtMs, waterReadyMs: planting.waterReadyMs, wateredAtMs: String(executed), priceMist: '0', appChargeMist: '0' };
    } else {
      requireThat(packet.action === 'claim' && executed >= uint(cycle.cutoffMs) && executed <= uint(cycle.claimDeadlineMs),
        'Claim executed outside its fixed Season 3 window.');
      same(contents(output), { ...s, reward_processed: true, growth_points: '0', cutoff_growth_points: '0' }, 'Unexpected Seed changes during reward claim.');
      const frozen = { ...checked.frozen, paid_mist: String(checked.reward), processed_growth_points: checked.points, processed_seeds: '1' };
      same(contents(registryChange.outputState), { ...r, reward_pool: String(uint(r.reward_pool) - checked.reward), settlement: frozen },
        'Unexpected Registry settlement or reward-pool changes.');
      const created = changes.filter(x => x.idCreated);
      requireThat(created.length === (checked.reward > 0n ? 1 : 0), 'A positive claim must create exactly one reward coin.');
      let rewardCoinId = null;
      if (checked.reward > 0n) {
        verifyCreatedCoin(created[0], EXPECTED.sender, checked.reward, version);
        rewardCoinId = created[0].address; allowed.add(rewardCoinId);
      }
      const events = [];
      if (!checked.finalized) events.push(event('RewardSettlementFinalized', { registry_id: EXPECTED.registryId, season_id: EXPECTED.seasonId,
        season_end_ms: cycle.cutoffMs, claim_deadline_ms: cycle.claimDeadlineMs, pool_mist: String(checked.pool), eligible_growth_points: checked.points }));
      events.push(event('RewardEntitlementProcessed', { registry_id: EXPECTED.registryId, season_id: EXPECTED.seasonId, seed_id: planting.seedId,
        owner: EXPECTED.sender, eligible_growth_points: checked.points, amount_mist: String(checked.reward) }));
      if (checked.reward > 0n) events.push(event('RewardClaimed', { owner: EXPECTED.sender, amount_mist: String(checked.reward) }));
      same(complete(effects.events, 'claim events'), events, 'Unexpected reward claim events or amounts.');
      fees = gasAndBalances(effects, resolved, changes, allowed, version, { ownerDeltaBeforeGas: String(checked.reward) });
      detail = { seedId: planting.seedId, nftId: planting.nftId, previousGrowthPoints: checked.points, growthPoints: '0',
        eligibleGrowthPoints: checked.points, totalEligibleGrowthPoints: checked.points, wateringStreak: s.watering_streak,
        rewardMist: String(checked.reward), rewardSui: formatSui(checked.reward), poolMist: String(checked.pool), rewardCoinId,
        rewardProcessed: true, claimedAtMs: String(executed), settlementFinalized: true, finalizedByClaim: !checked.finalized,
        priceMist: '0', appChargeMist: '0' };
    }
  }
  return { status: actual ? 'confirmed' : 'simulated', action: packet.action, checkpoint: actual ? effects.checkpoint : input.checkpoint,
    cycleDigest: cycle.digest, plantDigest: planting?.digest ?? null, packageId: EXPECTED.packageId, registryId: EXPECTED.registryId,
    seasonId: EXPECTED.seasonId, inventoryVersion: '1', actualStartMs: cycle.actualStartMs, storedStartMs: cycle.storedStartMs,
    cutoffMs: cycle.cutoffMs, claimDeadlineMs: cycle.claimDeadlineMs, ...detail, ...fees,
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256,
    seedOutput: output, registryOutput: registryChange.outputState };
}
async function validateCareSimulation(action, response, packet, previous, proof, cycle, planting, options) {
  same(packet?.action, action, 'Wrong care action.');
  const data = dataOf(response); requireThat(data.simulateTransaction && !data.transaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...live } = data;
  const current = await inspectState({ data: live }, proof, options);
  sameSnapshot(current, previous);
  const before = inspectCare(previous, cycle, planting, options), after = inspectCare(current, cycle, planting, options);
  requireThat(before.canAct && after.canAct && before.action === action && after.action === action, 'The care action is no longer eligible.', 'NOT_READY');
  if (action === 'plant') {
    const a = current.nfts.find(x => x.address === packet.nftId), b = previous.nfts.find(x => x.address === packet.nftId);
    requireThat(a && b, 'The selected NFTree is no longer owned.'); same(reference(a), reference(b)); same(contents(a), contents(b));
    same(packet.nftReference, reference(a)); same(packet.fieldInputs, observedFields(previous, packet.nftId), 'The planting field inputs differ from the observed records.');
  } else {
    same(reference(after.seed), reference(before.seed), 'The Seed input changed before simulation.'); same(contents(after.seed), contents(before.seed));
    same(packet.seedReference, reference(after.seed));
    if (action === 'water') same(packet.fieldInputs, observedFields(previous, planting.nftId), 'The watering field inputs differ from the observed records.');
  }
  await validateCareWalletTransaction(packet.transaction, packet, cycle, planting);
  const checked = await validateEffects(simulateTransaction.effects, packet, { ...current, seed: after.seed }, cycle, planting, options);
  requireThat(!checked.gasAboveReviewCeiling, 'The network fee exceeds the 0.05 SUI review ceiling.', 'GAS_INCREASED');
  return checked;
}
export const validatePlantSimulation = (response, packet, previous, proof, cycle, options = {}) =>
  validateCareSimulation('plant', response, packet, previous, proof, cycle, null, options);
export const validateWaterSimulation = (response, packet, previous, proof, cycle, planting, options = {}) =>
  validateCareSimulation('water', response, packet, previous, proof, cycle, planting, options);
export const validateClaimSimulation = (response, packet, previous, proof, cycle, planting, options = {}) =>
  validateCareSimulation('claim', response, packet, previous, proof, cycle, planting, options);

function receiptAdvance(live, output, expectedDigest, label) {
  requireThat(live && output, `The current ${label} is missing.`, 'CONFIRMATION_PENDING');
  requireThat(uint(live.version) >= uint(output.version), `Current ${label} predates its confirmed receipt.`, 'CONFIRMATION_PENDING');
  same(live.owner, output.owner, `Current ${label} ownership changed.`);
  same(typeOf(live), typeOf(output), `Current ${label} type changed.`);
  if (uint(live.version) === uint(output.version)) {
    same(reference(live), reference(output), `Current ${label} contradicts the confirmed output.`);
    same(contents(live), contents(output), `Current ${label} contents contradict its receipt.`);
    if (live.previousTransaction) same(live.previousTransaction.digest, expectedDigest, `Current ${label} names a different transaction.`);
    return false;
  }
  return true;
}
async function receiptPacket(action, actual, cycle, planting) {
  const data = Transaction.from(actual.transactionBcs).getData();
  const owned = data.inputs.filter(x => x.Object?.ImmOrOwnedObject).map(x => x.Object.ImmOrOwnedObject);
  requireThat(owned.length === 1, 'Care must consume exactly one reviewed owned NFTree or Seed.');
  const ref = { ...owned[0], version: String(owned[0].version) };
  reference({ address: ref.objectId, version: ref.version, digest: ref.digest });
  same(ref.objectId, action === 'plant' ? EXPECTED.previousNftId : planting.seedId,
    'The actual care transaction targets another NFTree or Seed.');
  return packetFor(action, ref, cycle, planting);
}
export async function plantReceiptFieldVariables(response, expectedDigest) {
  const data = dataOf(response), actual = data.transaction;
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true,
  'A simulation cannot request a confirmed planting field.', 'CONFIRMATION_MISMATCH');
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint,
    'The planting receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  // Failed requests need only the existing gas-only failure verifier. Their
  // unchanged field observations never authorize another planting request.
  if (actual.effects.status === 'FAILURE') return null;
  requireThat(actual.effects.status === 'SUCCESS', 'The planting receipt does not prove success.', 'TRANSACTION_FAILED');
  checkpoint(actual.effects.checkpoint, {}, false);
  same(digest(expectedDigest), actual.digest, 'The requested and actual receipt digests differ.');
  const transaction = Transaction.from(actual.transactionBcs);
  same(await transaction.getDigest(), expectedDigest, 'The actual bytes do not match the requested digest.');
  const owned = transaction.getData().inputs.filter(x => x.Object?.ImmOrOwnedObject).map(x => x.Object.ImmOrOwnedObject);
  requireThat(owned.length === 1 && owned[0].objectId === EXPECTED.previousNftId,
    'The planting receipt must use the verified Season 2 NFTree.');
  const ref = { ...owned[0], version: String(uint(owned[0].version)) };
  reference({ address: ref.objectId, version: ref.version, digest: ref.digest });
  const packet = await packetFrom(transactionFor('plant', ref), simulationFor('plant', ref));
  await resolvedTransaction(actual.effects, packet, actual, { excludeIds: [ref.objectId] });
  const changes = objectChanges(actual.effects), registry = changes.find(x => x.address === EXPECTED.registryId)?.inputState;
  requireThat(registry, 'The planting receipt lacks its Registry input.');
  const descriptor = fieldDescriptors(registry, EXPECTED.previousNftId).find(x => x.alias === 'playerGrowth');
  const row = await unchangedPlantGrowth(actual.effects, changes, descriptor, expectedDigest);
  if (!row) return null;
  requireThat(uint(row.version) <= BigInt(Number.MAX_SAFE_INTEGER), 'The historical field version cannot be queried exactly.');
  return { objectId: row.objectId, version: Number(row.version) };
}
function verifiedUnchangedPlantField(response, row, descriptor) {
  requireThat(response, 'Read the exact unchanged player_growth object version from the planting receipt.', 'CONFIRMATION_PENDING');
  const data = dataOf(response);
  same(data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest }, 'The historical planting field identifies another network.');
  requireThat(!data.transaction && !data.simulateTransaction, 'A current or simulated transaction cannot replace the historical planting field.');
  const field = validateField(data.playerGrowth, descriptor, true);
  same({ objectId: field.address, version: String(uint(field.version)) }, row,
    'The historical player_growth object does not match the receipt runtime reference.');
  same(contents(field), { id: descriptor.id, name: descriptor.name, value: '10' },
    'The historical unchanged player_growth object must contain exactly 10 Growth Points.');
  return clone(field);
}
function receiptFieldInputs(action, registry, changes, planting, unchangedGrowth = null) {
  const fields = {};
  for (const descriptor of fieldDescriptors(registry, planting?.nftId ?? EXPECTED.previousNftId)) {
    const change = changes.find(x => x.address === descriptor.id);
    if (action === 'plant') {
      if (!change && descriptor.alias === 'playerGrowth' && unchangedGrowth) {
        fields.playerGrowth = clone(validateField(unchangedGrowth, descriptor, true));
        continue;
      }
      requireThat(change, `The planting receipt lacks its ${descriptor.table} update.`);
      fields[descriptor.alias] = clone(validateField(change.inputState, descriptor, true));
    } else if (descriptor.alias === 'playerGrowth') {
      requireThat(change?.inputState, 'The watering receipt lacks its owner growth input.');
      fields.playerGrowth = clone(validateField(change.inputState, descriptor, true));
    } else if (descriptor.alias === 'playerGrowthSeason') {
      fields.playerGrowthSeason = clone(validateField(change?.inputState ?? planting.fieldOutputs.playerGrowthSeason, descriptor, true));
    }
  }
  return fields;
}
async function verifiedFailure(action, actual, current, cycle, planting, options) {
  const effects = actual.effects;
  requireThat(typeof effects.executionError?.message === 'string' && effects.executionError.message.length > 0,
    'The failed receipt lacks its execution error.');
  const care = inspectCare(current, cycle, planting, options);
  const packet = await receiptPacket(action, actual, cycle, planting);
  const ref = action === 'plant' ? packet.nftReference : packet.seedReference;
  const resolved = await resolvedTransaction(effects, packet, actual, { excludeIds: [ref.objectId] });
  same(complete(effects.events, 'failed care events'), [], 'A failed care receipt cannot emit successful gameplay events.');
  const unchanged = complete(effects.unchangedConsensusObjects, 'failed care consensus reads');
  requireThat(unchanged.length <= 1 && unchanged.every(x => x.__typename === 'ConsensusObjectRead'), 'Unexpected failed care consensus inputs.');
  for (const item of unchanged) verifyClock(item.object, options, true);
  const changes = objectChanges(effects), version = String(uint(effects.lamportVersion)), allowed = new Set();
  requireThat(changes.every(x => !x.idCreated), 'A failed care receipt cannot create a gameplay or payment object.');
  const ownedObject = action === 'plant' ? current.nfts.find(x => x.address === packet.nftId) : care.seed;
  requireThat(ownedObject, 'The failed input is no longer owned.');
  requireThat(uint(ownedObject.version) >= uint(ref.version), 'Current owned state predates the failed transaction.');
  if (uint(ownedObject.version) === uint(ref.version)) same(reference(ownedObject), ref, 'Current owned input contradicts the failed transaction.');
  if (action === 'plant') {
    requireThat(!care.seed, 'A Season 3 planting already exists.'); expectedEmptyRegistry(current.registry, cycle);
  } else {
    const checked = claimInputs(current.registry, care.seed, cycle, planting);
    requireThat(!checked.s.reward_processed && (action !== 'water' || checked.points === '10'),
      'The original failed care action has already advanced.');
  }
  const descriptors = fieldDescriptors(current.registry, action === 'plant' ? packet.nftId : planting.nftId);
  for (const change of changes) {
    if (change.address === EXPECTED.registryId || change.address === ref.objectId) {
      const live = change.address === EXPECTED.registryId ? current.registry : ownedObject;
      requireThat(change.inputState && change.outputState && !change.idDeleted, 'The failed receipt lost a required protocol input.');
      inputOutput(change, change.inputState, version);
      same(contents(change.outputState), contents(change.inputState), 'The failed transaction changed protocol contents.');
      same(contents(change.outputState), contents(live), 'The live protocol state advanced after the failed transaction.');
      if (change.address === EXPECTED.registryId) registryIdentity(change.inputState);
      else {
        (action === 'plant' ? nftIdentity : seedIdentity)(change.inputState);
        same(reference(change.inputState), ref, 'The failed owned input differs from its actual bytes.');
      }
      receiptAdvance(live, change.outputState, actual.digest, 'failed care input'); allowed.add(change.address);
    } else {
      const descriptor = descriptors.find(x => x.id === change.address);
      if (!descriptor) continue;
      requireThat(action !== 'claim' && (action === 'plant' || ['playerGrowth', 'playerGrowthSeason'].includes(descriptor.alias)),
        'The failed action included an unrelated dynamic field.');
      requireThat(change.inputState && change.outputState && !change.idDeleted, 'The failed receipt lost an existing owner field.');
      validateField(change.inputState, descriptor, true); validateField(change.outputState, descriptor, true);
      same(contents(change.outputState), contents(change.inputState), 'The failed action changed an owner field.');
      requireThat(uint(change.outputState.version) >= uint(change.inputState.version) && uint(change.outputState.version) <= uint(version),
        'The failed owner field version is invalid.'); allowed.add(change.address);
    }
  }
  const fees = gasAndBalances(effects, resolved, changes, allowed, version);
  return { action, status: 'failed', digest: actual.digest, cycleDigest: cycle.digest, plantDigest: planting?.digest ?? null,
    seedId: planting?.seedId ?? null, nftId: action === 'plant' ? packet.nftId : planting.nftId,
    packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, seasonId: EXPECTED.seasonId,
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256, checkpoint: effects.checkpoint,
    permitsRetry: care.canAct && care.action === action, currentStatus: care.status, message: effects.executionError.message, ...fees };
}
async function validateConfirmedCare(action, response, expectedDigest, proof, cycle, planting, options) {
  assertCycleReceipt(cycle);
  if (action !== 'plant') assertPlantReceipt(planting, cycle);
  const data = dataOf(response);
  requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true, 'A simulation cannot establish a confirmed care receipt.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint, 'The care receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  same(digest(expectedDigest), actual.digest, 'The requested and actual receipt digests differ.');
  same(await Transaction.from(actual.transactionBcs).getDigest(), expectedDigest, 'The actual bytes do not match the requested digest.');
  checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(actual.effects.checkpoint.sequenceNumber >= cycle.checkpoint.sequenceNumber, 'The care receipt predates its verified rollover.');
  const { transaction: _transaction, ...live } = data;
  const current = await inspectState({ data: live }, proof, options);
  requireThat(current.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber &&
    Date.parse(current.checkpoint.timestamp) >= Date.parse(actual.effects.checkpoint.timestamp),
    'Current state predates the actual care receipt.', 'CONFIRMATION_PENDING');
  if (actual.effects.status === 'FAILURE') {
    let failure;
    try { failure = await verifiedFailure(action, actual, current, cycle, planting, options); }
    catch (cause) { throw new CycleReviewError('TRANSACTION_FAILED', `The indexed care transaction failed; retry remains locked because ${cause.message}`); }
    const error = new CycleReviewError('TRANSACTION_FAILED', failure.message); error.confirmedFailure = freeze(failure); throw error;
  }
  requireThat(actual.effects.status === 'SUCCESS', 'The receipt does not prove successful care.', 'TRANSACTION_FAILED');
  const changes = objectChanges(actual.effects), registryChange = changes.find(x => x.address === EXPECTED.registryId);
  requireThat(registryChange?.inputState, 'The actual care receipt lacks its Registry input.');
  const packet = await receiptPacket(action, actual, cycle, planting);
  const ref = action === 'plant' ? packet.nftReference : packet.seedReference;
  const ownedChange = changes.find(x => x.address === ref.objectId);
  requireThat(ownedChange?.inputState, 'The actual care receipt lacks its reviewed owned input.');
  let unchangedGrowth = null;
  if (action === 'plant') {
    const descriptor = fieldDescriptors(registryChange.inputState, packet.nftId).find(x => x.alias === 'playerGrowth');
    const row = await unchangedPlantGrowth(actual.effects, changes, descriptor, expectedDigest);
    if (row) unchangedGrowth = verifiedUnchangedPlantField(options.unchangedPlantField, row, descriptor);
  }
  if (action !== 'claim') packet.fieldInputs = receiptFieldInputs(action, registryChange.inputState, changes, planting, unchangedGrowth);
  const checked = await validateEffects(actual.effects, packet, { ...current, registry: registryChange.inputState,
    ...(action === 'plant' ? { nfts: [ownedChange.inputState] } : { seed: ownedChange.inputState }) }, cycle, planting, options, actual);
  const currentSeed = current.ownedSeeds.find(x => x.address === checked.seedId);
  const hasAdvanced = [receiptAdvance(current.registry, checked.registryOutput, expectedDigest, 'Registry'),
    receiptAdvance(currentSeed, checked.seedOutput, expectedDigest, 'Season 3 Seed')].some(Boolean);
  if (action === 'plant') {
    const nft = current.nfts.find(x => x.address === checked.nftId);
    if (nft) {
      receiptAdvance(nft, checked.nftOutput, expectedDigest, 'NFTree');
      same(contents(nft), contents(checked.nftOutput), 'The NFTree contents changed after planting.');
    }
    const receipt = freeze(clone({ ...checked, digest: expectedDigest, hasAdvanced }));
    plantReceipts.add(receipt);
    try { inspectCare(current, cycle, receipt, options); }
    catch (cause) { plantReceipts.delete(receipt); throw cause; }
    return receipt;
  }
  const care = inspectCare(current, cycle, planting, options);
  requireThat(care.seedId === checked.seedId && contents(current.registry).current_season_id === EXPECTED.seasonId &&
    contents(current.registry).season_start_ms === cycle.storedStartMs, 'The current season no longer supports this care receipt.');
  if (action === 'water') {
    const progress = seedProgress(currentSeed, cycle, planting, uint(current.clockMs));
    requireThat(progress.points === '24' && progress.s.last_watered_ms === checked.wateredAtMs,
      'Current Seed care contradicts the verified first watering.');
  } else {
    requireThat(care.status === 'claimed', 'The current Seed does not retain the confirmed processed reward.');
    same(contents(currentSeed), contents(checked.seedOutput), 'The processed Seed differs from its claim receipt.');
    same(contents(current.registry).settlement, contents(checked.registryOutput).settlement, 'The finalized payout differs from its claim receipt.');
  }
  return freeze(clone({ ...checked, digest: expectedDigest, hasAdvanced }));
}
export const validateConfirmedPlant = (response, expectedDigest, proof, cycle, options = {}) =>
  validateConfirmedCare('plant', response, expectedDigest, proof, cycle, null, options);
export const validateConfirmedWater = (response, expectedDigest, proof, cycle, planting, options = {}) =>
  validateConfirmedCare('water', response, expectedDigest, proof, cycle, planting, options);
export const validateConfirmedClaim = (response, expectedDigest, proof, cycle, planting, options = {}) =>
  validateConfirmedCare('claim', response, expectedDigest, proof, cycle, planting, options);
