import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRoutes, selectRoute, routeType, objectMatchesRoute, normalizeSettlementFields,
  rewardState, canonicalAddress, u64, SEASON_DURATION_MS, CLAIM_GRACE_MS,
} from './model.mjs';

const id = digit => '0x' + digit.repeat(64);
const legacyConfig = {
  PACKAGE_ID: id('2'), TYPE_PACKAGE_ID: id('1'), TYPE_PACKAGE_IDS: [id('1')],
  REGISTRY_ID: id('3'), ADMIN_CAP_ID: id('4'), CLOCK_ID: '0x6', RANDOM_ID: '0x8',
  TYPE_ORIGINS: { SeasonArchive: id('5'), ArchivedRewardClaimed: id('5') },
};
const settlementConfig = {
  enabled: true, PACKAGE_ID: id('7'), TYPE_PACKAGE_ID: id('6'),
  REGISTRY_ID: id('8'), ADMIN_CAP_ID: id('9'),
};
const routes = makeRoutes(legacyConfig, settlementConfig);
const route = routes.settlement;
const START = 1_700_000_000_000n;
const END = START + SEASON_DURATION_MS;
const DEADLINE = END + CLAIM_GRACE_MS;
const NOW = END + 1n;
function registry(overrides = {}) {
  return {
    id: route.REGISTRY_ID, version: '1', current_season_id: '1', season_start_ms: String(START),
    reward_pool: '1000', total_growth_points: '100', eligible_growth_points: '100',
    settlement: null, paused: false, ...overrides,
  };
}
function frozen(overrides = {}) {
  return {
    season_id: '1', season_end_ms: String(END), claim_deadline_ms: String(DEADLINE),
    pool_mist: '1000', eligible_growth_points: '100', paid_mist: '0',
    processed_growth_points: '0', processed_seeds: '0', ...overrides,
  };
}
function finalized(overrides = {}, stateOverrides = {}) {
  return registry({ settlement: { vec: [frozen(stateOverrides)] }, ...overrides });
}
function seed(overrides = {}) {
  return {
    id: id('a'), version: '1', registry_id: route.REGISTRY_ID, season_id: '1', owner: id('b'),
    growth_points: '40', cutoff_growth_points: '40', reward_processed: false,
    state: 0, last_watered_ms: String(START), bottomless_can_expiry_ms: String(END), ...overrides,
  };
}
function archive(overrides = {}, stateOverrides = {}) {
  return {
    id: id('c'), version: '1', registry_id: route.REGISTRY_ID, season_id: '1',
    season_start_ms: String(START), season_end_ms: String(END), claim_deadline_ms: String(DEADLINE),
    finalized_at_ms: String(END + 1n), total_growth_points: '100', reward_pool: '1000',
    swept: false, settlement: frozen(stateOverrides), ...overrides,
  };
}
const options = (overrides = {}) => ({ route, nowMs: NOW, ...overrides });
const wrapped = (fields, name) => ({ objectId: fields.id, content: { type: routeType(route, name), fields } });
function receipt(overrides = {}) {
  return { type: routeType(route, 'RewardEntitlementProcessed'), parsedJson: {
    registry_id: route.REGISTRY_ID, season_id: '1', seed_id: id('a'), owner: id('b'),
    eligible_growth_points: '40', amount_mist: '400', ...overrides,
  } };
}

test('legacy is the default; incomplete or non-boolean settlement activation is unavailable', () => {
  const inactive = makeRoutes(legacyConfig);
  assert.equal(selectRoute(inactive).id, 'legacy');
  assert.equal(inactive.settlement.available, false);
  assert.throws(() => selectRoute(inactive, 'settlement'), { code: 'CONTRACT_ROUTE_UNAVAILABLE' });
  assert.throws(() => selectRoute(inactive, '__proto__'), { code: 'CONTRACT_ROUTE_UNAVAILABLE' });
  assert.equal(makeRoutes(legacyConfig, { ...settlementConfig, enabled: 'true' }).settlement.available, false);
  assert.throws(() => makeRoutes(legacyConfig, { enabled: true }), { code: 'CONTRACT_ROUTE_INVALID' });
});

