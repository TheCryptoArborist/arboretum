import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import * as model from './model.mjs';
import { applyPartnerReport } from '../economy-review/build-admin-preview.mjs';

// The actual emitted wallet is executed with the installed Transaction SDK.
// Only fixture Wallet Standard methods and fixture reads are available here.
// No browser wallet, network request, transaction build, or submission is used.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIGEST = '11111111111111111111111111111111';
const id = digit => '0x' + digit.repeat(64);
const OWNER = '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4';
const SEED_ID = id('a'), ARCHIVE_ID = id('b'), OTHER_ID = id('c'), FIELD_ID = id('d');
const LEGACY_PACKAGE = '0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724';
const LEGACY_ORIGIN = '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b';
const LEGACY_ARCHIVE_ORIGIN = '0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940';
const LEGACY_REGISTRY = '0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50';
const DEPLOYMENT = Object.freeze({
  enabled: true, PACKAGE_ID: id('7'), TYPE_PACKAGE_ID: id('6'),
  REGISTRY_ID: id('8'), ADMIN_CAP_ID: id('9'),
});
const CP = 123, START = 1_700_000_000_000n;
const END = START + model.SEASON_DURATION_MS, DEADLINE = END + model.CLAIM_GRACE_MS;
const NOW = END + 1n;
const settlementType = name => DEPLOYMENT.TYPE_PACKAGE_ID + '::settlement::' + name;
const legacyType = name => (name === 'SeasonArchive' || name === 'ArchivedRewardClaimed'
  ? LEGACY_ARCHIVE_ORIGIN : LEGACY_ORIGIN) + '::arboretum::' + name;
const page = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

const emittedSources = {};
const generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'arboretum-wallet-fixtures-'));
try {
  for (const route of ['legacy', 'settlement']) {
    const target = path.join(generatedDirectory, route + '.mjs');
    await promisify(execFile)('python3', [path.join(ROOT, 'settlement-integration/build_wallet.py'), target, route]);
    emittedSources[route] = fs.readFileSync(target, 'utf8');
  }
} finally {
  fs.rmSync(generatedDirectory, { recursive: true, force: true });
}
const exposedNames = [
  'CONTRACT', 'connectWallet', 'initializeWallet', 'signAndExecute', 'buyCrate', 'buyBoomChest', 'buyVictoryChest',
  'buySupplyDrop', 'adminDepositToPool', 'claimReward', 'claimArchivedReward',
  'getProtocolRoutes', 'getIntegrationStatus', 'getRewardOptions', 'getProjectedReward',
  'getOwnedObjects', 'getAllObjectsByStructType', 'getObjectById', 'getObjectsByIds',
  'getRegistryFields', 'getSeasonStats', 'getSeasonArchive', 'getConfiguredSeasonArchiveId',
  'getSuiBalance', 'getPlayerCurrentGrowthPoints', 'getTotalRewardsCollected',
  'resolveSuiName', 'getDynamicFieldObject',
];
const scripts = Object.fromEntries(Object.entries(emittedSources).map(([route, source]) => [route,
  new vm.Script(source.replace(/^import .*\n/gm, '').replace(/^export /gm, '') +
    '\nglobalThis.walletTestApi={' + exposedNames.join(',') + '};', { filename: 'emitted-' + route + '-wallet.js' }),
]));

function moveObject(name, fields, { type = settlementType(name), objectId = fields.id } = {}) {
  return { objectId, version: '42', digest: 'fixture-object-digest', type,
    content: { dataType: 'moveObject', type, fields }, display: { data: {} } };
}
function frozen(changes = {}) {
  return { season_id: '1', season_end_ms: String(END), claim_deadline_ms: String(DEADLINE),
    pool_mist: '1000', eligible_growth_points: '100', paid_mist: '0',
    processed_growth_points: '0', processed_seeds: '0', ...changes };
}
function registry(changes = {}, stateChanges = {}) {
  return moveObject('Registry', {
    id: DEPLOYMENT.REGISTRY_ID, version: '1', current_season_id: '1',
    season_start_ms: String(START), reward_pool: '1000', treasury: '0', total_seeds: '3',
    total_growth_points: '100', eligible_growth_points: '100',
    settlement: { fields: { vec: [{ fields: frozen(stateChanges) }] } }, paused: false, ...changes,
  });
}
function seed(changes = {}, wrapper = {}) {
  return moveObject('Seed', {
    id: SEED_ID, version: '1', registry_id: DEPLOYMENT.REGISTRY_ID, season_id: '1', owner: OWNER,
    growth_points: '40', cutoff_growth_points: '40', reward_processed: false, state: 0,
    last_watered_ms: String(START), bottomless_can_expiry_ms: String(END),
    claimed_ms: '0', planted_at_ms: String(START), ...changes,
  }, wrapper);
}
function archive(changes = {}, stateChanges = {}, wrapper = {}) {
  return moveObject('SeasonArchive', {
    id: ARCHIVE_ID, version: '1', registry_id: DEPLOYMENT.REGISTRY_ID, season_id: '1',
    season_start_ms: String(START), season_end_ms: String(END), claim_deadline_ms: String(DEADLINE),
    finalized_at_ms: String(NOW), total_growth_points: '100', total_seeds: '3', reward_pool: '1000',
    swept: false, settlement: { fields: frozen(stateChanges) }, ...changes,
  }, wrapper);
}
function fixture({ archived = false, seedChanges = {}, registryChanges = {}, stateChanges = {}, nowMs = NOW } = {}) {
  return {
    snapshot: { checkpoint: CP, nowMs: Number(nowMs), registry: archived
      ? registry({ current_season_id: '2', season_start_ms: String(END), reward_pool: '0',
        total_growth_points: '0', eligible_growth_points: '0', settlement: null, ...registryChanges })
      : registry(registryChanges, stateChanges) },
    seeds: [seed(seedChanges)], archives: archived ? [archive()] : [],
  };
}
function receipt(changes = {}, type = settlementType('RewardEntitlementProcessed')) {
  return { sequenceNumber: 0, sender: { address: OWNER }, contents: { type: { repr: type }, json: {
    registry_id: DEPLOYMENT.REGISTRY_ID, season_id: '1', seed_id: SEED_ID, owner: OWNER,
    eligible_growth_points: '40', amount_mist: '400', ...changes,
  } } };
}
function confirmedResponse(events = []) {
  return { data: { transaction: { digest: DIGEST, effects: {
    digest: DIGEST, status: 'SUCCESS', executionError: null,
    checkpoint: { sequenceNumber: CP, timestamp: '2026-10-20T00:00:00.000Z' },
    events: page(events), objectChanges: page([]),
  } } } };
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

function harness({ mode = 'settlement', reviewOnly = false, deployment = DEPLOYMENT,
  data = fixture(), reader = {}, response = confirmedResponse(), windowOverrides = {},
  stored = {}, accountAddress = OWNER, grpcResult = { dynamicField: { fieldId: FIELD_ID } },
  wallets = null,
} = {}) {
  const calls = { sign: [], confirmation: [], reader: [], grpc: [], clients: [], timers: new Map() };
  let now = 0, timerId = 0;
  const account = { address: accountAddress, chains: ['sui:mainnet'] };
  const wallet = { name: 'Offline Integration Fixture', accounts: [account], features: {
    'sui:signAndExecuteTransaction': { async signAndExecuteTransaction(input) {
      calls.sign.push(input);
      return { digest: DIGEST, effects: 'AQ==', bytes: 'fixture-bytes', signature: 'fixture-signature' };
    } },
  } };
  const defaults = {
    state: async () => data.snapshot,
    owned: async () => data.seeds ?? [],
    all: async () => data.archives ?? [],
    object: async objectId => objectId === DEPLOYMENT.REGISTRY_ID
      ? data.snapshot.registry : (data.objects ?? []).find(obj => obj.objectId === objectId) ?? null,
    events: async () => data.events ?? [],
    query: async () => ({ address: { balance: { totalBalance: '15000000' }, defaultNameRecord: { domain: 'fixture.sui' } } }),
  };
  const integrationReader = Object.fromEntries(Object.keys(defaults).map(name => [name, async (...args) => {
    calls.reader.push({ name, args });
    return (reader[name] ?? defaults[name])(...args);
  }]));
  const context = vm.createContext({
    ...model, Transaction, bcs, createReader: () => integrationReader,
    SETTLEMENT_DEPLOYMENT: deployment, REVIEW_ONLY: reviewOnly,
    getWallets: () => ({ get: () => typeof wallets === 'function' ? wallets() : wallets ?? [wallet] }),
    SuiGrpcClient: class {
      constructor(options) {
        calls.clients.push(options);
        this.core = { getDynamicField: async input => {
          calls.grpc.push(input);
          return typeof grpcResult === 'function' ? grpcResult(input) : grpcResult;
        } };
      }
    },
    window: { ...windowOverrides }, location: { search: '?protocol=settlement&enabled=true' },
    document: { dispatchEvent() {} }, Event: class {},
    sessionStorage: storage(), localStorage: storage(stored),
    console: { log() {}, warn() {}, error() {} }, AbortController,
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const timer = ++timerId;
      if (delay <= 2000) { now += delay; queueMicrotask(callback); }
      else calls.timers.set(timer, callback);
      return timer;
    },
    clearTimeout(timer) { calls.timers.delete(timer); },
    async fetch(url, options) {
      const input = { url, options, body: JSON.parse(options.body) };
      calls.confirmation.push(input);
      const payload = typeof response === 'function' ? await response(input) : response;
      return { ok: true, status: 200, json: async () => structuredClone(payload) };
    },
  });
  scripts[mode].runInContext(context);
  return { context, calls, api: context.walletTestApi, connect: () => context.walletTestApi.connectWallet() };
}

