import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Transaction } from '@mysten/sui/transactions';

// These are offline response fixtures. No wallet, RPC, GraphQL or chain write is used.
// The response shape matches the installed Wallet Standard 0.21.1 and SDK 2.19.0,
// and the GraphQL point query verified against mainnet on 2026-10-19.
const DIGEST = '11111111111111111111111111111111';
const ADDRESS = '0x' + '1'.repeat(64);
const TOOL_ID = '0x' + '2'.repeat(64);
const ARCHIVE_ID = '0x' + '3'.repeat(64);
const TYPE_ORIGIN = '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b';
const ARCHIVE_TYPE_ORIGIN = '0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940';
const TOOL_TYPE = TYPE_ORIGIN + '::arboretum::Tool';
const walletSource = fs.readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
const gameSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sdkImport = "import { getWallets, SuiClient, Transaction } from './sui-sdk.bundle.js';";
assert.equal(walletSource.split(sdkImport).length, 2, 'Wallet test import seam must remain unambiguous');
const browserScript = new vm.Script(walletSource.replace(sdkImport, '').replace(/^export /gm, '') +
  '\nglobalThis.walletTestApi={connectWallet,disconnectWallet,signAndExecute,waterSeed,buyCrate,claimReward,claimArchivedReward,batchWaterAllSeeds};',
  { filename: 'wallet.js' });

const page = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function confirmedResponse() {
  return { data: { transaction: { digest: DIGEST, effects: {
    digest: DIGEST, status: 'SUCCESS', executionError: null,
    checkpoint: { sequenceNumber: 123, timestamp: '2026-10-19T17:00:00.000Z' },
    events: page([{ sequenceNumber: 0, sender: { address: ADDRESS }, contents: {
      type: { repr: TYPE_ORIGIN + '::arboretum::CrateOpened' },
      json: { tool_kinds: ['growth_tonic'], rarities: [0] },
    } }]),
    objectChanges: page([{ address: TOOL_ID, idCreated: true, idDeleted: false,
      outputState: { version: 124, digest: 'object-digest', asMoveObject: { contents: { type: { repr: TOOL_TYPE } } } },
    }]),
  } } } };
}
function failedResponse(message = 'MoveAbort(0xabc::arboretum::assert_season_active, 6)') {
  const body = confirmedResponse();
  body.data.transaction.effects.status = 'FAILURE';
  body.data.transaction.effects.executionError = { message };
  body.data.transaction.effects.events = page([]);
  body.data.transaction.effects.objectChanges = page([]);
  return body;
}
function rewardResponse({ archived = false, owner = ADDRESS, amount = '15000000', seedId = TOOL_ID, archiveId = ARCHIVE_ID, type } = {}) {
  const body = confirmedResponse();
  body.data.transaction.effects.events = page([{ sequenceNumber: 0, sender: { address: owner }, contents: {
    type: { repr: type ?? (archived ? ARCHIVE_TYPE_ORIGIN + '::arboretum::ArchivedRewardClaimed' : TYPE_ORIGIN + '::arboretum::RewardClaimed') },
    json: { owner, amount_mist: amount, ...(archived ? { seed_id: seedId, archive_id: archiveId, season_id: '3' } : {}) },
  } }]);
  return body;
}

