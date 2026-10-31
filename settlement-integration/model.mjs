/**
 * Pure route and reward calculations for the reviewed settlement module.
 * This module reads no browser storage, globals, wallet, clock, or network.
 * The caller supplies compiled deployment configuration and an indexed snapshot.
 * Amounts are BigInts in MIST; a missing amount is null, never an inferred zero.
 *
 * Contract: contract-payout/source/settlement.move, version 1.
 * Type origins: the package that first defines each type, not its latest caller.
 * Guidance: MystenLabs/skills frontend-apps/queries.md and sui-publish/SKILL.md.
 */

export const SEASON_DURATION_MS = 2_592_000_000n;
export const CLAIM_GRACE_MS = 604_800_000n;
export const SETTLEMENT_VERSION = 1n;
const U64_MAX = (1n << 64n) - 1n;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BOUND_TYPES = new Set(['Seed', 'SeasonArchive', 'AdminCap', 'ChallengeBook', 'CanopyChallenge']);

function fail(message, code = 'SETTLEMENT_DATA_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function unwrap(value) {
  // JSON-RPC-compatible Move struct wrappers can occur inside GraphQL results.
  for (let n = 0; n < 5 && record(value) && record(value.fields); n++) value = value.fields;
  return value;
}
export function moveFields(input) {
  const data = input?.data ?? input;
  const value = data?.content?.fields ?? data?.asMoveObject?.contents?.json
    ?? data?.contents?.json ?? data?.json ?? data;
  const fields = unwrap(value);
  if (!record(fields)) fail('Move fields are missing or malformed.');
  return fields;
}
export function canonicalAddress(value) {
  value = unwrap(value);
  if (record(value)) value = value.id;
  value = unwrap(value);
  if (record(value)) value = value.id;
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null;
  return '0x' + value.slice(2).toLowerCase().padStart(64, '0');
}
function address(value, label) {
  const normalized = canonicalAddress(value);
  if (!normalized) fail(`${label} is missing or invalid.`);
  return normalized;
}
function deploymentAddress(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${label} requires a verified full deployment address.`, 'CONTRACT_ROUTE_INVALID');
  }
  const normalized = canonicalAddress(value);
  if (normalized === '0x' + '0'.repeat(64)) fail(`${label} cannot be a placeholder.`, 'CONTRACT_ROUTE_INVALID');
  return normalized;
}
export function u64(value, label = 'Value') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be an exact unsigned integer.`);
    value = BigInt(value);
  } else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = BigInt(value);
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) fail(`${label} must be an exact u64.`);
  return value;
}
function bool(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value;
}
function balance(value, label) {
  value = unwrap(value);
  return u64(record(value) ? value.value : value, label);
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validateOrigins(origins = {}) {
  if (!record(origins)) fail('TYPE_ORIGINS must be a map.', 'CONTRACT_ROUTE_INVALID');
  return Object.fromEntries(Object.entries(origins).map(([name, origin]) => {
    if (!NAME.test(name)) fail('Invalid type name.', 'CONTRACT_ROUTE_INVALID');
    return [name, deploymentAddress(origin, `Origin of ${name}`)];
  }));
}

/** Deployment configuration is supplied by the build; no runtime activation source is consulted. */
export function makeRoutes(legacyContract, settlementConfig = {}) {
  if (!record(legacyContract) || !record(settlementConfig)) fail('Route configuration is missing.', 'CONTRACT_ROUTE_INVALID');
  if (settlementConfig.enabled === true && settlementConfig.reviewEnabled === true) {
    fail('Settlement activation and read-only review modes are mutually exclusive.', 'CONTRACT_ROUTE_INVALID');
  }
  const legacy = {
    ...clone(legacyContract),
    id: 'legacy', label: 'Existing garden', available: true, reason: null, READ_ONLY: false,
    MODULE: 'arboretum', NETWORK: legacyContract.NETWORK ?? 'mainnet',
    EXPECTED_VERSION: null, SUPPORTS_SETTLEMENT: false,
    PACKAGE_ID: deploymentAddress(legacyContract.PACKAGE_ID, 'Legacy call package'),
    TYPE_PACKAGE_ID: deploymentAddress(legacyContract.TYPE_PACKAGE_ID, 'Legacy type origin'),
    REGISTRY_ID: deploymentAddress(legacyContract.REGISTRY_ID, 'Legacy Registry'),
    ADMIN_CAP_ID: deploymentAddress(legacyContract.ADMIN_CAP_ID, 'Legacy AdminCap'),
    TYPE_ORIGINS: validateOrigins(legacyContract.TYPE_ORIGINS),
  };
  legacy.TYPE_PACKAGE_IDS = [...new Set([legacy.TYPE_PACKAGE_ID, ...(legacyContract.TYPE_PACKAGE_IDS ?? []), ...Object.values(legacy.TYPE_ORIGINS)]
    .map(value => deploymentAddress(value, 'Legacy type origin')))];

  let settlement = {
    id: 'settlement', label: 'New seasons', available: false,
    reason: 'New seasons are not active yet.', MODULE: 'settlement', NETWORK: legacy.NETWORK,
    EXPECTED_VERSION: 1, SUPPORTS_SETTLEMENT: true, READ_ONLY: true,
    PACKAGE_ID: null, TYPE_PACKAGE_ID: null, TYPE_PACKAGE_IDS: [], TYPE_ORIGINS: {},
    REGISTRY_ID: null, ADMIN_CAP_ID: null,
  };
  if (settlementConfig.enabled === true || settlementConfig.reviewEnabled === true) {
    const cfg = clone(settlementConfig);
    if (cfg.MODULE != null && cfg.MODULE !== 'settlement') fail('The new-season module must be settlement.', 'CONTRACT_ROUTE_INVALID');
    if (cfg.NETWORK != null && cfg.NETWORK !== legacy.NETWORK) fail('Route networks must match.', 'CONTRACT_ROUTE_INVALID');
    if (cfg.EXPECTED_VERSION != null && u64(cfg.EXPECTED_VERSION, 'Settlement version') !== SETTLEMENT_VERSION) {
      fail('This integration supports settlement version 1 only.', 'CONTRACT_ROUTE_INVALID');
    }
    const origin = deploymentAddress(cfg.TYPE_PACKAGE_ID, 'Settlement type origin');
    const registry = deploymentAddress(cfg.REGISTRY_ID, 'Settlement Registry');
    const cap = deploymentAddress(cfg.ADMIN_CAP_ID, 'Settlement AdminCap');
    if (registry === legacy.REGISTRY_ID || cap === legacy.ADMIN_CAP_ID || legacy.TYPE_PACKAGE_IDS.includes(origin)) {
      fail('Settlement objects and type origins must be distinct from the legacy game.', 'CONTRACT_ROUTE_INVALID');
    }
    const origins = validateOrigins(cfg.TYPE_ORIGINS);
    if (Object.values(origins).some(value => legacy.TYPE_PACKAGE_IDS.includes(value))) {
      fail('A legacy type origin cannot define settlement types.', 'CONTRACT_ROUTE_INVALID');
    }
    settlement = {
      ...cfg, ...settlement, available: true, reason: null,
      READ_ONLY: cfg.enabled !== true,
      PACKAGE_ID: deploymentAddress(cfg.PACKAGE_ID, 'Settlement call package'),
      TYPE_PACKAGE_ID: origin, TYPE_PACKAGE_IDS: [...new Set([origin, ...Object.values(origins)])],
      TYPE_ORIGINS: origins, REGISTRY_ID: registry, ADMIN_CAP_ID: cap,
      CLOCK_ID: legacy.CLOCK_ID ?? '0x6', RANDOM_ID: legacy.RANDOM_ID ?? '0x8',
      SUPPORTS_SUPPLY_DROPS: true, SUPPORTS_MONTHLY_DURATION_START: true,
      SUPPORTS_ARCHIVED_SEASON_CLAIMS: true, SUPPORTS_EARLY_SEASON_ARCHIVE: true,
      SUPPORTS_PARTNER_CHESTS: true,
      SUPPORTS_CANOPY_CHALLENGES: cfg.SUPPORTS_CANOPY_CHALLENGES === true,
      CHALLENGE_BOOK_ID: cfg.CHALLENGE_BOOK_ID ?? '', ACTIVE_CANOPY_CHALLENGE_ID: cfg.ACTIVE_CANOPY_CHALLENGE_ID ?? '',
    };
  }
  return freeze({ legacy, settlement });
}
export function selectRoute(routes, id = 'legacy') {
  if (!['legacy', 'settlement'].includes(id)) fail('Unknown garden route.', 'CONTRACT_ROUTE_UNAVAILABLE');
  const route = routes?.[id];
  if (route?.available !== true) fail(route?.reason ?? 'This garden is not configured.', 'CONTRACT_ROUTE_UNAVAILABLE');
  return route;
}
export function routeType(route, structName) {
  if (route?.available !== true) fail('This garden is not configured.', 'CONTRACT_ROUTE_UNAVAILABLE');
  if (!NAME.test(structName ?? '')) fail('Invalid Move type name.');
  return `${address(route.TYPE_ORIGINS?.[structName] ?? route.TYPE_PACKAGE_ID, 'Type origin')}::${route.MODULE}::${structName}`;
}
function objectType(input) {
  const data = input?.data ?? input;
  const type = data?.content?.type ?? data?.asMoveObject?.contents?.type ?? data?.contents?.type ?? data?.type;
  return typeof type === 'string' ? type : type?.repr ?? null;
}
function normalizedType(type) {
  const parts = typeof type === 'string' ? type.split('::') : [];
  if (parts.length !== 3 || !NAME.test(parts[1]) || !NAME.test(parts[2])) return null;
  const origin = canonicalAddress(parts[0]);
  return origin ? `${origin}::${parts[1]}::${parts[2]}` : null;
}
function objectId(input, fields) {
  const data = input?.data ?? input;
  const outerValue = data?.objectId ?? data?.address;
  const outer = canonicalAddress(outerValue);
  const inner = canonicalAddress(fields?.id);
  if ((outerValue != null && !outer) || (fields?.id != null && !inner) || (outer && inner && outer !== inner)) return null;
  return outer ?? inner;
}
export function objectMatchesRoute(input, route, structName, { registryBound = false } = {}) {
  try {
    if (route?.available !== true || normalizedType(objectType(input)) !== routeType(route, structName)) return false;
    const fields = moveFields(input);
    if (!objectId(input, fields)) return false;
    if (structName === 'Registry' && objectId(input, fields) !== route.REGISTRY_ID) return false;
    if (route.id === 'settlement') {
      if (u64(fields.version, 'Object version') !== SETTLEMENT_VERSION) return false;
      if ((BOUND_TYPES.has(structName) || registryBound) && canonicalAddress(fields.registry_id) !== route.REGISTRY_ID) return false;
    }
    return true;
  } catch { return false; }
}

function option(value) {
  if (value === null) return null;
  value = unwrap(value);
  if (record(value) && Object.hasOwn(value, 'vec')) value = value.vec;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length !== 1) fail('Settlement option contains more than one value.');
    value = unwrap(value[0]);
  }
  if (!record(value) || !Object.hasOwn(value, 'season_id')) fail('Settlement option is missing or malformed.');
  return value;
}

