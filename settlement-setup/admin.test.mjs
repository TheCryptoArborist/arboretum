import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { createSetupController, SetupAttemptJournal, isExplicitRejection } from './admin.mjs';
import { SETUP_EXPECTED as EXPECTED, TIP_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY, loadReviewedSetup } from './setup-core.mjs';
import { toBase64 } from '@mysten/bcs';

const capture = new URL('../settlement-integration/release/evidence/20261031-empty-registry-review/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, capture), 'utf8')).response;
const packet = fs.readFileSync(new URL('setup-kind.b64', capture), 'utf8');
const elsewhere = '0x' + '1'.repeat(64);
const clone = value => structuredClone(value);
const confirmedUpgradeCapture = new URL('../settlement-integration/release/evidence/20261031-confirmed-upgrade/', import.meta.url);
const upgradeData = JSON.parse(fs.readFileSync(new URL('receipt.json', confirmedUpgradeCapture), 'utf8')).response.data;
const networkData = JSON.parse(fs.readFileSync(new URL('network.json', confirmedUpgradeCapture), 'utf8')).response.data;
const empty = () => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
function baseData() {
  const { transaction, ...authority } = clone(upgradeData);
  return { ...authority, upgradeTransaction: transaction, genesis: clone(networkData.genesis),
    checkpoint: { sequenceNumber: 340100000, timestamp: new Date().toISOString(), digest: networkData.checkpoint.digest },
    registries: empty(), adminCaps: empty() };
}
// Synthetic successful setup receipt only. No signature is made, no wallet is
// accessed, and these IDs are never published as real deployment evidence.
async function confirmedFixture() {
  const { transaction } = await loadReviewedSetup(packet);
  transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasPrice(1000);
  transaction.setGasBudget(10000000);
  transaction.setGasPayment([]);
  transaction.setExpiration({ Epoch: 9999 });
  const transactionBcs = toBase64(await transaction.build());
  const digest = await transaction.getDigest();
  const data = baseData();
  const simulationEffects = clone(read('setup-simulation.json').data.simulateTransaction.effects);
  const remap = new Map(simulationEffects.objectChanges.nodes.filter(change => change.idCreated)
    .map((change, index) => [change.address, `0x${String(index + 31).padStart(64, '0')}`]));
  function replace(value) {
    if (typeof value === 'string') return remap.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  }
  const effects = replace(simulationEffects);
  effects.checkpoint = { sequenceNumber: 340099999, timestamp: new Date().toISOString() };
  const outputVersion = Number(BigInt(EXPECTED.legacyAdminCap.version) + 1n);
  for (const change of effects.objectChanges.nodes) {
    if (!change.outputState) continue;
    change.outputState.version = outputVersion;
    delete change.outputState.previousTransaction;
    if (change.outputState.owner?.__typename === 'Shared') change.outputState.owner.initialSharedVersion = outputVersion;
  }
  const registry = effects.objectChanges.nodes.find(change => change.outputState?.asMoveObject?.contents?.type?.repr === EXPECTED.registryType).outputState;
  const cap = effects.objectChanges.nodes.find(change => change.outputState?.asMoveObject?.contents?.type?.repr === EXPECTED.adminCapType).outputState;
  data.legacyAdminCap = effects.objectChanges.nodes.find(change => change.address === EXPECTED.legacyAdminCap.objectId).outputState;
  registry.previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint: effects.checkpoint } };
  cap.previousTransaction = clone(registry.previousTransaction);
  data.registries.nodes = [clone(registry)];
  data.adminCaps.nodes = [clone(cap)];
  data.transaction = { digest, transactionBcs, sender: { address: EXPECTED.sender }, effects };
  return { digest, response: { data }, registryId: registry.address, adminCapId: cap.address };
}
function attachExisting(data, fixture, candidate = null) {
  for (const key of ['legacyAdminCap', 'registries', 'adminCaps']) data[key] = clone(fixture.response.data[key]);
  data.registries.nodes[0].previousTransaction = candidate ? {
    digest: candidate, effects: { status: 'SUCCESS', checkpoint: fixture.response.data.transaction.effects.checkpoint },
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
function harness({ storage = new MemoryStorage(), signingError, signRequest, beforeSimulation,
  transformInputs, transformSimulation, confirmationForDigest } = {}) {
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
  let signingCalls = 0, networkCalls = 0, simulations = 0, lockHeld = false, checkpoint, copiedReceipt;
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
      if (url === '/admin/settlement-setup/setup-kind.b64') return { ok: true, text: async () => packet };
      assert.equal(url, EXPECTED.graphqlEndpoint, 'Only the pinned mainnet read endpoint is allowed');
      const { query, variables } = JSON.parse(options.body);
      let response;
      if (query === TIP_QUERY) {
        response = { data: baseData() };
        checkpoint = clone(response.data.checkpoint);
      } else if (query === INPUTS_QUERY) {
        response = { data: { ...baseData(), checkpoint: clone(checkpoint), reviewCheckpoint: clone(checkpoint) } };
        transformInputs?.(response.data);
      } else if (query === SIMULATION_QUERY) {
        simulations += 1;
        await beforeSimulation?.(simulations, { connection, network, wallets, originalWallet });
        response = { data: { ...baseData(), simulateTransaction: read('setup-simulation.json').data.simulateTransaction } };
        transformSimulation?.(response.data, simulations);
      } else if (query === CONFIRM_QUERY) {
        response = await confirmationForDigest?.(variables.digest);
        assert.ok(response, 'An explicit synthetic receipt fixture is required');
      } else throw new Error('Unexpected request in offline test');
      return { ok: true, json: async () => response };
    },
  };
  const controller = createSetupController({ window: win, document: doc, dAppKit: kit });
  const get = id => doc.getElementById(id);
  return {
    controller, get, win, kit, connection, network, wallets, originalWallet, storage,
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
      await get('check-setup').fire('click');
      assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true;
      await get('acknowledge').fire('change');
      assert.equal(get('submit-setup').disabled, false);
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
    assert.equal(h.get('gas-estimate').textContent, '0.005632932 SUI');
    assert.equal(h.controller.getState().session.account.address, EXPECTED.sender);
  } finally { h.controller.destroy(); }
});

