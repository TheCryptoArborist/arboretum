import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidTransactionDigest } from '@mysten/sui/utils';
import { uiWalletAccountsAreSame, uiWalletAccountBelongsToUiWallet } from '@wallet-standard/ui';
import { getWalletForHandle } from '@wallet-standard/ui-registry';
import * as common from './common.mjs';
import * as rollover from './rollover-core.mjs';
import * as care from './care-core.mjs';

const { EXPECTED, assertExpectedOrigin, assertAdministrator, contents } = common;
export const ACTIONS = Object.freeze(['rollover', 'plant', 'water', 'claim']);
export const JOURNAL_PREFIX = 'arboretum:season-two:v1:';
const REQUEST_LOCK = JOURNAL_PREFIX + 'wallet';
const SIGN_FEATURES = ['sui:signAndExecuteTransaction', 'sui:signAndExecuteTransactionBlock'];
const LABELS = Object.freeze({ rollover: 'Start Season 2', plant: 'Plant a Seed', water: 'Water your Seed', claim: 'Claim Season 2 reward' });
const ensure = (value, message) => { if (!value) throw new Error(message); };
const messageOf = error => typeof error?.message === 'string' ? error.message.slice(0, 650) : 'The check could not be completed.';
const sameProvider = (handle, provider) => { try { return getWalletForHandle(handle) === provider; } catch { return false; } };
const sameAccount = (a, b) => { try { return Boolean(a && b && uiWalletAccountsAreSame(a, b)); } catch { return false; } };
const supportsSigning = account => account?.chains?.includes(EXPECTED.chain) && SIGN_FEATURES.some(feature => account.features.includes(feature));
export const isExplicitRejection = error => error?.code === 4001 ||
  (error?.name === 'WalletStandardError' && error?.context?.__code === 4001000);
export function formatTimestamp(value) {
  const time = Number(value); ensure(Number.isSafeInteger(time) && time > 0, 'The verified time is invalid.');
  return new Date(time).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long' });
}
export function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000)), days = Math.floor(seconds / 86400);
  return (days ? days + 'd ' : '') + [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
export function suiAmount(value) {
  const n = BigInt(value), a = n < 0n ? -n : n;
  const fraction = String(a % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return (n < 0n ? '−' : '') + (a / 1000000000n) + (fraction ? '.' + fraction : '') + ' SUI';
}

// Storage contains only public transaction metadata. Receipts are never trusted
// after deserializing: their digests must pass the full on-chain verifier again.
export class CycleAttemptJournal {
  constructor(storage) { this.storage = storage; }
  read(action) {
    ensure(ACTIONS.includes(action), 'Unknown test step.');
    const raw = this.storage.getItem(JOURNAL_PREFIX + action);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      ensure(value?.action === action && value.sender === EXPECTED.sender && value.registryId === EXPECTED.registryId && value.seasonId === '2', 'Wrong saved test binding.');
      ensure(typeof value.nonce === 'string' && value.nonce.length > 0 && ['requesting', 'submitted', 'uncertain', 'failed', 'confirmed'].includes(value.phase), 'Unrecognized saved test request.');
      ensure(value.digest == null || isValidTransactionDigest(value.digest), 'Invalid saved transaction digest.');
      ensure(typeof value.kindSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.kindSha256), 'Invalid saved transaction fingerprint.');
      if (value.phase === 'confirmed' || value.phase === 'submitted') ensure(value.digest, 'Saved receipt digest is missing.');
      return value;
    } catch { return { action, phase: 'unrecognized', nonce: 'unrecognized', digest: null }; }
  }
  readAll() { return Object.fromEntries(ACTIONS.map(action => [action, this.read(action)])); }
  write(action, value) {
    ensure(ACTIONS.includes(action), 'Unknown test step.');
    const record = { ...value, action, sender: EXPECTED.sender, registryId: EXPECTED.registryId, seasonId: '2' };
    const raw = JSON.stringify(record); this.storage.setItem(JOURNAL_PREFIX + action, raw);
    ensure(this.storage.getItem(JOURNAL_PREFIX + action) === raw && this.read(action)?.phase !== 'unrecognized', 'The browser could not save the wallet request.');
    return record;
  }
  clearRejected(action, nonce) {
    const current = this.read(action);
    ensure(current?.nonce === nonce && current.phase === 'requesting' && current.digest == null, 'The saved request changed. Verify its original receipt.');
    this.storage.removeItem(JOURNAL_PREFIX + action); ensure(this.read(action) === null, 'The rejected request could not be cleared.');
  }
  clearVerifiedFailure(action, nonce, digest, kindSha256) {
    const current = this.read(action);
    ensure(current?.phase === 'failed' && current.nonce === nonce && current.digest === digest && current.kindSha256 === kindSha256,
      'The saved failed request changed. Verify it again before retrying.');
    this.storage.removeItem(JOURNAL_PREFIX + action); ensure(this.read(action) === null, 'The failed request could not be cleared.');
  }
}

const DEFAULT_PROTOCOL = Object.freeze({
  ...common, ...care,
  prepare(action, snapshot, receipts, nftId) {
    if (action === 'rollover') return rollover.prepareRollover(snapshot);
    if (action === 'plant') return care.preparePlant(snapshot, nftId, receipts.rollover);
    if (action === 'water') return care.prepareWater(snapshot, receipts.rollover, receipts.plant);
    return care.prepareClaim(snapshot, receipts.rollover, receipts.plant);
  },
  simulate(action, response, packet, previous, proof, receipts, options) {
    if (action === 'rollover') return rollover.validateRolloverSimulation(response, packet, previous, proof, options);
    if (action === 'plant') return care.validatePlantSimulation(response, packet, previous, proof, receipts.rollover, options);
    if (action === 'water') return care.validateWaterSimulation(response, packet, previous, proof, receipts.rollover, receipts.plant, options);
    return care.validateClaimSimulation(response, packet, previous, proof, receipts.rollover, receipts.plant, options);
  },
  confirm(action, response, digest, proof, receipts, options) {
    if (action === 'rollover') return rollover.validateConfirmedRollover(response, digest, proof, options);
    if (action === 'plant') return care.validateConfirmedPlant(response, digest, proof, receipts.rollover, options);
    if (action === 'water') return care.validateConfirmedWater(response, digest, proof, receipts.rollover, receipts.plant, options);
    return care.validateConfirmedClaim(response, digest, proof, receipts.rollover, receipts.plant, options);
  },
  validateWallet(transaction, packet, receipts) {
    return packet.action === 'rollover' ? rollover.validateWalletTransaction(transaction, packet) : care.validateWalletTransaction(transaction, packet, receipts.rollover, receipts.plant ?? null);
  },
});

