import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { toBase58 } from '@mysten/sui/utils';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { ACTIONS, CycleAttemptJournal, createCycleController, isExplicitRejection, formatCountdown, suiAmount } from './admin.mjs';
import { EXPECTED } from './common.mjs';

// These tests exercise the wallet orchestration boundary. The separate core
// suites validate real transaction bytes, effects, historical proofs and amounts.
const OTHER = '0x' + '1'.repeat(64), BASE_TIME = 1794168000000;
const DIGESTS = Object.fromEntries(ACTIONS.map((action, i) => [action, toBase58(new Uint8Array(32).fill(i + 5))]));
const HASHES = Object.fromEntries(ACTIONS.map((action, i) => [action, String(i + 1).repeat(64)]));
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class Element {
  children = []; listeners = new Map(); value = ''; checked = false; _disabled = false; hidden = false; textContent = ''; className = '';
  constructor(tag = 'div') { this.tag = tag; }
  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = Boolean(value); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  async fire(type) { return Promise.all((this.listeners.get(type) || []).map(fn => fn({ preventDefault() {} }))); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
}
function store(value) {
  const listeners = new Set();
  return { get: () => value, set(next) { value = next; for (const fn of listeners) fn(value); },
    subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); } };
}
function wallet() {
  return getOrCreateUiWalletForStandardWallet({ name: 'Slush', version: '1.0.0',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', chains: ['sui:mainnet'],
    features: { 'standard:connect': {}, 'standard:events': {}, 'sui:signAndExecuteTransaction': {} },
    accounts: [EXPECTED.sender, OTHER].map(address => ({ address, publicKey: new Uint8Array(32),
      chains: ['sui:mainnet'], features: ['sui:signAndExecuteTransaction'] })) });
}
function recorded(storage, action, phase = 'confirmed', extra = {}) {
  return new CycleAttemptJournal(storage).write(action, { nonce: 'synthetic-' + action, phase,
    digest: ['confirmed', 'submitted', 'failed'].includes(phase) ? DIGESTS[action] : null, kindSha256: HASHES[action], at: BASE_TIME, ...extra });
}
async function harness({ storage = new MemoryStorage(), initial = 'rollover-ready', signingError, successful = false,
  denyLock = false, beforeSimulation, transformSimulation, duringSigning, beforeConfirmation, invalidReceipt = false, failRead = false, confirmedFailure = false } = {}) {
  const elements = new Map(), timers = new Map(), storageListeners = new Set();
  let timerId = 0, clock = BASE_TIME, phase = initial, lockHeld = false, signCalls = 0, simulations = 0, reads = 0, receiptReads = 0, validations = 0;
  let readFailure = failRead, rejectReceipt = invalidReceipt, failedReceipt = confirmedFailure, copied;
  const doc = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: tag => new Element(tag) };
  const originalWallet = wallet(), wallets = store([originalWallet]), connection = store({ isConnected: false, wallet: null, account: null }), network = store('mainnet');
  const receipts = Object.fromEntries(ACTIONS.map(action => [action, { action, status: 'confirmed', digest: DIGESTS[action], kindSha256: HASHES[action],
    gasEstimateMist: '2000000', actualStartMs: String(BASE_TIME), cutoffMs: String(BASE_TIME + 172800000), claimDeadlineMs: String(BASE_TIME + 777600000),
    ...(action === 'rollover' ? { archiveId: '0x' + '3'.repeat(64) } : { seedId: '0x' + '4'.repeat(64), nftId: EXPECTED.previousNftId,
      plantedAtMs: String(BASE_TIME + 1000), waterReadyMs: String(BASE_TIME + 77761000), growthPoints: action === 'plant' ? '10' : action === 'claim' ? '0' : '24' }),
    ...(action === 'claim' ? { rewardMist: '7000000', netReceiveMist: '5000000', eligibleGrowthPoints: '24' } : {}) }]));
  const snapshot = () => ({ status: phase === 'rollover-ready' ? phase : 'season-two', phase,
    checkpoint: { timestamp: new Date(clock).toISOString(), sequenceNumber: '100' }, clockMs: String(clock),
    registry: { asMoveObject: { contents: { json: { reward_pool: phase === 'rollover-ready' || phase === 'plant-ready' ? '0' : '7000000' } } } },
    ownedNFTs: [{ objectId: EXPECTED.previousNftId, name: 'Verified NFTree' }], seasonSeeds: [] });
  const protocol = {
    PROOF_QUERY: 'proof', PROOF_VARIABLES: {}, INPUTS_QUERY: 'inputs', INPUT_VARIABLES: {},
    SIMULATION_QUERY: 'simulation', CONFIRM_QUERY: 'confirmation', CONFIRM_VARIABLES: {},
    PLANT_FIELDS_QUERY: 'fields', plantFieldVariables: () => ({}), attachPlantFields: chain => chain,
    nextNFTPageVariables: () => null,
    async inspectState(raw) { assert.ok(raw.data.current); return raw.data.current; },
    inspectCare(chain, cycle, plant) {
      assert.equal(cycle.digest, DIGESTS.rollover);
      const p = chain.phase;
      if (p !== 'plant-ready' && !plant) return { status: 'needs-plant-receipt', canAct: false };
      return { status: p, action: ({ 'plant-ready': 'plant', 'water-ready': 'water', 'claim-ready': 'claim' })[p] ?? null,
        canAct: ['plant-ready', 'water-ready', 'claim-ready'].includes(p), seedId: plant?.seedId,
        growthPoints: ['waiting-water', 'water-ready'].includes(p) ? '10' : p === 'claimed' ? '0' : '24', wateringStreak: p === 'plant-ready' ? '0' : p === 'waiting-water' ? '1' : '2' };
    },
    async prepare(action) { return { action, transaction: { action }, simulationTransaction: { action }, kindSha256: HASHES[action] }; },
    async simulate(action) { const result = { gasEstimateMist: '2000000', ...(action === 'claim' ? { rewardMist: '7000000', netReceiveMist: '5000000', eligibleGrowthPoints: '24' } : {}) };
      transformSimulation?.(result, simulations); return result; },
    async validateWallet(transaction, packet) { validations++; assert.equal(transaction.action, packet.action); },
    async confirm(action, raw, digest) {
      assert.equal(digest, DIGESTS[action]);
      if (failedReceipt) throw Object.assign(new Error('Exact synthetic failure'), { confirmedFailure: { action, digest, kindSha256: HASHES[action], permitsRetry: true } });
      if (rejectReceipt) throw new Error('Synthetic receipt could not be verified');
      return receipts[action];
    },
  };
  const kit = {
    stores: { $wallets: wallets, $connection: connection, $currentNetwork: network },
    async connectWallet({ wallet: selected }) { connection.set({ isConnected: true, wallet: selected, account: selected.accounts[0] }); },
    switchAccount({ account }) { connection.set({ ...connection.get(), account }); },
    async disconnectWallet() { connection.set({ isConnected: false, wallet: null, account: null }); },
    async signAndExecuteTransaction(args) {
      signCalls++; assert.equal(args.account.address, EXPECTED.sender); assert.equal(args.network, 'mainnet');
      await duringSigning?.(storage, args.transaction.action);
      if (successful) { const action = args.transaction.action; if (!failedReceipt) phase = ({ rollover: 'plant-ready', plant: 'waiting-water', water: 'watered', claim: 'claimed' })[action];
        return { [failedReceipt ? 'FailedTransaction' : 'Transaction']: { digest: DIGESTS[action] } }; }
      throw signingError || Object.assign(new Error('User rejected'), { code: 4001 });
    }, getClient: () => ({ core: { async waitForTransaction() {} } }),
  };
  const win = {
    location: { origin: EXPECTED.origin }, localStorage: storage, crypto: webcrypto,
    addEventListener(type, fn) { if (type === 'storage') storageListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'storage') storageListeners.delete(fn); },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { async writeText(text) { copied = text; } }, locks: { async request(_name, options, run) {
      assert.equal(options.ifAvailable, true); if (denyLock || lockHeld) return run(null); lockHeld = true;
      try { return await run({ name: 'test-lock' }); } finally { lockHeld = false; }
    } } },
    async fetch(url, options) {
      assert.equal(url, EXPECTED.graphqlEndpoint || EXPECTED.endpoint); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      const { query, variables } = JSON.parse(options.body);
      if (query === 'inputs') { reads++; if (readFailure) throw new Error('Synthetic unavailable read'); }
      else if (query === 'simulation') { simulations++; await beforeSimulation?.(simulations, { connection, network, wallets, originalWallet }); }
      else if (query === 'confirmation') { receiptReads++; assert.ok(Object.values(DIGESTS).includes(variables.digest)); await beforeConfirmation?.(storage, receiptReads); }
      else assert.ok(['proof', 'fields'].includes(query));
      return { ok: true, status: 200, json: async () => ({ data: { current: snapshot() } }) };
    },
  };
  const controller = createCycleController({ window: win, document: doc, dAppKit: kit, now: () => clock, protocol }); await controller.ready;
  const get = id => doc.getElementById(id);
  return { controller, get, win, kit, connection, network, wallets, originalWallet, storage, receipts,
    counts: () => ({ signCalls, simulations, reads, receiptReads, validations }), copied: () => copied,
    setReadFailure(value) { readFailure = value; }, setInvalidReceipt(value) { rejectReceipt = value; }, setFailedReceipt(value) { failedReceipt = value; },
    setNow(value) { clock = value; }, setPhase(value) { phase = value; },
    tick() { const entry = [...timers].find(([, timer]) => timer.ms === 1000); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); },
    storageChanged() { for (const fn of storageListeners) fn({ key: null }); },
    async connectAndChoose(index = 0) {
      await get('wallet-list').querySelectorAll('button')[0].fire('click'); assert.equal(get('account-select').value, '');
      get('account-select').value = String(index); await get('account-select').fire('change'); await get('use-account').fire('click');
    },
    async review({ connect = true, nft = false } = {}) {
      if (connect) await this.connectAndChoose();
      if (nft) { get('nft-select').value = EXPECTED.previousNftId; await get('nft-select').fire('change'); }
      await get('check-action').fire('click'); assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true; await get('acknowledge').fire('change'); assert.equal(get('submit-action').disabled, false, get('status-message').textContent);
    },
    async recover(action, digest = DIGESTS[action]) { get('recovery-action').value = action; get('transaction-digest').value = digest; await get('verify-form').fire('submit'); },
  };
}

