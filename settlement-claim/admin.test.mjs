import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { getOrCreateUiWalletForStandardWallet } from '@wallet-standard/ui-registry';
import { createClaimController, ClaimAttemptJournal, isExplicitRejection, formatCountdown, formatTimestamp } from './admin.mjs';
import { EXPECTED, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY, contents } from './claim-core.mjs';
import { createClaimFixtures, makeConfirmedClaimFailure } from './claim-fixtures.mjs';

const clone = value => structuredClone(value), OTHER = '0x' + '1'.repeat(64);
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class Element {
  children = []; listeners = new Map(); value = ''; checked = false; disabled = false; hidden = false; textContent = ''; className = '';
  constructor(tag = 'div') { this.tag = tag; }
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
async function harness({ mode = 'ready', storage = new MemoryStorage(), signingError,
  signRequest, beforeSimulation, transformSimulation, transformInputs, transformConfirmation, fixtureOptions = {}, failRead = false, denyLock = false } = {}) {
  const fixtures = await createClaimFixtures(fixtureOptions), elements = new Map(), timers = new Map();
  let timerId = 0, clock = fixtures.now, signCalls = 0, simulations = 0, reads = 0, receiptReads = 0, copied, lockHeld = false;
  let readFailure = failRead, claimed = mode === 'claimed';
  if (mode === 'waiting') clock = Number(EXPECTED.cutoffMs) - 3600000;
  if (mode === 'expired') clock = Number(EXPECTED.claimDeadlineMs) + 1;
  const doc = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: tag => new Element(tag) };
  const originalWallet = wallet(), wallets = store([originalWallet]), connection = store({ isConnected: false, wallet: null, account: null }), network = store('mainnet');
  const kit = {
    stores: { $wallets: wallets, $connection: connection, $currentNetwork: network },
    async connectWallet({ wallet: selected }) { connection.set({ isConnected: true, wallet: selected, account: selected.accounts[0] }); return { accounts: selected.accounts }; },
    switchAccount({ account }) { connection.set({ ...connection.get(), account }); },
    async disconnectWallet() { connection.set({ isConnected: false, wallet: null, account: null }); },
    async signAndExecuteTransaction(args) {
      signCalls++; assert.equal(args.account.address, EXPECTED.sender); assert.equal(args.network, 'mainnet');
      assert.equal(args.transaction.getData().commands.length, 1); assert.equal(args.transaction.getData().commands[0].MoveCall.function, 'claim_reward');
      assert.ok(Object.values(args.transaction.getData().gasData).every(value => value === null));
      if (signRequest) { const result = await signRequest(args, fixtures); claimed = Boolean(result?.Transaction); return result; }
      throw signingError || Object.assign(new Error('User rejected'), { code: 4001 });
    }, getClient: () => ({ async waitForTransaction() {} }),
  };
  const storageListeners = new Set();
  const win = {
    location: { origin: EXPECTED.origin }, localStorage: storage, crypto: webcrypto,
    addEventListener(type, fn) { if (type === 'storage') storageListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'storage') storageListeners.delete(fn); },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { async writeText(text) { copied = text; } }, locks: { async request(_name, options, run) {
      assert.equal(options.ifAvailable, true);
      if (denyLock || lockHeld) return run(null); lockHeld = true;
      try { return await run({ name: 'synthetic-lock' }); } finally { lockHeld = false; }
    } } },
    async fetch(url, options) {
      assert.equal(url, EXPECTED.graphqlEndpoint || EXPECTED.endpoint);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      const { query, variables } = JSON.parse(options.body);
      let result;
      if (query === INPUTS_QUERY) {
        reads++; if (readFailure) throw new Error('Synthetic read unavailable');
        result = clone(claimed ? fixtures.confirmation : fixtures.inputs); delete result.data.transaction;
        result.data.checkpoint.timestamp = new Date(clock).toISOString(); contents(result.data.clock).timestamp_ms = String(clock);
        transformInputs?.(result.data, fixtures, reads);
      } else if (query === SIMULATION_QUERY) {
        simulations++; await beforeSimulation?.(simulations, { connection, network, wallets, originalWallet });
        result = clone(fixtures.simulation); transformSimulation?.(result.data, simulations, fixtures);
      } else if (query === CONFIRM_QUERY) {
        receiptReads++; assert.equal(variables.digest, fixtures.digest, 'Only the explicit synthetic receipt may be read'); result = clone(fixtures.confirmation);
        transformConfirmation?.(result.data, receiptReads, fixtures);
      } else throw new Error('Unexpected request in offline controller test');
      return { ok: true, status: 200, json: async () => result };
    },
  };
  const controller = createClaimController({ window: win, document: doc, dAppKit: kit, now: () => clock });
  await controller.ready;
  const get = id => doc.getElementById(id);
  return { controller, get, win, kit, fixtures, connection, network, wallets, originalWallet, storage,
    counts: () => ({ signCalls, simulations, reads, receiptReads }), copied: () => copied,
    setLockDenied(value) { denyLock = value; },
    setReadFailure(value) { readFailure = value; }, setNow(value) { clock = value; },
    tick() { const match = [...timers].find(([, timer]) => timer.ms === 1000); assert.ok(match); timers.delete(match[0]); match[1].fn(); },
    storageChanged() { for (const fn of storageListeners) fn({ key: null }); },
    async connectAndChoose(index = 0) {
      await get('wallet-list').querySelectorAll('button')[0].fire('click');
      assert.equal(get('account-select').value, '', 'Connection must not implicitly select an account');
      get('account-select').value = String(index); await get('account-select').fire('change'); await get('use-account').fire('click');
    },
    async review() { await this.connectAndChoose(); await get('check-claim').fire('click');
      assert.equal(get('acknowledge').disabled, false, get('status-message').textContent);
      get('acknowledge').checked = true; await get('acknowledge').fire('change');
      assert.equal(get('submit-claim').disabled, false, get('status-message').textContent); },
  };
}