test('configuration is detached and deeply frozen, including per-type origins', () => {
  const input = structuredClone(legacyConfig);
  const localRoutes = makeRoutes(input, settlementConfig);
  input.TYPE_ORIGINS.SeasonArchive = id('f');
  assert.equal(routeType(localRoutes.legacy, 'SeasonArchive'), `${id('5')}::arboretum::SeasonArchive`);
  assert.throws(() => { localRoutes.settlement.REGISTRY_ID = id('d'); }, TypeError);
  assert.throws(() => localRoutes.legacy.TYPE_PACKAGE_IDS.push(id('d')), TypeError);
  assert.throws(() => { localRoutes.legacy.TYPE_ORIGINS.Seed = id('d'); }, TypeError);
});

test('type queries use defining origins while call package may be a later upgrade', () => {
  assert.equal(route.PACKAGE_ID, id('7'));
  assert.equal(routeType(route, 'Seed'), `${id('6')}::settlement::Seed`);
  assert.equal(routeType(routes.legacy, 'ArchivedRewardClaimed'), `${id('5')}::arboretum::ArchivedRewardClaimed`);
  assert.throws(() => routeType(route, 'Seed;drop'), /Invalid Move type/);
  assert.throws(() => routeType(makeRoutes(legacyConfig).settlement, 'Seed'), /not configured/);
});

test('legacy Registry, AdminCap, and any known legacy origin cannot activate the new route', () => {
  for (const override of [{ REGISTRY_ID: id('3') }, { ADMIN_CAP_ID: id('4') },
    { TYPE_PACKAGE_ID: id('1') }, { TYPE_PACKAGE_ID: id('5') }, { TYPE_ORIGINS: { Seed: id('5') } },
    { MODULE: 'arboretum' }, { NETWORK: 'testnet' }, { EXPECTED_VERSION: 2 },
    { REGISTRY_ID: '0x0' }, { REGISTRY_ID: id('0') }]) {
    assert.throws(() => makeRoutes(legacyConfig, { ...settlementConfig, ...override }), undefined, JSON.stringify(override));
  }
});

test('typed object checks bind Registry/Seed/Archive identity and version', () => {
  assert.equal(objectMatchesRoute(wrapped(seed(), 'Seed'), route, 'Seed'), true);
  assert.equal(objectMatchesRoute(wrapped(registry(), 'Registry'), route, 'Registry'), true);
  assert.equal(objectMatchesRoute(wrapped(archive(), 'SeasonArchive'), route, 'SeasonArchive'), true);
  assert.equal(objectMatchesRoute(wrapped(seed({ registry_id: id('d') }), 'Seed'), route, 'Seed'), false);
  assert.equal(objectMatchesRoute(wrapped(seed({ version: '2' }), 'Seed'), route, 'Seed'), false);
  assert.equal(objectMatchesRoute(wrapped(archive({ registry_id: id('d') }), 'SeasonArchive'), route, 'SeasonArchive'), false);
  assert.equal(objectMatchesRoute(wrapped(registry({ id: id('d') }), 'Registry'), route, 'Registry'), false);
  const conflictingId = wrapped(seed(), 'Seed');
  conflictingId.objectId = id('d');
  assert.equal(objectMatchesRoute(conflictingId, route, 'Seed'), false);
  assert.equal(rewardState(conflictingId, finalized(), options()).status, 'unknown');
  const wrongType = wrapped(seed(), 'Seed');
  wrongType.content.type = `${route.PACKAGE_ID}::settlement::Seed`;
  assert.equal(objectMatchesRoute(wrongType, route, 'Seed'), false);
  wrongType.content.type = routeType(routes.legacy, 'Seed');
  assert.equal(objectMatchesRoute(wrongType, route, 'Seed'), false);
});