function assertOneFixtureSignature(h) {
  assert.equal(h.calls.sign.length, 1);
  assert.equal(h.calls.sign[0].chain, 'sui:mainnet');
  assert.equal(h.calls.sign[0].transaction instanceof Transaction, true);
  assert.equal(h.calls.confirmation.length, 1, 'A fixture index confirms the mock digest once');
  assert.equal(h.calls.timers.size, 0);
  for (const call of h.calls.confirmation) {
    assert.equal(call.url, 'https://graphql.mainnet.sui.io/graphql');
    assert.match(call.body.query, /^query ConfirmArboretumTransaction/);
    assert.doesNotMatch(call.body.query, /\bmutation\b|executeTransaction|simulateTransaction/);
    assert.equal(call.body.variables.digest, DIGEST);
    assert.equal('signature' in call.body.variables, false);
    assert.equal('bytes' in call.body.variables, false);
  }
}
function transactionData(h) {
  assertOneFixtureSignature(h);
  return h.calls.sign[0].transaction.getData();
}
const argumentObjectId = (data, argument) => data.inputs[argument.Input]?.UnresolvedObject?.objectId;
const pureBytes = (data, argument) => Buffer.from(data.inputs[argument.Input].Pure.bytes, 'base64');
function oneMoveCall(data) {
  const calls = data.commands.filter(command => command.MoveCall).map(command => command.MoveCall);
  assert.equal(calls.length, 1);
  return calls[0];
}

function connectionWallet(name, addresses, calls, onConnect = null) {
  const wallet = { name, accounts: addresses.map(address => ({ address, chains: ['sui:mainnet'] })), features: {
    'sui:signAndExecuteTransaction': { async signAndExecuteTransaction() {
      assert.fail('Connection fixtures must never request a signature');
    } },
    'standard:connect': { async connect(options) {
      calls.push({ name, silent: options?.silent === true });
      if (onConnect) onConnect(wallet);
    } },
  } };
  return wallet;
}
function savedWallet(name, address = OWNER) {
  return { arb_name: name, arb_addr: address, arb_expiry: String(Date.now() + 60_000) };
}
function assertNoConnectionDataRequests(h) {
  assert.equal(h.calls.sign.length, 0);
  assert.equal(h.calls.confirmation.length, 0);
  assert.equal(h.calls.reader.length, 0);
  assert.equal(h.calls.grpc.length, 0);
}

