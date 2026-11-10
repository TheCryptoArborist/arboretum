// Pure review of one owner NFTree planting in the already-confirmed v1 season.
// No fetch, storage, DOM, wallet connection, signing or execution belongs here.
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { fromBase58, fromHex, toHex, toBase64 } from '@mysten/bcs';
import { parse, print, stripIgnoredCharacters } from 'graphql';
import { sha256 } from '../settlement-admin/upgrade-core.mjs';
import {
  START_EXPECTED, PROOF_QUERY as START_PROOF_QUERY, PROOF_VARIABLES as START_PROOF_VARIABLES,
  INPUTS_QUERY as START_INPUTS_QUERY, INPUT_VARIABLES as START_INPUT_VARIABLES,
  CONFIRM_QUERY as START_CONFIRM_QUERY, inspectStartState, validateConfirmedStart,
} from '../settlement-season/start-core.mjs';

export class PlantReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'PlantReviewError'; this.code = code; }
}
const requireThat = (value, message, code = 'REVIEW_MISMATCH') => {
  if (!value) throw new PlantReviewError(code, message);
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (actual, expected, message = 'The reviewed values differ.') =>
  requireThat(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), message);
const uint = value => {
  requireThat((typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) ||
    (Number.isSafeInteger(value) && value >= 0), 'Malformed unsigned integer.');
  return BigInt(value);
};
const address = value => { requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Malformed object address.'); return value; };
const amount = value => { requireThat(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value), 'Malformed balance amount.'); return BigInt(value); };
const SUI = '0x' + '0'.repeat(63) + '2';
const SUI_TYPE = `${SUI}::sui::SUI`;
const COIN_TYPE = `${SUI}::coin::Coin<${SUI_TYPE}>`;
export const PLANT_EXPECTED = Object.freeze({
  ...START_EXPECTED,
  startDigest: 'HEKxugzt8jjFK3bVxdxzBDkWaiRwefawMQb9PtuNy9uW',
  actualStartMs: '1793483848277', storedStartMs: '1790978248277', cutoffMs: '1793570248277',
  claimDeadlineMs: '1794175048277', seasonId: '1', inventoryVersion: '1',
  nftType: '0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705::collection::NFT',
  priceMist: '10000000', rewardShareMist: '7000000', treasuryShareMist: '2800000', developerShareMist: '200000',
  treasuryWallet: '0x6f1020c2fd6c91129f7cb5e0d651295e87f7245f96b7d090715c89b38197e77f',
  maxGasMist: '50000000',
});
export const EXPECTED = PLANT_EXPECTED;
const REGISTRY_TYPE = `${EXPECTED.packageId}::settlement::Registry`;
const SEED_TYPE = `${EXPECTED.packageId}::settlement::Seed`;
const EVENT_TYPE = `${EXPECTED.packageId}::settlement::SeedPlanted`;
const TABLE_NAMES = ['seeds_by_owner', 'referrers', 'referral_earnings', 'player_growth', 'player_growth_season', 'planted_saplings'];
export const contents = object => object?.asMoveObject?.contents?.json;
const typeOf = object => object?.asMoveObject?.contents?.type?.repr;
const normalizedType = value => String(value ?? '').replace(/\s+/g, '');
export function reference(object) {
  requireThat(fromBase58(object?.digest ?? '').length === 32, 'Malformed object digest.');
  return { objectId: address(object.address), version: String(uint(object.version)), digest: object.digest };
}
const complete = (value, label) => {
  requireThat(Array.isArray(value?.nodes) && value.pageInfo?.hasNextPage === false, `Incomplete ${label}.`);
  requireThat(new Set(value.nodes.map(x => x.address)).size === value.nodes.length, `Duplicate ${label}.`);
  return value.nodes;
};
const dataOf = response => {
  requireThat(!(response?.response && response?.data), 'Ambiguous wrapped and unwrapped response.');
  const raw = response?.response ?? response;
  requireThat(raw?.data && !raw.errors?.length, 'Incomplete or failed GraphQL response.');
  return raw.data;
};
const owner = (object, expected = EXPECTED.sender) => same(object?.owner,
  { __typename: 'AddressOwner', address: { address: expected } }, 'The object owner differs from the reviewed recipient.');
function checkpoint(value, options = {}, fresh = true) {
  requireThat(Number.isSafeInteger(value?.sequenceNumber) && value.sequenceNumber > 0 && Number.isFinite(Date.parse(value.timestamp)),
    'A confirmed blockchain checkpoint is required.', 'CONFIRMATION_PENDING');
  if (fresh) {
    const now = options.now ?? Date.now(), time = Date.parse(value.timestamp);
    requireThat(Number.isFinite(now) && time <= now + 30000 && now - time <= EXPECTED.maxAgeMs,
      'The chain review is stale. Refresh before continuing.', 'STALE_REVIEW');
  }
  return value;
}
function verifyClock(object, options = {}, historical = false) {
  reference(object); same(object.address, EXPECTED.clockId, 'Wrong Clock object.');
  same(typeOf(object), `${SUI}::clock::Clock`, 'Wrong Clock type.');
  same(object.owner, { __typename: 'Shared', initialSharedVersion: 1 }, 'Wrong Clock ownership.');
  const value = contents(object); same(Object.keys(value).sort(), ['id', 'timestamp_ms'], 'Wrong Clock fields.');
  same(value.id, EXPECTED.clockId); const time = uint(value.timestamp_ms), now = BigInt(options.now ?? Date.now());
  if (!historical) requireThat(time <= now + 30000n && now - time <= BigInt(EXPECTED.maxAgeMs), 'Stale execution Clock.');
  return time;
}
export function assertExpectedOrigin(origin) {
  requireThat(origin === EXPECTED.origin, 'Review this planting only at https://www.treegrow.xyz.', 'WRONG_ORIGIN');
}
export function assertAdministrator(account, chain = EXPECTED.chain) {
  requireThat(chain === EXPECTED.chain, 'Select Sui mainnet.', 'WRONG_NETWORK');
  requireThat(account === EXPECTED.sender, 'Select the administrator account shown in this review.', 'WRONG_ACCOUNT');
}