// Actual SUCCESS + SeedDied event from the unsigned deployed-mainnet claim
// simulation on 2026-10-19. No transaction was submitted. Tests supply a mock
// digest/checkpoint envelope; they do not misrepresent this as a chain receipt.
// Source: gameplay-verification/deployed-probe/claim_reward-simulation-20261019.json
const noPayoutSimulation = {
  status: 'SUCCESS',
  seedId: '0x0055f786810a6094e0d4231968d4b546f3c5e3177d2e71253ef38f8e6ea2dffc',
  owner: '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4',
  events: [{ sequenceNumber: 0, contents: {
    type: { repr: '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::SeedDied' },
    json: {
      seed_id: '0x0055f786810a6094e0d4231968d4b546f3c5e3177d2e71253ef38f8e6ea2dffc',
      owner: '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4',
    },
  } }],
};
function noPayoutResponse() {
  const body = confirmedResponse();
  body.data.transaction.effects.status = noPayoutSimulation.status;
  body.data.transaction.effects.events = page(structuredClone(noPayoutSimulation.events));
  body.data.transaction.effects.objectChanges = page([]);
  return body;
}
const rawWalletResult = () => ({ digest: DIGEST, effects: 'AQ==', bytes: 'mock-bytes', signature: 'mock-signature' });
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
function harness({ result = rawWalletResult(), response = confirmedResponse(), signError = null, accountAddress = ADDRESS } = {}) {
  let now = 0, timerId = 0;
  const calls = { sign: [], reads: [], jsonRpc: 0, timers: new Map() };
  const account = { address: accountAddress, chains: ['sui:mainnet'] };
  const wallet = { name: 'Offline Test Wallet', accounts: [account], features: {
    'sui:signAndExecuteTransaction': { async signAndExecuteTransaction(input) {
      calls.sign.push(input);
      if (signError) throw signError;
      return typeof result === 'function' ? result() : result;
    } },
  } };
  const context = vm.createContext({
    Transaction,
    getWallets: () => ({ get: () => [wallet] }),
    SuiClient: class { waitForTransaction() { calls.jsonRpc++; throw Error('Retired JSON-RPC must not confirm transactions'); } },
    window: {}, document: { dispatchEvent() {} }, Event: class {},
    sessionStorage: storage(), localStorage: storage(),
    console: { warn() {}, error() {}, log() {} }, AbortController,
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++timerId;
      // Advance polling time without a real delay. Longer request timeouts are
      // tracked and cleared; fetch failures/timeouts are injected explicitly.
      if (delay <= 2000) { now += delay; queueMicrotask(callback); }
      else calls.timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { calls.timers.delete(id); },
    async fetch(url, options) {
      const input = { url, options, body: JSON.parse(options.body) };
      calls.reads.push(input);
      const payload = typeof response === 'function' ? await response(input, calls.reads.length) : response;
      if (payload?.httpError) return { ok: false, status: payload.httpError, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => payload };
    },
  });
  browserScript.runInContext(context);
  return { context, calls, wallet, api: context.walletTestApi, connect: () => context.walletTestApi.connectWallet() };
}
function assertOnlyReadsAndOneSignature(h) {
  assert.equal(h.calls.sign.length, 1, 'Each action asks the wallet only once');
  assert.equal(h.calls.jsonRpc, 0);
  assert.equal(h.calls.timers.size, 0, 'Request deadlines are cleaned up');
  for (const { url, options, body } of h.calls.reads) {
    assert.equal(url, 'https://graphql.mainnet.sui.io/graphql');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.match(body.query, /^query ConfirmArboretumTransaction/);
    assert.doesNotMatch(body.query, /\bmutation\b|executeTransaction|simulateTransaction/);
    assert.equal(body.variables.digest, DIGEST);
    assert.equal('signature' in body.variables, false);
    assert.equal('bytes' in body.variables, false);
  }
}

test('raw Wallet Standard effects are confirmed by GraphQL and normalized for current callers', async () => {
  const h = harness(); await h.connect();
  const tx = new Transaction();
  const result = await h.api.signAndExecute(tx);
  assert.equal(h.calls.sign[0].transaction, tx, 'Wallet receives the Transaction instance');
  assert.equal(tx.getData().sender, ADDRESS);
  assert.equal(h.calls.sign[0].chain, 'sui:mainnet');
  assert.equal(result.digest, DIGEST);
  assert.equal(result.bytes, 'mock-bytes'); assert.equal(result.signature, 'mock-signature');
  assert.equal(result.effects.status.status, 'success');
  assert.equal(result.events[0].type, TYPE_ORIGIN + '::arboretum::CrateOpened');
  assert.equal(result.events[0].parsedJson.tool_kinds[0], 'growth_tonic');
  assert.equal(result.objectChanges[0].type, 'created');
  assert.equal(result.objectChanges[0].objectId, TOOL_ID); assert.equal(result.objectChanges[0].objectType, TOOL_TYPE);
  assert.equal(result.checkpoint, '123');
  assertOnlyReadsAndOneSignature(h);
});