for (const mode of ['legacy', 'settlement']) {
  test(mode + ' review connects only the explicitly selected wallet', async () => {
    const calls = [];
    const chosen = connectionWallet('Chosen Fixture', [OWNER], calls);
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [other, chosen] });
    const result = await h.api.connectWallet(chosen.name);
    assert.equal(result.walletName, chosen.name); assert.equal(result.address, OWNER);
    assert.equal(h.context.window.currentWallet, chosen);
    assert.deepEqual(calls, [{ name: chosen.name, silent: false }]);
    assertNoConnectionDataRequests(h);
  });

  test(mode + ' review rejects missing or invalid named wallets without contacting another wallet', async () => {
    const calls = [];
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [other] });
    for (const name of ['Missing Chosen Fixture', '', false, 0]) {
      await assert.rejects(h.api.connectWallet(name), /selected wallet is no longer available/);
    }
    assert.deepEqual(calls, []);
    assert.equal(h.context.window.currentWallet, undefined);
    assert.equal(h.context.window.playerAddress, undefined);
    assert.equal(h.calls.clients.length, 0);
    assertNoConnectionDataRequests(h);
  });

  test(mode + ' review retains auto-detection when no wallet was explicitly selected', async () => {
    const calls = [];
    const wallet = connectionWallet('Auto-detected Fixture', [OWNER], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [wallet] });
    assert.equal((await h.api.connectWallet()).walletName, wallet.name);
    assert.deepEqual(calls, [{ name: wallet.name, silent: false }]);
    assertNoConnectionDataRequests(h);
  });

  test(mode + ' review rejects ambiguous wallet names before connecting or restoring', async () => {
    const calls = [];
    const first = connectionWallet('Duplicate Fixture', [OWNER], calls);
    const second = connectionWallet('Duplicate Fixture', [OTHER_ID], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [second, first], stored: savedWallet(first.name) });
    await assert.rejects(h.api.connectWallet(first.name), /More than one wallet uses the selected name/);
    assert.equal(await h.api.initializeWallet(), null);
    assert.deepEqual(calls, []);
    assert.equal(h.context.window.currentWallet, undefined);
    assert.equal(h.context.window.playerAddress, undefined);
    assert.equal(h.calls.clients.length, 0);
    assertNoConnectionDataRequests(h);
  });

  test(mode + ' review restores the exact saved account even when it is not first', async () => {
    const calls = [];
    const saved = connectionWallet('Saved Fixture', [OTHER_ID, OWNER], calls);
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [other, saved], stored: savedWallet(saved.name) });
    const result = await h.api.initializeWallet();
    assert.equal(result.address, OWNER); assert.equal(result.walletName, saved.name);
    assert.equal(h.context.window.currentWallet, saved);
    assert.equal(h.context.window.currentAccount, saved.accounts[1]);
    assert.deepEqual(calls, []);
    assertNoConnectionDataRequests(h);
  });

  test(mode + ' review does not restore a different wallet or account when the saved choice disappears', async () => {
    for (const missing of ['wallet', 'account', 'account after silent connect']) {
      const calls = [];
      const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
      const saved = connectionWallet('Saved Fixture', missing === 'account after silent connect' ? [] : [OTHER_ID], calls,
        wallet => { wallet.accounts = other.accounts; });
      const stored = savedWallet(saved.name);
      const h = harness({ mode, reviewOnly: true, wallets: missing === 'wallet' ? [other] : [other, saved], stored });
      assert.equal(await h.api.initializeWallet(), null, missing);
      assert.equal(h.context.window.currentWallet, undefined, missing);
      assert.equal(h.context.window.currentAccount, undefined, missing);
      assert.equal(h.context.window.playerAddress, undefined, missing);
      assert.equal(h.context.localStorage.getItem('arb_addr'), OWNER, 'Do not replace the saved address');
      assert.equal(h.context.localStorage.getItem('arb_name'), saved.name, 'Do not replace the saved wallet');
      assert.deepEqual(calls, missing === 'account after silent connect' ? [{ name: saved.name, silent: true }] : []);
      assert.equal(h.calls.clients.length, 0);
      assertNoConnectionDataRequests(h);
    }
  });

  test(mode + ' review can silently restore the exact saved account from its saved wallet', async () => {
    const calls = [];
    const saved = connectionWallet('Saved Fixture', [], calls, wallet => {
      wallet.accounts = [{ address: OTHER_ID, chains: ['sui:mainnet'] }, { address: OWNER, chains: ['sui:mainnet'] }];
    });
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    const h = harness({ mode, reviewOnly: true, wallets: [other, saved], stored: savedWallet(saved.name) });
    assert.equal((await h.api.initializeWallet()).address, OWNER);
    assert.equal(h.context.window.currentWallet, saved);
    assert.equal(h.context.window.currentAccount, saved.accounts[1]);
    assert.deepEqual(calls, [{ name: saved.name, silent: true }]);
    assertNoConnectionDataRequests(h);
  });
}

const funding = [
  { name: 'crate', method: 'buyCrate', args: [2], target: 'buy_crate', payment: 10_000_000n, legacyArgs: 3, tag: 2 },
  { name: 'Boom Chest', method: 'buyBoomChest', args: [], target: 'buy_boom_chest', payment: 10_000_000n, legacyArgs: 2 },
  { name: 'Victory Chest', method: 'buyVictoryChest', args: [], target: 'buy_victory_chest', payment: 10_000_000n, legacyArgs: 2 },
  { name: 'Supply Drop', method: 'buySupplyDrop', args: [0], target: 'buy_supply_drop', payment: 50_000_000n, legacyArgs: 3, tag: 0 },
  { name: 'admin pool deposit', method: 'adminDepositToPool', args: ['12345678901234567890'],
    target: 'deposit_to_pool', payment: 12_345_678_901_234_567_890n, legacyArgs: 3, admin: true },
];
for (const mode of ['legacy', 'settlement']) for (const action of funding) {
  test(mode + ' ' + action.name + ' emits the correct payment and Clock signature', async () => {
    const h = harness({ mode }); await h.connect();
    await h.api[action.method](...action.args);
    const data = transactionData(h), call = oneMoveCall(data), route = h.api.CONTRACT;
    assert.equal(call.package, mode === 'settlement' ? DEPLOYMENT.PACKAGE_ID : LEGACY_PACKAGE);
    assert.equal(call.module, mode === 'settlement' ? 'settlement' : 'arboretum');
    assert.equal(call.function, action.target);
    assert.equal(call.arguments.length, action.legacyArgs + (mode === 'settlement' ? 1 : 0));
    assert.equal(data.sender, OWNER);
    assert.equal(data.gasData.budget, null, 'The SDK/wallet estimates the gas budget');
    const split = data.commands[0].SplitCoins;
    assert.equal(split.coin.$kind, 'GasCoin');
    assert.equal(pureBytes(data, split.amounts[0]).readBigUInt64LE(), action.payment);
    assert.equal(argumentObjectId(data, call.arguments[action.admin ? 1 : 0]), route.REGISTRY_ID);
    if (action.admin) assert.equal(argumentObjectId(data, call.arguments[0]), route.ADMIN_CAP_ID);
    if (action.tag !== undefined) assert.equal(pureBytes(data, call.arguments[1]).readUInt8(), action.tag);
    const coinArgument = call.arguments[action.legacyArgs - 1];
    assert.deepEqual(coinArgument.NestedResult, [0, 0], 'Only the split Coin is passed as payment');
    if (mode === 'settlement') assert.equal(argumentObjectId(data, call.arguments.at(-1)), model.canonicalAddress('0x6'));
    else assert.equal(data.inputs.some(input => input.UnresolvedObject?.objectId === model.canonicalAddress('0x6')), false);
  });
}