const startProofDefinition = parse(START_PROOF_QUERY).definitions[0];
const startInputDefinition = parse(START_INPUTS_QUERY).definitions[0];
// These authority objects are checked by exact owner/type/reference/content.
// Their optional previous-transaction display fields are not needed here.
for (const field of startInputDefinition.selectionSet.selections) {
  if (['upgradeCap', 'legacyAdminCap', 'registry'].includes(field.alias?.value ?? field.name.value))
    field.selectionSet.selections = field.selectionSet.selections.filter(x => x.name.value !== 'previousTransaction');
}
const startConfirmDefinition = parse(START_CONFIRM_QUERY).definitions[0];
const fields = definition => definition.selectionSet.selections.map(print).join('\n');
const variables = definition => definition.variableDefinitions.map(print).join(', ');
const startTransactionField = structuredClone(startConfirmDefinition.selectionSet.selections.find(x => x.name.value === 'transaction'));
startTransactionField.alias = { kind: 'Name', value: 'startTransaction' };
startTransactionField.arguments[0].value = { kind: 'StringValue', value: EXPECTED.startDigest, block: false };
const OBJECT_FIELDS = `address version digest owner { __typename
  ... on AddressOwner { address { address } } ... on ObjectOwner { address { address } }
  ... on Shared { initialSharedVersion } } asMoveObject { contents { type { repr } json } }`;
const CURRENT_OBJECT = `${OBJECT_FIELDS} previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } }`;
const OWNED_OBJECT = `address version digest owner { __typename ... on AddressOwner { address { address } } }
  asMoveObject { contents { type { repr } json } }`;
const INVENTORY_FIELDS = `ownedNFTs: objects(first: 50, filter: { owner: "${EXPECTED.sender}", type: "${EXPECTED.nftType}" }) {
  nodes { ${OWNED_OBJECT} } pageInfo { hasNextPage endCursor } }
  ownedSeeds: objects(first: 50, filter: { owner: "${EXPECTED.sender}", type: "${SEED_TYPE}" }) {
  nodes { ${OWNED_OBJECT} previousTransaction { digest effects { status checkpoint { sequenceNumber timestamp } } } }
  pageInfo { hasNextPage endCursor } }`;
const EFFECT_FIELDS = `status executionError { message } checkpoint { sequenceNumber timestamp } epoch { epochId } lamportVersion
  transaction { transactionBcs sender { address } }
  gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
  balanceChangesJson objectChanges(first: 50) { nodes { address idCreated idDeleted
    inputState { ${OBJECT_FIELDS} } outputState { ${OBJECT_FIELDS} }
  } pageInfo { hasNextPage endCursor } }
  events(first: 10) { nodes { sender { address } contents { type { repr } json } } pageInfo { hasNextPage endCursor } }
  unchangedConsensusObjects(first: 10) { nodes { __typename ... on ConsensusObjectRead { object { ${OBJECT_FIELDS} } } }
    pageInfo { hasNextPage endCursor } }`;
export const PROOF_QUERY = stripIgnoredCharacters(`query OwnerPlantProof(${variables(startProofDefinition)}) {
  ${fields(startProofDefinition)} ${print(startTransactionField)} }`);
export const PROOF_VARIABLES = START_PROOF_VARIABLES;
export const INPUTS_QUERY = stripIgnoredCharacters(`query OwnerPlantInputs(${variables(startInputDefinition)}) {
  ${fields(startInputDefinition)} ${INVENTORY_FIELDS} }`);
export const INPUT_VARIABLES = START_INPUT_VARIABLES;
export const SIMULATION_QUERY = stripIgnoredCharacters(`query OwnerPlantSimulation($transaction: JSON!, ${variables(startInputDefinition)}) {
  ${fields(startInputDefinition)} ${INVENTORY_FIELDS}
  simulateTransaction(transaction: $transaction, checksEnabled: true, doGasSelection: true) { effects { ${EFFECT_FIELDS} } } }`);
export const CONFIRM_QUERY = stripIgnoredCharacters(`query OwnerPlantConfirmation($digest: String!, ${variables(startInputDefinition)}) {
  ${fields(startInputDefinition)} ${INVENTORY_FIELDS}
  transaction(digest: $digest) { digest sender { address } transactionBcs effects { ${EFFECT_FIELDS} } } }`);