test('fields, optional-state wrappers, and nested Balance values normalize identically', () => {
  const expected = normalizeSettlementFields(finalized(), options());
  const variants = [
    finalized({ settlement: frozen() }),
    finalized({ settlement: [frozen()] }),
    finalized({ settlement: { fields: { vec: [{ fields: frozen() }] } }, reward_pool: { fields: { value: '1000' } } }),
    wrapped(finalized(), 'Registry'),
    { address: route.REGISTRY_ID, asMoveObject: { contents: { type: { repr: routeType(route, 'Registry') }, json: finalized() } } },
  ];
  for (const value of variants) assert.deepEqual(normalizeSettlementFields(value, options()), expected);
  for (const settlement of [null, [], { vec: [] }, { fields: { vec: [] } }]) {
    assert.equal(normalizeSettlementFields(registry({ settlement }), options()).finalized, false);
  }
});

test('finalized original pool and denominator never shrink with other payments', () => {
  const before = rewardState(seed(), finalized(), options());
  const after = rewardState(seed(), finalized({ reward_pool: '400' },
    { paid_mist: '600', processed_growth_points: '60', processed_seeds: '1' }), options());
  assert.equal(before.amountMist, 400n);
  assert.equal(after.amountMist, 400n);
  assert.equal(after.status, 'claimable');
  assert.equal(after.estimated, false);
});

test('all six claim orders produce 1,3,5 MIST and leave the same rounding residue', () => {
  for (const order of [[1,2,3], [1,3,2], [2,1,3], [2,3,1], [3,1,2], [3,2,1]]) {
    let paid = 0n, processed = 0n, count = 0n;
    for (const points of order) {
      const r = finalized({ reward_pool: String(10n - paid), total_growth_points: '6', eligible_growth_points: '6' }, {
        pool_mist: '10', eligible_growth_points: '6', paid_mist: String(paid),
        processed_growth_points: String(processed), processed_seeds: String(count),
      });
      const result = rewardState(seed({ growth_points: String(points), cutoff_growth_points: String(points) }), r, options());
      assert.equal(result.status, 'claimable');
      assert.equal(result.amountMist, { 1: 1n, 2: 3n, 3: 5n }[points]);
      paid += result.amountMist; processed += BigInt(points); count++;
    }
    assert.equal(10n - paid, 1n);
  }
});

test('delayed claims keep cutoff eligibility despite later drought or gameplay pause', () => {
  const protectedAtCutoff = seed({ last_watered_ms: String(START), bottomless_can_expiry_ms: String(END) });
  const result = rewardState(protectedAtCutoff, finalized({ paused: true }), options({ nowMs: DEADLINE }));
  assert.equal(result.status, 'claimable');
  assert.equal(result.amountMist, 400n);
  assert.equal(result.paused, true);
});

test('early-season projections use current GP while final entitlements use cutoff eligibility', () => {
  const r = registry({ eligible_growth_points: '0' });
  const s = seed({ cutoff_growth_points: '0' });
  const estimated = rewardState(s, r, options({ nowMs: START + 1n }));
  assert.equal(estimated.status, 'estimate');
  assert.equal(estimated.amountMist, 400n);
  assert.equal(estimated.entitlementMist, null);
  assert.equal(estimated.projectionGP, 40n);
  assert.equal(estimated.claimable, false);
  const ended = rewardState(s, r, options({ nowMs: END }));
  assert.equal(ended.status, 'zero_entitlement');
  assert.equal(ended.amountMist, 0n);
});

test('cutoff and fixed seven-day deadline are inclusive; the next millisecond closes claims', () => {
  assert.equal(rewardState(seed(), registry(), options({ nowMs: END - 1n })).status, 'estimate');
  const first = rewardState(seed(), registry(), options({ nowMs: END }));
  assert.equal(first.status, 'claimable');
  assert.equal(first.finalized, false);
  assert.equal(first.estimated, false);
  assert.equal(rewardState(seed(), finalized(), options({ nowMs: DEADLINE })).status, 'claimable');
  const expired = rewardState(seed(), finalized(), options({ nowMs: DEADLINE + 1n }));
  assert.equal(expired.status, 'expired');
  assert.equal(expired.claimable, false);
  assert.equal(expired.amountMist, null);
  assert.equal(expired.entitlementMist, 400n);
});

