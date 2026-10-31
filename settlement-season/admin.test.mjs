import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64, toBase58 } from '@mysten/bcs';
import { createSeasonController, SeasonAttemptJournal, isExplicitRejection } from './admin.mjs';
import { START_EXPECTED as EXPECTED, PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY } from './start-core.mjs';

const capture = new URL('../settlement-integration/verification/season-test-20261031/mainnet/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, capture), 'utf8')).response;
const kind = fs.readFileSync(new URL('unsigned-start-kind.b64', capture), 'utf8').trim();
const elsewhere = '0x' + '1'.repeat(64);
const clone = value => structuredClone(value);
const syntheticDigest = label => toBase58(createHash('sha256').update('offline-season-controller:' + label).digest());
// Explicitly synthetic fixtures. Captured public shapes are advanced only for
// offline freshness; unsigned BCS supplies a recomputable test receipt digest.
// There is no keypair, signing primitive, real wallet or live network here.
async function createFixtures() {
  const inputs = { data: clone(read('inputs.json').data) };
  const proof = { data: clone(read('confirmed-proof.json').data) };
  const simulation = { data: clone(read('simulation.json').data) };
  const capturedStart = BigInt(simulation.data.simulateTransaction.effects.events.nodes[0].contents.json.start_ms);
  const actualStart = BigInt(Date.now() - 3000);
  const delta = actualStart - capturedStart;
  const shift = value => String(BigInt(value) + delta);
  for (const response of [inputs, proof, simulation]) {
    response.data.checkpoint.timestamp = new Date(Date.parse(response.data.checkpoint.timestamp) + Number(delta)).toISOString();
    if (response.data.clock) response.data.clock.asMoveObject.contents.json.timestamp_ms = shift(response.data.clock.asMoveObject.contents.json.timestamp_ms);
  }
  const effects = simulation.data.simulateTransaction.effects;
  effects.events.nodes[0].contents.json.start_ms = shift(effects.events.nodes[0].contents.json.start_ms);
  effects.unchangedConsensusObjects.nodes[0].object.asMoveObject.contents.json.timestamp_ms = String(actualStart);
  const outputRegistry = effects.objectChanges.nodes.find(change => change.address === EXPECTED.registryId).outputState;
  outputRegistry.asMoveObject.contents.json.season_start_ms = shift(outputRegistry.asMoveObject.contents.json.season_start_ms);

  const confirmedEffects = clone(effects);
  const resolved = Transaction.from(effects.transaction.transactionBcs).getData();
  const transaction = Transaction.fromKind(kind);
  transaction.setSender(EXPECTED.sender);
  transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasPrice(resolved.gasData.price);
  transaction.setGasBudget(EXPECTED.maxGasMist);
  transaction.setGasPayment([]);
  transaction.setExpiration(resolved.expiration);
  const bytes = toBase64(await transaction.build());
  const digest = await transaction.getDigest();
  const checkpoint = {
    sequenceNumber: simulation.data.checkpoint.sequenceNumber + 5,
    timestamp: new Date(Number(actualStart) + 1000).toISOString(),
    digest: syntheticDigest('receipt-checkpoint'),
  };
  confirmedEffects.checkpoint = clone(checkpoint);
  confirmedEffects.transaction = { transactionBcs: bytes, sender: { address: EXPECTED.sender } };
  const previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint: clone(checkpoint) } };
  for (const change of confirmedEffects.objectChanges.nodes) {
    change.outputState.digest = syntheticDigest('receipt-output:' + change.address);
    change.outputState.previousTransaction = clone(previousTransaction);
  }
  const confirmation = { data: clone(inputs.data) };
  confirmation.data.checkpoint = {
    sequenceNumber: checkpoint.sequenceNumber + 5,
    timestamp: new Date(Number(actualStart) + 2000).toISOString(),
    digest: syntheticDigest('current-checkpoint'),
  };
  confirmation.data.clock = clone(confirmedEffects.unchangedConsensusObjects.nodes[0].object);
  confirmation.data.clock.asMoveObject.contents.json.timestamp_ms = String(actualStart + 2000n);
  confirmation.data.transaction = { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: confirmedEffects };
  confirmation.data.registries.nodes = [clone(confirmedEffects.objectChanges.nodes.find(change => change.address === EXPECTED.registryId).outputState)];
  confirmation.data.adminCaps.nodes = [clone(confirmedEffects.objectChanges.nodes.find(change => change.address === EXPECTED.adminCapId).outputState)];
  return { checkpoint, inputs, proof, simulation, confirmation, digest, bytes,
    actualStartMs: String(actualStart), storedStartMs: outputRegistry.asMoveObject.contents.json.season_start_ms,
    cutoffMs: String(actualStart + 86400000n), claimDeadlineMs: String(actualStart + 691200000n),
    gasEstimateMist: String(BigInt(effects.gasEffects.gasSummary.computationCost) + BigInt(effects.gasEffects.gasSummary.storageCost) - BigInt(effects.gasEffects.gasSummary.storageRebate)),
  };
}
function attachExisting(data, fixture, candidate = null) {
  for (const key of ['registries', 'adminCaps', 'clock', 'checkpoint']) data[key] = clone(fixture.confirmation.data[key]);
  data.registries.nodes[0].previousTransaction = candidate ? {
    digest: candidate, effects: { status: 'SUCCESS', checkpoint: fixture.checkpoint },
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
  transformInputs, transformSimulation, confirmationForDigest } = {}) {
  const fixtures = await createFixtures();
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
      if (url === '/admin/season-test/start-kind.b64') return { ok: true, text: async () => kind };
      assert.equal(url, EXPECTED.graphqlEndpoint, 'Only the pinned mainnet read endpoint is allowed');
      const { query, variables } = JSON.parse(options.body);
      let response;
      if (query === PROOF_QUERY) {
        response = clone(fixtures.proof);
      } else if (query === INPUTS_QUERY) {
        response = clone(fixtures.inputs);
        transformInputs?.(response.data, fixtures);
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
      return { ok: true, json: async () => response };
    },
  };
  const controller = createSeasonController({ window: win, document: doc, dAppKit: kit });
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
      await get('check-season').fire('click');
      assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true;
      await get('acknowledge').fire('change');
      assert.equal(get('submit-season').disabled, false);
    },
  };
}