test('wallet-provided event/object arrays do not bypass indexed confirmation', async () => {
  const result = { ...rawWalletResult(), effects: { status: { status: 'success' }, gasUsed: { computationCost: '4' } }, events: [], objectChanges: [] };
  const h = harness({ result }); await h.connect();
  const full = await h.api.signAndExecute(new Transaction());
  assert.equal(h.calls.reads.length, 1);
  assert.equal(full.events.length, 1);
  assert.equal(full.effects.gasUsed.computationCost, '4');
  assertOnlyReadsAndOneSignature(h);
});

test('not-yet-indexed responses are polled without a second signature', async () => {
  const h = harness({ response: (_, count) => count < 3 ? { data: { transaction: null } } : confirmedResponse() });
  await h.connect(); const result = await h.api.waterSeed(TOOL_ID);
  assert.equal(result.effects.status.status, 'success'); assert.equal(h.calls.reads.length, 3);
  assertOnlyReadsAndOneSignature(h);
});

test('transient HTTP and GraphQL errors recover through reads only', async () => {
  const h = harness({ response: (_, count) => count === 1 ? { httpError: 503 } : count === 2 ? { errors: [{ message: 'Temporarily unavailable' }] } : confirmedResponse() });
  await h.connect(); await h.api.buyCrate(0); assert.equal(h.calls.reads.length, 3);
  assertOnlyReadsAndOneSignature(h);
});

test('an executed Move failure rejects with the original error and digest', async () => {
  const h = harness({ response: failedResponse() }); await h.connect();
  await assert.rejects(h.api.claimReward(TOOL_ID), error => {
    assert.equal(error.code, 'TRANSACTION_FAILED'); assert.equal(error.digest, DIGEST);
    assert.match(error.message, /MoveAbort\(0xabc::arboretum::assert_season_active, 6\)/);
    return true;
  });
  assertOnlyReadsAndOneSignature(h);
});

test('partial GraphQL errors do not discard an explicit execution failure', async () => {
  const response = failedResponse('MoveAbort(mock, 6)');
  response.errors = [{ message: 'Receipt field unavailable', path: ['transaction', 'effects', 'events'] }];
  response.data.transaction.effects.events = null;
  const h = harness({ response }); await h.connect();
  await assert.rejects(h.api.waterSeed(TOOL_ID), error => error.code === 'TRANSACTION_FAILED' && /MoveAbort\(mock, 6\)/.test(error.message));
  assert.equal(h.calls.reads.length, 1); assertOnlyReadsAndOneSignature(h);
});

test('partial GraphQL errors preserve known success while withholding an incomplete receipt', async () => {
  const response = confirmedResponse();
  response.errors = [{ message: 'Receipt field unavailable', path: ['transaction', 'effects', 'events'] }];
  response.data.transaction.effects.events = null;
  const h = harness({ response }); await h.connect();
  await assert.rejects(h.api.buyCrate(0), error => error.code === 'TRANSACTION_DETAILS_UNAVAILABLE' && /succeeded on Sui/.test(error.message));
  assert.equal(h.calls.reads.length, 1); assertOnlyReadsAndOneSignature(h);
});

test('a parsed failure already returned by the wallet never resolves as success', async () => {
  const h = harness({ result: { ...rawWalletResult(), effects: { status: { status: 'failure', error: 'InsufficientGas' } }, events: [], objectChanges: [] } });
  await h.connect();
  await assert.rejects(h.api.buyCrate(0), error => error.code === 'TRANSACTION_FAILED' && /InsufficientGas/.test(error.message));
  assert.equal(h.calls.reads.length, 0); assertOnlyReadsAndOneSignature(h);
});