test('archived and direct entitlement calculations agree and late archive does not extend deadline', () => {
  assert.equal(rewardState(seed(), archive(), options({ archive: true })).amountMist, 400n);
  const late = archive({ finalized_at_ms: String(DEADLINE + 100n) });
  const result = rewardState(seed(), late, options({ archive: true, nowMs: DEADLINE + 100n }));
  assert.equal(result.status, 'expired');
  assert.equal(result.claimDeadlineMs, DEADLINE);
  assert.equal(rewardState(seed(), archive({ claim_deadline_ms: String(DEADLINE + 100n) }), options({ archive: true })).status, 'unknown');
});

test('all genuine zero entitlements remain distinct from missing data and can be processed once', () => {
  const cases = [
    [seed({ cutoff_growth_points: '0' }), finalized()],
    [seed({ cutoff_growth_points: '0' }), finalized({ eligible_growth_points: '0' }, { eligible_growth_points: '0' })],
    [seed(), finalized({ reward_pool: '0' }, { pool_mist: '0' })],
    [seed({ cutoff_growth_points: '1', growth_points: '1' }), finalized({ reward_pool: '1' }, { pool_mist: '1' })],
  ];
  for (const [s, r] of cases) {
    const result = rewardState(s, r, options());
    assert.equal(result.status, 'zero_entitlement');
    assert.equal(result.amountMist, 0n);
    assert.equal(result.claimable, false);
    assert.equal(result.processable, true);
  }
  const missing = seed(); delete missing.cutoff_growth_points;
  assert.equal(rewardState(missing, finalized(), options()).status, 'unknown');
});

test('a processed Seed without its receipt does not infer a zero payout from cleared GP', () => {
  const result = rewardState(seed({ growth_points: '0', cutoff_growth_points: '0', reward_processed: true }),
    finalized({ reward_pool: '600' }, { paid_mist: '400', processed_growth_points: '40', processed_seeds: '1' }), options());
  assert.equal(result.status, 'processed');
  assert.equal(result.amountMist, null);
  assert.equal(result.eligibleGP, null);
  assert.equal(result.claimable, false);
});

test('exact indexed receipts distinguish a paid entitlement from processed zero', () => {
  const processed = seed({ growth_points: '0', cutoff_growth_points: '0', reward_processed: true });
  const r = finalized({ reward_pool: '600' }, { paid_mist: '400', processed_growth_points: '40', processed_seeds: '1' });
  const paid = rewardState(processed, r, options({ receipt: receipt(), nowMs: DEADLINE + 1n }));
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amountMist, 400n);
  assert.equal(paid.paidMist, 400n);
  assert.equal(paid.eligibleGP, 40n);
  const zero = rewardState(processed, finalized({}, { processed_seeds: '1' }), options({
    receipt: receipt({ eligible_growth_points: '0', amount_mist: '0' }),
  }));
  assert.equal(zero.status, 'processed_zero');
  assert.equal(zero.amountMist, 0n);
});

test('wrong-type, wrong-owner, wrong-Seed, wrong-Registry, wrong-season and inconsistent receipts fail closed', () => {
  const s = seed({ growth_points: '0', cutoff_growth_points: '0', reward_processed: true });
  const r = finalized({ reward_pool: '600' }, { paid_mist: '400', processed_growth_points: '40', processed_seeds: '1' });
  for (const override of [{ owner: id('d') }, { seed_id: id('d') }, { registry_id: id('d') },
    { season_id: '2' }, { amount_mist: '401' }, { eligible_growth_points: '41' }]) {
    assert.equal(rewardState(s, r, options({ receipt: receipt(override) })).status, 'unknown');
  }
  const wrongType = { ...receipt(), type: routeType(routes.legacy, 'RewardClaimed') };
  assert.equal(rewardState(s, r, options({ receipt: wrongType })).status, 'unknown');
  assert.equal(rewardState(seed(), r, options({ receipt: receipt() })).status, 'unknown');
});