export const CONFIRM_VARIABLES = INPUT_VARIABLES;
export const NFT_PAGE_QUERY = stripIgnoredCharacters(`query OwnerPlantNFTPage($checkpoint: UInt53!, $after: String!) {
  genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest }
  checkpoint(sequenceNumber: $checkpoint) { sequenceNumber query {
    ownedNFTs: objects(first: 50, after: $after, filter: { owner: "${EXPECTED.sender}", type: "${EXPECTED.nftType}" }) {
      nodes { ${OWNED_OBJECT} } pageInfo { hasNextPage endCursor } }
  } }
}`);
export function nextNFTPageVariables(response) {
  const data = dataOf(response), inventory = data.ownedNFTs;
  requireThat(Array.isArray(inventory?.nodes) && typeof inventory.pageInfo?.hasNextPage === 'boolean', 'The NFTree inventory is missing.');
  if (!inventory.pageInfo.hasNextPage) return null;
  requireThat(inventory.nodes.length < 5000 && typeof inventory.pageInfo.endCursor === 'string' && inventory.pageInfo.endCursor.length > 0,
    'The NFTree inventory exceeds the supported complete review or has an invalid cursor.');
  checkpoint(data.checkpoint, {}, false);
  return { checkpoint: data.checkpoint.sequenceNumber, after: inventory.pageInfo.endCursor };
}
export function appendNFTPage(response, pageResponse) {
  const request = nextNFTPageVariables(response); requireThat(request, 'The NFTree inventory is already complete.');
  const data = dataOf(response), page = dataOf(pageResponse);
  same(page.genesis, data.genesis, 'NFTree page identifies another network.');
  same(page.checkpoint?.sequenceNumber, request.checkpoint, 'NFTree inventory page changed checkpoint.');
  const inventory = page.checkpoint?.query?.ownedNFTs;
  requireThat(Array.isArray(inventory?.nodes) && typeof inventory.pageInfo?.hasNextPage === 'boolean', 'Incomplete NFTree page.');
  requireThat(inventory.nodes.length > 0 && inventory.nodes.length <= 50, 'NFTree pagination did not advance.');
  const all = [...data.ownedNFTs.nodes, ...inventory.nodes];
  requireThat(all.length <= 5000 && new Set(all.map(x => x.address)).size === all.length, 'Duplicate or oversized NFTree inventory.');
  const cursors = data.nftPageCursors ?? [];
  requireThat(!cursors.includes(request.after), 'NFTree pagination repeated a cursor.');
  if (inventory.pageInfo.hasNextPage) requireThat(inventory.pageInfo.endCursor !== request.after &&
    !cursors.includes(inventory.pageInfo.endCursor), 'NFTree pagination did not advance.');
  const merged = structuredClone(response);
  const target = merged.response?.data ?? merged.data;
  target.ownedNFTs = { nodes: all, pageInfo: structuredClone(inventory.pageInfo) };
  target.nftPageCursors = [...cursors, request.after];
  return merged;
}