for (const [name, response] of [
  ['missing transaction', { data: { transaction: null } }],
  ['missing effects', { data: { transaction: { digest: DIGEST } } }],
  ['missing execution status', { data: { transaction: { digest: DIGEST, effects: { digest: DIGEST } } } }],
  ['missing checkpoint', (() => { const r = confirmedResponse(); r.data.transaction.effects.checkpoint = null; return r; })()],
  ['network timeout', () => { throw Error('Mock request timed out'); }],
]) test(name + ' stays unconfirmed and never replays the transaction', async () => {
  const h = harness({ response }); await h.connect();
  await assert.rejects(h.api.signAndExecute(new Transaction()), error => {
    assert.equal(error.code, 'TRANSACTION_UNCONFIRMED'); assert.equal(error.digest, DIGEST);
    assert.match(error.message, /before trying again/); return true;
  });
  assert.ok(h.calls.reads.length <= 24, 'Polling is bounded');
  assertOnlyReadsAndOneSignature(h);
});

for (const target of ['transaction', 'effects']) test('wrong ' + target + ' digest is rejected', async () => {
  const response = confirmedResponse();
  (target === 'transaction' ? response.data.transaction : response.data.transaction.effects).digest = 'different-digest';
  const h = harness({ response }); await h.connect();
  await assert.rejects(h.api.signAndExecute(new Transaction()), error => error.code === 'TRANSACTION_UNCONFIRMED' && /did not match/.test(error.cause?.message));
  assertOnlyReadsAndOneSignature(h);
});

for (const result of [undefined, null, {}, { digest: '' }, { digest: 123 }, { $kind: 'Transaction', Transaction: { digest: DIGEST } }]) {
  test('malformed or different-API wallet result has no assumed success: ' + JSON.stringify(result), async () => {
    const h = harness({ result: () => result }); await h.connect();
    await assert.rejects(h.api.signAndExecute(new Transaction()), error => error.code === 'TRANSACTION_UNCONFIRMED' && error.digest === null);
    assert.equal(h.calls.reads.length, 0); assertOnlyReadsAndOneSignature(h);
  });
}

test('wallet rejection is propagated without confirmation reads or retry', async () => {
  const rejected = Object.assign(new Error('User rejected the request'), { code: 4001 });
  const h = harness({ signError: rejected }); await h.connect();
  await assert.rejects(h.api.signAndExecute(new Transaction()), error => error === rejected);
  assert.equal(h.calls.reads.length, 0); assertOnlyReadsAndOneSignature(h);
});

test('disconnected wallet is rejected before requesting a signature', async () => {
  const h = harness();
  await assert.rejects(h.api.signAndExecute(new Transaction()), /Wallet not connected/);
  assert.equal(h.calls.sign.length, 0); assert.equal(h.calls.reads.length, 0);
});

test('event/object detail pages are read independently and preserved', async () => {
  const h = harness({ response: ({ body }, count) => {
    const r = confirmedResponse();
    if (count === 1) {
      r.data.transaction.effects.events.pageInfo = { hasNextPage: true, endCursor: 'event-page-2' };
      r.data.transaction.effects.objectChanges.pageInfo = { hasNextPage: true, endCursor: 'object-page-2' };
    } else if (count === 2) {
      assert.equal(body.variables.eventCursor, 'event-page-2'); assert.equal(body.variables.objectCursor, 'object-page-2');
      r.data.transaction.effects.events.nodes[0].sequenceNumber = 1;
      r.data.transaction.effects.objectChanges.nodes[0].address = 'second-object';
      r.data.transaction.effects.objectChanges.pageInfo = { hasNextPage: true, endCursor: 'object-page-3' };
    } else {
      assert.equal(body.variables.readEvents, false); assert.equal(body.variables.objectCursor, 'object-page-3');
      delete r.data.transaction.effects.events;
      r.data.transaction.effects.objectChanges.nodes[0].address = 'third-object';
    }
    return r;
  } });
  await h.connect(); const result = await h.api.signAndExecute(new Transaction());
  assert.equal(result.events.length, 2); assert.equal(result.objectChanges.length, 3);
  assertOnlyReadsAndOneSignature(h);
});

