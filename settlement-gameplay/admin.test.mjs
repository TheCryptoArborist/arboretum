import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { toBase58 } from '@mysten/bcs';
import { createGameplayController, PlantAttemptJournal, isExplicitRejection } from './admin.mjs';
import { PLANT_EXPECTED as EXPECTED, PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY, NFT_PAGE_QUERY } from './plant-core.mjs';
import { createPlantFixtures } from './plant-fixtures.mjs';
const elsewhere = '0x' + '1'.repeat(64);
const clone = value => structuredClone(value);
const syntheticDigest = label => toBase58(createHash('sha256').update('offline-plant-controller:' + label).digest());
function attachExisting(data, fixture, candidate = null) {
  for (const key of Object.keys(data)) if (key in fixture.confirmation.data) data[key] = clone(fixture.confirmation.data[key]);
  delete data.transaction;
  for (const object of [data.registries.nodes[0], ...data.ownedSeeds.nodes]) object.previousTransaction = candidate ? {
    digest: candidate, effects: { status: 'SUCCESS', checkpoint: clone(fixture.confirmation.data.checkpoint) },
  } : null;
}
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class Element {
  children = []; listeners = new Map(); value = ''; checked = false; disabled = false;
  hidden = false; textContent = ''; className = '';
  constructor(tag = 'div') { this.tag = tag; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, [...listeners, listener]);
  }
  async fire(type) {
    return Promise.all((this.listeners.get(type) || []).map(listener => listener({ preventDefault() {} })));
  }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]);
  }
}
function store(value) {
  const listeners = new Set();
  return {
    get: () => value,
    set(next) { value = next; for (const listener of listeners) listener(value); },
    subscribe(listener) { listeners.add(listener); listener(value); return () => listeners.delete(listener); },
  };
}
function wallet(addresses = [EXPECTED.sender, elsewhere]) {
  const raw = {
    name: 'Slush', version: '1.0.0', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: ['sui:mainnet'],
    features: { 'standard:connect': {}, 'standard:events': {}, 'sui:signAndExecuteTransaction': {} },
    accounts: addresses.map(address => ({ address, publicKey: new Uint8Array(32), chains: ['sui:mainnet'], features: ['sui:signAndExecuteTransaction'] })),
  };
  return getOrCreateUiWalletForStandardWallet(raw);
}
async function harness({ storage = new MemoryStorage(), signingError, signRequest, beforeSimulation,
  transformInputs, transformSimulation, confirmationForDigest, paginate = false, beforeNFTPage } = {}) {
  const fixtures = await createPlantFixtures();
  const elements = new Map();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new Element();
        if (id === 'receipt-panel') element.hidden = true;
        elements.set(id, element);
      }
      return elements.get(id);
    },
    createElement: tag => new Element(tag),
  };
  const originalWallet = wallet();
  const wallets = store([originalWallet]);
  const connection = store({ isConnected: false, wallet: null, account: null });
  const network = store('mainnet');
  let signingCalls = 0, networkCalls = 0, simulations = 0, inputReads = 0, nextPage = null, pageReads = 0, lockHeld = false, copiedReceipt;
  const kit = {
    stores: { $wallets: wallets, $connection: connection, $currentNetwork: network },
    async connectWallet({ wallet: selected }) {
      connection.set({ isConnected: true, wallet: selected, account: selected.accounts[0] });
      return { accounts: selected.accounts };
    },
    switchAccount({ account }) { connection.set({ ...connection.get(), account }); },
    async disconnectWallet() { connection.set({ isConnected: false, wallet: null, account: null }); },
    async signAndExecuteTransaction(args) {
      signingCalls += 1;
      assert.equal(args.account.address, EXPECTED.sender);
      assert.equal(args.network, 'mainnet');
      assert.equal(args.transaction.getData().sender, EXPECTED.sender);
      assert.ok(Object.values(args.transaction.getData().gasData).every(value => value === null));
      if (signRequest) return await signRequest(args);
      throw signingError || Object.assign(new Error('User rejected the request'), { code: 4001 });
    },
    getClient: () => ({ async waitForTransaction() {} }),
  };
  const win = {
    location: { origin: EXPECTED.origin }, localStorage: storage, crypto: webcrypto,
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    navigator: { clipboard: { async writeText(value) { copiedReceipt = value; } }, locks: { async request(_name, _options, run) {
      if (lockHeld) return run(null);
      lockHeld = true;
      try { return await run({ name: 'test-lock' }); } finally { lockHeld = false; }
    } } },
    async fetch(url, options) {
      networkCalls += 1;
      assert.equal(url, (EXPECTED.graphqlEndpoint || EXPECTED.endpoint), 'Only the pinned mainnet read endpoint is allowed');
      const { query, variables } = JSON.parse(options.body);
      let response;
      if (query === NFT_PAGE_QUERY) {
        assert.ok(nextPage, 'A pinned page must have been requested by the preceding inventory response');
        assert.deepEqual(variables, nextPage.variables);
        pageReads += 1;
        await beforeNFTPage?.(pageReads, { connection, network, wallets, originalWallet });
        response = nextPage.response; nextPage = null;
      } else if (query === PROOF_QUERY) {
        response = clone(fixtures.proof);
      } else if (query === INPUTS_QUERY) {
        response = clone(fixtures.inputs);
        inputReads += 1; transformInputs?.(response.data, fixtures, inputReads);
      } else if (query === SIMULATION_QUERY) {
        simulations += 1;
        await beforeSimulation?.(simulations, { connection, network, wallets, originalWallet });
        response = clone(fixtures.simulation);
        transformSimulation?.(response.data, simulations, fixtures);
      } else if (query === CONFIRM_QUERY) {
        response = confirmationForDigest ? await confirmationForDigest(variables.digest, fixtures) :
          variables.digest === fixtures.digest ? clone(fixtures.confirmation) : undefined;
        assert.ok(response, 'An explicit synthetic receipt fixture is required');
      } else throw new Error('Unexpected request in offline test');
      if (paginate && query !== NFT_PAGE_QUERY && response?.data?.ownedNFTs?.nodes?.length > 1) {
        const all = response.data.ownedNFTs.nodes;
        const selected = all.find(nft => nft.address === fixtures.nftId);
        const first = all.filter(nft => nft.address !== fixtures.nftId);
        assert.ok(selected && first.length);
        const cursor = 'offline-pinned-nft-page';
        nextPage = { variables: { checkpoint: response.data.checkpoint.sequenceNumber, after: cursor }, response: { data: {
          genesis: clone(response.data.genesis), checkpoint: { sequenceNumber: response.data.checkpoint.sequenceNumber,
            query: { ownedNFTs: { nodes: [selected], pageInfo: { hasNextPage: false, endCursor: null } } } },
        } } };
        response.data.ownedNFTs = { nodes: first, pageInfo: { hasNextPage: true, endCursor: cursor } };
      }
      return { ok: true, json: async () => response };
    },
  };
  const controller = createGameplayController({ window: win, document: doc, dAppKit: kit, now: () => fixtures.now });
  const get = id => doc.getElementById(id);
  return {
    controller, get, win, kit, connection, network, wallets, originalWallet, storage, fixtures,
    counts: () => ({ signingCalls, networkCalls, simulations }), isLockHeld: () => lockHeld,
    copied: () => copiedReceipt,
    async connectAndChoose(index = 0) {
      await get('wallet-list').querySelectorAll('button')[0].fire('click');
      assert.equal(get('account-select').value, '', 'Connection must not implicitly select the first account');
      get('account-select').value = String(index);
      await get('account-select').fire('change');
      await get('use-account').fire('click');
    },
    async review() {
      await this.connectAndChoose();
      await get('load-nfts').fire('click');
      assert.equal(get('nft-select').value, '', 'Loading must not implicitly select an NFTree');
      get('nft-select').value = fixtures.nftId;
      await get('nft-select').fire('change');
      await get('check-plant').fire('click');
      assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true;
      await get('acknowledge').fire('change');
      assert.equal(get('submit-plant').disabled, false);
    },
  };
}