test('public countdown reads season reward eligibility without connecting, simulating or signing', async () => {
  const h = await harness({ mode: 'waiting' });
  try {
    assert.equal(h.get('countdown').textContent, '01:00:00'); assert.equal(h.get('current-gp').textContent, '10');
    assert.equal(h.get('eligible-gp').textContent, '10'); assert.equal(h.get('reward-share').textContent, '0.007 SUI'); assert.equal(h.get('check-claim').disabled, true);
    assert.deepEqual(h.counts(), { signCalls: 0, simulations: 0, reads: 1, receiptReads: 0 });
    await h.connectAndChoose(); await h.get('check-claim').fire('click');
    assert.equal(h.counts().simulations, 0); assert.equal(h.get('submit-claim').disabled, true);
    h.setNow(Number(EXPECTED.cutoffMs) - 3599000); h.tick(); assert.equal(h.get('countdown').textContent, '00:59:59');
  } finally { h.controller.destroy(); }
});

test('the timer reaching zero does not authorize claim until a fresh mainnet read', async () => {
  const h = await harness({ mode: 'waiting' });
  try {
    await h.connectAndChoose(); h.setNow(Number(EXPECTED.cutoffMs)); h.tick();
    assert.equal(h.get('check-claim').disabled, true); assert.equal(h.counts().simulations, 0);
    await h.controller.refresh(); assert.equal(h.get('check-claim').disabled, false);
    assert.equal(h.get('seed-state').textContent, 'Ready to claim');
  } finally { h.controller.destroy(); }
});

test('one explicit provider, account choice, current simulation and acknowledgment precede signing', async () => {
  const h = await harness();
  try {
    assert.equal(h.get('check-claim').disabled, true); await h.review();
    assert.equal(h.counts().signCalls, 0); assert.equal(h.counts().simulations, 1);
    assert.equal(h.controller.getState().session.account.address, EXPECTED.sender);
    assert.equal(h.get('gas-estimate').textContent, '0.001575051 SUI');
    assert.equal(h.get('expected-kind').textContent, h.fixtures.packet.kindSha256);
  } finally { h.controller.destroy(); }
});

test('wrong account cannot simulate or open the wallet', async () => {
  const h = await harness();
  try {
    await h.connectAndChoose(1); await h.get('check-claim').fire('click'); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().simulations, 0); assert.equal(h.counts().signCalls, 0);
    assert.equal(h.get('submit-claim').disabled, true);
  } finally { h.controller.destroy(); }
});