function peelProof(response) {
  const data = dataOf(response); requireThat(!data.simulateTransaction, 'Simulation cannot establish the season proof.');
  const { startTransaction, ...setup } = data;
  requireThat(startTransaction?.digest === EXPECTED.startDigest, 'The confirmed first-season proof is missing.');
  return { setup: { data: setup }, startTransaction };
}
function validateNft(object) {
  reference(object); owner(object); same(typeOf(object), EXPECTED.nftType, 'Select an NFT from the exact NFTree collection.');
  requireThat(contents(object) && typeof contents(object) === 'object' && contents(object).id === object.address, 'Incomplete NFTree contents.');
  return object;
}
function validateSeedIdentity(object) {
  reference(object); owner(object); same(typeOf(object), SEED_TYPE, 'Unexpected Seed type.');
  const seed = contents(object);
  requireThat(seed?.id === object.address && seed.version === '1' && seed.registry_id === EXPECTED.registryId && seed.owner === EXPECTED.sender,
    'The owned Seed has a different Registry, version or owner.');
  return object;
}
export async function inspectPlantState(response, proofResponse, options = {}) {
  const live = dataOf(response), { setup, startTransaction } = peelProof(proofResponse);
  requireThat(!live.transaction && !live.simulateTransaction && !live.startTransaction, 'Live state and receipt proof must remain separate.');
  const base = await inspectStartState({ data: live }, setup, options);
  const confirmedStart = await validateConfirmedStart({ data: { ...live, transaction: startTransaction } }, EXPECTED.startDigest, setup, options);
  same([confirmedStart.actualStartMs, confirmedStart.storedStartMs, confirmedStart.cutoffMs, confirmedStart.seasonId],
    [EXPECTED.actualStartMs, EXPECTED.storedStartMs, EXPECTED.cutoffMs, '1'], 'The confirmed season schedule differs.');
  const nfts = complete(live.ownedNFTs, 'owned NFTree inventory').map(validateNft);
  const seeds = complete(live.ownedSeeds, 'owned Seed inventory').map(validateSeedIdentity);
  const ownedNFTs = nfts.map(nft => ({ ...reference(nft), objectType: EXPECTED.nftType,
    name: typeof contents(nft).name === 'string' ? contents(nft).name : 'NFTree ' + nft.address.slice(0, 10) }));
  const state = contents(base.registry), clockMs = uint(base.clockMs);
  const result = { ...base, confirmedStart, nfts, ownedNFTs, ownedSeeds: seeds, firstSeed: seeds[0] ?? null,
    digestCandidate: seeds[0]?.previousTransaction?.digest ?? base.registry.previousTransaction?.digest ?? null };
  if (seeds.length || uint(state.total_seeds) > 0n || uint(state.current_season_id) > 1n ||
    TABLE_NAMES.some(name => uint(state[name].size) > 0n)) return { ...result, status: 'already-planted' };
  if (state.current_season_id !== '1' || state.season_start_ms !== EXPECTED.storedStartMs || clockMs >= uint(EXPECTED.cutoffMs))
    return { ...result, status: 'closed' };
  const startOutput = complete(startTransaction.effects.objectChanges, 'first-start changes').find(x => x.address === EXPECTED.registryId)?.outputState;
  same(contents(base.registry), contents(startOutput), 'The first-plant Registry is no longer the exact empty started state.');
  requireThat(state.paused === false && state.reward_pool === '0' && state.treasury === '0' && seeds.length === 0,
    'The first-plant state has changed.', 'PLANT_STATE_CHANGED');
  requireThat(clockMs >= uint(EXPECTED.actualStartMs), 'The current Clock predates Season 1.');
  return { ...result, status: 'ready', digestCandidate: null };
}
export async function validateInputs(response, proofResponse, options = {}) {
  const state = await inspectPlantState(response, proofResponse, options);
  requireThat(state.status === 'ready', state.status === 'already-planted'
    ? 'The first planting is already recorded. Verify its receipt.' : 'The first test growing period is closed.',
  state.status === 'already-planted' ? 'ALREADY_PLANTED' : 'SEASON_CLOSED');
  return state;
}
function transactionFor(nft) {
  const tx = new Transaction(); tx.setSender(EXPECTED.sender);
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(EXPECTED.priceMist)]);
  tx.moveCall({ target: `${EXPECTED.packageId}::settlement::plant_seed_with_nftree`, typeArguments: [EXPECTED.nftType], arguments: [
    tx.sharedObjectRef({ objectId: EXPECTED.registryId, initialSharedVersion: EXPECTED.registryInitialSharedVersion, mutable: true }),
    tx.objectRef(nft), payment, tx.pure.option('address', null),
    tx.sharedObjectRef({ objectId: EXPECTED.clockId, initialSharedVersion: '1', mutable: false }),
  ] });
  return tx;
}
function simulationFor(nft) {
  return { version: 1, sender: EXPECTED.sender, gasPayment: { owner: EXPECTED.sender }, kind: { programmableTransaction: {
    inputs: [
      { kind: 'PURE', pure: bcs.u64().serialize(EXPECTED.priceMist).toBase64() },
      { kind: 'SHARED', objectId: EXPECTED.registryId, version: EXPECTED.registryInitialSharedVersion, mutable: true },
      { kind: 'IMMUTABLE_OR_OWNED', ...nft },
      { kind: 'PURE', pure: bcs.option(bcs.Address).serialize(null).toBase64() },
      { kind: 'SHARED', objectId: EXPECTED.clockId, version: '1', mutable: false },
    ], commands: [
      { splitCoins: { coin: { kind: 'GAS' }, amounts: [{ kind: 'INPUT', input: 0 }] } },
      { moveCall: { package: EXPECTED.packageId, module: 'settlement', function: 'plant_seed_with_nftree', typeArguments: [EXPECTED.nftType],
        arguments: [{ kind: 'INPUT', input: 1 }, { kind: 'INPUT', input: 2 }, { kind: 'RESULT', result: 0, subresult: 0 },
          { kind: 'INPUT', input: 3 }, { kind: 'INPUT', input: 4 }] } },
    ],
  } } };
}
export async function buildReviewedPlant(selectedNftId, state) {
  requireThat(state?.status === 'ready', 'Refresh the empty first-plant state before selecting an NFTree.');
  address(selectedNftId);
  const selected = state.nfts?.find(x => x.address === selectedNftId); requireThat(selected, 'Select one verified owned NFTree.');
  validateNft(selected); const nftReference = reference(selected), transaction = transactionFor(nftReference);
  const bytes = await transaction.build({ onlyTransactionKind: true });
  return { transaction, simulationTransaction: simulationFor(nftReference), kindBase64: toBase64(bytes),
    kindSha256: await sha256(bytes), nftId: selectedNftId, nftReference };
}
export async function validateWalletTransaction(transaction, packet) {
  requireThat(transaction instanceof Transaction && packet?.nftReference, 'A reviewed Sui planting Transaction is required.');
  const data = transaction.getData(); assertAdministrator(data.sender);
  requireThat(data.expiration === null && Object.values(data.gasData).every(x => x === null), 'Final gas and expiration must be selected by the wallet.');
  const expected = await transactionFor(packet.nftReference).build({ onlyTransactionKind: true });
  same(toBase64(await transaction.build({ onlyTransactionKind: true })), toBase64(expected), 'The wallet transaction differs from the exact single planting.');
  same(packet.kindBase64, toBase64(expected), 'The reviewed planting packet differs.');
  same(packet.kindSha256, await sha256(expected), 'The reviewed planting hash differs.');
  same(packet.nftId, packet.nftReference.objectId, 'The selected NFTree identity differs.');
  return true;
}
function sameLiveInputs(current, previous, nftId) {
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']) {
    same(reference(current[name]), reference(previous[name]), `${name} changed before simulation.`);
    same(contents(current[name]), contents(previous[name]), `${name} contents changed.`);
    same(current[name].owner, previous[name].owner, `${name} owner changed.`);
  }
  const a = current.nfts.find(x => x.address === nftId), b = previous.nfts.find(x => x.address === nftId);
  requireThat(a && b, 'The selected NFTree is no longer owned by this account.');
  same(reference(a), reference(b), 'The selected NFTree reference changed.'); same(contents(a), contents(b), 'NFTree contents changed.');
}
export async function validateSimulation(response, packet, previous, proofResponse, options = {}) {
  const data = dataOf(response); requireThat(data.simulateTransaction && !data.transaction, 'Expected checked simulation data only.');
  const { simulateTransaction, ...live } = data;
  const current = await validateInputs({ data: live }, proofResponse, options);
  requireThat(current.checkpoint.sequenceNumber >= previous.checkpoint.sequenceNumber, 'Simulation checkpoint moved backwards.');
  sameLiveInputs(current, previous, packet.nftId); await validateWalletTransaction(packet.transaction, packet);
  same(packet.simulationTransaction, simulationFor(packet.nftReference), 'The simulation proposal differs from the reviewed planting.');
  const result = await validateEffects(simulateTransaction.effects, packet, current, options);
  requireThat(uint(result.gasEstimateMist) <= uint(EXPECTED.maxGasMist), 'The estimate exceeds the 0.05 SUI gas review ceiling.', 'GAS_INCREASED');
  return result;
}