test('connection, explicit account and explicit NFT choice are required before one-Seed review', async () => {
  const h = await harness();
  try {
    assert.deepEqual(h.counts(), { signingCalls: 0, networkCalls: 0, simulations: 0 });
    await h.review();
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 1);
    assert.equal(h.controller.getState().session.account.address, EXPECTED.sender);
    assert.equal(h.controller.getState().selectedNFT.objectId, h.fixtures.nftId);
    assert.equal(h.get('expected-kind').textContent, h.controller.getState().review.loaded.kindSha256);
    assert.match(h.get('projected-water').textContent, /watering/);
  } finally { h.controller.destroy(); }
});

test('wrong administrator cannot load inventory, simulate or open Slush', async () => {
  const h = await harness();
  try {
    await h.connectAndChoose(1);
    assert.equal(h.get('load-nfts').disabled, true);
    assert.equal(h.get('check-plant').disabled, true);
    await h.get('check-plant').fire('click');
    await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 0);
  } finally { h.controller.destroy(); }
});

test('loading NFTrees never chooses the first NFT automatically', async () => {
  const h = await harness();
  try {
    await h.connectAndChoose(); await h.get('load-nfts').fire('click');
    assert.equal(h.get('nft-select').value, '');
    assert.equal(h.controller.getState().selectedNFT, null);
    assert.equal(h.get('check-plant').disabled, true);
    await h.get('check-plant').fire('click');
    assert.equal(h.counts().simulations, 0);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('changing the NFTree invalidates the acknowledged review', async () => {
  const h = await harness();
  try {
    await h.review();
    const second = h.controller.getState().ownedNFTs.find(nft => nft.objectId !== h.fixtures.nftId);
    assert.ok(second, 'Fixture must include a second exact-type NFTree');
    h.get('nft-select').value = second.objectId; await h.get('nft-select').fire('change');
    assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.controller.getState().review, null);
    await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('changed NFT reference after selection stops before simulation', async () => {
  const h = await harness({ transformInputs(data, fixture, count) {
    if (count >= 2) {
      const nft = data.ownedNFTs.nodes.find(nft => nft.address === fixture.nftId);
      nft.version = Number(nft.version) + 1;
      nft.digest = syntheticDigest('changed-nft-reference');
    }
  } });
  try {
    await h.connectAndChoose(); await h.get('load-nfts').fire('click');
    h.get('nft-select').value = h.fixtures.nftId; await h.get('nft-select').fire('change');
    await h.get('check-plant').fire('click');
    assert.match(h.get('status-message').textContent, /reference changed/);
    assert.equal(h.counts().simulations, 0);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('account change during final simulation invalidates review before wallet handoff', async () => {
  const h = await harness({ beforeSimulation(number, { connection, originalWallet }) {
    if (number === 2) connection.set({ isConnected: true, wallet: originalWallet, account: originalWallet.accounts[1] });
  } });
  try {
    await h.review(); await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
    assert.equal(h.controller.getState().selectedNFT, null);
  } finally { h.controller.destroy(); }
});

test('same-address replacement provider cannot inherit a planting review', async () => {
  const h = await harness();
  try {
    await h.review(); const replacement = wallet();
    h.wallets.set([replacement]);
    h.connection.set({ isConnected: true, wallet: replacement, account: replacement.accounts[0] });
    await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
  } finally { h.controller.destroy(); }
});

test('network change during final simulation blocks wallet handoff', async () => {
  const h = await harness({ beforeSimulation(number, { network }) { if (number === 2) network.set('testnet'); } });
  try { await h.review(); await h.get('submit-plant').fire('click'); assert.equal(h.counts().signingCalls, 0); }
  finally { h.controller.destroy(); }
});

test('duplicate clicks create one request; explicit rejection clears only the matching request', async () => {
  const h = await harness();
  try {
    await h.review(); await Promise.all([h.get('submit-plant').fire('click'), h.get('submit-plant').fire('click')]);
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(new PlantAttemptJournal(h.storage).read(), null);
    assert.match(h.get('status-title').textContent, /cancelled in Slush/);
    assert.equal(h.get('submit-plant').disabled, true);
  } finally { h.controller.destroy(); }
});

test('unknown wallet error survives reload and prevents a second paid request', async () => {
  const storage = new MemoryStorage();
  const h = await harness({ storage, signingError: new Error('Wallet response was lost') });
  try {
    await h.review(); await h.get('submit-plant').fire('click'); await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt.phase, 'uncertain');
    const reloaded = await harness({ storage });
    try {
      assert.equal(reloaded.controller.getState().attempt.phase, 'uncertain');
      assert.equal(reloaded.get('submit-plant').disabled, true);
      assert.equal(reloaded.get('recovery-panel').hidden, false);
      assert.equal(reloaded.counts().networkCalls, 0);
      await reloaded.get('check-existing').fire('click');
      assert.equal(reloaded.controller.getState().attempt.phase, 'uncertain');
      assert.equal(reloaded.counts().signingCalls, 0);
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('a read failure in another tab cannot change the in-flight planting journal', async () => {
  const storage = new MemoryStorage();
  let rejectRequest, notifyRequest;
  const requested = new Promise(resolve => { notifyRequest = resolve; });
  const owner = await harness({ storage, signRequest() { notifyRequest(); return new Promise((_resolve, reject) => { rejectRequest = reject; }); } });
  let observer;
  try {
    await owner.review(); const submission = owner.get('submit-plant').fire('click'); await requested;
    observer = await harness({ storage }); observer.win.fetch = async () => { throw Error('Read-only network failure'); };
    await observer.get('check-existing').fire('click');
    assert.equal(new PlantAttemptJournal(storage).read().phase, 'requesting');
    const remove = storage.removeItem.bind(storage);
    storage.removeItem = key => { assert.equal(owner.isLockHeld(), true); remove(key); };
    rejectRequest(Object.assign(Error('Rejected'), { code: 4001 })); await submission;
    assert.equal(new PlantAttemptJournal(storage).read(), null);
    assert.equal(owner.counts().signingCalls, 1); assert.equal(observer.counts().signingCalls, 0);
  } finally { observer?.controller.destroy(); owner.controller.destroy(); }
});

test('journal binds the selected NFTree and kind and rejects unrelated clearing', () => {
  const storage = new MemoryStorage(), journal = new PlantAttemptJournal(storage);
  const binding = { nftId: elsewhere, kindSha256: 'a'.repeat(64) };
  journal.write({ ...binding, phase: 'requesting', nonce: 'original', digest: null });
  assert.throws(() => journal.clearRejected('other'), /changed/);
  journal.write({ ...binding, phase: 'submitted', nonce: 'original', digest: EXPECTED.startDigest });
  assert.throws(() => journal.clearRejected('original'), /changed/);
  const [key] = storage.values.keys();
  storage.setItem(key, '{broken'); assert.equal(journal.read().phase, 'unrecognized');
  storage.setItem(key, ''); assert.equal(journal.read().phase, 'unrecognized');
  assert.throws(() => journal.write({ phase: 'requesting', nonce: 'unbound', digest: null }), /bound/);
});

test('only typed explicit rejection codes count as cancellation', () => {
  assert.equal(isExplicitRejection({ code: 4001 }), true);
  assert.equal(isExplicitRejection({ name: 'WalletStandardError', context: { __code: 4001000 } }), true);
  assert.equal(isExplicitRejection(Error('User rejected request')), false);
  assert.equal(isExplicitRejection(Error('Cancelled while waiting for network')), false);
});

test('current Seed check works without wallet, NFT selection or simulation', async () => {
  const h = await harness();
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0); assert.equal(h.counts().simulations, 0);
    assert.equal(h.connection.get().isConnected, false);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(h.controller.getState().selectedNFT, null);
    assert.match(h.get('status-title').textContent, /Ready for the first test Seed/);
  } finally { h.controller.destroy(); }
});

test('existing Seed without receipt candidate persistently blocks another first plant', async () => {
  const storage = new MemoryStorage();
  const h = await harness({ storage, transformInputs(data, fixture) { attachExisting(data, fixture); } });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.controller.getState().attempt.phase, 'observed-existing');
    assert.equal(h.controller.getState().attempt.digest, null);
    assert.equal(h.get('receipt-panel').hidden, true);
    const reloaded = await harness({ storage });
    try { await reloaded.get('submit-plant').fire('click'); assert.equal(reloaded.counts().signingCalls, 0); }
    finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('wrong discovery candidate stays replaceable and the exact receipt recovers without wallet', async () => {
  const h = await harness({
    transformInputs(data, fixture) { attachExisting(data, fixture, EXPECTED.startDigest); },
    confirmationForDigest(digest, fixture) {
      const response = clone(fixture.confirmation);
      if (digest !== fixture.digest) response.data.transaction.sender.address = elsewhere;
      return response;
    },
  });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.get('transaction-digest').value, EXPECTED.startDigest);
    assert.equal(h.controller.getState().attempt.digest, null);
    h.get('transaction-digest').value = h.fixtures.digest; await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Test Seed confirmed', h.get('status-message').textContent);
    assert.equal(h.get('receipt-registry').textContent, EXPECTED.registryId);
    assert.equal(h.controller.getState().attempt.digest, h.fixtures.digest);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('incomplete NFT inventory prevents selection and simulation', async () => {
  const h = await harness({ transformInputs(data) { data.ownedNFTs.pageInfo.hasNextPage = true; } });
  try {
    await h.connectAndChoose(); await h.get('load-nfts').fire('click');
    assert.equal(h.get('nft-controls').hidden, true);
    assert.equal(h.get('check-plant').disabled, true);
    assert.equal(h.counts().simulations, 0);
  } finally { h.controller.destroy(); }
});

test('changed fee requires fresh acknowledgement before a wallet request', async () => {
  const h = await harness({ transformSimulation(data, number) {
    if (number < 2) return;
    const e = data.simulateTransaction.effects;
    e.gasEffects.gasSummary.computationCost = String(BigInt(e.gasEffects.gasSummary.computationCost) + 1n);
    const balance = e.balanceChangesJson.find(value => value.address === EXPECTED.sender);
    balance.amount = String(BigInt(balance.amount) - 1n);
  } });
  try {
    await h.review(); await h.get('submit-plant').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('status-title').textContent, 'The planting review changed');
    assert.equal(h.get('acknowledge').checked, false);
    h.get('acknowledge').checked = true; await h.get('acknowledge').fire('change');
    await h.get('submit-plant').fire('click'); assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('verified receipt shows the new Seed, payment and exact next-water time and prevents replanting', async () => {
  let fixture;
  const h = await harness({ signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }) });
  fixture = h.fixtures;
  try {
    await h.review(); await h.get('submit-plant').fire('click');
    assert.equal(h.get('status-title').textContent, 'Test Seed confirmed', h.get('status-message').textContent);
    const receipt = h.controller.getState().receipt;
    assert.equal(receipt.nftId, fixture.nftId);
    assert.equal(h.get('receipt-seed').textContent, receipt.seedId);
    assert.equal(BigInt(receipt.waterReadyMs) - BigInt(receipt.plantedAtMs), 77760000n);
    assert.equal(h.get('receipt-digest').textContent, fixture.digest);
    await h.get('copy-receipt').fire('click');
    assert.match(h.copied(), /Planting payment: 0.01 SUI/);
    assert.match(h.copied(), /Reward pool: 0.007 SUI/);
    assert.match(h.copied(), /Next watering eligible:/);
    await h.get('submit-plant').fire('click'); assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('wrong receipt cannot clear or replace the digest returned by Slush', async () => {
  let fixture;
  const observed = [];
  const h = await harness({ signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }),
    confirmationForDigest(digest, f) { observed.push(digest); const response = clone(f.confirmation); response.data.transaction.sender.address = elsewhere; return response; },
  });
  fixture = h.fixtures;
  try {
    await h.review(); await h.get('submit-plant').fire('click');
    assert.equal(h.controller.getState().attempt.digest, fixture.digest);
    assert.equal(h.controller.getState().receipt, null);
    h.get('transaction-digest').value = EXPECTED.startDigest; await h.get('verify-form').fire('submit');
    assert.deepEqual(observed, [fixture.digest]);
    assert.equal(h.get('submit-plant').disabled, true);
  } finally { h.controller.destroy(); }
});

test('storage failure disables paid planting but keeps read-only recovery', async () => {
  const storage = { getItem() { throw Error('Unavailable storage'); }, setItem() { throw Error('Unavailable storage'); }, removeItem() {} };
  const h = await harness({ storage });
  try {
    assert.equal(h.get('submit-plant').disabled, true);
    assert.equal(h.get('recovery-panel').hidden, false);
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.match(h.get('status-title').textContent, /Ready for the first test Seed/);
  } finally { h.controller.destroy(); }
});


test('complete NFT pagination keeps the checkpoint and allows explicit selection from a later page', async () => {
  const h = await harness({ paginate: true });
  try {
    await h.review();
    assert.equal(h.controller.getState().selectedNFT.objectId, h.fixtures.nftId);
    assert.equal(h.controller.getState().ownedNFTs.length, 2);
    assert.equal(h.counts().simulations, 1);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('account change during paginated NFT loading prevents selection and simulation', async () => {
  const h = await harness({ paginate: true, beforeNFTPage(_number, { connection, originalWallet }) {
    connection.set({ isConnected: true, wallet: originalWallet, account: originalWallet.accounts[1] });
  } });
  try {
    await h.connectAndChoose(); await h.get('load-nfts').fire('click');
    assert.equal(h.controller.getState().session, null);
    assert.equal(h.controller.getState().selectedNFT, null);
    assert.equal(h.get('nft-controls').hidden, true);
    assert.equal(h.counts().simulations, 0);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});