test('default legacy route cannot be switched by storage, page globals, or URL values', () => {
  const h = harness({ mode: 'legacy', deployment: { enabled: false },
    stored: { arb_protocol: 'settlement', arb_settlement_enabled: 'true', ARBORETUM_SETTLEMENT_ENABLED: 'true' },
    windowOverrides: { ARBORETUM_PROTOCOL: 'settlement', ARBORETUM_SETTLEMENT_CONFIG: DEPLOYMENT },
  });
  assert.equal(h.api.CONTRACT.id, 'legacy');
  const routes = h.api.getProtocolRoutes();
  assert.equal(routes.find(route => route.id === 'legacy').selected, true);
  assert.equal(routes.find(route => route.id === 'settlement').available, false);
  assert.equal(h.calls.sign.length, 0);
});

test('emitted settlement route refuses to initialize without verified compiled deployment', () => {
  assert.throws(() => harness({ deployment: { enabled: false },
    stored: { arb_settlement_enabled: 'true' },
    windowOverrides: { SETTLEMENT_DEPLOYMENT: DEPLOYMENT, ARBORETUM_SETTLEMENT_CONFIG: DEPLOYMENT },
  }), error => error.code === 'CONTRACT_ROUTE_UNAVAILABLE');
  assert.throws(() => harness({ deployment: { enabled: true } }), error => error.code === 'CONTRACT_ROUTE_INVALID');
});

test('settlement route and admin capability stay immutable after initialization', async () => {
  const h = harness({ windowOverrides: { ARBORETUM_ADMIN_CAP: OTHER_ID, ARBORETUM_REGISTRY_ID: OTHER_ID } });
  assert.equal(Object.isFrozen(h.api.CONTRACT), true);
  assert.throws(() => { h.api.CONTRACT.PACKAGE_ID = OTHER_ID; }, TypeError);
  await h.connect(); await h.api.adminDepositToPool('1');
  const data = transactionData(h), call = oneMoveCall(data);
  assert.equal(argumentObjectId(data, call.arguments[0]), DEPLOYMENT.ADMIN_CAP_ID);
  assert.equal(argumentObjectId(data, call.arguments[1]), DEPLOYMENT.REGISTRY_ID);
});

test('owned settlement Seeds require the new origin, Registry, and version', async () => {
  const valid = seed();
  const h = harness({ data: { ...fixture(), seeds: [
    valid, seed({ id: OTHER_ID, registry_id: OTHER_ID }),
    seed({ id: FIELD_ID }, { type: legacyType('Seed') }),
    seed({ id: id('e') }, { type: DEPLOYMENT.PACKAGE_ID + '::settlement::Seed' }),
    seed({ id: id('f'), version: '2' }),
  ] } });
  const objects = await h.api.getOwnedObjects(OWNER, 'Seed');
  assert.deepEqual(Array.from(objects, object => object.objectId), [SEED_ID]);
  const reads = h.calls.reader.filter(call => call.name === 'owned');
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].args, [OWNER, settlementType('Seed'), null]);
  assert.equal(h.calls.sign.length, 0);
});

test('a foreign Seed owner invalidates wallet inventory and claim preflight', async () => {
  const h = harness({ data: fixture({ seedChanges: { owner: OTHER_ID } }) });
  await h.connect();
  await assert.rejects(h.api.getOwnedObjects(OWNER, 'Seed'), /owner does not match/);
  await assert.rejects(h.api.claimReward(SEED_ID), /owner does not match/);
  assert.equal(h.calls.sign.length, 0); assert.equal(h.calls.confirmation.length, 0);
});

test('legacy inventory queries historical type origins and never treats its call package as a type origin', async () => {
  const h = harness({ mode: 'legacy', data: { ...fixture(), seeds: [] } });
  await h.api.getOwnedObjects(OWNER, 'Seed');
  const types = h.calls.reader.filter(call => call.name === 'owned').map(call => call.args[1]);
  assert.ok(types.includes(legacyType('Seed')));
  assert.equal(types.includes(LEGACY_PACKAGE + '::arboretum::Seed'), false);
  h.calls.reader.length = 0;
  await h.api.getAllObjectsByStructType('SeasonArchive');
  assert.deepEqual(h.calls.reader.map(call => call.args[0]), [legacyType('SeasonArchive')]);
});

test('reward view pins the Registry, Clock, owned Seeds, and archives to one checkpoint', async () => {
  const h = harness({ data: fixture({ archived: true }) });
  const view = await h.api.getRewardOptions(OWNER);
  assert.equal(view.checkpoint, CP); assert.equal(view.nowMs, Number(NOW));
  assert.equal(view.entries.length, 1); assert.equal(view.entries[0].archiveId, ARCHIVE_ID);
  assert.equal(view.entries[0].reward.amountMist, 400n);
  assert.deepEqual(h.calls.reader.map(call => ({ name: call.name, args: call.args })), [
    { name: 'state', args: [DEPLOYMENT.REGISTRY_ID] },
    { name: 'owned', args: [OWNER, settlementType('Seed'), CP] },
    { name: 'all', args: [settlementType('SeasonArchive'), 10000, CP] },
  ]);
  assert.equal(h.calls.confirmation.length, 0);
});

test('archive matching excludes other Registries and origins before choosing a unique season', async () => {
  const data = fixture({ archived: true });
  data.archives.push(archive({ id: OTHER_ID, registry_id: OTHER_ID }),
    archive({ id: FIELD_ID }, {}, { type: legacyType('SeasonArchive') }));
  const h = harness({ data });
  const entry = (await h.api.getRewardOptions(OWNER)).entries[0];
  assert.equal(entry.archiveId, ARCHIVE_ID); assert.equal(entry.reward.amountMist, 400n);
});

for (const ambiguous of [false, true]) test((ambiguous ? 'ambiguous' : 'missing') + ' season archive produces unknown entitlement', async () => {
  const data = fixture({ archived: true });
  data.archives = ambiguous ? [archive(), archive({ id: OTHER_ID })] : [];
  const h = harness({ data });
  const entry = (await h.api.getRewardOptions(OWNER)).entries[0];
  assert.equal(entry.reward.status, 'unknown'); assert.equal(entry.reward.amountMist, null);
  assert.equal(entry.reward.processable, false); assert.equal(entry.archiveId, null);
  assert.equal(await h.api.getProjectedReward(OWNER), null);
});

test('changed remaining pool and delayed wall-clock drought do not change frozen entitlement', async () => {
  const h = harness({ data: fixture({ nowMs: DEADLINE,
    registryChanges: { reward_pool: '400', paused: true },
    stateChanges: { paid_mist: '600', processed_growth_points: '60', processed_seeds: '2' },
  }) });
  const entry = (await h.api.getRewardOptions(OWNER)).entries[0];
  assert.equal(entry.reward.amountMist, 400n); assert.equal(entry.reward.status, 'claimable');
  assert.equal(entry.reward.estimated, false); assert.equal(entry.reward.processable, true);
  assert.equal(entry.reward.paused, true);
});