test('a stalled cursor reports a succeeded transaction with unavailable details, not a reason to repeat it', async () => {
  const r = confirmedResponse(); r.data.transaction.effects.events.pageInfo = { hasNextPage: true, endCursor: 'stalled' };
  const h = harness({ response: r }); await h.connect();
  await assert.rejects(h.api.signAndExecute(new Transaction()), error => error.code === 'TRANSACTION_DETAILS_UNAVAILABLE' && /succeeded on Sui/.test(error.message) && /do not repeat/.test(error.message));
  assert.equal(h.calls.reads.length, 2); assertOnlyReadsAndOneSignature(h);
});

test('missing input/output state does not manufacture a created object', async () => {
  const response = confirmedResponse();
  response.data.transaction.effects.objectChanges.nodes = [{ address: TOOL_ID, idCreated: false, idDeleted: false, outputState: null }];
  const h = harness({ response }); await h.connect();
  const result = await h.api.signAndExecute(new Transaction());
  assert.notEqual(result.objectChanges[0].type, 'created');
  assertOnlyReadsAndOneSignature(h);
});

test('a current-season claim resolves with a matching positive payout receipt, retaining its result fields', async () => {
  const h = harness({ response: rewardResponse({ amount: '9007199254740993' }) }); await h.connect();
  const result = await h.api.claimReward(TOOL_ID);
  assert.equal(result.effects.status.status, 'success'); assert.equal(result.digest, DIGEST);
  assert.equal(result.events[0].parsedJson.amount_mist, '9007199254740993', 'u64 amounts are not rounded through Number');
  assert.equal(result.signature, 'mock-signature');
  assert.equal(h.calls.sign[0].transaction.getData().commands[0].MoveCall.function, 'claim_reward');
  assertOnlyReadsAndOneSignature(h);
});

test('the deployed SUCCESS + SeedDied behavior rejects a claim as confirmed with no payout', async () => {
  const h = harness({ accountAddress: noPayoutSimulation.owner, response: noPayoutResponse() }); await h.connect();
  await assert.rejects(h.api.claimReward(noPayoutSimulation.seedId), error => {
    assert.equal(error.code, 'CLAIM_NO_PAYOUT'); assert.equal(error.digest, DIGEST);
    assert.match(error.message, /No reward was paid/); assert.match(error.message, /Seed was marked dead/);
    assert.match(error.message, /Refresh your garden and check the transaction before another claim/);
    return true;
  });
  assertOnlyReadsAndOneSignature(h);
});

for (const [name, options, code = 'CLAIM_PAYOUT_UNCONFIRMED'] of [
  ['zero payout', { amount: '0' }, 'CLAIM_NO_PAYOUT'],
  ['noncanonical amount', { amount: '01' }],
  ['exponent amount', { amount: '1e3' }],
  ['fractional amount', { amount: 1.5 }],
  ['unsafe numeric amount', { amount: 9007199254740992 }],
  ['overflowing u64 amount', { amount: '18446744073709551616' }],
  ['wrong owner', { owner: ARCHIVE_ID }],
  ['fake package event', { type: TOOL_ID + '::arboretum::RewardClaimed' }],
  ['fake module event', { type: TYPE_ORIGIN + '::other_module::RewardClaimed' }],
]) test('a claim cannot report a positive payment from ' + name, async () => {
  const h = harness({ response: rewardResponse(options) }); await h.connect();
  await assert.rejects(h.api.claimReward(TOOL_ID), error => error.code === code && error.digest === DIGEST && /before another claim/.test(error.message));
  assertOnlyReadsAndOneSignature(h);
});

test('a claim with no reward receipt reports confirmed execution without assuming a payout', async () => {
  const response = confirmedResponse(); response.data.transaction.effects.events = page([]);
  const h = harness({ response }); await h.connect();
  await assert.rejects(h.api.claimReward(TOOL_ID), error => error.code === 'CLAIM_PAYOUT_UNCONFIRMED' && /Transaction confirmed on Sui/.test(error.message));
  assertOnlyReadsAndOneSignature(h);
});

