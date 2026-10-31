import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { createUpgradeController, UpgradeAttemptJournal, isExplicitRejection } from './admin.mjs';
import { EXPECTED, TIP_QUERY, INPUTS_QUERY, SIMULATION_QUERY } from './upgrade-core.mjs';

const capture = new URL('../settlement-integration/release/evidence/20261031-review/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, capture), 'utf8')).response;
const packet = fs.readFileSync(new URL('upgrade-kind.b64', capture), 'utf8');
const elsewhere = '0x' + '1'.repeat(64);
const clone = value => structuredClone(value);

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
function harness({ storage = new MemoryStorage(), signingError, signRequest, beforeSimulation } = {}) {
  const elements = new Map();
  const doc = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: tag => new Element(tag),
  };
  const originalWallet = wallet();
  const wallets = store([originalWallet]);
  const connection = store({ isConnected: false, wallet: null, account: null });
  const network = store('mainnet');
  let signingCalls = 0, networkCalls = 0, simulations = 0, lockHeld = false, checkpoint;
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
    navigator: { locks: { async request(_name, _options, run) {
      if (lockHeld) return run(null);
      lockHeld = true;
      try { return await run({ name: 'test-lock' }); } finally { lockHeld = false; }
    } } },
    async fetch(url, options) {
      networkCalls += 1;
      if (url === '/admin/settlement-upgrade/upgrade-kind.b64') return { ok: true, text: async () => packet };
      assert.equal(url, EXPECTED.graphqlEndpoint, 'Only the pinned mainnet read endpoint is allowed');
      const { query } = JSON.parse(options.body);
      let response;
      if (query === TIP_QUERY) {
        response = read('checkpoint.json');
        response.data.checkpoint.timestamp = new Date().toISOString();
        checkpoint = clone(response.data.checkpoint);
      } else if (query === INPUTS_QUERY) {
        response = read('chain-inputs.json');
        response.data.checkpoint = clone(checkpoint);
      } else if (query === SIMULATION_QUERY) {
        simulations += 1;
        await beforeSimulation?.(simulations, { connection, network, wallets, originalWallet });
        response = read('upgrade-simulation.json');
        response.data.checkpoint.timestamp = new Date().toISOString();
      } else throw new Error('Unexpected request in offline test');
      return { ok: true, json: async () => response };
    },
  };
  const controller = createUpgradeController({ window: win, document: doc, dAppKit: kit });
  const get = id => doc.getElementById(id);
  return {
    controller, get, win, kit, connection, network, wallets, originalWallet, storage,
    counts: () => ({ signingCalls, networkCalls, simulations }), isLockHeld: () => lockHeld,
    async connectAndChoose(index = 0) {
      await get('wallet-list').querySelectorAll('button')[0].fire('click');
      assert.equal(get('account-select').value, '', 'Connection must not implicitly select the first account');
      get('account-select').value = String(index);
      await get('account-select').fire('change');
      await get('use-account').fire('click');
    },
    async review() {
      await this.connectAndChoose();
      await get('check-release').fire('click');
      assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true;
      await get('acknowledge').fire('change');
      assert.equal(get('submit-upgrade').disabled, false);
    },
  };
}

test('load, connection and successful readiness never request a signature; account choice is explicit', async () => {
  const h = harness();
  try {
    assert.deepEqual(h.counts(), { signingCalls: 0, networkCalls: 0, simulations: 0 });
    await h.review();
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 1);
    assert.equal(h.get('gas-estimate').textContent, '0.337998763 SUI');
    assert.equal(h.controller.getState().session.account.address, EXPECTED.sender);
  } finally { h.controller.destroy(); }
});