test('early-season projected rewards are estimates and cannot enter claim preflight', async () => {
  const data = fixture({ nowMs: START + 1n, registryChanges: { settlement: null, eligible_growth_points: '0' },
    seedChanges: { cutoff_growth_points: '0' } });
  const h = harness({ data }); await h.connect();
  const entry = (await h.api.getRewardOptions(OWNER)).entries[0];
  assert.equal(entry.reward.status, 'estimate'); assert.equal(entry.reward.estimated, true);
  assert.equal(entry.reward.amountMist, 400n); assert.equal(entry.reward.entitlementMist, null);
  await assert.rejects(h.api.claimReward(SEED_ID));
  assert.equal(h.calls.sign.length, 0); assert.equal(h.calls.confirmation.length, 0);
});

for (const archived of [false, true]) for (const zero of [false, true]) {
  test((archived ? 'archived' : 'direct') + ' settlement verifies an exact ' + (zero ? 'zero-value' : 'positive') + ' receipt', async () => {
    const data = fixture({ archived, seedChanges: zero ? { cutoff_growth_points: '0' } : {} });
    const h = harness({ data, response: confirmedResponse([receipt(zero ? { eligible_growth_points: '0', amount_mist: '0' } : {})]) });
    await h.connect();
    const result = archived ? await h.api.claimArchivedReward(SEED_ID, ARCHIVE_ID) : await h.api.claimReward(SEED_ID);
    assert.equal(result.reward.processed, true); assert.equal(result.reward.paid, !zero);
    assert.equal(result.reward.amountMist, zero ? '0' : '400');
    const dataTx = transactionData(h), call = oneMoveCall(dataTx);
    assert.equal(call.package, DEPLOYMENT.PACKAGE_ID); assert.equal(call.module, 'settlement');
    assert.equal(call.function, archived ? 'claim_archived_reward' : 'claim_reward');
    assert.equal(call.arguments.length, 3);
    assert.equal(argumentObjectId(dataTx, call.arguments[0]), archived ? ARCHIVE_ID : DEPLOYMENT.REGISTRY_ID);
    assert.equal(argumentObjectId(dataTx, call.arguments[1]), SEED_ID);
    assert.equal(argumentObjectId(dataTx, call.arguments[2]), model.canonicalAddress('0x6'));
  });
}

for (const [name, events] of [
  ['no receipt', []],
  ['legacy origin', [receipt({}, legacyType('RewardEntitlementProcessed'))]],
  ['call package used as event origin', [receipt({}, DEPLOYMENT.PACKAGE_ID + '::settlement::RewardEntitlementProcessed')]],
  ['another Registry', [receipt({ registry_id: OTHER_ID })]],
  ['another Seed', [receipt({ seed_id: OTHER_ID })]],
  ['another wallet', [receipt({ owner: OTHER_ID })]],
  ['another season', [receipt({ season_id: '2' })]],
  ['different eligible GP', [receipt({ eligible_growth_points: '39' })]],
  ['different payment', [receipt({ amount_mist: '399' })]],
  ['missing payment', [receipt({ amount_mist: undefined })]],
  ['zero for a positive preflight', [receipt({ amount_mist: '0' })]],
  ['two matching receipts', [receipt(), { ...receipt(), sequenceNumber: 1 }]],
]) test(name + ' cannot confirm a settlement payout or cause a second signature', async () => {
  const h = harness({ response: confirmedResponse(events) }); await h.connect();
  await assert.rejects(h.api.claimReward(SEED_ID), error =>
    error.code === 'CLAIM_PAYOUT_UNCONFIRMED' && error.digest === DIGEST);
  assertOneFixtureSignature(h);
});

test('a positive receipt cannot mislabel a genuine zero preflight as paid', async () => {
  const h = harness({ data: fixture({ seedChanges: { cutoff_growth_points: '0' } }),
    response: confirmedResponse([receipt({ eligible_growth_points: '0' })]) });
  await h.connect();
  await assert.rejects(h.api.claimReward(SEED_ID), error => error.code === 'CLAIM_PAYOUT_UNCONFIRMED');
  assertOneFixtureSignature(h);
});

test('a u64 season ID and u64 payment are checked exactly without Number rounding', async () => {
  const maximum = '18446744073709551615';
  const h = harness({ data: fixture({
    registryChanges: { current_season_id: maximum, reward_pool: maximum, eligible_growth_points: maximum, total_growth_points: maximum },
    stateChanges: { season_id: maximum, pool_mist: maximum, eligible_growth_points: maximum },
    seedChanges: { season_id: maximum, growth_points: maximum, cutoff_growth_points: maximum },
  }), response: confirmedResponse([receipt({ season_id: maximum, eligible_growth_points: maximum, amount_mist: maximum })]) });
  await h.connect();
  const result = await h.api.claimReward(SEED_ID);
  assert.equal(result.reward.amountMist, maximum); assert.equal(result.reward.paid, true);
  assertOneFixtureSignature(h);
});

for (const [name, data] of [
  ['expired deadline', fixture({ nowMs: DEADLINE + 1n })],
  ['already processed Seed', fixture({ seedChanges: { reward_processed: true, cutoff_growth_points: '0', growth_points: '0' } })],
  ['missing eligibility field', fixture({ seedChanges: { cutoff_growth_points: undefined } })],
  ['unsupported Seed version', fixture({ seedChanges: { version: '2' } })],
  ['foreign Registry Seed', fixture({ seedChanges: { registry_id: OTHER_ID } })],
]) test(name + ' is refused before a fixture wallet signature', async () => {
  const h = harness({ data }); await h.connect();
  await assert.rejects(h.api.claimReward(SEED_ID));
  assert.equal(h.calls.sign.length, 0); assert.equal(h.calls.confirmation.length, 0);
});

test('archived claim requires the exact matching archive before signing', async () => {
  const h = harness({ data: fixture({ archived: true }) }); await h.connect();
  await assert.rejects(h.api.claimArchivedReward(SEED_ID, OTHER_ID));
  assert.equal(h.calls.sign.length, 0);
});

for (const archived of [false, true]) test('legacy ' + (archived ? 'archived' : 'direct') + ' claims keep their original positive-payment semantics', async () => {
  const type = legacyType(archived ? 'ArchivedRewardClaimed' : 'RewardClaimed');
  const legacyReceipt = receipt({ amount_mist: '400', archive_id: ARCHIVE_ID }, type);
  const h = harness({ mode: 'legacy', response: confirmedResponse([legacyReceipt]) }); await h.connect();
  const result = archived ? await h.api.claimArchivedReward(SEED_ID, ARCHIVE_ID) : await h.api.claimReward(SEED_ID);
  assert.equal(result.reward, undefined);
  const data = transactionData(h), call = oneMoveCall(data);
  assert.equal(call.package, LEGACY_PACKAGE); assert.equal(call.module, 'arboretum');
  assert.equal(call.arguments.length, 3);
  assert.equal(h.calls.reader.length, 0, 'New settlement preflight is not applied to legacy claims');
});