test('public readiness never connects, simulates or signs; explicit account review and acknowledgement are required', async () => {
  const h = await harness();
  try {
    assert.equal(h.get('current-stage').textContent, 'Ready for Season 2'); assert.equal(h.get('check-action').disabled, true);
    assert.deepEqual(h.counts(), { signCalls: 0, simulations: 0, reads: 1, receiptReads: 0, validations: 0 });
    await h.review(); assert.equal(h.counts().signCalls, 0); assert.equal(h.counts().simulations, 1);
    assert.equal(h.get('gas-estimate').textContent, '0.002 SUI'); assert.equal(h.get('net-estimate').textContent, '−0.002 SUI');
  } finally { h.controller.destroy(); }
});
test('wrong account, changed provider or network cannot open a wallet request', async () => {
  const wrong = await harness();
  try { await wrong.connectAndChoose(1); await wrong.get('check-action').fire('click'); await wrong.get('submit-action').fire('click'); assert.equal(wrong.counts().signCalls, 0); assert.equal(wrong.counts().simulations, 0); }
  finally { wrong.controller.destroy(); }
  for (const change of [h => h.connection.set({ ...h.connection.get(), account: h.originalWallet.accounts[1] }), h => h.wallets.set([wallet()]), h => h.network.set('testnet')]) {
    const h = await harness(); try { await h.review(); change(h); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 0); assert.equal(h.controller.getState().review, null); }
    finally { h.controller.destroy(); }
  }
});
test('account changes during final simulation stop the handoff', async () => {
  const h = await harness({ beforeSimulation(number, { connection, originalWallet }) { if (number === 2) connection.set({ ...connection.get(), account: originalWallet.accounts[1] }); } });
  try { await h.review(); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 0); assert.equal(new CycleAttemptJournal(h.storage).read('rollover'), null); }
  finally { h.controller.destroy(); }
});
test('changed fee requires a new acknowledgement before opening Slush', async () => {
  const h = await harness({ transformSimulation(result, count) { if (count > 1) result.gasEstimateMist = '2500000'; } });
  try { await h.review(); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 0); assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.get('gas-estimate').textContent, '0.0025 SUI'); assert.match(h.get('status-title').textContent, /review changed/); }
  finally { h.controller.destroy(); }
});
test('typed rejection clears its own request, while an ambiguous wallet error survives reload', async () => {
  const rejected = await harness();
  try { await rejected.review(); await rejected.get('submit-action').fire('click'); assert.equal(rejected.counts().signCalls, 1);
    assert.equal(new CycleAttemptJournal(rejected.storage).read('rollover'), null); assert.equal(rejected.get('submit-action').disabled, true); }
  finally { rejected.controller.destroy(); }
  const storage = new MemoryStorage(), h = await harness({ storage, signingError: new Error('cancelled network connection') });
  try { await h.review(); await h.get('submit-action').fire('click'); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 1);
    assert.equal(new CycleAttemptJournal(storage).read('rollover').phase, 'uncertain'); }
  finally { h.controller.destroy(); }
  const reload = await harness({ storage });
  try { await reload.connectAndChoose(); await reload.get('check-action').fire('click'); assert.equal(reload.counts().signCalls, 0); assert.equal(reload.counts().simulations, 0); }
  finally { reload.controller.destroy(); }
});
test('cross-tab lock prevents a second handoff before any request is recorded', async () => {
  const h = await harness({ denyLock: true });
  try { await h.review(); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 0); assert.equal(h.counts().validations, 0); assert.equal(new CycleAttemptJournal(h.storage).read('rollover'), null); }
  finally { h.controller.destroy(); }
});
test('stale or failed current-state reads invalidate reviewed actions', async () => {
  const h = await harness();
  try { await h.review(); h.setNow(BASE_TIME + EXPECTED.maxAgeMs + 1); h.tick(); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 0);
    assert.equal(h.get('countdown').textContent, '—'); h.setReadFailure(true); await h.controller.refresh(); assert.equal(h.get('chain-status').textContent, 'Read unavailable');
    h.setReadFailure(false); await h.controller.refresh(); assert.equal(h.get('check-action').disabled, false); }
  finally { h.controller.destroy(); }
});
test('a successful wallet response needs receipt verification before advancing; recorded digest cannot be replaced', async () => {
  const h = await harness({ successful: true, invalidReceipt: true });
  try { await h.review(); await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 1); assert.equal(h.controller.getState().receipts.rollover, undefined);
    assert.equal(new CycleAttemptJournal(h.storage).read('rollover').digest, DIGESTS.rollover); assert.equal(h.get('submit-action').disabled, true);
    const reads = h.counts().receiptReads; await h.recover('rollover', DIGESTS.plant); assert.equal(h.counts().receiptReads, reads);
    h.setInvalidReceipt(false); await h.recover('rollover'); assert.equal(h.controller.getState().receipts.rollover.digest, DIGESTS.rollover);
    assert.equal(h.get('nft-controls').hidden, false); assert.equal(h.get('nft-select').value, '', 'No NFT is implicitly selected');
  } finally { h.controller.destroy(); }
});
test('saved receipts are reverified in dependency order; storage JSON never supplies trusted schedule data', async () => {
  const storage = new MemoryStorage(); recorded(storage, 'rollover', 'confirmed', { cutoffMs: '1' }); recorded(storage, 'plant');
  const h = await harness({ storage, initial: 'waiting-water' });
  try { assert.equal(h.counts().receiptReads, 2); assert.equal(h.controller.getState().receipts.rollover.cutoffMs, String(BASE_TIME + 172800000));
    assert.equal(h.get('current-stage').textContent, 'Your Seed is taking root'); assert.equal(h.counts().signCalls, 0);
    h.storageChanged(); assert.equal(h.controller.getState().receipts.rollover, undefined); assert.equal(h.get('submit-action').disabled, true);
    await h.controller.refresh({ restore: true }); assert.equal(h.counts().receiptReads, 4); }
  finally { h.controller.destroy(); }
});
test('a late wallet result cannot overwrite another tab’s nonce or pinned digest', async () => {
  for (const replace of [
    (storage, action) => recorded(storage, action, 'submitted', { nonce: 'other-tab', digest: DIGESTS.plant }),
    (storage, action) => { const current = new CycleAttemptJournal(storage).read(action); recorded(storage, action, 'submitted', { nonce: current.nonce, digest: DIGESTS.plant }); },
  ]) {
    const h = await harness({ successful: true, duringSigning: replace });
    try { await h.review(); await h.get('submit-action').fire('click'); const saved = new CycleAttemptJournal(h.storage).read('rollover');
      assert.equal(saved.digest, DIGESTS.plant); assert.notEqual(saved.phase, 'confirmed'); assert.equal(h.controller.getState().receipts.rollover, undefined);
      assert.equal(h.counts().signCalls, 1); assert.equal(h.counts().receiptReads, 0); assert.equal(h.get('submit-action').disabled, true); }
    finally { h.controller.destroy(); }
  }
});
test('receipt recovery cannot overwrite a request created during its asynchronous verification', async () => {
  const h = await harness({ initial: 'plant-ready', beforeConfirmation(storage) { recorded(storage, 'rollover', 'submitted', { nonce: 'newer-request', digest: DIGESTS.plant }); } });
  try { await h.recover('rollover'); assert.equal(h.controller.getState().receipts.rollover, undefined);
    const saved = new CycleAttemptJournal(h.storage).read('rollover'); assert.equal(saved.nonce, 'newer-request'); assert.equal(saved.digest, DIGESTS.plant); assert.equal(saved.phase, 'submitted'); }
  finally { h.controller.destroy(); }
});
test('existing Season 2 without a start receipt offers recovery and cannot start another season', async () => {
  const h = await harness({ initial: 'plant-ready' });
  try { await h.connectAndChoose(); await h.get('check-action').fire('click'); assert.equal(h.counts().simulations, 0); assert.equal(h.get('recovery-panel').open, true);
    assert.equal(h.get('recovery-action').value, 'rollover'); await h.recover('plant'); assert.equal(h.counts().receiptReads, 0); }
  finally { h.controller.destroy(); }
});
test('confirmed failure must be reverified before its matching request can be cleared', async () => {
  const h = await harness({ successful: true, confirmedFailure: true });
  try { await h.review(); await h.get('submit-action').fire('click'); assert.equal(new CycleAttemptJournal(h.storage).read('rollover').phase, 'failed');
    assert.equal(h.get('retry-action').disabled, false); const count = h.counts().receiptReads; await h.get('retry-action').fire('click');
    assert.equal(h.counts().receiptReads, count + 1); assert.equal(new CycleAttemptJournal(h.storage).read('rollover'), null);
    assert.equal(h.get('submit-action').disabled, true); assert.equal(h.counts().signCalls, 1); }
  finally { h.controller.destroy(); }
});
test('all four actions advance only after their receipts; waiting and cutoff states block premature requests', async () => {
  const h = await harness({ successful: true });
  try {
    await h.review(); await h.get('submit-action').fire('click'); assert.equal(h.controller.getState().receipts.rollover.action, 'rollover');
    await h.review({ connect: false, nft: true }); await h.get('submit-action').fire('click'); assert.equal(h.get('current-stage').textContent, 'Your Seed is taking root');
    await h.get('check-action').fire('click'); assert.equal(h.counts().signCalls, 2);
    h.setNow(BASE_TIME + 77761000); h.tick(); await h.get('check-action').fire('click'); assert.equal(h.counts().signCalls, 2);
    h.setPhase('water-ready'); await h.controller.refresh(); await h.review({ connect: false }); await h.get('submit-action').fire('click');
    assert.equal(h.get('current-stage').textContent, 'Your Seed has been watered'); assert.equal(h.counts().signCalls, 3);
    h.setNow(BASE_TIME + 172800001); h.setPhase('claim-ready'); await h.controller.refresh(); await h.review({ connect: false }); await h.get('submit-action').fire('click');
    assert.equal(h.get('current-stage').textContent, 'Season 2 reward paid'); assert.equal(h.counts().signCalls, 4);
    assert.deepEqual(Object.keys(h.controller.getState().receipts), ACTIONS); await h.get('copy-receipt').fire('click');
    for (const digest of Object.values(DIGESTS)) assert.ok(h.copied().includes(digest));
    await h.get('submit-action').fire('click'); assert.equal(h.counts().signCalls, 4);
  } finally { h.controller.destroy(); }
});
test('unavailable or malformed storage blocks wallet requests while public status stays usable', async () => {
  const storage = new MemoryStorage(); storage.setItem('arboretum:season-two:v1:rollover', '{');
  for (const s of [storage, { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); } }]) {
    const h = await harness({ storage: s });
    try { await h.connectAndChoose(); await h.get('check-action').fire('click'); assert.equal(h.get('current-stage').textContent, 'Ready for Season 2'); assert.equal(h.counts().simulations, 0); assert.equal(h.counts().signCalls, 0); }
    finally { h.controller.destroy(); }
  }
});
test('journal nonce and digest bindings prevent clearing another request', () => {
  const storage = new MemoryStorage(), journal = new CycleAttemptJournal(storage); recorded(storage, 'rollover', 'requesting');
  assert.throws(() => journal.clearRejected('rollover', 'different')); assert.equal(journal.read('rollover').phase, 'requesting');
  recorded(storage, 'rollover', 'failed'); assert.throws(() => journal.clearVerifiedFailure('rollover', 'synthetic-rollover', DIGESTS.plant, HASHES.rollover));
  assert.equal(journal.read('rollover').phase, 'failed');
});
test('formatters preserve MIST precision and only typed rejection is treated as cancellation', () => {
  assert.equal(suiAmount('5424949'), '0.005424949 SUI'); assert.equal(suiAmount('-1'), '−0.000000001 SUI');
  assert.equal(formatCountdown(77760000), '21:36:00'); assert.equal(formatCountdown(172800000), '2d 00:00:00');
  assert.equal(isExplicitRejection(new Error('User rejected')), false); assert.equal(isExplicitRejection({ code: 4001 }), true);
  assert.equal(isExplicitRejection({ name: 'WalletStandardError', context: { __code: 4001000 } }), true);
});