/** Normalize an indexed Registry or Archive. Missing fields and broken invariants throw. */
export function normalizeSettlementFields(input, { archive = false, nowMs, route } = {}) {
  if (route?.available !== true || route.id !== 'settlement') fail('A configured settlement route is required.');
  const fields = moveFields(input);
  const type = objectType(input);
  if (type && !objectMatchesRoute(input, route, archive ? 'SeasonArchive' : 'Registry')) fail('Object type or Registry does not match the selected garden.');
  if (u64(fields.version, 'Object version') !== SETTLEMENT_VERSION) fail('Unsupported settlement object version.');
  const id = objectId(input, fields);
  if (!id) fail('Settlement object identity is missing.');
  const registryId = archive ? address(fields.registry_id, 'Archive Registry') : id;
  if (registryId !== route.REGISTRY_ID) fail('Settlement Registry does not match the selected garden.');
  const now = u64(nowMs, 'Current time');
  const seasonId = u64(archive ? fields.season_id : fields.current_season_id, 'Season');
  const start = u64(fields.season_start_ms, 'Season start');
  const end = start === 0n ? 0n : u64(start + SEASON_DURATION_MS, 'Season cutoff');
  const deadline = end === 0n ? 0n : u64(end + CLAIM_GRACE_MS, 'Claim deadline');
  const remaining = balance(fields.reward_pool, 'Remaining reward pool');
  const total = u64(fields.total_growth_points, 'Total Growth Points');
  const eligible = u64(archive ? fields.total_growth_points : fields.eligible_growth_points, 'Eligible Growth Points');
  const paused = archive ? false : bool(fields.paused, 'Gameplay pause');
  const swept = archive ? bool(fields.swept, 'Archive sweep state') : false;
  if (eligible > total) fail('Eligible Growth Points exceed the recorded total.');
  if (!Object.hasOwn(fields, 'settlement')) fail('Settlement state is missing.');
  const state = archive ? unwrap(fields.settlement) : option(fields.settlement);
  if (archive) {
    if (start === 0n || !record(state)) fail('Archive settlement is missing.');
    if (u64(fields.season_end_ms, 'Archive cutoff') !== end || u64(fields.claim_deadline_ms, 'Archive deadline') !== deadline) {
      fail('Archive timing does not match the fixed season window.');
    }
    const finalizedAt = u64(fields.finalized_at_ms, 'Archive finalization time');
    if (finalizedAt < end || finalizedAt > now) fail('Archive finalization time is inconsistent with cutoff or the snapshot clock.');
  }
  if (start === 0n && (state !== null || eligible !== 0n || remaining !== 0n || total !== 0n)) fail('Inactive Registry has inconsistent seasonal accounting.');
  let pool = remaining, paid = 0n, processedGP = 0n, processedSeeds = 0n;
  if (state !== null) {
    if (!record(state) || start === 0n || now < end) fail('Finalized settlement is inconsistent with the season time.');
    if (u64(state.season_id, 'Settlement season') !== seasonId
        || u64(state.season_end_ms, 'Settlement cutoff') !== end
        || u64(state.claim_deadline_ms, 'Settlement deadline') !== deadline
        || u64(state.eligible_growth_points, 'Settlement eligible Growth Points') !== eligible) {
      fail('Frozen settlement does not match its Registry or Archive.');
    }
    pool = u64(state.pool_mist, 'Original reward pool');
    paid = u64(state.paid_mist, 'Rewards paid');
    processedGP = u64(state.processed_growth_points, 'Processed Growth Points');
    processedSeeds = u64(state.processed_seeds, 'Processed Seeds');
    if (paid > pool || processedGP > eligible) fail('Settlement counters exceed their fixed originals.');
    if (swept) {
      if (now <= deadline || remaining !== 0n) fail('Swept archive is inconsistent with its deadline or balance.');
    } else if (paid + remaining !== pool) fail('Paid rewards plus the remaining pool do not equal the original pool.');
  }
  return freeze({
    objectId: id, registryId, seasonId, seasonStartMs: start, seasonEndMs: end, claimDeadlineMs: deadline,
    nowMs: now, poolMist: pool, remainingPoolMist: remaining, paidMist: paid,
    eligibleGP: eligible, totalGP: total, processedGP, processedSeeds,
    finalized: state !== null, frozen: start > 0n && now >= end,
    active: start > 0n && now >= start && now < end,
    claimWindowOpen: start > 0n && now >= end && now <= deadline && !swept,
    paused, swept, archive,
  });
}