test('legacy zero-payment success is still reported as no payout', async () => {
  const h = harness({ mode: 'legacy', response: confirmedResponse([receipt({ amount_mist: '0' }, legacyType('RewardClaimed'))]) });
  await h.connect();
  await assert.rejects(h.api.claimReward(SEED_ID), error => error.code === 'CLAIM_NO_PAYOUT');
  assertOneFixtureSignature(h);
});

test('review-only preview refuses every funding path and claim before wallet signing', async () => {
  const h = harness({ reviewOnly: true }); await h.connect();
  assert.equal(h.api.getIntegrationStatus().reviewOnly, true);
  for (const action of funding) await assert.rejects(h.api[action.method](...action.args), /preview does not submit/);
  await assert.rejects(h.api.claimReward(SEED_ID), /preview does not submit/);
  await assert.rejects(h.api.signAndExecute(new Transaction()), /preview does not submit/);
  assert.equal(h.calls.sign.length, 0); assert.equal(h.calls.confirmation.length, 0);
});

test('object batches and names use the modern GraphQL reader without retired client calls', async () => {
  const objects = [seed(), moveObject('Tool', { id: OTHER_ID, kind: 'growth_tonic' })];
  const h = harness({ data: { ...fixture(), objects } });
  const result = await h.api.getObjectsByIds([SEED_ID, OTHER_ID, SEED_ID]);
  assert.deepEqual(Array.from(result, object => object.objectId), [SEED_ID, OTHER_ID]);
  assert.equal(await h.api.resolveSuiName(OWNER), 'fixture.sui');
  assert.equal(await h.api.resolveSuiName(OWNER), 'fixture.sui');
  assert.equal(h.calls.reader.filter(call => call.name === 'object').length, 2);
  assert.equal(h.calls.reader.filter(call => call.name === 'query').length, 1, 'Verified name lookup is cached');
  assert.equal(h.calls.clients.length, 0); assert.equal(h.calls.confirmation.length, 0);
});

test('dynamic-field lookup uses the gRPC core API with correctly serialized address and u64 keys', async () => {
  const h = harness({ data: { ...fixture(), objects: [moveObject('Field', { id: FIELD_ID, value: 'fixture' })] } });
  const one = await h.api.getDynamicFieldObject(OTHER_ID, 'address', OWNER);
  const two = await h.api.getDynamicFieldObject(OTHER_ID, 'u64', '18446744073709551615');
  assert.equal(one.objectId, FIELD_ID); assert.equal(two.objectId, FIELD_ID);
  assert.equal(h.calls.clients.length, 1); assert.equal(h.calls.clients[0].network, 'mainnet');
  assert.equal(h.calls.grpc.length, 2); assert.equal(h.calls.grpc[0].parentId, OTHER_ID);
  assert.equal(h.calls.grpc[0].name.type, 'address');
  assert.equal(Buffer.from(h.calls.grpc[0].name.bcs).toString('hex'), OWNER.slice(2));
  assert.equal(Buffer.from(h.calls.grpc[1].name.bcs).readBigUInt64LE(), 18_446_744_073_709_551_615n);
  assert.deepEqual(h.calls.reader.map(call => call.args), [[FIELD_ID], [FIELD_ID]]);
  await assert.rejects(h.api.getDynamicFieldObject(OTHER_ID, 'unsupported', '1'), /Unsupported/);
  assert.equal(h.calls.grpc.length, 2); assert.equal(h.calls.sign.length, 0);
});

test('a verified balance is returned exactly in MIST through the GraphQL reader', async () => {
  const h = harness({ reader: { query: async () => ({ address: { balance: { totalBalance: '18446744073709551615' } } }) } });
  assert.equal(await h.api.getSuiBalance(OWNER), 18_446_744_073_709_551_615n);
  assert.equal(h.calls.reader.length, 1); assert.equal(h.calls.reader[0].name, 'query');
  assert.equal(h.calls.confirmation.length, 0);
});

for (const [name, queryResult] of [
  ['missing balance', { address: {} }],
  ['missing amount', { address: { balance: {} } }],
  ['null address', { address: null }],
  ['negative amount', { address: { balance: { totalBalance: '-1' } } }],
  ['unsafe numeric amount', { address: { balance: { totalBalance: Number.MAX_SAFE_INTEGER + 1 } } }],
]) test(name + ' is unavailable rather than a fabricated zero balance', async () => {
  const h = harness({ reader: { query: async () => queryResult } });
  await assert.rejects(h.api.getSuiBalance(OWNER));
  assert.equal(h.calls.confirmation.length, 0);
});

test('an explicit zero balance remains a verified zero', async () => {
  const h = harness({ reader: { query: async () => ({ address: { balance: { totalBalance: '0' } } }) } });
  assert.equal(await h.api.getSuiBalance(OWNER), 0n);
});

test('Registry read failure cannot become zero player Growth Points', async () => {
  const failure = new Error('fixture Registry read failed');
  const h = harness({ reader: { object: async () => { throw failure; }, state: async () => { throw failure; } } });
  await assert.rejects(h.api.getPlayerCurrentGrowthPoints(OWNER), error => error === failure);
});

test('network failure propagates through reward views and aggregate projections', async () => {
  const failure = new Error('fixture checkpoint read failed');
  const h = harness({ reader: { state: async () => { throw failure; } } });
  await assert.rejects(h.api.getRewardOptions(OWNER), error => error === failure);
  await assert.rejects(h.api.getProjectedReward(OWNER), error => error === failure);
  assert.equal(h.calls.sign.length, 0);
});

test('corrupt reward fields keep the aggregate projection unknown', async () => {
  const h = harness({ data: fixture({ seedChanges: { cutoff_growth_points: 'corrupt' } }) });
  const entry = (await h.api.getRewardOptions(OWNER)).entries[0];
  assert.equal(entry.reward.status, 'unknown'); assert.equal(entry.reward.amountMist, null);
  assert.equal(await h.api.getProjectedReward(OWNER), null);
});