test('changed provider, account and network invalidate a reviewed action', async () => {
  for (const change of [h => h.connection.set({ ...h.connection.get(), account: h.originalWallet.accounts[1] }),
    h => h.wallets.set([wallet()]), h => h.network.set('testnet')]) {
    const h = await harness();
    try { await h.review(); change(h); await h.get('submit-claim').fire('click');
      assert.equal(h.controller.getState().review, null); assert.equal(h.counts().signCalls, 0); assert.equal(h.get('submit-claim').disabled, true); }
    finally { h.controller.destroy(); }
  }
});

test('account changes during final simulation prevent a wallet handoff', async () => {
  const h = await harness({ beforeSimulation(number, { connection, originalWallet }) { if (number === 2) connection.set({ ...connection.get(), account: originalWallet.accounts[1] }); } });
  try { await h.review(); await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 0); assert.equal(h.controller.getState().review, null); }
  finally { h.controller.destroy(); }
});

test('stale reads and closed windows disable both the timer and reviewed action', async () => {
  const h = await harness();
  try {
    await h.review(); h.setNow(h.fixtures.now + EXPECTED.maxAgeMs + 1); h.tick();
    assert.equal(h.get('countdown').textContent, '—'); assert.equal(h.get('submit-claim').disabled, true);
    h.setNow(Number(EXPECTED.claimDeadlineMs) + 1); await h.controller.refresh();
    assert.equal(h.get('countdown').textContent, 'Closed'); await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 0);
  } finally { h.controller.destroy(); }
});

test('failed automatic reads hide the countdown and a successful refresh restores eligibility', async () => {
  const h = await harness();
  try {
    await h.review(); h.setReadFailure(true); await h.controller.refresh({ quiet: true });
    assert.equal(h.get('countdown').textContent, '—'); assert.equal(h.get('chain-status').textContent, 'Read unavailable');
    assert.equal(h.get('submit-claim').disabled, true); assert.equal(h.controller.getState().review, null);
    h.setReadFailure(false); await h.controller.refresh(); assert.equal(h.get('chain-status').textContent, 'Mainnet verified');
    assert.equal(h.get('check-claim').disabled, false);
  } finally { h.controller.destroy(); }
});

test('a changed gas estimate requires a new acknowledgment before the wallet opens', async () => {
  const h = await harness({ transformSimulation(data, count, f) {
    if (count < 2) return;
    const effects = data.simulateTransaction.effects; effects.gasEffects.gasSummary.computationCost = 200000;
    effects.balanceChangesJson[0].amount = '5324949';
    contents(effects.objectChanges.nodes.find(x => x.address === f.gasId).outputState).balance = '998324949';
  } });
  try { await h.review(); await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 0);
    assert.equal(h.get('acknowledge').checked, false); assert.equal(h.get('gas-estimate').textContent, '0.001675051 SUI');
    assert.match(h.get('status-title').textContent, /review changed/); }
  finally { h.controller.destroy(); }
});

test('explicit rejection clears only its request and requires another review', async () => {
  const h = await harness();
  try { await h.review(); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().signCalls, 1); assert.equal(h.controller.getState().attempt, null);
    assert.equal(new ClaimAttemptJournal(h.storage).read(), null); assert.equal(h.get('submit-claim').disabled, true);
    assert.match(h.get('status-title').textContent, /cancelled/); }
  finally { h.controller.destroy(); }
});

test('unknown wallet errors remain locked through a second click and reload', async () => {
  const storage = new MemoryStorage(), h = await harness({ storage, signingError: new Error('cancelled network connection') });
  try {
    await h.review(); await h.get('submit-claim').fire('click'); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().signCalls, 1); assert.equal(h.controller.getState().attempt.phase, 'uncertain');
    const reloaded = await harness({ storage });
    try { await reloaded.connectAndChoose(); await reloaded.get('check-claim').fire('click');
      assert.equal(reloaded.get('submit-claim').disabled, true); assert.equal(reloaded.counts().signCalls, 0); assert.equal(reloaded.counts().simulations, 0); }
    finally { reloaded.controller.destroy(); }
  } finally { h.controller.destroy(); }
});