test('load, explicit connection and successful 24-hour readiness never request a signature', async () => {
  const h = await harness();
  try {
    assert.deepEqual(h.counts(), { signingCalls: 0, networkCalls: 0, simulations: 0 });
    await h.review();
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 1);
    assert.equal(h.get('gas-estimate').textContent, '0.000100553 SUI');
    assert.equal(h.controller.getState().session.account.address, EXPECTED.sender);
    assert.match(h.get('projected-cutoff').textContent, /202[0-9]/);
  } finally { h.controller.destroy(); }
});

test('an explicitly selected wrong account cannot check or open a wallet request', async () => {
  const h = await harness();
  try {
    await h.connectAndChoose(1);
    assert.equal(h.get('check-season').disabled, true);
    assert.equal(h.controller.getState().session, null);
    await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('account fallback during final simulation invalidates the acknowledged review', async () => {
  const h = await harness({ beforeSimulation(number, { connection, originalWallet }) {
    if (number === 2) connection.set({ isConnected: true, wallet: originalWallet, account: originalWallet.accounts[1] });
  } });
  try {
    await h.review(); await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
    assert.equal(h.controller.getState().attempt, null);
  } finally { h.controller.destroy(); }
});

test('same-address replacement provider cannot inherit a prior review', async () => {
  const h = await harness();
  try {
    await h.review();
    const replacement = wallet();
    h.wallets.set([replacement]);
    h.connection.set({ isConnected: true, wallet: replacement, account: replacement.accounts[0] });
    await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().session, null);
  } finally { h.controller.destroy(); }
});

test('duplicate clicks create one request; definite rejection clears only that request', async () => {
  const h = await harness();
  try {
    await h.review();
    await Promise.all([h.get('submit-season').fire('click'), h.get('submit-season').fire('click')]);
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt, null);
    assert.equal(new SeasonAttemptJournal(h.storage).read(), null);
    assert.match(h.get('status-title').textContent, /cancelled in Slush/);
    assert.equal(h.get('submit-season').disabled, true);
  } finally { h.controller.destroy(); }
});

test('uncertain wallet error blocks retry and survives reload without another request', async () => {
  const storage = new MemoryStorage();
  const h = await harness({ storage, signingError: new Error('Wallet response was lost') });
  try {
    await h.review(); await h.get('submit-season').fire('click'); await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 1);
    assert.equal(h.controller.getState().attempt.phase, 'uncertain');
    const reloaded = await harness({ storage });
    try {
      assert.equal(reloaded.controller.getState().attempt.phase, 'uncertain');
      assert.equal(reloaded.get('submit-season').disabled, true);
      assert.equal(reloaded.get('recovery-panel').hidden, false);
      assert.equal(reloaded.counts().networkCalls, 0);
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('network change during final simulation blocks wallet handoff', async () => {
  const h = await harness({ beforeSimulation(number, { network }) { if (number === 2) network.set('testnet'); } });
  try {
    await h.review(); await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('submit-season').disabled, true);
  } finally { h.controller.destroy(); }
});

test('read failure in a second tab cannot mutate the first tab in-flight journal', async () => {
  const storage = new MemoryStorage();
  let rejectRequest, notifyRequest;
  const requested = new Promise(resolve => { notifyRequest = resolve; });
  const owner = await harness({ storage, signRequest() {
    notifyRequest(); return new Promise((_resolve, reject) => { rejectRequest = reject; });
  } });
  let observer;
  try {
    await owner.review();
    const submission = owner.get('submit-season').fire('click');
    await requested;
    observer = await harness({ storage });
    observer.win.fetch = async () => { throw new Error('Read-only network failure'); };
    await observer.get('check-existing').fire('click');
    assert.equal(new SeasonAttemptJournal(storage).read().phase, 'requesting');
    const remove = storage.removeItem.bind(storage);
    storage.removeItem = key => { assert.equal(owner.isLockHeld(), true); remove(key); };
    rejectRequest(Object.assign(new Error('User rejected request'), { code: 4001 }));
    await submission;
    assert.equal(new SeasonAttemptJournal(storage).read(), null);
    assert.equal(owner.counts().signingCalls, 1);
    assert.equal(observer.counts().signingCalls, 0);
  } finally { observer?.controller.destroy(); owner.controller.destroy(); }
});

test('saved request locks fail closed and cannot be cleared by unrelated rejection', () => {
  const storage = new MemoryStorage(), journal = new SeasonAttemptJournal(storage);
  journal.write({ phase: 'requesting', nonce: 'original', digest: null });
  assert.throws(() => journal.clearRejected('other'), /changed/);
  journal.write({ phase: 'submitted', nonce: 'original', digest: EXPECTED.setupDigest });
  assert.throws(() => journal.clearRejected('original'), /changed/);
  const [key] = storage.values.keys();
  storage.setItem(key, '{broken'); assert.equal(journal.read().phase, 'unrecognized');
  storage.setItem(key, ''); assert.equal(journal.read().phase, 'unrecognized');
});

test('only typed, explicit rejection codes count as cancellation', () => {
  assert.equal(isExplicitRejection({ code: 4001 }), true);
  assert.equal(isExplicitRejection({ name: 'WalletStandardError', context: { __code: 4001000 } }), true);
  assert.equal(isExplicitRejection(new Error('User rejected request')), false);
  assert.equal(isExplicitRejection(new Error('Cancelled while waiting for network')), false);
});

test('fresh browser can check unstarted Registry without connection or simulation', async () => {
  const h = await harness();
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.counts().simulations, 0);
    assert.equal(h.connection.get().isConnected, false);
    assert.equal(h.get('submit-season').disabled, true);
    assert.equal(h.controller.getState().attempt, null);
    assert.match(h.get('status-title').textContent, /ready for its first season/);
  } finally { h.controller.destroy(); }
});

test('already-started state without receipt candidate persistently prevents another first start', async () => {
  const storage = new MemoryStorage();
  const h = await harness({ storage, transformInputs(data, fixture) { attachExisting(data, fixture); } });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.controller.getState().attempt.phase, 'observed-existing');
    assert.equal(h.controller.getState().attempt.digest, null);
    assert.equal(h.get('receipt-panel').hidden, true);
    const reloaded = await harness({ storage });
    try {
      await reloaded.get('submit-season').fire('click');
      assert.equal(reloaded.counts().signingCalls, 0);
      assert.equal(reloaded.get('submit-season').disabled, true);
    } finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('wrong previous-transaction candidate remains replaceable; verified start recovers without wallet', async () => {
  const wrongCandidate = EXPECTED.setupDigest;
  const h = await harness({
    transformInputs(data, fixture) { attachExisting(data, fixture, wrongCandidate); },
    confirmationForDigest(digest, fixture) {
      const response = clone(fixture.confirmation);
      if (digest !== fixture.digest) response.data.transaction = clone(fixture.proof.data.transaction);
      return response;
    },
  });
  try {
    await h.get('check-existing').fire('click');
    assert.equal(h.get('transaction-digest').value, wrongCandidate);
    assert.equal(h.controller.getState().attempt.digest, null);
    assert.equal(h.controller.getState().receipt, null);
    h.get('transaction-digest').value = h.fixtures.digest;
    await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Test season confirmed', h.get('status-message').textContent);
    assert.equal(h.get('receipt-registry').textContent, EXPECTED.registryId);
    assert.equal(h.controller.getState().attempt.digest, h.fixtures.digest);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('duplicate or truncated Registry inventory stops readiness before simulation', async () => {
  for (const truncated of [false, true]) {
    const h = await harness({ transformInputs(data) {
      if (truncated) data.registries.pageInfo.hasNextPage = true;
      else data.registries.nodes.push(clone(data.registries.nodes[0]));
    } });
    try {
      await h.connectAndChoose(); await h.get('check-season').fire('click');
      assert.equal(h.get('submit-season').disabled, true);
      assert.equal(h.get('acknowledge').disabled, true);
      assert.equal(h.counts().signingCalls, 0);
      assert.equal(h.counts().simulations, 0);
    } finally { h.controller.destroy(); }
  }
});

test('changed fee requires a new acknowledgment before the one wallet request', async () => {
  const h = await harness({ transformSimulation(data, number) {
    if (number < 2) return;
    const e = data.simulateTransaction.effects;
    e.gasEffects.gasSummary.computationCost = String(BigInt(e.gasEffects.gasSummary.computationCost) + 1n);
    e.balanceChangesJson[0].amount = String(BigInt(e.balanceChangesJson[0].amount) - 1n);
  } });
  try {
    await h.review(); await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 0);
    assert.equal(h.get('gas-estimate').textContent, '0.000100554 SUI');
    assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.get('submit-season').disabled, true);
    h.get('acknowledge').checked = true; await h.get('acknowledge').fire('change');
    await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('only an independently verified receipt displays actual start and exact 24-hour cutoff', async () => {
  let fixture;
  const h = await harness({ signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }) });
  fixture = h.fixtures;
  try {
    await h.review();
    assert.equal(h.get('receipt-start').textContent, '');
    await h.get('submit-season').fire('click');
    assert.equal(h.get('status-title').textContent, 'Test season confirmed', h.get('status-message').textContent);
    assert.equal(h.counts().signingCalls, 1);
    const receipt = h.controller.getState().receipt;
    assert.equal(receipt.actualStartMs, fixture.actualStartMs);
    assert.equal(receipt.cutoffMs, fixture.cutoffMs);
    assert.equal(BigInt(receipt.cutoffMs) - BigInt(receipt.actualStartMs), 86400000n);
    assert.equal(BigInt(receipt.actualStartMs) - BigInt(receipt.storedStartMs), 2505600000n);
    assert.equal(h.get('receipt-start').textContent, new Date(Number(fixture.actualStartMs)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' }));
    assert.equal(h.get('receipt-cutoff').textContent, new Date(Number(fixture.cutoffMs)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' }));
    assert.equal(h.get('receipt-digest').textContent, fixture.digest);
    await h.get('copy-receipt').fire('click');
    assert.match(h.copied(), new RegExp(fixture.digest));
    assert.match(h.copied(), /24.hour|86400000|Duration: 24/i);
    assert.match(h.copied(), /start|cutoff/i);
    await h.get('submit-season').fire('click');
    assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('historical first-start receipt remains recoverable after later Registry activity', async () => {
  const h = await harness({ confirmationForDigest(_digest, fixture) {
    const response = clone(fixture.confirmation);
    const registry = response.data.registries.nodes[0];
    registry.version = Number(registry.version) + 1;
    registry.digest = syntheticDigest('later-current-registry');
    registry.asMoveObject.contents.json.total_seeds = '1';
    registry.previousTransaction = { digest: syntheticDigest('later-activity'), effects: { status: 'SUCCESS', checkpoint: response.data.checkpoint } };
    return response;
  } });
  try {
    h.get('transaction-digest').value = h.fixtures.digest;
    await h.get('verify-form').fire('submit');
    assert.equal(h.get('status-title').textContent, 'Test season confirmed', h.get('status-message').textContent);
    assert.equal(h.controller.getState().receipt.hasAdvanced, true);
    assert.match(h.get('receipt-state-message').textContent, /since|later|changed/i);
    assert.equal(h.get('submit-season').disabled, true);
    assert.equal(h.counts().signingCalls, 0);
  } finally { h.controller.destroy(); }
});

test('known wallet digest cannot be replaced by a later-activity candidate', async () => {
  let confirmed = false, fixture;
  const requested = [];
  const h = await harness({
    signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest: fixture.digest } }),
    transformInputs(data, f) { if (confirmed) attachExisting(data, f, EXPECTED.setupDigest); },
    confirmationForDigest(digest, f) {
      requested.push(digest);
      const response = clone(f.confirmation);
      if (!confirmed) response.data.transaction = clone(f.proof.data.transaction);
      return response;
    },
  });
  fixture = h.fixtures;
  try {
    await h.review(); await h.get('submit-season').fire('click');
    assert.equal(h.controller.getState().attempt.digest, fixture.digest);
    assert.equal(h.controller.getState().receipt, null);
    h.get('transaction-digest').value = EXPECTED.setupDigest;
    await h.get('verify-form').fire('submit');
    assert.deepEqual(requested, [fixture.digest]);
    confirmed = true; await h.get('check-existing').fire('click');
    assert.deepEqual(requested, [fixture.digest, fixture.digest]);
    assert.equal(h.controller.getState().receipt.digest, fixture.digest);
    assert.equal(h.counts().signingCalls, 1);
  } finally { h.controller.destroy(); }
});

test('42-character wallet digest survives reload and reaches read-only recovery', async () => {
  const digest = '11Cd4BX7vopdUjCBe56dfR9Mw86iDpdcAZbJ2yE8jR';
  const storage = new MemoryStorage(), observed = [];
  const confirmationForDigest = value => { observed.push(value); throw new Error('Synthetic unavailable receipt.'); };
  const h = await harness({ storage, confirmationForDigest,
    signRequest: async () => ({ $kind: 'Transaction', Transaction: { digest } }),
  });
  let reloaded;
  try {
    await h.review(); await h.get('submit-season').fire('click');
    assert.deepEqual(observed, [digest]);
    assert.equal(new SeasonAttemptJournal(storage).read().digest, digest);
    reloaded = await harness({ storage, confirmationForDigest });
    assert.equal(reloaded.get('transaction-digest').value, digest);
    await reloaded.get('verify-form').fire('submit');
    assert.deepEqual(observed, [digest, digest]);
    assert.equal(reloaded.counts().signingCalls, 0);
    assert.equal(reloaded.get('submit-season').disabled, true);
  } finally { reloaded?.controller.destroy(); h.controller.destroy(); }
});