test('an archived claim requires its defining upgrade type, owner, Seed and archive, and retains a positive u64 receipt', async () => {
  const h = harness({ response: rewardResponse({ archived: true, amount: '18446744073709551615' }) }); await h.connect();
  const result = await h.api.claimArchivedReward(TOOL_ID, ARCHIVE_ID);
  assert.equal(result.effects.status.status, 'success'); assert.equal(result.digest, DIGEST);
  assert.equal(result.events[0].type, ARCHIVE_TYPE_ORIGIN + '::arboretum::ArchivedRewardClaimed');
  assert.equal(h.calls.sign[0].transaction.getData().commands[0].MoveCall.function, 'claim_archived_reward');
  assertOnlyReadsAndOneSignature(h);
});

for (const [name, options] of [
  ['wrong Seed', { seedId: ADDRESS }],
  ['wrong archive', { archiveId: ADDRESS }],
  ['wrong owner', { owner: ARCHIVE_ID }],
  ['wrong type origin', { type: TYPE_ORIGIN + '::arboretum::ArchivedRewardClaimed' }],
]) test('an archived claim rejects a payout receipt for ' + name, async () => {
  const h = harness({ response: rewardResponse({ archived: true, ...options }) }); await h.connect();
  await assert.rejects(h.api.claimArchivedReward(TOOL_ID, ARCHIVE_ID), error => error.code === 'CLAIM_PAYOUT_UNCONFIRMED' && error.digest === DIGEST);
  assertOnlyReadsAndOneSignature(h);
});

for (const switchedOwnerReceipt of [false, true]) test('claim receipt owner is captured before wallet changes: ' + (switchedOwnerReceipt ? 'reject switched-owner receipt' : 'accept original-signer receipt'), async () => {
  const h = harness({ response: async () => {
    h.wallet.accounts = [{ address: ARCHIVE_ID, chains: ['sui:mainnet'] }];
    await h.connect();
    return rewardResponse({ owner: switchedOwnerReceipt ? ARCHIVE_ID : ADDRESS });
  } });
  await h.connect();
  if (switchedOwnerReceipt) await assert.rejects(h.api.claimReward(TOOL_ID), error => error.code === 'CLAIM_PAYOUT_UNCONFIRMED');
  else assert.equal((await h.api.claimReward(TOOL_ID)).digest, DIGEST);
  assert.equal(h.calls.sign[0].account.address, ADDRESS);
  assertOnlyReadsAndOneSignature(h);
});

test('disconnecting during confirmation does not invalidate the original signer\'s verified archived payout', async () => {
  const h = harness({ response: async () => {
    await h.api.disconnectWallet();
    return rewardResponse({ archived: true });
  } });
  await h.connect();
  assert.equal((await h.api.claimArchivedReward(TOOL_ID, ARCHIVE_ID)).digest, DIGEST);
  assert.equal(h.context.window.playerAddress, null);
  assertOnlyReadsAndOneSignature(h);
});

function attachPurchaseUi(h) {
  const ui = [];
  Object.assign(h.context, {
    needWallet: () => false, txToast: (...args) => ui.push(['toast', ...args]),
    crateTierLabel: () => 'Seedling Crate', showCratePending: () => ui.push(['pending']),
    showCratePurchase: () => ui.push(['purchase']), closeCrate: () => ui.push(['closed']),
    refreshGardenAfterTx: () => ui.push(['refresh']), toast: (...args) => ui.push(['error', ...args]),
  });
  const start = gameSource.indexOf('async function doBuyCrate(tier){');
  const end = gameSource.indexOf('window.doBuyCrate=doBuyCrate;', start) + 'window.doBuyCrate=doBuyCrate;'.length;
  assert.ok(start >= 0 && end > start);
  new vm.Script(gameSource.slice(start, end), { filename: 'index.html:doBuyCrate' }).runInContext(h.context);
  return ui;
}

test('existing purchase UI shows success only after confirmation resolves', async () => {
  let release;
  const confirmation = new Promise(resolve => { release = resolve; });
  const h = harness({ response: () => confirmation }); await h.connect(); const ui = attachPurchaseUi(h);
  const purchase = h.context.window.doBuyCrate(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.some(([kind]) => kind === 'purchase' || kind === 'refresh'), false);
  release(confirmedResponse()); await purchase;
  assert.equal(ui.filter(([kind]) => kind === 'purchase').length, 1);
  assert.equal(ui.filter(([kind]) => kind === 'refresh').length, 1);
  assert.equal(ui.some(([kind]) => kind === 'error'), false);
  assertOnlyReadsAndOneSignature(h);
});