test('collected settlement rewards use only exact matching owner, Registry, type, and event identity', async () => {
  const history = (eventId, changes = {}, type = settlementType('RewardEntitlementProcessed')) => ({
    id: eventId, type, parsedJson: { owner: OWNER, registry_id: DEPLOYMENT.REGISTRY_ID, amount_mist: '500000000', ...changes },
  });
  const h = harness({ data: { ...fixture(), events: [
    history('tx:0'), history('tx:0'), history('tx:1', { amount_mist: '0' }),
    history('tx:2', { owner: OTHER_ID }), history('tx:3', { registry_id: OTHER_ID }),
    history('tx:4', {}, legacyType('RewardClaimed')),
  ] } });
  assert.equal(await h.api.getTotalRewardsCollected(OWNER), 0.5);
  assert.equal(h.calls.reader.length, 1); assert.equal(h.calls.reader[0].name, 'events');
  assert.equal(h.calls.reader[0].args[0], settlementType('RewardEntitlementProcessed'));
});

test('unavailable or corrupt reward history is an error rather than zero collected', async () => {
  const failure = new Error('fixture event read failed');
  const h = harness({ reader: { events: async () => { throw failure; } } });
  await assert.rejects(h.api.getTotalRewardsCollected(OWNER), error => error === failure);
  const corrupt = harness({ data: { ...fixture(), events: [{ id: 'tx:0', type: settlementType('RewardEntitlementProcessed'),
    parsedJson: { owner: OWNER, registry_id: DEPLOYMENT.REGISTRY_ID, amount_mist: undefined } }] } });
  await assert.rejects(corrupt.api.getTotalRewardsCollected(OWNER));
});