export function createCycleController({ window: win, document: doc, dAppKit, now = () => Date.now(), protocol = DEFAULT_PROTOCOL }) {
  const ids = ['origin-warning', 'chain-status', 'current-stage', 'stage-note', 'current-gp', 'current-streak', 'pool-balance',
    'countdown-label', 'countdown', 'countdown-note', 'chain-checked', 'refresh-state', 'season-start', 'watering-time', 'season-cutoff',
    'claim-deadline', 'expected-admin', 'expected-registry', 'expected-package', 'current-seed', 'season-archive', 'action-heading',
    'action-description', 'wallet-list', 'wallet-status', 'account-controls', 'account-select', 'use-account', 'connected-address',
    'disconnect', 'nft-controls', 'nft-select', 'check-action', 'submit-action', 'review-panel', 'gas-status', 'amount-label',
    'amount-estimate', 'gas-estimate', 'net-estimate', 'gas-note', 'review-summary', 'checked-at', 'acknowledge', 'acknowledgement-text',
    'action-note', 'status-panel', 'status-title', 'status-message', 'receipt-panel', 'receipt-heading', 'receipt-message', 'receipt-details',
    'receipt-link', 'copy-receipt', 'receipt-history', 'recovery-panel', 'recovery-message', 'verify-form', 'recovery-action',
    'transaction-digest', 'verify-receipt', 'failure-panel', 'failure-message', 'retry-action',
    ...ACTIONS.flatMap(action => ['step-' + action, 'step-' + action + '-note'])];
  const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
  ensure(Object.values(el).every(Boolean), 'The Season 2 page is incomplete. Reload before continuing.');
  assertExpectedOrigin(win.location.origin);
  const state = { busy: null, provider: null, session: null, generation: 0, connected: false, accountOptions: [],
    review: null, chain: null, chainReadAt: null, proof: null, readError: null, storageError: null,
    attempts: {}, receipts: {}, receipt: null, failure: null, destroyed: false };
  const options = () => ({ now: now(), nowMs: now() });
  let journal, refreshTimer, tickTimer, expirationTimer;
  const unsubscribers = [];
  for (const [id, value] of [['expected-admin', EXPECTED.sender], ['expected-registry', EXPECTED.registryId], ['expected-package', EXPECTED.packageId]]) el[id].textContent = value;
  function status(title, message, tone = '') {
    el['status-panel'].hidden = false; el['status-panel'].className = 'notice status-panel ' + tone;
    el['status-title'].textContent = title; el['status-message'].textContent = message;
  }
  function invalidateReview() { state.review = null; el.acknowledge.checked = false; el['review-panel'].hidden = true; win.clearTimeout(expirationTimer); }
  function invalidateSession(message) {
    state.generation += 1; state.session = null; invalidateReview(); el['connected-address'].hidden = true;
    if (message) el['wallet-status'].textContent = message;
  }
  function readAttempts() {
    if (state.storageError) return state.attempts;
    try { state.attempts = journal.readAll(); } catch (error) { state.storageError = messageOf(error); }
    return state.attempts;
  }
  function saveAttempt(action, value) {
    try { state.attempts[action] = journal.write(action, value); }
    catch (error) { state.storageError = messageOf(error); state.attempts[action] = { ...value, action }; throw error; }
    return state.attempts[action];
  }
  function blockedAction() {
    readAttempts();
    return ACTIONS.find(action => state.attempts[action] &&
      (!state.receipts[action] || state.attempts[action].phase !== 'confirmed' || state.attempts[action].digest !== state.receipts[action].digest)) ?? null;
  }
  const eligibleWallets = () => dAppKit.stores.$wallets.get().filter(wallet => wallet.name === 'Slush');
  function currentPinnedWallet() {
    const wallets = eligibleWallets(); ensure(wallets.length === 1, 'Keep one Slush browser extension available and connect it explicitly.');
    ensure(state.provider && sameProvider(wallets[0], state.provider), 'The Slush provider changed. Reconnect the intended extension.'); return wallets[0];
  }
  function assertSession(generation = state.generation) {
    assertExpectedOrigin(win.location.origin);
    ensure(generation === state.generation && state.session, 'The selected account changed. Select the owner and check the action again.');
    ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network, 'Select Sui mainnet.');
    const wallet = currentPinnedWallet(), connection = dAppKit.stores.$connection.get();
    ensure(connection.isConnected && sameProvider(connection.wallet, state.provider) && sameAccount(connection.account, state.session.account), 'The connected account changed. Select the owner again.');
    const account = wallet.accounts.find(candidate => sameAccount(candidate, state.session.account));
    ensure(account && uiWalletAccountBelongsToUiWallet(account, wallet) && supportsSigning(account), 'The selected account is no longer available on Sui mainnet.');
    assertAdministrator(account.address, EXPECTED.chain); return { wallet, account };
  }
  const hasSession = () => { try { assertSession(); return true; } catch { return false; } };
  function chainFresh() {
    if (!state.chain || state.readError || state.chainReadAt === null) return false;
    const age = now() - Date.parse(state.chain.checkpoint.timestamp);
    return Number.isFinite(age) && age >= -30000 && age <= EXPECTED.maxAgeMs && now() - state.chainReadAt <= EXPECTED.maxAgeMs;
  }
  function view() {
    if (!state.chain) return { status: 'unavailable', action: null, canAct: false };
    if (state.chain.status === 'rollover-ready') return { status: 'rollover-ready', action: 'rollover', canAct: true };
    if (state.chain.status !== 'season-two') return { status: 'closed', action: null, canAct: false };
    if (!state.receipts.rollover) return { status: 'needs-rollover-receipt', action: null, canAct: false };
    try { return protocol.inspectCare(state.chain, state.receipts.rollover, state.receipts.plant ?? null, options()); }
    catch (error) { return { status: 'unavailable', action: null, canAct: false, reason: messageOf(error) }; }
  }
  const estimatedClock = () => Number(state.chain?.clockMs || 0) + Math.max(0, now() - (state.chainReadAt ?? now()));
  function actionOpen(v = view()) {
    if (!chainFresh() || !v.canAct || !v.action) return false;
    if (state.receipts[v.action]) return false;
    if (v.action === 'plant' || v.action === 'water') return estimatedClock() < Number(state.receipts.rollover.cutoffMs);
    if (v.action === 'claim') return estimatedClock() <= Number(state.receipts.rollover.claimDeadlineMs);
    return true;
  }
  function populateNFTs() {
    const selected = el['nft-select'].value, nfts = state.chain?.ownedNFTs ?? [];
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = nfts.length ? 'Select an NFTree' : 'No directly owned NFTrees found';
    el['nft-select'].replaceChildren(placeholder);
    for (const nft of nfts) { const option = doc.createElement('option'); option.value = nft.objectId ?? nft.address;
      option.textContent = (nft.name || 'NFTree') + ' · ' + option.value.slice(0, 10) + '…' + option.value.slice(-6); el['nft-select'].append(option); }
    el['nft-select'].value = nfts.some(nft => (nft.objectId ?? nft.address) === selected) ? selected : '';
  }
  function renderChain(v) {
    const r = contents(state.chain?.registry), cycle = state.receipts.rollover, plant = state.receipts.plant;
    const seed = v.seed ? contents(v.seed) ?? v.seed : state.chain?.seasonSeeds?.length === 1 ? contents(state.chain.seasonSeeds[0]) : null;
    el['current-gp'].textContent = v.growthPoints ?? seed?.growth_points ?? '—';
    el['current-streak'].textContent = v.wateringStreak ?? seed?.watering_streak ?? '—';
    el['pool-balance'].textContent = r ? suiAmount(r.reward_pool) : '—';
    el['current-seed'].textContent = v.seedId ?? plant?.seedId ?? 'Available after planting';
    el['season-archive'].textContent = cycle?.archiveId ?? 'Available after rollover';
    if (cycle) { el['season-start'].textContent = formatTimestamp(cycle.actualStartMs); el['season-cutoff'].textContent = formatTimestamp(cycle.cutoffMs); el['claim-deadline'].textContent = formatTimestamp(cycle.claimDeadlineMs); }
    if (plant) el['watering-time'].textContent = formatTimestamp(plant.waterReadyMs);
    el['chain-checked'].textContent = state.chain ? 'Last verified ' + new Date(state.chainReadAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago' }) + ' · checkpoint ' + state.chain.checkpoint.sequenceNumber : 'Waiting for a current mainnet read.';
    const messages = {
      'rollover-ready': ['Ready for Season 2', 'Your Season 1 payment is complete. Start a fresh 48-hour test, then plant promptly.', 'Start Season 2', 'This approval archives Season 1 and starts Season 2 together. The new season begins when the transaction succeeds.'],
      'plant-ready': ['Your new season is growing', 'Choose an NFTree and plant one Seed while there is time to water before the cutoff.', 'Plant a Seed', 'Plant one Season 2 Seed for 0.01 SUI. Your NFTree stays in your wallet.'],
      'plant-window-closed': ['The planting window has closed', 'There is no longer enough time for this test’s first watering before the growing cutoff.', 'Planting is closed for this test', 'This 48-hour test needs planting early enough to leave the normal 21-hour, 36-minute watering interval.'],
      'waiting-water': ['Your Seed is taking root', 'Return when watering opens. This test uses the normal 21-hour, 36-minute care interval.', 'Watering opens soon', 'The first watering adds 14 GP and advances your watering streak to 2.'],
      'water-ready': ['Time for a little water', 'Your first watering is ready. Check it below and approve it before the growing cutoff.', 'Water your Seed', 'One normal watering takes your Seed from 10 to 24 GP. There is no app charge; you pay the network fee.'],
      watered: ['Your Seed has been watered', 'The first watering is complete. Keep this page for the reward when the growing season ends.', 'Growing until the cutoff', 'You have completed this test’s watering step. The reward opens at the growing cutoff.'],
      'claim-ready': ['Your season reward is ready', 'Review the reward and network fee before claiming your Season 2 share.', 'Claim Season 2 reward', 'This claim processes your eligible Growth Points and pays the reward to your selected wallet.'],
      claimed: [state.receipts.claim ? 'Season 2 reward paid' : 'Season 2 reward processed', 'Your Seed’s reward has been processed. Its remaining claimable GP is now zero.', 'Season 2 is complete', 'Your completed actions are available in the receipts below.'],
      expired: ['The claim window has closed', 'Existing receipts can still be verified below.', 'Claim deadline passed', 'A new claim is no longer available for this test.'],
      closed: ['This test window has ended', 'This page covers the fixed Season 2 test. Existing receipts remain available for review.', 'No action available', 'Refresh the current state or recover a previous receipt below.'],
      'needs-rollover-receipt': ['Season 2 has already started', 'Recover the Season 2 start transaction below to restore its exact schedule and continue.', 'Verify your season start', 'Paste the original Season 2 start digest from Slush. This check costs no gas.'],
      'needs-plant-receipt': ['Your Season 2 Seed is planted', 'Recover the planting transaction below to restore the Seed’s watering schedule.', 'Verify your planting', 'Paste the original planting digest from Slush. A second planting is disabled.'],
      unavailable: ['Status needs a fresh check', v.reason || 'Refresh mainnet status to continue.', 'Refresh your season', 'A fresh verified state is required before reviewing any wallet action.'],
    };
    const m = messages[v.status] || messages.unavailable;
    if (v.status === 'waiting-water' && plant?.canWaterBeforeCutoff === false) {
      m[0] = 'Your Seed is planted'; m[1] = 'The planting completed too late for watering before this season’s cutoff. Its existing Growth Points can still be claimed after the cutoff.';
      m[2] = 'Waiting for the season reward'; m[3] = 'The reward check will open at the growing cutoff shown below.';
    }
    el['current-stage'].textContent = m[0]; el['stage-note'].textContent = m[1]; el['action-heading'].textContent = m[2]; el['action-description'].textContent = m[3];
    for (const action of ACTIONS) {
      const done = Boolean(state.receipts[action]) || (action === 'water' && ['watered', 'claim-ready', 'claimed'].includes(v.status) && seed?.watering_streak === '2') || (action === 'claim' && v.status === 'claimed');
      el['step-' + action].className = done ? 'done' : v.action === action ? 'active' : '';
      el['step-' + action + '-note'].textContent = done ? 'Complete' : ({ rollover: 'Archive & start', plant: '0.01 SUI', water: '10 → 24 GP', claim: 'After the cutoff' })[action];
    }
    el['nft-controls'].hidden = v.action !== 'plant';
    el['chain-status'].textContent = chainFresh() ? 'Mainnet verified' : state.readError ? 'Read unavailable' : state.chain ? 'Refresh needed' : 'Checking mainnet';
    el['chain-status'].className = 'pill' + (chainFresh() ? ' ready' : '');
    el['countdown-label'].textContent = 'SEASON TIMER'; el.countdown.textContent = '—';
    el['countdown-note'].textContent = state.readError || 'The 48 hours begin when your season-start transaction succeeds.';
    if (chainFresh() && cycle) {
      const clock = estimatedClock(); let target;
      if (['waiting-water', 'water-ready'].includes(v.status) && plant && plant.canWaterBeforeCutoff !== false && clock < Number(plant.waterReadyMs)) {
        target = Number(plant.waterReadyMs); el['countdown-label'].textContent = 'FIRST WATERING OPENS IN'; el['countdown-note'].textContent = 'Return at the watering time shown below, then refresh status.';
      } else if (clock < Number(cycle.cutoffMs)) {
        target = Number(cycle.cutoffMs); el['countdown-label'].textContent = 'GROWING ENDS IN'; el['countdown-note'].textContent = 'The reward becomes available when this growing window ends.';
      } else if (v.status !== 'claimed' && clock <= Number(cycle.claimDeadlineMs)) {
        target = Number(cycle.claimDeadlineMs); el['countdown-label'].textContent = 'CLAIM WINDOW CLOSES IN'; el['countdown-note'].textContent = 'Claim before this deadline. Your reward and network fee are checked separately.';
      } else { el.countdown.textContent = v.status === 'claimed' ? 'Complete' : 'Closed'; el['countdown-note'].textContent = 'Review your confirmed receipts below.'; }
      if (target) el.countdown.textContent = formatCountdown(target - clock);
    }
    if (!chainFresh()) { el.countdown.textContent = '—'; el['countdown-note'].textContent = state.readError || 'Refresh the status to restore the verified timer and next step.'; }
  }
  function syncUI() {
    const v = view(), busy = Boolean(state.busy), selected = hasSession(), blocked = blockedAction();
    const open = actionOpen(v), nftChosen = v.action !== 'plant' || Boolean(el['nft-select'].value);
    const fresh = state.review && state.review.action === v.action && now() - state.review.checkedAt < EXPECTED.maxAgeMs && open;
    el['check-action'].disabled = busy || !selected || !open || !nftChosen || blocked || state.storageError;
    el['check-action'].textContent = state.busy === 'checking' ? 'Checking…' : 'Check ' + (v.action ? LABELS[v.action].toLowerCase() : 'readiness');
    el.acknowledge.disabled = busy || !selected || !fresh || blocked || state.storageError;
    el['submit-action'].disabled = busy || !selected || !fresh || !el.acknowledge.checked || blocked || state.storageError;
    el['submit-action'].textContent = state.busy === 'submitting' ? 'Checking and opening Slush…' : blocked ? 'Verify the previous request' : v.action ? LABELS[v.action] + ' in Slush ↗' : 'Waiting for the next step';
    el['account-select'].disabled = busy || !state.connected; el['use-account'].disabled = busy || !state.connected || el['account-select'].value === '';
    el.disconnect.disabled = busy || !state.connected; el['nft-select'].disabled = busy || blocked || state.storageError;
    el['refresh-state'].disabled = busy; el['verify-receipt'].disabled = busy; el['recovery-action'].disabled = busy;
    el['retry-action'].disabled = busy || !state.failure?.permitsRetry || state.storageError;
    for (const button of el['wallet-list'].querySelectorAll('button')) button.disabled = busy || state.connected;
    renderChain(v);
  }
  function populateAccounts(wallet) {
    const previous = el['account-select'].value === '' ? null : state.accountOptions[Number(el['account-select'].value)];
    state.accountOptions = wallet?.accounts ? [...wallet.accounts] : [];
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select an account'; el['account-select'].replaceChildren(placeholder);
    state.accountOptions.forEach((account, index) => { const option = doc.createElement('option'); option.value = String(index);
      option.textContent = account.address === EXPECTED.sender ? 'Owner · ' + account.address : account.address; el['account-select'].append(option); });
    const index = previous ? state.accountOptions.findIndex(account => sameAccount(account, previous)) : -1; el['account-select'].value = index >= 0 ? String(index) : '';
  }
  function renderWallets() {
    const wallets = eligibleWallets(); el['wallet-list'].replaceChildren();
    if (wallets.length !== 1) { const note = doc.createElement('p'); note.className = 'small-text';
      note.textContent = wallets.length ? 'More than one Slush provider is available. Keep the intended extension enabled, then reload.' : 'Use a browser with the Slush extension for wallet approvals. Your status and receipts can be viewed without a wallet.'; el['wallet-list'].append(note); return; }
    const button = doc.createElement('button'); button.type = 'button'; button.id = 'connect-slush'; button.className = 'button secondary';
    button.textContent = state.connected ? 'Slush connected' : 'Connect Slush browser extension'; button.addEventListener('click', () => connect(wallets[0])); el['wallet-list'].append(button);
  }
  function connectionChanged() {
    const connection = dAppKit.stores.$connection.get(); state.connected = Boolean(connection.isConnected && state.provider && sameProvider(connection.wallet, state.provider));
    if (state.session) { try { assertSession(); } catch { invalidateSession('The wallet or account changed. Select the owner again.'); } }
    el['account-controls'].hidden = !state.connected; populateAccounts(state.connected ? connection.wallet : null); renderWallets(); syncUI();
  }
  async function connect(wallet) {
    if (state.busy || state.connected) return; state.busy = 'connecting'; invalidateSession();
    try {
      assertExpectedOrigin(win.location.origin); const wallets = eligibleWallets(), provider = getWalletForHandle(wallet);
      ensure(wallets.length === 1 && sameProvider(wallets[0], provider), 'The available Slush provider changed. Reload and connect again.');
      state.provider = provider; syncUI(); el['wallet-status'].textContent = 'Approve the connection in Slush.';
      await dAppKit.connectWallet({ wallet: wallets[0] }); const connection = dAppKit.stores.$connection.get();
      ensure(connection.isConnected && sameProvider(connection.wallet, provider), 'Slush did not return the selected provider.');
      el['wallet-status'].textContent = 'Choose your account, then select “Use selected account”.'; el['account-select'].value = '';
    } catch (error) { state.provider = null; status('Connection not completed', messageOf(error), 'warning'); }
    finally { state.busy = null; connectionChanged(); }
  }
  function chooseAccount() {
    if (state.busy) return; invalidateSession();
    try {
      const wallet = currentPinnedWallet(); ensure(el['account-select'].value !== '', 'Choose an account first.');
      const choice = state.accountOptions[Number(el['account-select'].value)], account = wallet.accounts.find(candidate => sameAccount(candidate, choice));
      ensure(account && supportsSigning(account), 'That account is not available for Sui mainnet.');
      ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network, 'Select Sui mainnet.'); assertAdministrator(account.address);
      dAppKit.switchAccount({ account }); state.session = { account }; state.generation += 1; assertSession();
      el['connected-address'].textContent = account.address; el['connected-address'].hidden = false; el['wallet-status'].textContent = 'Owner selected · Slush · Sui mainnet';
    } catch (error) { state.session = null; status('Select the owner account', messageOf(error) + ' Required account: ' + EXPECTED.sender, 'warning'); }
    syncUI();
  }
  async function disconnect() {
    if (state.busy) return; invalidateSession(); state.provider = null;
    try { await dAppKit.disconnectWallet(); } catch (error) { status('Connection could not be closed', messageOf(error), 'warning'); }
    el['wallet-status'].textContent = 'Connecting shares your address. It costs no gas.'; connectionChanged();
  }
  async function graphql(query, variables = {}) {
    const abort = new AbortController(), timer = win.setTimeout(() => abort.abort(), 25000);
    try {
      const response = await win.fetch(EXPECTED.graphqlEndpoint || EXPECTED.endpoint, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
      ensure(response.ok, 'Mainnet read failed (HTTP ' + response.status + '). Refresh status to try again.'); return await response.json();
    } finally { win.clearTimeout(timer); }
  }
  async function readComplete(query, variables, guard = () => {}) {
    let raw = await graphql(query, variables); guard(); let count = 0;
    for (let next = protocol.nextNFTPageVariables(raw); next; next = protocol.nextNFTPageVariables(raw)) {
      ensure(count++ < 100, 'The NFTree inventory exceeds this review limit.');
      const page = await graphql(protocol.NFT_PAGE_QUERY, next); guard(); raw = protocol.appendNFTPage(raw, page);
    }
    return raw;
  }
  async function inspectChain(guard = () => {}) {
    const proof = await graphql(protocol.PROOF_QUERY, protocol.PROOF_VARIABLES); guard();
    const raw = await readComplete(protocol.INPUTS_QUERY, protocol.INPUT_VARIABLES, guard);
    const chain = await protocol.inspectState(raw, proof, options()); guard(); state.proof = proof; return chain;
  }
  function acceptChain(chain) { state.chain = chain; state.chainReadAt = now(); state.readError = null; populateNFTs(); }
  async function fieldsFor(chain, action, nftId, guard = () => {}) {
    if (action === 'rollover') return chain;
    const selected = action === 'plant' ? nftId : state.receipts.plant?.nftId;
    ensure(selected, 'Verify the planting receipt before this step.');
    const raw = await graphql(protocol.PLANT_FIELDS_QUERY, protocol.plantFieldVariables(chain, selected)); guard();
    return protocol.attachPlantFields(chain, raw, selected);
  }
  async function refreshState({ quiet = false, restore = false } = {}) {
    if (state.busy || state.destroyed) return; state.busy = 'refreshing'; invalidateReview(); syncUI();
    try {
      acceptChain(await inspectChain());
      if (restore) {
        readAttempts();
        for (const action of ACTIONS) {
          const record = state.attempts[action]; if (!record?.digest || state.receipts[action]?.digest === record.digest) continue;
          try { await verifyDigest(action, record.digest, false, false); }
          catch (error) { uncertain(action, error); break; }
        }
      }
      const v = view();
      if (v.status === 'needs-rollover-receipt' || v.status === 'needs-plant-receipt') {
        el['recovery-panel'].open = true; el['recovery-action'].value = v.status === 'needs-rollover-receipt' ? 'rollover' : 'plant';
        el['recovery-message'].textContent = v.status === 'needs-rollover-receipt' ? 'Season 2 is already started. Paste its original start transaction from Slush to verify the schedule and continue.' : 'The Season 2 Seed already exists. Paste its original planting transaction to restore watering and reward checks.';
      }
      if (!quiet && !blockedAction()) status('Season status refreshed', 'The next step and its timing have been verified on mainnet.');
    } catch (error) { state.readError = messageOf(error); invalidateReview(); if (!quiet) status('Season status could not be verified', messageOf(error), 'warning'); }
    finally { state.busy = null; syncUI(); }
  }
  async function freshReview(action, generation, nftId) {
    const guard = () => assertSession(generation); guard(); acceptChain(await inspectChain(guard));
    const v = view(); ensure(v.action === action && actionOpen(v), v.reason || 'This step is no longer ready. Refresh the season.');
    const previous = await fieldsFor(state.chain, action, nftId, guard);
    const packet = await protocol.prepare(action, previous, state.receipts, nftId); guard();
    const raw = await readComplete(protocol.SIMULATION_QUERY, { ...protocol.INPUT_VARIABLES, transaction: packet.simulationTransaction }, guard);
    const simulation = await protocol.simulate(action, raw, packet, previous, state.proof, state.receipts, options()); guard();
    return { action, chain: previous, packet, simulation, checkedAt: now(), generation, nftId };
  }
  function economics(review) {
    const s = review.simulation, fee = BigInt(s.gasEstimateMist);
    if (review.action === 'plant') return { label: 'Planting price', amount: EXPECTED.priceMist, net: String(-BigInt(EXPECTED.priceMist) + BigInt(EXPECTED.developerShareMist) - fee),
      note: '0.007 SUI funds the reward pool, 0.0028 SUI goes to treasury, and 0.0002 SUI returns to this owner as the developer share. Network gas is separate.' };
    if (review.action === 'claim') return { label: 'Reward before gas', amount: s.rewardMist, net: s.netReceiveMist ?? String(BigInt(s.rewardMist) - fee),
      note: 'Your reward is paid from the season pool. Check the net amount after network gas before approving.' };
    return { label: 'App charge', amount: '0', net: String(-fee), note: 'Only the network fee is charged. Slush selects the final gas budget.' };
  }
  function displayReview(review) {
    state.review = review; const e = economics(review); el['review-panel'].hidden = false; el.acknowledge.checked = false;
    el['amount-label'].textContent = e.label; el['amount-estimate'].textContent = suiAmount(e.amount); el['gas-estimate'].textContent = suiAmount(review.simulation.gasEstimateMist);
    el['net-estimate'].textContent = suiAmount(e.net); el['gas-note'].textContent = e.note;
    const summaries = { rollover: 'Archive the completed Season 1 and start Season 2 for exactly 48 hours in one transaction.',
      plant: 'Plant one Season 2 Seed with the NFTree you selected. Initial growth: 10 GP.', water: 'Water your verified Season 2 Seed once. Expected growth: 10 → 24 GP.',
      claim: 'Process ' + (review.simulation.eligibleGrowthPoints ?? 'the verified') + ' eligible GP and pay the Season 2 reward to your wallet.' };
    el['review-summary'].textContent = summaries[review.action];
    el['acknowledgement-text'].textContent = 'I want to ' + ({ rollover: 'archive Season 1 and start the 48-hour Season 2 test', plant: 'plant this one Season 2 Seed for 0.01 SUI', water: 'water this Season 2 Seed once', claim: 'claim this Seed’s Season 2 reward once' })[review.action] + '. I have reviewed the amounts and network fee.';
    el['checked-at'].textContent = 'Checked ' + new Date(review.checkedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago' }) + ' · this review expires after two minutes.';
    win.clearTimeout(expirationTimer); expirationTimer = win.setTimeout(() => { if (state.review === review) { invalidateReview(); syncUI(); } }, EXPECTED.maxAgeMs);
  }
  async function checkAction() {
    const v = view(); if (state.busy || blockedAction() || state.storageError || !actionOpen(v) || !hasSession()) return;
    state.busy = 'checking'; invalidateReview(); const generation = state.generation, nftId = el['nft-select'].value; syncUI();
    status('Checking ' + LABELS[v.action].toLowerCase(), 'Reading the exact inputs and simulating the proposed action. This check costs no gas.');
    try { const review = await freshReview(v.action, generation, nftId); ensure(!blockedAction() && !state.storageError, 'A previous wallet request needs verification.');
      displayReview(review); status('Ready for your review', 'Review the amounts below, acknowledge this step, then open its Slush review.'); }
    catch (error) { invalidateReview(); status('Readiness check stopped', messageOf(error), 'warning'); }
    finally { state.busy = null; syncUI(); }
  }
  function renderReceipt(receipt) {
    state.receipt = receipt; el['receipt-panel'].hidden = false; el['receipt-heading'].textContent = LABELS[receipt.action] + ' · confirmed';
    el['receipt-message'].textContent = ({ rollover: 'Season 1 is archived. Season 2 is growing for 48 hours. Plant your test Seed promptly using the next step above.',
      plant: receipt.canWaterBeforeCutoff === false ? 'Your new Seed has 10 GP. Planting completed too late to water before the cutoff; return after the cutoff to claim its existing reward.' : 'Your new Seed has 10 GP. Its first watering time is shown above. Return at that time and refresh the status.',
      water: 'Your first watering is complete. Your Seed has 24 GP and a watering streak of 2. Return after the growing cutoff for its reward.',
      claim: 'Your Season 2 reward payment and processed Growth Points have been verified. This test’s reward is complete.' })[receipt.action];
    const entries = [['Transaction digest', receipt.digest], ['Network fee', suiAmount(receipt.gasEstimateMist)]];
    if (receipt.seedId) entries.push(['Seed object', receipt.seedId]);
    if (receipt.archiveId) entries.push(['Season 1 archive', receipt.archiveId]);
    if (receipt.actualStartMs) entries.push(['Season 2 started', formatTimestamp(receipt.actualStartMs)]);
    if (receipt.waterReadyMs) entries.push(['Watering opens', formatTimestamp(receipt.waterReadyMs)]);
    if (receipt.cutoffMs) entries.push(['Growing cutoff', formatTimestamp(receipt.cutoffMs)]);
    if (receipt.rewardMist != null) entries.push(['Reward paid', suiAmount(receipt.rewardMist)], ['Net wallet change', suiAmount(receipt.netReceiveMist)]);
    el['receipt-details'].replaceChildren();
    for (const [label, value] of entries) { const dt = doc.createElement('dt'), dd = doc.createElement('dd'); dt.textContent = label; dd.textContent = value; el['receipt-details'].append(dt, dd); }
    el['receipt-link'].href = 'https://suivision.xyz/txblock/' + encodeURIComponent(receipt.digest);
    el['receipt-history'].replaceChildren();
    for (const action of ACTIONS) if (state.receipts[action]) { const link = doc.createElement('a'); link.href = 'https://suivision.xyz/txblock/' + encodeURIComponent(state.receipts[action].digest);
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = LABELS[action] + ' ↗'; el['receipt-history'].append(link); }
  }
  function acceptReceipt(action, receipt, originalAttempt) {
    ensure(receipt.status === 'confirmed' && receipt.action === action, 'A confirmed receipt for this exact step is required.');
    const saved = readAttempts()[action] ?? null;
    ensure(Boolean(saved) === Boolean(originalAttempt) && (!saved ||
      (saved.nonce === originalAttempt.nonce && saved.kindSha256 === originalAttempt.kindSha256)),
      'The saved request changed during receipt verification. Refresh and verify the original request.');
    if (saved?.digest) ensure(saved.digest === receipt.digest, 'Use the original digest returned by Slush.');
    if (saved?.kindSha256) ensure(saved.kindSha256 === (receipt.kindSha256 ?? receipt.exactKindSha256), 'The receipt differs from the reviewed transaction.');
    state.receipts[action] = receipt; state.failure = null; el['failure-panel'].hidden = true; invalidateReview();
    try { saveAttempt(action, { ...saved, nonce: saved?.nonce && saved.nonce !== 'unrecognized' ? saved.nonce : win.crypto.randomUUID(), phase: 'confirmed',
      digest: receipt.digest, kindSha256: receipt.kindSha256 ?? receipt.exactKindSha256, at: now() }); } catch { /* Display the verified receipt even if storage is unavailable. */ }
    renderReceipt(receipt);
  }
  async function verifyDigest(action, digest, wait = false, announce = true) {
    ensure(ACTIONS.includes(action) && isValidTransactionDigest(digest), 'Paste the complete original transaction digest from Slush.');
    readAttempts(); const saved = state.attempts[action]; if (saved?.digest) ensure(saved.digest === digest, 'Use the digest already returned by Slush for this request.');
    if (action !== 'rollover') ensure(state.receipts.rollover, 'Verify the Season 2 start receipt first.');
    if (action === 'water' || action === 'claim') ensure(state.receipts.plant, 'Verify the planting receipt first.');
    if (wait) { try { const client = dAppKit.getClient(EXPECTED.network);
      if (client.core?.waitForTransaction) await client.core.waitForTransaction({ digest, timeout: 15000 });
      else await client.waitForTransaction({ digest, timeout: 15000, pollSchedule: [0, 500, 1500, 3000] });
    } catch { /* An indexing timeout never authorizes a second request. */ } }
    let last;
    for (let i = 0; i < 4; i += 1) {
      if (i) await new Promise(resolve => win.setTimeout(resolve, i * 1000));
      try {
        const proof = await graphql(protocol.PROOF_QUERY, protocol.PROOF_VARIABLES);
        const raw = await readComplete(protocol.CONFIRM_QUERY, { ...protocol.CONFIRM_VARIABLES, digest });
        const confirmationOptions = options();
        if (action === 'plant' && protocol.plantReceiptFieldVariables) {
          const variables = await protocol.plantReceiptFieldVariables(raw, digest);
          if (variables) confirmationOptions.unchangedPlantField = await graphql(protocol.PLANT_RECEIPT_FIELD_QUERY, variables);
        }
        const receipt = await protocol.confirm(action, raw, digest, proof, state.receipts, confirmationOptions);
        const { transaction: _tx, simulateTransaction: _sim, ...live } = raw.response?.data ?? raw.data;
        acceptChain(await protocol.inspectState({ data: live }, proof, options())); state.proof = proof;
        acceptReceipt(action, receipt, saved); if (announce) status(LABELS[action] + ' confirmed on mainnet', 'The transaction, state changes, and network fee have been verified.', 'success');
        return receipt;
      } catch (error) {
        const failure = error?.confirmedFailure, current = readAttempts()[action];
        if (failure && saved && current?.nonce === saved.nonce && current?.digest === digest && failure.digest === digest && current.kindSha256 === failure.kindSha256 &&
          (!failure.action || failure.action === action)) {
          saveAttempt(action, { ...current, phase: 'failed' }); state.failure = { ...failure, action, nonce: current.nonce };
          el['failure-panel'].hidden = false; el['failure-message'].textContent = 'The exact submitted transaction failed. ' + (failure.permitsRetry ? 'Its failure can be rechecked before preparing a new review.' : 'The current state does not permit a retry.');
        }
        last = error; if (error?.code !== 'CONFIRMATION_PENDING') throw error;
      }
    }
    throw last;
  }
  function uncertain(action, error, nonce = null) {
    invalidateReview(); readAttempts(); const saved = state.attempts[action];
    if (!state.storageError && nonce && saved?.nonce === nonce && !['confirmed', 'failed'].includes(saved.phase)) {
      try { saveAttempt(action, { ...saved, phase: 'uncertain' }); } catch { /* The memory lock remains. */ }
    }
    el['recovery-panel'].open = true; el['recovery-action'].value = action; if (saved?.digest) el['transaction-digest'].value = saved.digest;
    status('Verify the original ' + LABELS[action].toLowerCase() + ' request', messageOf(error) + ' Another request is disabled until the original outcome is verified.', 'warning'); syncUI();
  }
  async function submitAction() {
    const v = view(); if (state.busy || blockedAction() || state.storageError || !actionOpen(v)) return;
    const acknowledged = state.review, generation = state.generation, action = v.action; let handedOff = false, nonce;
    try {
      assertSession(generation); ensure(acknowledged?.action === action && el.acknowledge.checked && now() - acknowledged.checkedAt < EXPECTED.maxAgeMs,
        'Check and acknowledge the current review first.'); ensure(win.navigator.locks?.request, 'Use a current browser that supports protected wallet requests.');
      state.busy = 'submitting'; syncUI();
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling a test transaction. Verify its result before continuing.');
        ensure(!blockedAction() && !state.storageError, 'An earlier wallet request needs verification.');
        status('Checking once more before Slush', 'Refreshing the exact inputs, timing, and fee before opening your wallet.');
        const fresh = await freshReview(action, generation, acknowledged.nftId);
        const comparison = ['gasEstimateMist', 'rewardMist', 'netReceiveMist', 'eligibleGrowthPoints', 'growthPoints', 'priceMist'];
        if (fresh.packet.kindSha256 !== acknowledged.packet.kindSha256 || comparison.some(key => fresh.simulation[key] !== acknowledged.simulation[key])) {
          displayReview(fresh); status('The review changed', 'Review the updated inputs and amounts, acknowledge them, then open Slush again.', 'warning'); return;
        }
        await protocol.validateWallet(fresh.packet.transaction, fresh.packet, state.receipts);
        ensure(actionOpen(view()) && now() - fresh.checkedAt < EXPECTED.maxAgeMs, 'The current review expired. Check the action again.');
        const { account } = assertSession(generation);
        ensure(el.acknowledge.checked && state.review === acknowledged, 'The acknowledgement changed. Review the action again.');
        ensure(!blockedAction() && !state.storageError, 'Another wallet request needs verification.');
        nonce = win.crypto.randomUUID(); saveAttempt(action, { nonce, phase: 'requesting', digest: null, kindSha256: fresh.packet.kindSha256, at: now() });
        assertSession(generation); handedOff = true; status('Review ' + LABELS[action].toLowerCase() + ' in Slush', 'Review the transaction in your wallet. This page will verify its actual result after your decision.');
        let result;
        try { result = await dAppKit.signAndExecuteTransaction({ transaction: fresh.packet.transaction, account, network: EXPECTED.network }); }
        catch (error) {
          if (!isExplicitRejection(error)) throw error;
          journal.clearRejected(action, nonce); state.attempts[action] = null; invalidateReview(); status('Cancelled in Slush', 'Slush reported that you rejected this request. Run a fresh check to continue.'); return;
        }
        const digest = result?.Transaction?.digest || result?.FailedTransaction?.digest;
        ensure(isValidTransactionDigest(digest || ''), 'Slush did not return a verifiable transaction digest.');
        const current = readAttempts()[action];
        ensure(!state.storageError && current?.nonce === nonce && current.kindSha256 === fresh.packet.kindSha256,
          'The saved request changed while Slush was open. Refresh and verify the original request.');
        ensure(!current.digest || current.digest === digest, 'A different transaction digest is already saved. Verify that original request.');
        if (!['confirmed', 'failed'].includes(current.phase)) saveAttempt(action, { ...current, phase: 'submitted', digest });
        status('Verifying the actual receipt', 'Slush returned a digest. Checking execution, state changes, and the actual network fee.');
        await verifyDigest(action, digest, true);
      });
    } catch (error) { if (handedOff || state.attempts[action]) uncertain(action, error, nonce); else { invalidateReview(); status('Wallet review did not open', messageOf(error), 'warning'); } }
    finally { state.busy = null; syncUI(); }
  }
  async function verifyFromForm(event) {
    event.preventDefault(); if (state.busy) return; const action = el['recovery-action'].value;
    if (!ACTIONS.includes(action)) return; state.busy = 'verifying'; invalidateReview(); syncUI();
    try { await verifyDigest(action, el['transaction-digest'].value.trim(), true); }
    catch (error) { uncertain(action, error); } finally { state.busy = null; syncUI(); }
  }
  async function retryFailure() {
    if (state.busy || state.storageError || !state.failure?.permitsRetry) return;
    const failure = state.failure; state.busy = 'retrying'; syncUI();
    try {
      ensure(win.navigator.locks?.request, 'This browser cannot protect recovery across tabs.');
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling this request.'); let checked;
        try { await verifyDigest(failure.action, failure.digest); throw new Error('A successful transaction cannot be retried.'); }
        catch (error) { checked = error.confirmedFailure; ensure(checked?.permitsRetry && checked.digest === failure.digest && checked.kindSha256 === failure.kindSha256,
          'The original failed transaction no longer permits a retry.'); }
        acceptChain(await inspectChain()); journal.clearVerifiedFailure(failure.action, failure.nonce, failure.digest, failure.kindSha256);
        state.attempts[failure.action] = null; state.failure = null; el['failure-panel'].hidden = true; invalidateReview();
        status('Ready for a fresh review', 'The original failure is verified. Check the action again and review the new fee before another wallet approval.');
      });
    } catch (error) { status('Retry could not be enabled', messageOf(error), 'warning'); } finally { state.busy = null; syncUI(); }
  }
  function onStorage(event) {
    if (event.key !== null && !event.key?.startsWith(JOURNAL_PREFIX)) return;
    invalidateReview(); state.receipts = {}; state.failure = null; readAttempts();
    status('A test record changed in another tab', 'Refresh status to reverify the saved receipts before continuing.', 'warning'); syncUI();
  }
  function scheduleRefresh() { refreshTimer = win.setTimeout(async () => {
    if (state.destroyed) return; if (!doc.hidden && !state.busy) await refreshState({ quiet: true }); if (!state.destroyed) scheduleRefresh();
  }, 60000); }
  function tick() {
    if (state.destroyed) return; if (state.review && (!actionOpen(view()) || now() - state.review.checkedAt >= EXPECTED.maxAgeMs)) invalidateReview();
    syncUI(); tickTimer = win.setTimeout(tick, 1000);
  }
  try {
    journal = new CycleAttemptJournal(win.localStorage); readAttempts(); const probe = JOURNAL_PREFIX + 'storage-check';
    win.localStorage.setItem(probe, 'available'); ensure(win.localStorage.getItem(probe) === 'available', 'Browser storage is unavailable.'); win.localStorage.removeItem(probe);
  } catch (error) { state.storageError = messageOf(error); }
  el['use-account'].addEventListener('click', chooseAccount);
  el['account-select'].addEventListener('change', () => { invalidateSession(); el['wallet-status'].textContent = 'Select “Use selected account” to confirm your choice.'; syncUI(); });
  el.disconnect.addEventListener('click', disconnect);
  el['nft-select'].addEventListener('change', () => { invalidateReview(); syncUI(); });
  el['refresh-state'].addEventListener('click', () => refreshState({ restore: true }));
  el['check-action'].addEventListener('click', checkAction); el.acknowledge.addEventListener('change', syncUI);
  el['submit-action'].addEventListener('click', submitAction); el['verify-form'].addEventListener('submit', verifyFromForm); el['retry-action'].addEventListener('click', retryFailure);
  el['copy-receipt'].addEventListener('click', async () => {
    const receipts = ACTIONS.filter(action => state.receipts[action]).map(action => state.receipts[action]); if (!receipts.length) return;
    const lines = ['Arboretum Season 2 owner test · Sui mainnet', 'Registry: ' + EXPECTED.registryId, 'Owner: ' + EXPECTED.sender, ''];
    for (const receipt of receipts) { lines.push(LABELS[receipt.action], 'Transaction: ' + receipt.digest, 'Actual network fee: ' + suiAmount(receipt.gasEstimateMist));
      for (const key of ['seedId', 'archiveId', 'actualStartMs', 'plantedAtMs', 'waterReadyMs', 'cutoffMs', 'claimDeadlineMs', 'growthPoints', 'eligibleGrowthPoints', 'rewardMist', 'netReceiveMist'])
        if (receipt[key] != null) lines.push(key + ': ' + receipt[key]); lines.push(''); }
    try { await win.navigator.clipboard.writeText(lines.join('\n')); el['copy-receipt'].textContent = 'Receipts copied'; }
    catch { status('Copy the receipt', 'Select and copy the transaction details shown in the confirmed receipt.'); }
  });
  win.addEventListener('storage', onStorage);
  unsubscribers.push(dAppKit.stores.$wallets.subscribe(connectionChanged), dAppKit.stores.$connection.subscribe(connectionChanged), dAppKit.stores.$currentNetwork.subscribe(connectionChanged));
  if (state.storageError) status('Browser storage is required for wallet requests', 'Status remains available. Enable storage for www.treegrow.xyz and reload before opening a wallet request.', 'warning');
  const ready = refreshState({ quiet: true, restore: true }); scheduleRefresh(); tick();
  return { ready, refresh: refreshState, getState: () => ({ ...state, accountOptions: [...state.accountOptions], attempts: { ...state.attempts }, receipts: { ...state.receipts } }),
    destroy() { state.destroyed = true; invalidateSession(); for (const timer of [refreshTimer, tickTimer, expirationTimer]) win.clearTimeout(timer);
      unsubscribers.forEach(unsubscribe => unsubscribe()); win.removeEventListener('storage', onStorage); } };
}

export function bootCyclePage(win = window, doc = document) {
  try {
    assertExpectedOrigin(win.location.origin);
    const dAppKit = createDAppKit({ networks: ['mainnet'], defaultNetwork: 'mainnet', autoConnect: false, storage: null,
      slushWalletConfig: null, enableBurnerWallet: false,
      createClient: () => new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }) });
    return createCycleController({ window: win, document: doc, dAppKit });
  } catch (error) {
    const notice = doc.getElementById('origin-warning'); if (notice) { notice.hidden = false; notice.textContent = messageOf(error); }
    const wallets = doc.getElementById('wallet-list'); if (wallets) wallets.textContent = 'Open https://www.treegrow.xyz/admin/season-two/ for this owner test.';
    return null;
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') bootCyclePage();