test('an explicitly chosen wrong account cannot check or open a wallet review', async () => {
  const h = harness();
  try {
    await h.connectAndChoose(1);
    assert.equal(h.get('check-release').disabled, true);
    assert.equal(h.controller.getState().session, null);
    assert.match(h.get('status-message').textContent, new RegExp(EXPECTED.sender));
    await h.get('submit-upgrade').fire('click');
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('account fallback during final simulation invalidates the acknowledged review before handoff', async () => {
  const h = harness({ beforeSimulation(number, { connection, originalWallet }) {
    if (number === 2) connection.set({ isConnected: true, wallet: originalWallet, account: originalWallet.accounts[1] });
  } });
  try {
    await h.review();
    await h.get('submit-upgrade').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(h.get('submit-upgrade').disabled, true);
  } finally { h.controller.destroy(); }
});

test('a replacement Slush provider with the same address cannot inherit a prior review', async () => {
  const h = harness();
  try {
    await h.review();
    const replacement = wallet();
    h.wallets.set([replacement]);
    h.connection.set({ isConnected: true, wallet: replacement, account: replacement.accounts[0] });
    await h.get('submit-upgrade').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
  } finally { h.controller.destroy(); }
});

test('duplicate clicks produce one explicit request and a definite rejection clears only its own lock', async () => {
  const h = harness();
  try {
    await h.review();
    await Promise.all([h.get('submit-upgrade').fire('click'), h.get('submit-upgrade').fire('click')]);
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(new UpgradeAttemptJournal(h.storage).read(), null);
    assert.equal(h.get('status-title').textContent, 'Upgrade cancelled in Slush');
    assert.equal(h.get('submit-upgrade').disabled, true, 'A rejected request still needs a fresh review');
  } finally { h.controller.destroy(); }
});

test('an uncertain wallet error blocks retries and survives a page reload', async () => {
  const storage = new MemoryStorage();
  const h = harness({ storage, signingError: new Error('Wallet response was lost') });
  try {
    await h.review();
    await h.get('submit-upgrade').fire('click');
    await h.get('submit-upgrade').fire('click');
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt.phase, 'uncertain');
    assert.equal(h.get('recovery-panel').hidden, false);
    const reloaded = harness({ storage });
    try {
      assert.equal(reloaded.controller.getState().attempt.phase, 'uncertain');
      assert.equal(reloaded.get('submit-upgrade').disabled, true);
      assert.equal(reloaded.get('recovery-panel').hidden, false);
      assert.equal(reloaded.counts().networkCalls, 0, 'Reload must not silently send any request');
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('the fixed mainnet selection is revalidated before a wallet handoff', async () => {
  const h = harness({ beforeSimulation(number, { network }) { if (number === 2) network.set('testnet'); } });
  try {
    await h.review();
    await h.get('submit-upgrade').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('submit-upgrade').disabled, true);
  } finally { h.controller.destroy(); }
});

test('a second tab read failure cannot change an in-flight request or prevent its rejection cleanup', async () => {
  const storage = new MemoryStorage();
  let rejectRequest, notifyRequest;
  const requestStarted = new Promise(resolve => { notifyRequest = resolve; });
  const owner = harness({ storage, signRequest() {
    notifyRequest();
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  } });
  let observer;
  try {
    await owner.review();
    const submission = owner.get('submit-upgrade').fire('click');
    await requestStarted;
    observer = harness({ storage });
    assert.equal(new UpgradeAttemptJournal(storage).read().phase, 'requesting');
    observer.win.fetch = async () => { throw new Error('Read-only network check failed'); };
    await observer.get('check-existing').fire('click');
    assert.equal(new UpgradeAttemptJournal(storage).read().phase, 'requesting',
      'A second tab may show a read error but must not mutate the request owner’s journal');
    const remove = storage.removeItem.bind(storage);
    storage.removeItem = key => {
      assert.equal(owner.isLockHeld(), true, 'Cancellation must clear the journal before releasing the exclusive lock');
      remove(key);
    };
    rejectRequest(Object.assign(new Error('User rejected the request'), { code: 4001 }));
    await submission;
    assert.equal(new UpgradeAttemptJournal(storage).read(), null);
    assert.equal(owner.get('status-title').textContent, 'Upgrade cancelled in Slush');
    assert.equal(owner.counts().signingCalls, 1);
    assert.equal(observer.counts().signingCalls, 0);
  } finally { observer?.controller.destroy(); owner.controller.destroy(); }
});

test('saved locks fail closed and cannot be cleared by a different request or after submission', () => {
  const storage = new MemoryStorage();
  const journal = new UpgradeAttemptJournal(storage);
  journal.write({ phase: 'requesting', nonce: 'original', digest: null });
  assert.throws(() => journal.clearRejected('other'), /changed/);
  journal.write({ phase: 'submitted', nonce: 'original', digest: '1'.repeat(44) });
  assert.throws(() => journal.clearRejected('original'), /changed/);
  const [key] = storage.values.keys();
  storage.setItem(key, '{broken');
  assert.equal(journal.read().phase, 'unrecognized');
  storage.setItem(key, '');
  assert.equal(journal.read().phase, 'unrecognized', 'A present empty journal must fail closed');
});

test('only explicit rejection codes are treated as cancellation', () => {
  assert.equal(isExplicitRejection({ code: 4001 }), true);
  assert.equal(isExplicitRejection({ name: 'WalletStandardError', context: { __code: 4001000 } }), true);
  assert.equal(isExplicitRejection(new Error('Cancelled while waiting for the network')), false);
  assert.equal(isExplicitRejection(new Error('User rejected the request')), false);
});