test('unknown history, mismatched season and mismatched Registry never assign a fresh entitlement', () => {
  assert.equal(rewardState(seed(), finalized(), { route: routes.legacy, nowMs: NOW }).status, 'legacy');
  assert.equal(rewardState(seed(), finalized(), { route: makeRoutes(legacyConfig).settlement, nowMs: NOW }).status, 'unknown');
  for (const override of [{ registry_id: id('d') }, { season_id: '2' }, { version: '2' },
    { reward_processed: undefined }, { cutoff_growth_points: '101', growth_points: '101' }]) {
    const result = rewardState(seed(override), finalized(), options());
    assert.equal(result.status, 'unknown');
    assert.equal(result.amountMist, null);
  }
});

test('large u64 arithmetic stays exact rather than converting through Number', () => {
  const max = (1n << 64n) - 1n;
  const s = seed({ growth_points: String(max - 1n), cutoff_growth_points: String(max - 1n) });
  const r = finalized({ reward_pool: String(max), total_growth_points: String(max), eligible_growth_points: String(max) },
    { pool_mist: String(max), eligible_growth_points: String(max) });
  assert.equal(rewardState(s, r, options()).amountMist, max - 1n);
  assert.equal(u64(String(max)), max);
  assert.throws(() => u64(max + 1n));
});

test('corrupt numeric or boolean values, absent state, and malformed Option fail closed', () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '01', ' 40', '4e1', 'NaN', '', null, false, {}, []]) {
    const result = rewardState(seed({ cutoff_growth_points: value }), finalized(), options());
    assert.equal(result.status, 'unknown', `Accepted bad number ${String(value)}`);
  }
  for (const value of [undefined, {}, false, { vec: [frozen(), frozen()] }]) {
    assert.equal(rewardState(seed(), registry({ settlement: value }), options()).status, 'unknown');
  }
  assert.equal(rewardState(seed(), finalized({ paused: 'false' }), options()).status, 'unknown');
  assert.equal(rewardState(seed(), finalized(), { route }).status, 'unknown');
});

test('inconsistent frozen counters or timing cannot present an available claim', () => {
  for (const [outer, inner] of [
    [{ reward_pool: '999' }, {}], [{}, { paid_mist: '1001' }], [{}, { processed_growth_points: '101' }],
    [{}, { season_id: '2' }], [{}, { season_end_ms: String(END + 1n) }],
    [{}, { claim_deadline_ms: String(DEADLINE + 1n) }], [{}, { eligible_growth_points: '99' }],
  ]) assert.equal(rewardState(seed(), finalized(outer, inner), options()).status, 'unknown');
  assert.equal(rewardState(seed(), finalized(), options({ nowMs: END - 1n })).status, 'unknown');
});

test('sweeping retains history while closing availability and requires an expired empty archive', () => {
  const swept = archive({ swept: true, reward_pool: '0' }, { paid_mist: '400', processed_growth_points: '40', processed_seeds: '1' });
  assert.equal(rewardState(seed(), swept, options({ archive: true, nowMs: DEADLINE + 1n })).status, 'expired');
  assert.equal(rewardState(seed(), swept, options({ archive: true, nowMs: DEADLINE })).status, 'unknown');
  assert.equal(rewardState(seed(), { ...swept, reward_pool: '1' }, options({ archive: true, nowMs: DEADLINE + 1n })).status, 'unknown');
});

test('canonical IDs support normalized Move UID wrappers without accepting arbitrary values', () => {
  assert.equal(canonicalAddress({ fields: { id: { id: '0xA' } } }), '0x' + '0'.repeat(63) + 'a');
  assert.equal(canonicalAddress(null), null);
  assert.equal(canonicalAddress('abc'), null);
  assert.equal(canonicalAddress('0x' + 'f'.repeat(65)), null);
});