test('cross-tab lock contention and saved requests prevent duplicate wallet handoffs', async () => {
  const h = await harness({ denyLock: true });
  try { await h.review(); await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 0); assert.match(h.get('status-message').textContent, /Another tab/); }
  finally { h.controller.destroy(); }
  const second = await harness();
  try {
    await second.review(); new ClaimAttemptJournal(second.storage).write({ nonce: 'other-tab', phase: 'requesting', digest: null, kindSha256: second.fixtures.packet.kindSha256 });
    second.storageChanged(); await second.get('submit-claim').fire('click'); assert.equal(second.counts().signCalls, 0); assert.equal(second.get('submit-claim').disabled, true);
  } finally { second.controller.destroy(); }
});

test('missing Web Locks or unavailable storage never reaches signing', async () => {
  const h = await harness();
  try { await h.review(); delete h.win.navigator.locks; await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 0); }
  finally { h.controller.destroy(); }
  const broken = await harness({ storage: { getItem() { throw Error('Blocked'); } } });
  try { assert.equal(broken.get('current-gp').textContent, '10'); await broken.connectAndChoose(); await broken.get('check-claim').fire('click'); assert.equal(broken.counts().simulations, 0); }
  finally { broken.controller.destroy(); }
});

test('synthetic successful receipt is checked and copied; a digest alone never completes the flow', async () => {
  const h = await harness({ signRequest: async (_args, f) => ({ $kind: 'Transaction', Transaction: { digest: f.digest } }) });
  try {
    await h.review(); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().signCalls, 1); assert.equal(h.counts().receiptReads, 1); assert.equal(h.controller.getState().receipt.status, 'confirmed');
    assert.equal(h.get('receipt-growth').textContent, '10 GP processed'); assert.equal(h.get('receipt-reward').textContent, '0.007 SUI');
    assert.equal(h.get('current-gp').textContent, '0'); assert.equal(h.get('eligible-gp').textContent, '10');
    assert.equal(h.get('countdown').textContent, 'Complete', 'The hero must use current confirmation fields immediately');
    assert.equal(h.get('receipt-gas').textContent, '0.001575051 SUI'); assert.equal(h.get('submit-claim').disabled, true);
    await h.get('copy-receipt').fire('click'); assert.match(h.copied(), /Reward paid: 0.007 SUI/); assert.match(h.copied(), /Eligible Growth Points processed: 10/); assert.match(h.copied(), /Net wallet change: 0.005424949 SUI/);
    await h.controller.refresh(); assert.equal(h.get('current-gp').textContent, '0'); assert.equal(h.get('countdown').textContent, 'Complete');
  } finally { h.controller.destroy(); }
});

function makeConfirmedFailure(data, _count, f) {
  makeConfirmedClaimFailure({ ...f, confirmation: { data } });
}

test('verified failed request needs explicit retry and revalidation before a fresh review', async () => {
  const h = await harness({ signRequest: async (_args, f) => ({ $kind: 'FailedTransaction', FailedTransaction: { digest: f.digest } }),
    transformConfirmation: makeConfirmedFailure });
  try {
    await h.review(); await h.get('submit-claim').fire('click');
    assert.equal(h.controller.getState().receipt, null); assert.equal(h.controller.getState().attempt.phase, 'failed');
    assert.equal(h.get('failure-panel').hidden, false); assert.equal(h.get('retry-claim').disabled, false);
    assert.equal(h.get('current-gp').textContent, '10'); assert.equal(h.get('submit-claim').disabled, true);
    await h.get('retry-claim').fire('click');
    assert.equal(h.counts().receiptReads, 2, 'Retry must reverify the actual failed receipt');
    assert.equal(h.counts().signCalls, 1, 'Enabling retry must not open another wallet request');
    assert.equal(h.controller.getState().attempt, null); assert.equal(h.controller.getState().failure, null);
    assert.equal(h.get('check-claim').disabled, false); assert.equal(h.get('submit-claim').disabled, true);
    assert.equal(h.get('acknowledge').checked, false); assert.equal(h.get('failure-panel').hidden, true);
  } finally { h.controller.destroy(); }
});