test('existing purchase UI enters its error path on failed execution', async () => {
  const h = harness({ response: failedResponse('MoveAbort(mock, 6)') }); await h.connect(); const ui = attachPurchaseUi(h);
  await h.context.window.doBuyCrate(0);
  assert.equal(ui.some(([kind]) => kind === 'purchase' || kind === 'refresh'), false);
  assert.equal(ui.some(([kind, message]) => kind === 'error' && message.includes('MoveAbort(mock, 6)')), true);
  assertOnlyReadsAndOneSignature(h);
});

function attachClaimUi(h, { owner = ADDRESS, seedId = TOOL_ID } = {}) {
  const ui = [], confirmations = [];
  Object.assign(h.context, {
    PA: owner, needWallet: () => false, requireGardenActive: async () => true,
    isActiveCycleSeed: () => true,
    showConfirm: (copy, callback) => { ui.push(['confirm', copy]); confirmations.push(callback); },
    txToast: (...args) => ui.push(['toast', ...args]), toast: (...args) => ui.push(['error', ...args]),
    refreshGardenAfterTx: () => ui.push(['refresh']),
  });
  Object.assign(h.context.window.arb, {
    getSeasonStats: async () => ({ claimable: true }),
    getOwnedObjects: async () => [{ objectId: seedId, state: 'alive', growthPoints: 188 }],
    parseSeedObject: value => value,
  });
  const errorStart = gameSource.indexOf('function friendlyTxError(action,e){');
  const errorEnd = gameSource.indexOf('async function getOwnedRevivalKits(){', errorStart);
  const claimStart = gameSource.indexOf('async function doClaimReward(){');
  const claimEnd = gameSource.indexOf('window.doClaimReward=doClaimReward;', claimStart) + 'window.doClaimReward=doClaimReward;'.length;
  assert.ok(errorStart >= 0 && errorEnd > errorStart && claimStart >= 0 && claimEnd > claimStart);
  new vm.Script(gameSource.slice(errorStart, errorEnd) + gameSource.slice(claimStart, claimEnd),
    { filename: 'index.html:doClaimReward' }).runInContext(h.context);
  return { ui, async claim() {
    await h.context.window.doClaimReward();
    assert.equal(confirmations.length, 1, 'The existing UI asks once for this claim');
    await confirmations[0]();
  } };
}

test('existing claim UI displays payment confirmation and refreshes only for a verified positive payout', async () => {
  const h = harness({ response: rewardResponse() }); await h.connect(); const view = attachClaimUi(h);
  await view.claim();
  assert.equal(view.ui.filter(([kind, , , cls]) => kind === 'toast' && cls === 'tg').length, 1);
  assert.equal(view.ui.filter(([kind]) => kind === 'refresh').length, 1);
  assert.equal(view.ui.some(([kind]) => kind === 'error'), false);
  assertOnlyReadsAndOneSignature(h);
});

test('existing claim UI does not show reward success for the deployed SUCCESS + SeedDied outcome', async () => {
  const h = harness({ accountAddress: noPayoutSimulation.owner, response: noPayoutResponse() }); await h.connect();
  const view = attachClaimUi(h, { owner: noPayoutSimulation.owner, seedId: noPayoutSimulation.seedId });
  await view.claim();
  assert.equal(view.ui.some(([kind, , , cls]) => kind === 'toast' && cls === 'tg' || kind === 'refresh'), false);
  const error = view.ui.find(([kind]) => kind === 'error');
  assert.match(error?.[1] ?? '', /No reward was paid: this Seed was marked dead/);
  assert.match(error[1], /Refresh your garden and check the transaction before another claim/);
  assert.ok(error[1].includes(DIGEST), 'The UI retains the submitted transaction digest');
  assertOnlyReadsAndOneSignature(h);
});