function processedReceipt(receipt, seedInput, seed, route, snapshot) {
  if (normalizedType(objectType(receipt)) !== routeType(route, 'RewardEntitlementProcessed')) fail('The processed-reward receipt has the wrong event type.');
  const data = unwrap(receipt?.parsedJson ?? receipt?.contents?.json ?? receipt?.json);
  if (!record(data)) fail('Processed-reward receipt fields are missing.');
  if (address(data.registry_id, 'Receipt Registry') !== snapshot.registryId
      || address(data.seed_id, 'Receipt Seed') !== objectId(seedInput, seed)
      || address(data.owner, 'Receipt owner') !== address(seed.owner, 'Seed owner')
      || u64(data.season_id, 'Receipt season') !== snapshot.seasonId) fail('The processed-reward receipt belongs to another entitlement.');
  const points = u64(data.eligible_growth_points, 'Receipt eligible Growth Points');
  const amount = u64(data.amount_mist, 'Receipt reward');
  const expected = snapshot.eligibleGP === 0n ? 0n : points * snapshot.poolMist / snapshot.eligibleGP;
  if (points > snapshot.eligibleGP || points > snapshot.processedGP || amount !== expected
      || amount > snapshot.paidMist || snapshot.processedSeeds === 0n) fail('Processed-reward receipt is inconsistent with the settlement.');
  return { amount, points };
}