test('a changed Seed during explicit failure recovery keeps the failed request locked', async () => {
  const h = await harness({ signRequest: async (_args, f) => ({ $kind: 'FailedTransaction', FailedTransaction: { digest: f.digest } }),
    transformConfirmation(data, count, f) { makeConfirmedFailure(data, count, f); if (count >= 2) contents(data.seed).growth_points = '24'; } });
  try {
    await h.review(); await h.get('submit-claim').fire('click'); await h.get('retry-claim').fire('click');
    assert.equal(h.controller.getState().attempt.phase, 'failed'); assert.equal(h.counts().signCalls, 1);
    assert.equal(h.get('submit-claim').disabled, true); assert.match(h.get('status-title').textContent, /Retry could not/);
  } finally { h.controller.destroy(); }
});

test('a held request lock prevents failure recovery from clearing the journal or submitting', async () => {
  const h = await harness({ signRequest: async (_args, f) => ({ $kind: 'FailedTransaction', FailedTransaction: { digest: f.digest } }),
    transformConfirmation: makeConfirmedFailure });
  try {
    await h.review(); await h.get('submit-claim').fire('click');
    const saved = clone(new ClaimAttemptJournal(h.storage).read());
    assert.equal(saved.phase, 'failed'); h.setLockDenied(true);
    await h.get('retry-claim').fire('click');
    assert.deepEqual(new ClaimAttemptJournal(h.storage).read(), saved);
    assert.equal(h.controller.getState().attempt.phase, 'failed');
    assert.equal(h.counts().receiptReads, 1, 'Contended recovery must not start revalidation');
    assert.equal(h.counts().signCalls, 1, 'Contended recovery must not submit another request');
    assert.match(h.get('status-message').textContent, /Another tab/);
  } finally { h.controller.destroy(); }
});

test('a failed receipt cannot unlock a different journal fingerprint or unknown digest', async () => {
  for (const knownDigest of [true, false]) {
    const h = await harness({ transformConfirmation: makeConfirmedFailure });
    try {
      new ClaimAttemptJournal(h.storage).write({ nonce: 'different-attempt', phase: 'uncertain',
        digest: knownDigest ? h.fixtures.digest : null, kindSha256: knownDigest ? '0'.repeat(64) : h.fixtures.packet.kindSha256 });
      h.storageChanged(); h.get('transaction-digest').value = h.fixtures.digest;
      await h.get('verify-form').fire('submit');
      assert.equal(h.controller.getState().failure, null); assert.equal(h.get('retry-claim').disabled, true);
      assert.equal(h.controller.getState().attempt.phase, 'uncertain'); assert.equal(h.counts().signCalls, 0);
    } finally { h.controller.destroy(); }
  }
});

test('already-claimed Seed blocks new simulation and supports receipt recovery without a wallet', async () => {
  const h = await harness({ mode: 'claimed' });
  try {
    assert.equal(h.get('countdown').textContent, 'Complete'); assert.equal(h.get('current-gp').textContent, '0');
    assert.equal(h.get('transaction-digest').value, h.fixtures.digest); await h.get('verify-form').fire('submit');
    assert.equal(h.controller.getState().receipt.digest, h.fixtures.digest); assert.equal(h.counts().signCalls, 0); assert.equal(h.counts().simulations, 0);
  } finally { h.controller.destroy(); }
});

test('malformed journals fail closed and time labels handle the Chicago season deadlines', async () => {
  const storage = new MemoryStorage(); storage.setItem('arboretum:first-claim:v1:season-1:attempt', '{invalid');
  assert.equal(new ClaimAttemptJournal(storage).read().phase, 'unrecognized');
  assert.equal(isExplicitRejection(new Error('cancelled')), false); assert.equal(isExplicitRejection({ code: 4001 }), true);
  assert.equal(formatCountdown(6047025), '01:40:48'); assert.equal(formatCountdown(-1), '00:00:00');
  assert.match(formatTimestamp(EXPECTED.plantedAtMs), /5:40:41 PM CDT/);
  assert.match(formatTimestamp(EXPECTED.cutoffMs), /3:57:28 PM CST/);
  assert.match(formatTimestamp(EXPECTED.claimDeadlineMs), /Nov 8, 2026, 3:57:28 PM CST/);
  const h = await harness({ storage }); try { await h.connectAndChoose(); assert.equal(h.get('check-claim').disabled, true); } finally { h.controller.destroy(); }
});