function validateExpiration(data, effects, actual) {
  const expiry = data.expiration, kind = expiry?.$kind, epoch = uint(effects.epoch?.epochId);
  if (kind === 'ValidDuring') {
    const v = expiry.ValidDuring, min = uint(v.minEpoch), max = uint(v.maxEpoch);
    requireThat(max === min + 1n && (actual ? min <= epoch && epoch <= max : min === epoch), 'Invalid mainnet expiration window.');
    same(v.chain, EXPECTED.genesisDigest, 'Wrong expiration chain.'); same(v.minTimestamp, null); same(v.maxTimestamp, null);
    requireThat(Number.isInteger(v.nonce) && v.nonce >= 0 && v.nonce <= 0xffffffff, 'Invalid transaction nonce.');
  } else if (actual && kind === 'Epoch') requireThat(uint(expiry.Epoch) >= epoch, 'The confirmed transaction expired before execution.');
  else requireThat(expiry === null || (actual && kind === 'None'), 'Unexpected transaction expiration.');
}
// The locked Sui SDK's coin-reservation format (utils/coin-reservation.ts).
// A version-zero gas reference represents an address-balance reservation, not
// an owned Coin input; it therefore has no ordinary object-change entry.
function virtualGasReference(payment, index, data) {
  if (uint(payment.version) !== 0n) return false;
  requireThat(index === 0 && data.expiration?.$kind === 'ValidDuring', 'A virtual gas reservation must be first and mainnet-bound.');
  const bytes = fromBase58(payment.digest); requireThat(bytes.length === 32 && bytes.slice(12).every(x => x === 0xac), 'Invalid virtual gas reservation digest.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireThat(view.getBigUint64(0, true) > 0n && BigInt(view.getUint32(8, true)) === uint(data.expiration.ValidDuring.minEpoch),
    'The virtual gas reservation amount or epoch differs.');
  const accumulator = deriveDynamicFieldID('0x' + '0'.repeat(61) + 'acc',
    TypeTagSerializer.parseFromStr('0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>'), bcs.Address.serialize(EXPECTED.sender).toBytes());
  const ownerId = fromHex(accumulator.slice(2)), chain = fromBase58(EXPECTED.genesisDigest);
  same(payment.objectId, '0x' + toHex(ownerId.map((value, i) => value ^ chain[i])), 'Virtual gas reservation belongs to another owner or network.');
  return true;
}
async function validateEffects(effects, packet, current, options = {}, actual = null) {
  requireThat(effects?.status === 'SUCCESS', effects?.executionError?.message ?? 'The planting transaction failed.', 'TRANSACTION_FAILED');
  same(effects.executionError, null);
  if (actual) checkpoint(effects.checkpoint, {}, false); else same(effects.checkpoint, null, 'Simulation cannot be a confirmed receipt.');
  const bytes = actual?.transactionBcs ?? effects.transaction?.transactionBcs;
  const tx = Transaction.from(bytes), data = tx.getData();
  same(data.sender, EXPECTED.sender, 'Wrong planting sender.'); same(data.gasData.owner, EXPECTED.sender, 'Wrong gas owner.');
  same((actual ?? effects.transaction)?.sender?.address, EXPECTED.sender, 'Wrong receipt sender.');
  if (actual) same(effects.transaction?.transactionBcs, bytes, 'Effects and receipt transaction bytes differ.');
  same(toBase64(await tx.build({ onlyTransactionKind: true })), packet.kindBase64, 'Resolved planting commands differ.');
  const gasBudget = uint(data.gasData.budget), gasPrice = uint(data.gasData.price);
  requireThat(gasBudget > 0n && gasPrice > 0n, 'Invalid gas budget or price.'); validateExpiration(data, effects, Boolean(actual));
  const payments = data.gasData.payment; requireThat(Array.isArray(payments), 'Missing gas-payment inventory.');
  if (!payments.length) requireThat(data.expiration?.$kind === 'ValidDuring', 'Address-balance gas requires mainnet-bound expiration.');
  requireThat(new Set(payments.map(x => address(x.objectId))).size === payments.length, 'Duplicate gas references.');
  const reservations = payments.filter((x, index) => virtualGasReference(x, index, data));
  const ordinaryPayments = payments.filter(x => uint(x.version) > 0n);
  const paymentMap = new Map(ordinaryPayments.map(x => [address(x.objectId), x]));
  requireThat(!payments.some(x => [EXPECTED.registryId, EXPECTED.clockId, packet.nftId].includes(x.objectId)), 'A protocol object cannot be a gas coin.');
  const unchanged = complete(effects.unchangedConsensusObjects, 'unchanged consensus objects');
  requireThat(unchanged.length === 1 && unchanged[0].__typename === 'ConsensusObjectRead', 'Only the read-only Clock consensus input is expected.');
  const executionClock = unchanged[0].object, planted = verifyClock(executionClock, options, Boolean(actual));
  requireThat(planted >= uint(EXPECTED.actualStartMs) && planted < uint(EXPECTED.cutoffMs), 'Planting is outside Season 1 growing time.');
  if (actual) requireThat(BigInt(Date.parse(effects.checkpoint.timestamp)) >= planted, 'Receipt checkpoint predates execution.');
  const changes = complete(effects.objectChanges, 'planting object changes');
  requireThat(reservations.every(payment => !changes.some(x => x.address === payment.objectId)), 'Virtual gas reservation must not masquerade as a real coin change.');
  for (const x of changes) {
    address(x.address); requireThat(typeof x.idCreated === 'boolean' && typeof x.idDeleted === 'boolean', 'Missing object-change flags.');
    if (x.inputState) same(x.inputState.address, x.address, 'Input-state address differs from its object-change identity.');
    if (x.outputState) same(x.outputState.address, x.address, 'Output-state address differs from its object-change identity.');
  }
  const registryChange = changes.find(x => x.address === EXPECTED.registryId), nftChange = changes.find(x => x.address === packet.nftId);
  requireThat(registryChange && nftChange, 'The Registry or NFTree input is missing from effects.');
  const nftInput = current.nfts.find(x => x.address === packet.nftId); requireThat(nftInput, 'The reviewed NFTree input is missing.');
  const version = String(uint(effects.lamportVersion));
  const inputVersions = [current.registry.version, nftInput.version, executionClock.version, ...payments.map(x => x.version)].map(uint);
  requireThat(uint(version) === inputVersions.reduce((a, b) => a > b ? a : b, 0n) + 1n, 'Output version differs from actual input Lamport version.');
  for (const [change, input] of [[registryChange, current.registry], [nftChange, nftInput]]) {
    requireThat(!change.idCreated && !change.idDeleted && change.inputState && change.outputState, 'A reviewed input was created or deleted.');
    same(reference(change.inputState), reference(input), 'A different object input was consumed.');
    same(contents(change.inputState), contents(input), 'An input object content changed.'); same(change.inputState.owner, input.owner, 'Input owner differs.');
    same(typeOf(change.inputState), typeOf(input), 'Input type differs.'); same(typeOf(change.outputState), typeOf(input), 'Output type differs.');
    same(change.outputState.address, input.address); same(change.outputState.owner, input.owner, 'An input object was transferred.');
    same(reference(change.outputState).version, version, 'Wrong output version.');
  }
  validateNft(nftChange.inputState); validateNft(nftChange.outputState);
  same(contents(nftChange.outputState), contents(nftInput), 'The selected NFTree was modified.');
  const inputRegistry = contents(current.registry);
  same(typeOf(current.registry), REGISTRY_TYPE); same(inputRegistry.version, '1'); same(inputRegistry.current_season_id, '1');
  same(inputRegistry.season_start_ms, EXPECTED.storedStartMs); same(inputRegistry.paused, false);
  for (const name of ['reward_pool', 'treasury', 'total_seeds', 'total_growth_points', 'eligible_growth_points']) same(inputRegistry[name], '0', 'The first planting requires an empty started Registry.');
  for (const name of TABLE_NAMES) same(inputRegistry[name].size, '0', 'The first planting requires empty Registry tables.');
  same(inputRegistry.settlement, null, 'A settled Registry cannot accept the first planting.');
  const seedChanges = changes.filter(x => typeOf(x.outputState) === SEED_TYPE);
  requireThat(seedChanges.length === 1 && seedChanges[0].idCreated && !seedChanges[0].idDeleted && seedChanges[0].inputState === null,
    'Exactly one fresh Seed must be created.');
  const seedObject = seedChanges[0].outputState, seedId = address(seedObject.address);
  same(reference(seedObject).version, version); owner(seedObject);
  same(contents(seedObject), { id: seedId, version: '1', registry_id: EXPECTED.registryId, cutoff_growth_points: '10', reward_processed: false,
    sapling_id: packet.nftId, season_id: '1', owner: EXPECTED.sender, planted_at_ms: String(planted), last_watered_ms: String(planted),
    watering_streak: '1', growth_points: '10', state: 0, fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0,
    bottomless_can_expiry_ms: '0', permanent_gp_bonus: '0' }, 'Created Seed fields differ from one fresh planting.');
  const expectedRegistry = structuredClone(inputRegistry);
  Object.assign(expectedRegistry, { reward_pool: EXPECTED.rewardShareMist, total_seeds: '1', total_growth_points: '10', eligible_growth_points: '10' });
  for (const name of ['seeds_by_owner', 'player_growth', 'player_growth_season', 'planted_saplings']) expectedRegistry[name].size = '1';
  same(contents(registryChange.outputState), expectedRegistry, 'Unexpected Registry changes during planting.');
  const fieldsToVerify = [
    ['seeds_by_owner', 'address', `vector<${SUI}::object::ID>`, EXPECTED.sender, [seedId]],
    ['player_growth', 'address', 'u64', EXPECTED.sender, '10'],
    ['player_growth_season', 'address', 'u64', EXPECTED.sender, '1'],
    ['planted_saplings', `${SUI}::object::ID`, 'u64', packet.nftId, '1'],
  ];
  const allowed = new Set([EXPECTED.registryId, packet.nftId, seedId]);
  for (const [table, keyType, valueType, name, value] of fieldsToVerify) {
    const matches = changes.filter(x => normalizedType(typeOf(x.outputState)) === normalizedType(`${SUI}::dynamic_field::Field<${keyType}, ${valueType}>`) &&
      x.outputState?.owner?.__typename === 'ObjectOwner' && x.outputState.owner.address?.address === inputRegistry[table].id);
    requireThat(matches.length === 1, `The ${table} record was not created exactly once.`);
    const x = matches[0]; requireThat(x.idCreated && !x.idDeleted && x.inputState === null, `The ${table} record is not new.`);
    same(x.address, deriveDynamicFieldID(inputRegistry[table].id, TypeTagSerializer.parseFromStr(keyType), bcs.Address.serialize(name).toBytes()),
      `The ${table} dynamic-field ID is not derived from its actual parent and key.`);
    same(reference(x.outputState).version, version); same(contents(x.outputState), { id: x.address, name, value }, `Wrong ${table} value.`);
    allowed.add(x.address);
  }
  let treasuryCoins = 0n, developerCoins = 0n;
  for (const x of changes.filter(x => !allowed.has(x.address))) {
    const payment = paymentMap.get(x.address);
    if (payment) {
      requireThat(!x.idCreated && x.inputState, 'Gas input change is malformed.');
      same(reference(x.inputState), { ...payment, version: String(payment.version) }); owner(x.inputState); same(typeOf(x.inputState), COIN_TYPE);
      if (x.idDeleted) same(x.outputState, null); else { owner(x.outputState); same(typeOf(x.outputState), COIN_TYPE); same(reference(x.outputState).version, version); }
    } else {
      requireThat(x.idCreated && !x.idDeleted && x.inputState === null && typeOf(x.outputState) === COIN_TYPE,
        'Unexpected object change outside the one planting and gas.');
      same(reference(x.outputState).version, version); const coin = contents(x.outputState);
      same(Object.keys(coin).sort(), ['balance', 'id']); same(coin.id, x.address);
      const recipient = x.outputState.owner?.address?.address;
      if (recipient === EXPECTED.treasuryWallet) { owner(x.outputState, EXPECTED.treasuryWallet); treasuryCoins += uint(coin.balance); }
      else { owner(x.outputState); developerCoins += uint(coin.balance); }
    }
  }
  same(String(treasuryCoins), EXPECTED.treasuryShareMist, 'The treasury transfer differs.');
  same(String(developerCoins), EXPECTED.developerShareMist, 'The developer transfer differs.');
  for (const payment of ordinaryPayments) requireThat(changes.some(x => x.address === payment.objectId), 'A selected gas input is missing from effects.');
  const events = complete(effects.events, 'planting events');
  same(events, [{ sender: { address: EXPECTED.sender }, contents: { type: { repr: EVENT_TYPE },
    json: { seed_id: seedId, owner: EXPECTED.sender, sapling_id: packet.nftId } } }], 'Unexpected planting event.');
  const gas = effects.gasEffects?.gasSummary;
  const net = uint(gas?.computationCost) + uint(gas?.storageCost) - uint(gas?.storageRebate); uint(gas?.nonRefundableStorageFee);
  requireThat(net > 0n && net <= gasBudget, 'Invalid actual gas amount.');
  const balances = effects.balanceChangesJson;
  requireThat(Array.isArray(balances) && balances.length === 2, 'Unexpected balance-change inventory.');
  const balancesMap = new Map();
  for (const x of balances) { address(x.address); same(x.coinType, SUI_TYPE, 'Only SUI can move.'); requireThat(!balancesMap.has(x.address), 'Duplicate balance recipient.'); balancesMap.set(x.address, amount(x.amount)); }
  same(String(balancesMap.get(EXPECTED.sender)), String(-uint(EXPECTED.priceMist) + uint(EXPECTED.developerShareMist) - net), 'The administrator debit differs from price less developer return plus gas.');
  same(String(balancesMap.get(EXPECTED.treasuryWallet)), EXPECTED.treasuryShareMist, 'Unexpected treasury balance change.');
  const waterReady = planted + uint(EXPECTED.wateringIntervalMs);
  return { status: actual ? 'confirmed' : 'simulated', checkpoint: actual ? effects.checkpoint : current.checkpoint,
    packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, seasonId: '1', inventoryVersion: '1', nftId: packet.nftId,
    seedId, growthPoints: '10', plantedAtMs: String(planted), waterReadyMs: String(waterReady), cutoffMs: EXPECTED.cutoffMs,
    canWaterBeforeCutoff: waterReady < uint(EXPECTED.cutoffMs), claimDeadlineMs: EXPECTED.claimDeadlineMs,
    priceMist: EXPECTED.priceMist, rewardShareMist: EXPECTED.rewardShareMist, treasuryShareMist: EXPECTED.treasuryShareMist,
    developerShareMist: EXPECTED.developerShareMist, gasEstimateMist: String(net),
    gasEstimateSui: `${net / 1000000000n}.${String(net % 1000000000n).padStart(9, '0')}`,
    kindSha256: packet.kindSha256, exactKindSha256: packet.kindSha256, executionClock: reference(executionClock),
    resolvedGasBudgetMist: String(gasBudget), resolvedGasPriceMist: String(gasPrice), resolvedGasPayments: payments.length,
    virtualGasReservations: reservations.length,
    note: actual ? 'Actual first planting confirmed; the price includes 0.007 SUI routed to the test reward pool.' : 'Unsigned prediction only. No wallet, signature, payment or planting occurred.' };
}
export async function validateConfirmedPlant(response, expectedDigest, proofResponse, options = {}) {
  const data = dataOf(response); requireThat(!data.simulateTransaction && response?.simulatedIdsAreNotDeployedIds !== true &&
    response?.response?.simulatedIdsAreNotDeployedIds !== true, 'Simulation cannot establish a confirmed planting.', 'CONFIRMATION_MISMATCH');
  const actual = data.transaction;
  requireThat(actual?.transactionBcs && actual.effects?.checkpoint, 'The planting receipt is not yet indexed.', 'CONFIRMATION_PENDING');
  checkpoint(data.checkpoint, options); checkpoint(actual.effects.checkpoint, {}, false);
  requireThat(data.checkpoint.sequenceNumber >= actual.effects.checkpoint.sequenceNumber, 'Current observation predates the receipt.', 'CONFIRMATION_PENDING');
  requireThat(typeof expectedDigest === 'string' && fromBase58(expectedDigest).length === 32 && actual.digest === expectedDigest,
    'The receipt digest differs.', 'CONFIRMATION_MISMATCH');
  const tx = Transaction.from(actual.transactionBcs); requireThat(await tx.getDigest() === expectedDigest, 'Transaction bytes do not match the digest.', 'CONFIRMATION_MISMATCH');
  const { transaction: ignored, ...live } = data;
  const current = await inspectPlantState({ data: live }, proofResponse, options);
  const changes = complete(actual.effects.objectChanges, 'confirmed planting changes');
  const registryChange = changes.find(x => x.address === EXPECTED.registryId);
  requireThat(registryChange?.inputState, 'The receipt lacks its Registry input.');
  const nftChanges = changes.filter(x => typeOf(x.inputState) === EXPECTED.nftType);
  requireThat(nftChanges.length === 1, 'The receipt must reference exactly one NFTree.');
  const nft = validateNft(nftChanges[0].inputState), nftReference = reference(nft);
  const expected = transactionFor(nftReference), kind = await expected.build({ onlyTransactionKind: true });
  same(toBase64(await tx.build({ onlyTransactionKind: true })), toBase64(kind), 'The receipt is not the exact single NFTree planting.');
  const packet = { transaction: expected, nftId: nft.address, nftReference, kindBase64: toBase64(kind), kindSha256: await sha256(kind) };
  const { startTransaction } = peelProof(proofResponse);
  const startOutput = complete(startTransaction.effects.objectChanges, 'confirmed start changes').find(x => x.address === EXPECTED.registryId)?.outputState;
  same(contents(registryChange.inputState), contents(startOutput), 'The receipt input was not the empty started test Registry.');
  same(registryChange.inputState.owner, startOutput.owner, 'Receipt Registry ownership differs.');
  requireThat(uint(registryChange.inputState.version) >= uint(startOutput.version), 'Planting predates the confirmed start.');
  if (uint(registryChange.inputState.version) === uint(startOutput.version)) same(reference(registryChange.inputState), reference(startOutput));
  requireThat(actual.effects.checkpoint.sequenceNumber >= startTransaction.effects.checkpoint.sequenceNumber, 'Receipt checkpoint predates the confirmed start.');
  const checked = await validateEffects(actual.effects, packet, { registry: registryChange.inputState, nfts: [nft] }, options, actual);
  const output = registryChange.outputState;
  requireThat(uint(current.registry.version) >= uint(output.version), 'Current Registry predates the confirmed planting.', 'CONFIRMATION_PENDING');
  if (uint(current.registry.version) === uint(output.version)) { same(reference(current.registry), reference(output)); same(contents(current.registry), contents(output)); }
  same(current.registry.owner, output.owner, 'Current Registry ownership differs.');
  const currentSeed = current.ownedSeeds.find(x => x.address === checked.seedId);
  if (!currentSeed) requireThat(uint(current.registry.version) > uint(output.version),
    'The same-version Registry is missing its newly planted Seed.', 'CONFIRMATION_MISMATCH');
  if (currentSeed) {
    const seedOutput = changes.find(x => x.address === checked.seedId).outputState;
    requireThat(uint(currentSeed.version) >= uint(seedOutput.version), 'Current Seed predates its receipt.');
    if (uint(currentSeed.version) === uint(seedOutput.version)) { same(reference(currentSeed), reference(seedOutput)); same(contents(currentSeed), contents(seedOutput)); }
  }
  return { ...checked, digest: expectedDigest, currentState: current.currentState,
    currentSeedUnavailable: !currentSeed,
    hasAdvanced: uint(current.registry.version) > uint(output.version),
    gasAboveReviewCeiling: uint(checked.gasEstimateMist) > uint(EXPECTED.maxGasMist) };
}