/**
 * A processed marker clears both Seed GP fields. Without its matching successful
 * indexed RewardEntitlementProcessed receipt, the amount paid is unknowable.
 * `claimable` is a positive payment; `processable` also permits recording zero.
 */
export function rewardState(seedInput, settlementInput, { route, nowMs, archive = false, receipt = null } = {}) {
  const base = {
    status: 'unknown', label: 'Reward status unavailable', reason: null,
    claimable: false, processable: false, amountMist: null, entitlementMist: null,
    paidMist: null, eligibleGP: null, estimated: false, finalized: false,
  };
  if (route?.available !== true) return freeze({ ...base, reason: 'This garden is not configured.' });
  if (route.id === 'legacy') return freeze({ ...base, status: 'legacy', label: 'Existing-season reward',
    reason: 'Existing-season rewards require their own history; the new-season formula does not reassign them.' });
  try {
    const snapshot = normalizeSettlementFields(settlementInput, { route, nowMs, archive });
    const seed = moveFields(seedInput);
    const type = objectType(seedInput);
    if (type && !objectMatchesRoute(seedInput, route, 'Seed')) fail('This Seed does not belong to the selected garden.');
    if (!objectId(seedInput, seed)) fail('Seed identity is missing or inconsistent.');
    if (u64(seed.version, 'Seed version') !== SETTLEMENT_VERSION) fail('Unsupported Seed version.');
    if (address(seed.registry_id, 'Seed Registry') !== snapshot.registryId) fail('This Seed belongs to another Registry.');
    if (u64(seed.season_id, 'Seed season') !== snapshot.seasonId) fail('This Seed belongs to another season; select its matching archive.');
    const points = u64(seed.cutoff_growth_points, 'Seed cutoff Growth Points');
    const growth = u64(seed.growth_points, 'Seed Growth Points');
    const processed = bool(seed.reward_processed, 'Reward processed marker');
    if (points > growth || points > snapshot.eligibleGP) fail('Seed eligibility is inconsistent with the settlement.');
    const result = { ...base, seasonId: snapshot.seasonId, seasonEndMs: snapshot.seasonEndMs,
      claimDeadlineMs: snapshot.claimDeadlineMs, registryId: snapshot.registryId,
      eligibleGP: points, finalized: snapshot.finalized, paused: snapshot.paused };
    if (processed) {
      if (points !== 0n || growth !== 0n || !snapshot.finalized) fail('Processed Seed fields are inconsistent.');
      if (!receipt) return freeze({ ...result, status: 'processed', label: 'Reward already processed', eligibleGP: null,
        reason: 'The Seed is processed. Its matching transaction receipt is required to show the amount paid.' });
      const matched = processedReceipt(receipt, seedInput, seed, route, snapshot);
      return freeze({ ...result, status: matched.amount > 0n ? 'paid' : 'processed_zero',
        label: matched.amount > 0n ? 'Reward paid' : 'Processed with no reward',
        amountMist: matched.amount, paidMist: matched.amount, entitlementMist: matched.amount,
        eligibleGP: matched.points });
    }
    if (receipt) fail('A processed receipt and an unprocessed Seed disagree; refresh the indexed snapshot before claiming.');
    if (snapshot.seasonStartMs === 0n) return freeze({ ...result, status: 'inactive', label: 'No active season' });
    if (snapshot.nowMs < snapshot.seasonStartMs) return freeze({ ...result, status: 'scheduled', label: 'Season has not started' });
    if (!snapshot.frozen) {
      // Early in the season, prospective cutoff eligibility can be zero for
      // every Seed. The ordinary projection uses current GP and is explicitly
      // not the final eligibility calculation or an assigned entitlement.
      if (growth > snapshot.totalGP) fail('Seed Growth Points exceed the current season total.');
      const projected = snapshot.totalGP === 0n ? 0n : growth * snapshot.remainingPoolMist / snapshot.totalGP;
      return freeze({ ...result, status: 'estimate', label: 'Estimated reward',
        reason: 'An estimate from current Growth Points. Care, eligibility, and funding can change until cutoff.',
        amountMist: projected, estimated: true, projectionGP: growth, projectionDenominatorGP: snapshot.totalGP });
    }
    const amount = snapshot.eligibleGP === 0n ? 0n : points * snapshot.poolMist / snapshot.eligibleGP;
    if (!snapshot.claimWindowOpen) return freeze({ ...result, status: 'expired', label: 'Claim window closed',
      reason: snapshot.swept ? 'The expired archive has been swept.' : 'The fixed seven-day claim window has ended.',
      entitlementMist: amount });
    if (amount > snapshot.remainingPoolMist || points + snapshot.processedGP > snapshot.eligibleGP) {
      fail('This entitlement conflicts with the already processed settlement totals.');
    }
    return freeze({ ...result, status: amount > 0n ? 'claimable' : 'zero_entitlement',
      label: amount > 0n ? 'Reward available' : 'No reward for this Seed',
      reason: amount > 0n ? null : 'The cutoff eligibility and original pool produce a zero-value entitlement.',
      amountMist: amount, entitlementMist: amount, claimable: amount > 0n, processable: true });
  } catch (error) {
    return freeze({ ...base, reason: error?.message ?? 'The reward snapshot could not be verified.' });
  }
}