test('an explicitly chosen wrong account cannot check or open a wallet review', async () => {
  const h = harness();
  try {
    await h.connectAndChoose(1);
    assert.equal(h.get('check-setup').disabled, true);
    assert.equal(h.controller.getState().session, null);
    assert.match(h.get('status-message').textContent, new RegExp(EXPECTED.sender));
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('account fallback during final simulation invalidates the acknowledged review before handoff', async () => {
  const h = harness({ beforeSimulation(number, { connection, originalWallet }) {
    if (number === 2) connection.set({ isConnected: true, wallet: originalWallet, account: originalWallet.accounts[1] });
  } });
  try {
    await h.review();
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(h.get('submit-setup').disabled, true);
  } finally { h.controller.destroy(); }
});

test('a replacement Slush provider with the same address cannot inherit a prior review', async () => {
  const h = harness();
  try {
    await h.review();
    const replacement = wallet();
    h.wallets.set([replacement]);
    h.connection.set({ isConnected: true, wallet: replacement, account: replacement.accounts[0] });
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
  } finally { h.controller.destroy(); }
});

test('duplicate clicks produce one explicit request and a definite rejection clears only its own lock', async () => {
  const h = harness();
  try {
    await h.review();
    await Promise.all([h.get('submit-setup').fire('click'), h.get('submit-setup').fire('click')]);
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(new SetupAttemptJournal(h.storage).read(), null);
    assert.equal(h.get('status-title').textContent, 'Setup cancelled in Slush');
    assert.equal(h.get('submit-setup').disabled, true, 'A rejected request still needs a fresh review');
  } finally { h.controller.destroy(); }
});

test('an uncertain wallet error blocks retries and survives a page reload', async () => {
  const storage = new MemoryStorage();
  const h = harness({ storage, signingError: new Error('Wallet response was lost') });
  try {
    await h.review();
    await h.get('submit-setup').fire('click');
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt.phase, 'uncertain');
    assert.equal(h.get('recovery-panel').hidden, false);
    const reloaded = harness({ storage });
    try {
      assert.equal(reloaded.controller.getState().attempt.phase, 'uncertain');
      assert.equal(reloaded.get('submit-setup').disabled, true);
      assert.equal(reloaded.get('recovery-panel').hidden, false);
      assert.equal(reloaded.counts().networkCalls, 0, 'Reload must not silently send any request');
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('the fixed mainnet selection is revalidated before a wallet handoff', async () => {
  const h = harness({ beforeSimulation(number, { network }) { if (number === 2) network.set('testnet'); } });
  try {
    await h.review();
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('submit-setup').disabled, true);
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
    const submission = owner.get('submit-setup').fire('click');
    await requestStarted;
    observer = harness({ storage });
    assert.equal(new SetupAttemptJournal(storage).read().phase, 'requesting');
    observer.win.fetch = async () => { throw new Error('Read-only network check failed'); };
    await observer.get('check-existing').fire('click');
    assert.equal(new SetupAttemptJournal(storage).read().phase, 'requesting',
      'A second tab may show a read error but must not mutate the request owner’s journal');
    const remove = storage.removeItem.bind(storage);
    storage.removeItem = key => {
      assert.equal(owner.isLockHeld(), true, 'Cancellation must clear the journal before releasing the exclusive lock');
      remove(key);
    };
    rejectRequest(Object.assign(new Error('User rejected the request'), { code: 4001 }));
    await submission;
    assert.equal(new SetupAttemptJournal(storage).read(), null);
    assert.equal(owner.get('status-title').textContent, 'Setup cancelled in Slush');
    assert.equal(owner.counts().signingCalls, 1);
    assert.equal(observer.counts().signingCalls, 0);
  } finally { observer?.controller.destroy(); owner.controller.destroy(); }
});

test('saved locks fail closed and cannot be cleared by a different request or after submission', () => {
  const storage = new MemoryStorage();
  const journal = new SetupAttemptJournal(storage);
  journal.write({ phase: 'requesting', nonce: 'original', digest: null });
  assert.throws(() => journal.clearRejected('other'), /changed/);
  journal.write({ phase: 'submitted', nonce: 'original', digest: EXPECTED.upgradeDigest });
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

test('a fresh browser can check existing setup without connecting or submitting', async () => {
  const h = harness();
  try {
    assert.equal(h.get('recovery-panel').hidden, false);
    assert.equal(h.counts().networkCalls, 0);
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 0);
    assert.equal(h.connection.get().isConnected, false);
    assert.equal(h.get('status-title').textContent, 'No existing settlement Registry found');
    assert.equal(h.get('submit-setup').disabled, true);
  } finally { h.controller.destroy(); }
});

test('an existing Registry without a recovery candidate blocks a fresh browser persistently', async () => {
  const fixture = await confirmedFixture();
  const storage = new MemoryStorage();
  const h = harness({ storage, transformInputs(data) { attachExisting(data, fixture); } });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().attempt.phase, 'observed-existing');
    assert.equal(h.controller.getState().attempt.digest, null);
    assert.equal(h.controller.getState().receipt, null);
    assert.equal(h.get('receipt-panel').hidden, true);
    assert.equal(h.get('submit-setup').disabled, true);
    const reloaded = harness({ storage });
    try {
      await reloaded.get('submit-setup').fire('click');
      assert.equal(reloaded.counts().signingCalls, 0);
      assert.equal(reloaded.get('submit-setup').disabled, true);
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('a wrong previous-transaction candidate stays replaceable and does not masquerade as a setup receipt', async () => {
  const fixture = await confirmedFixture();
  const wrongCandidate = EXPECTED.upgradeDigest;
  const h = harness({
    transformInputs(data) { attachExisting(data, fixture, wrongCandidate); },
    confirmationForDigest(digest) {
      if (digest === fixture.digest) return clone(fixture.response);
      assert.equal(digest, wrongCandidate);
      return { data: { ...clone(fixture.response.data), transaction: clone(upgradeData.transaction) } };
    },
  });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.get('transaction-digest').value, wrongCandidate);
    assert.equal(h.controller.getState().attempt.digest, null, 'An unverified candidate must not pin recovery to the wrong digest');
    assert.equal(h.controller.getState().receipt, null);
    assert.equal(h.get('receipt-registry').textContent, '');
    assert.equal(h.get('submit-setup').disabled, true);
    h.get('transaction-digest').value = fixture.digest;
    await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Setup confirmed', h.get('status-message').textContent);
    assert.equal(h.get('receipt-registry').textContent, fixture.registryId);
    assert.equal(h.get('receipt-admin-cap').textContent, fixture.adminCapId);
    assert.equal(h.controller.getState().attempt.digest, fixture.digest);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('multiple Registry inventories block readiness before simulation or wallet signing', async () => {
  const fixture = await confirmedFixture();
  const h = harness({ transformInputs(data) {
    attachExisting(data, fixture);
    data.registries.nodes.push(clone(data.registries.nodes[0]));
  } });
  try {
    await h.connectAndChoose();
    await h.get('check-setup').fire('click');
    assert.equal(h.get('submit-setup').disabled, true);
    assert.equal(h.get('acknowledge').disabled, true);
    assert.equal(h.get('recovery-panel').hidden, false);
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 0);
  } finally { h.controller.destroy(); }
});

test('a changed setup fee requires a new acknowledgement before the one wallet request', async () => {
  const h = harness({ transformSimulation(data, number) {
    if (number < 2) return;
    const effects = data.simulateTransaction.effects;
    const gas = effects.gasEffects.gasSummary;
    gas.computationCost = String(BigInt(gas.computationCost) + 1n);
    effects.balanceChangesJson[0].amount = String(BigInt(effects.balanceChangesJson[0].amount) - 1n);
  } });
  try {
    await h.review();
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('gas-estimate').textContent, '0.005632933 SUI');
    assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.get('submit-setup').disabled, true);
    h.get('acknowledge').checked = true;
    await h.get('acknowledge').fire('change');
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('only a verified actual receipt displays object IDs and supplies the complete copied receipt', async () => {
  const fixture = await confirmedFixture();
  const h = harness({
    signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }),
    confirmationForDigest: digest => { assert.equal(digest, fixture.digest); return clone(fixture.response); },
  });
  try {
    await h.review();
    assert.equal(h.get('receipt-registry').textContent, '', 'Simulation IDs cannot populate the receipt');
    assert.equal(h.get('receipt-admin-cap').textContent, '');
    await h.get('submit-setup').fire('click');
    assert.equal(h.get('status-title').textContent, 'Setup confirmed', h.get('status-message').textContent);
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.get('receipt-panel').hidden, false);
    assert.equal(h.get('receipt-digest').textContent, fixture.digest);
    assert.equal(h.get('receipt-registry').textContent, fixture.registryId);
    assert.equal(h.get('receipt-admin-cap').textContent, fixture.adminCapId);
    assert.equal(h.get('receipt-package').textContent, EXPECTED.packageId);
    await h.get('copy-receipt').fire('click');
    assert.equal(h.copied(), `Arboretum settlement setup · Sui mainnet\nTransaction: ${fixture.digest}\nRegistry: ${fixture.registryId}\nAdministrator capability: ${fixture.adminCapId}\nPackage: ${EXPECTED.packageId}`);
    await h.get('submit-setup').fire('click');
    assert.equal(h.counts().signingCalls, 1, 'A confirmed setup cannot be resubmitted');
  } finally { h.controller.destroy(); }
});

test('a historical empty-creation receipt reports later Registry activity without enabling another setup', async () => {
  const fixture = await confirmedFixture();
  const currentRegistry = fixture.response.data.registries.nodes[0];
  currentRegistry.version += 1;
  currentRegistry.asMoveObject.contents.json.current_season_id = '1';
  const h = harness({ confirmationForDigest: () => clone(fixture.response) });
  try {
    h.get('transaction-digest').value = fixture.digest;
    await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Setup confirmed', h.get('status-message').textContent);
    assert.equal(h.get('receipt-heading').textContent, 'The setup receipt is verified.');
    assert.match(h.get('receipt-state-message').textContent, /Registry or administrator objects have since changed/);
    assert.equal(h.controller.getState().receipt.currentEmpty, false);
    assert.equal(h.controller.getState().receipt.hasAdvanced, true);
    assert.equal(h.get('submit-setup').disabled, true);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('an existing-inventory candidate cannot replace a known wallet-returned digest', async () => {
  const fixture = await confirmedFixture();
  let confirmed = false;
  const requestedDigests = [];
  const h = harness({
    signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }),
    transformInputs(data) { if (confirmed) attachExisting(data, fixture, EXPECTED.upgradeDigest); },
    confirmationForDigest(digest) {
      requestedDigests.push(digest);
      if (confirmed) return clone(fixture.response);
      return { data: { ...clone(fixture.response.data), transaction: clone(upgradeData.transaction) } };
    },
  });
  try {
    await h.review();
    await h.get('submit-setup').fire('click');
    assert.equal(h.controller.getState().attempt.digest, fixture.digest);
    assert.equal(h.controller.getState().receipt, null);
    h.get('transaction-digest').value = EXPECTED.upgradeDigest;
    await h.get('verify-form').fire('submit');
    assert.deepEqual(requestedDigests, [fixture.digest], 'A different manually entered digest cannot replace the returned wallet digest');
    confirmed = true;
    await h.get('check-existing').fire('click');
    assert.deepEqual(requestedDigests, [fixture.digest, fixture.digest], 'Recovery must prefer the known wallet digest over an inventory candidate');
    assert.equal(h.controller.getState().receipt.digest, fixture.digest);
    assert.equal(h.controller.getState().attempt.digest, fixture.digest);
    assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('a valid 42-character wallet digest survives the journal and reaches read-only receipt recovery', async () => {
  const digest = '11Cd4BX7vopdUjCBe56dfR9Mw86iDpdcAZbJ2yE8jR';
  const storage = new MemoryStorage();
  const observed = [];
  const confirmationForDigest = value => {
    observed.push(value);
    throw new Error('The synthetic receipt is intentionally unavailable.');
  };
  const h = harness({ storage, confirmationForDigest,
    signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest } }),
  });
  let reloaded;
  try {
    assert.equal(digest.length, 42);
    await h.review();
    await h.get('submit-setup').fire('click');
    assert.deepEqual(observed, [digest]);
    assert.equal(new SetupAttemptJournal(storage).read().digest, digest);
    assert.equal(h.controller.getState().attempt.digest, digest);
    assert.equal(h.controller.getState().receipt, null);
    reloaded = harness({ storage, confirmationForDigest });
    assert.equal(reloaded.get('transaction-digest').value, digest);
    await reloaded.get('verify-form').fire('submit');
    assert.deepEqual(observed, [digest, digest]);
    assert.equal(reloaded.controller.getState().attempt.digest, digest);
    assert.equal(reloaded.get('submit-setup').disabled, true);
    assert.equal(reloaded.counts().signingCalls, 0);
  } finally { reloaded?.controller.destroy(); h.controller.destroy(); }
});

test('administrator-only object advancement does not claim the empty Registry has later activity', async () => {
  const fixture = await confirmedFixture();
  fixture.response.data.legacyAdminCap = clone(fixture.response.data.legacyAdminCap);
  fixture.response.data.legacyAdminCap.version += 1;
  const h = harness({ confirmationForDigest: () => clone(fixture.response) });
  try {
    h.get('transaction-digest').value = fixture.digest;
    await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Setup confirmed', h.get('status-message').textContent);
    assert.equal(h.controller.getState().receipt.currentEmpty, true);
    assert.equal(h.controller.getState().receipt.hasAdvanced, true);
    assert.match(h.get('receipt-state-message').textContent, /Registry or administrator objects have since changed/);
    assert.doesNotMatch(h.get('receipt-state-message').textContent, /The Registry has since changed/);
    assert.doesNotMatch(h.get('status-message').textContent, /The Registry has later activity/);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});