test('emitted sources import modern read APIs and keep review configuration explicit', () => {
  for (const source of Object.values(emittedSources)) {
    assert.match(source, /import \{ getWallets, SuiGrpcClient, Transaction, bcs \}/);
    assert.match(source, /import \{ SETTLEMENT_DEPLOYMENT, REVIEW_ONLY \}/);
    assert.doesNotMatch(source, /\bSuiClient\b|\.getOwnedObjects\(|\.multiGetObjects\(|\.getDynamicFieldObject\(/);
  }
});

// The NFTree helper bypasses the Arboretum wallet module. Exercise the actual
// emitted HTML action as well, with fixtures that record every external effect.
async function emittedReviewGame(route, source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arboretum-mint-review-'));
  const target = path.join(directory, 'game.html');
  try {
    fs.writeFileSync(target, applyPartnerReport(source));
    await promisify(execFile)('python3', [path.join(ROOT, 'settlement-integration/ui/transform_game.py'), target, route]);
    return fs.readFileSync(target, 'utf8');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const pickerScripts = new Map();
async function pickerHarness(route, registry) {
  if (!pickerScripts.has(route)) {
    const html = await emittedReviewGame(route);
    const start = html.indexOf('let walletPickerChoices=[];');
    const marker = 'window.triggerConnectIndex=triggerConnectIndex;';
    const end = html.indexOf(marker, start);
    assert.ok(start >= 0 && end > start, 'Exercise the picker functions emitted into the actual review HTML');
    const connectStart = html.indexOf('async function doConnect(walletName=null,expectedWallet=null){');
    const connectEnd = html.indexOf('async function doDisconnect(){', connectStart);
    assert.ok(connectStart >= 0 && connectEnd > connectStart, 'Exercise the actual connection handoff as well');
    pickerScripts.set(route, new vm.Script(html.slice(start, end + marker.length) + '\n' +
      html.slice(connectStart, connectEnd) +
      '\nglobalThis.pickerTestApi={walletOptionsMarkup,triggerConnectIndex,refreshWalletModal};'));
  }
  const h = harness({ mode: route, reviewOnly: true, wallets: registry });
  const notices = [], selections = [], expectedWallets = [], modalActions = [], connected = [];
  const elements = new Map(['wallet-modal', 'wallet-list', 'wallet-btn'].map(name => [name, {
    innerHTML: '', classList: { add() {}, remove(value) { modalActions.push({ name, value }); } },
  }]));
  Object.assign(h.context, {
    $: name => elements.get(name),
    safeImageUrl: () => '', escHTML: value => String(value),
    renderWalletDiagnostics() {}, waitForWalletConnectReady: async () => true,
    toast: message => notices.push(message),
    PA: null, afterConnect: result => connected.push(result),
  });
  h.context.window._getInstalledWallets = registry;
  h.context.window._walletReady = true;
  h.context.window.connectWallet = async (name, expectedWallet) => {
    selections.push(name); expectedWallets.push(expectedWallet);
    return h.api.connectWallet(name, expectedWallet);
  };
  pickerScripts.get(route).runInContext(h.context);
  return { ...h, picker: h.context.pickerTestApi, notices, selections, expectedWallets, modalActions, connected };
}

for (const route of ['legacy', 'settlement']) {
  test(route + ' review picker connects the displayed wallet after registry reordering', async () => {
    const calls = [];
    const chosen = connectionWallet('Displayed Fixture', [OWNER], calls);
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    let registry = [chosen, other];
    const h = await pickerHarness(route, () => registry);
    const markup = h.picker.walletOptionsMarkup(registry);
    assert.ok(markup.indexOf(chosen.name) < markup.indexOf(other.name));
    registry = [other, chosen];
    await h.picker.triggerConnectIndex(0);
    assert.deepEqual(h.selections, [chosen.name]);
    assert.deepEqual(h.expectedWallets, [chosen]);
    assert.deepEqual(calls, [{ name: chosen.name, silent: false }]);
    assert.equal(h.context.window.currentWallet, chosen);
    assert.equal(h.context.window.playerAddress, OWNER);
    assertNoConnectionDataRequests(h);
  });

  test(route + ' review picker never substitutes another wallet when the displayed wallet disappears', async () => {
    const calls = [];
    const chosen = connectionWallet('Displayed Fixture', [OWNER], calls);
    const other = connectionWallet('Other Fixture', [OTHER_ID], calls);
    let registry = [chosen, other];
    const h = await pickerHarness(route, () => registry);
    h.picker.walletOptionsMarkup(registry);
    registry = [other];
    await h.picker.triggerConnectIndex(0);
    assert.match(h.notices.at(-1), /selected wallet is no longer available/);
    assert.deepEqual(h.selections, [chosen.name]);
    assert.deepEqual(calls, []);
    assert.equal(h.context.window.currentWallet, undefined);
    assert.equal(h.context.window.playerAddress, undefined);
    assertNoConnectionDataRequests(h);
  });

  test(route + ' review picker rejects a single replacement provider with the same displayed name', async () => {
    const calls = [];
    const chosen = connectionWallet('Displayed Fixture', [OWNER], calls);
    const replacement = connectionWallet('Displayed Fixture', [OTHER_ID], calls);
    let registry = [chosen];
    const h = await pickerHarness(route, () => registry);
    h.picker.walletOptionsMarkup(registry);
    registry = [replacement];
    await h.picker.triggerConnectIndex(0);
    assert.deepEqual(h.selections, [chosen.name]);
    assert.deepEqual(h.expectedWallets, [chosen]);
    assert.deepEqual(calls, []);
    assert.deepEqual(h.connected, []);
    assert.match(h.notices.at(-1), /selected wallet is no longer available/);
    assert.equal(h.context.window.currentWallet, undefined);
    assert.equal(h.context.window.playerAddress, undefined);
    assertNoConnectionDataRequests(h);
  });

  test(route + ' review rechecks provider identity after asynchronous wallet detection', async () => {
    for (const emptyPolls of [0, 1]) {
      const calls = [];
      const chosen = connectionWallet('Displayed Fixture', [OWNER], calls);
      const replacement = connectionWallet('Displayed Fixture', [OTHER_ID], calls);
      let registry = [chosen], reads = 0;
      const h = await pickerHarness(route, () => {
        reads++;
        if (reads <= emptyPolls) return [];
        const detected = registry;
        if (reads === emptyPolls + 1) queueMicrotask(() => { registry = [replacement]; });
        return detected;
      });
      h.picker.walletOptionsMarkup([chosen]);
      await h.picker.triggerConnectIndex(0);
      assert.equal(reads, emptyPolls + 2, 'Validate the current registry again after detection resolves');
      assert.deepEqual(h.expectedWallets, [chosen]);
      assert.deepEqual(calls, []);
      assert.deepEqual(h.connected, []);
      assert.match(h.notices.at(-1), /selected wallet is no longer available/);
      assert.equal(h.context.window.currentWallet, undefined);
      assert.equal(h.context.window.playerAddress, undefined);
      assert.equal(h.calls.clients.length, 0);
      assertNoConnectionDataRequests(h);
    }
  });

  test(route + ' review picker refuses invalid or stale cards instead of auto-selecting', async () => {
    const calls = [];
    const wallet = connectionWallet('Displayed Fixture', [OWNER], calls);
    const h = await pickerHarness(route, () => [wallet]);
    h.picker.walletOptionsMarkup([wallet]);
    for (const index of [-1, 1, 0.5, '0', null, undefined]) await h.picker.triggerConnectIndex(index);
    h.picker.walletOptionsMarkup([]);
    await h.picker.triggerConnectIndex(0);
    h.picker.walletOptionsMarkup([{ ...wallet, name: '' }]);
    await h.picker.triggerConnectIndex(0);
    h.picker.walletOptionsMarkup([wallet]);
    let finishRefresh;
    h.context.waitForWalletConnectReady = () => new Promise(resolve => { finishRefresh = resolve; });
    const refresh = h.picker.refreshWalletModal();
    await h.picker.triggerConnectIndex(0);
    finishRefresh(); await refresh;
    assert.deepEqual(h.selections, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(h.modalActions, [], 'Keep the wallet picker open for a new choice');
    assert.equal(h.notices.length, 9);
    assert.ok(h.notices.every(message => /wallet choice is no longer available/.test(message)));
    assert.equal(h.context.window.currentWallet, undefined);
    assertNoConnectionDataRequests(h);
  });

  test(route + ' review picker fails closed if another provider registers the displayed name', async () => {
    const calls = [];
    const chosen = connectionWallet('Displayed Fixture', [OWNER], calls);
    const duplicate = connectionWallet('Displayed Fixture', [OTHER_ID], calls);
    let registry = [chosen];
    const h = await pickerHarness(route, () => registry);
    h.picker.walletOptionsMarkup(registry);
    registry = [duplicate, chosen];
    await h.picker.triggerConnectIndex(0);
    assert.match(h.notices.at(-1), /More than one wallet uses the selected name/);
    assert.deepEqual(calls, []);
    assert.equal(h.context.window.currentWallet, undefined);
    assert.equal(h.context.window.playerAddress, undefined);
    assertNoConnectionDataRequests(h);
  });
}

for (const route of ['legacy', 'settlement']) {
  test(route + ' review blocks the independent NFTree mint path before any external effect', async () => {
    const html = await emittedReviewGame(route);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bsrc\s*=|type\s*=\s*["']module/.test(script[1])) new vm.Script(script[2]);
    }
    const start = html.indexOf('async function mintNftreeInArboretum(){');
    const end = html.indexOf('async function doMint(){', start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(html, /NFTREE_MINT_SCRIPT|loadNftreeMintScript|mintWithConnectedWallet|connectAndMint|nftree-wallet-mint\.js/);
    assert.match(html, /<button[^>]+id="mint-here-btn"[^>]+disabled[^>]*>Minting disabled in review<\/button>/);
    assert.match(html, /id="mint-review-notice">NFTree minting is disabled/);

    for (const connected of [true, false]) {
      const calls = { helperLoads: 0, network: 0, wallet: 0, connectionChecks: 0 };
      const notices = [];
      const mint = async () => { calls.wallet++; return { digest: 'fixture-only' }; };
      const helper = { mintWithConnectedWallet: mint, connectAndMint: mint };
      const context = vm.createContext({
        window: { NFTreeWalletMint: helper }, PA: connected ? '0x' + 'd'.repeat(64) : null,
        WALLET_NAME: 'Offline mint regression fixture',
        needWallet() { calls.connectionChecks++; return !connected; },
        loadNftreeMintScript: async () => { calls.helperLoads++; return helper; },
        fetchNftreeSaleStatus: async () => { calls.network++; return { mintPriceMist: '25000000000', pools: [] }; },
        fetch: async () => { calls.network++; throw Error('Network is forbidden in this fixture'); },
        document: { createElement() { calls.helperLoads++; throw Error('Script loading is forbidden in this fixture'); } },
        $: () => ({ textContent: 'Mint NFTree Here', disabled: false }),
        formatMistAsSui: () => '25 SUI', toast: message => notices.push(message),
        updateNftreeAccess: async () => {}, refreshGardenAfterTx() {}, closeAModal2() {}, setActivePanel() {},
        console,
      });
      new vm.Script(html.slice(start, end)).runInContext(context);
      const result = await context.window.mintNftreeInArboretum();
      assert.equal(result.submitted, false); assert.equal(result.reason, 'REVIEW_ONLY');
      assert.deepEqual(calls, { helperLoads: 0, network: 0, wallet: 0, connectionChecks: 0 });
      assert.equal(notices.length, 1); assert.match(notices[0], /minting is disabled.*No wallet transaction/);
    }
  });
}

test('review transform fails closed if the independent mint source anchors change', async () => {
  const original = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const anchor of ['async function loadNftreeMintScript(){', 'async function mintNftreeInArboretum(){']) {
    assert.ok(original.includes(anchor));
    await assert.rejects(emittedReviewGame('legacy', original.replace(anchor, anchor.replace('(){', '() {'))),
      /Review UI section is not unique/);
  }
});