test('a changed pool reward requires a new acknowledgement even when the exact Seed kind is unchanged', async () => {
  const next = await createClaimFixtures({ poolMist: '8000000' });
  const h = await harness({
    transformInputs(data, _f, count) { if (count >= 3) Object.assign(data, clone(next.inputs.data)); },
    transformSimulation(data, count) { if (count >= 2) Object.assign(data, clone(next.simulation.data)); },
  });
  try {
    await h.review(); const acknowledgedKind = h.controller.getState().review.loaded.kindSha256;
    await h.get('submit-claim').fire('click');
    assert.equal(h.counts().signCalls, 0); assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.controller.getState().review.loaded.kindSha256, acknowledgedKind);
    assert.equal(h.get('reward-estimate').textContent, '0.008 SUI');
    assert.equal(h.get('net-estimate').textContent, '0.006424949 SUI');
    assert.match(h.get('status-title').textContent, /review changed/);
  } finally { h.controller.destroy(); }
});

test('a changed cutoff entitlement requires a new acknowledgement even when payout and gas remain equal', async () => {
  const next = await createClaimFixtures({ growthPoints: '24' });
  const h = await harness({
    transformInputs(data, _f, count) { if (count >= 3) Object.assign(data, clone(next.inputs.data)); },
    transformSimulation(data, count) { if (count >= 2) Object.assign(data, clone(next.simulation.data)); },
  });
  try {
    await h.review(); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().signCalls, 0); assert.equal(h.get('acknowledge').checked, false);
    assert.equal(h.get('reward-estimate').textContent, '0.007 SUI');
    assert.equal(h.get('gas-estimate').textContent, '0.001575051 SUI');
    assert.match(h.get('review-growth').textContent, /24 eligible GP/);
    assert.match(h.get('status-title').textContent, /review changed/);
  } finally { h.controller.destroy(); }
});

test('a paused season still permits the supported 24-GP claim and a separate reward/fee review', async () => {
  const h = await harness({ fixtureOptions: { growthPoints: '24', finalized: true, paused: true } });
  try {
    assert.equal(h.get('current-gp').textContent, '24'); assert.equal(h.get('eligible-gp').textContent, '24');
    assert.equal(h.get('total-eligible-gp').textContent, '24'); assert.equal(h.get('reward-share').textContent, '0.007 SUI');
    await h.review(); assert.equal(h.counts().signCalls, 0); assert.equal(h.get('submit-claim').disabled, false);
    assert.equal(h.get('reward-estimate').textContent, '0.007 SUI'); assert.equal(h.get('net-estimate').textContent, '0.005424949 SUI');
    assert.match(h.get('review-growth').textContent, /24 eligible GP/);
  } finally { h.controller.destroy(); }
});

test('an expired window remains read-only and exposes the earned entitlement without a misleading countdown', async () => {
  const h = await harness({ mode: 'expired' });
  try {
    assert.equal(h.get('countdown').textContent, 'Closed'); assert.equal(h.get('eligible-gp').textContent, '10');
    assert.equal(h.get('reward-share').textContent, '0.007 SUI');
    await h.connectAndChoose(); await h.get('check-claim').fire('click'); await h.get('submit-claim').fire('click');
    assert.equal(h.counts().simulations, 0); assert.equal(h.counts().signCalls, 0);
    assert.equal(h.get('submit-claim').disabled, true);
  } finally { h.controller.destroy(); }
});

test('a fabricated digest response stays uncertain until an actual validated claim receipt exists', async () => {
  const h = await harness({ signRequest: async (_args, f) => ({ $kind: 'Transaction', Transaction: { digest: f.digest } }),
    transformConfirmation(data) { data.transaction.effects.status = 'FAILURE'; } });
  try {
    await h.review(); await h.get('submit-claim').fire('click');
    assert.equal(h.controller.getState().receipt, null); assert.ok(h.controller.getState().attempt);
    assert.equal(h.get('submit-claim').disabled, true); assert.equal(h.get('retry-claim').disabled, true);
    await h.get('submit-claim').fire('click'); assert.equal(h.counts().signCalls, 1);
  } finally { h.controller.destroy(); }
});
