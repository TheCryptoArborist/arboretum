import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidTransactionDigest } from '@mysten/sui/utils';
import { uiWalletAccountsAreSame, uiWalletAccountBelongsToUiWallet } from '@wallet-standard/ui';
import { getWalletForHandle } from '@wallet-standard/ui-registry';
import {
  EXPECTED, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES,
  inspectWaterState, buildReviewedWater, validateSimulation, validateConfirmedWater,
  validateWalletTransaction, assertAdministrator, assertExpectedOrigin,
} from './water-core.mjs';

const ATTEMPT_KEY = 'arboretum:first-water:v1:season-1:attempt';
const REQUEST_LOCK = 'arboretum:first-water:v1:season-1:wallet';
const SIGN_FEATURES = ['sui:signAndExecuteTransaction', 'sui:signAndExecuteTransactionBlock'];
const REFRESH_MS = 30000;
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const messageOf = error => typeof error?.message === 'string' ? error.message.slice(0, 600) : 'The check could not be completed.';
function sameProvider(handle, provider) { try { return getWalletForHandle(handle) === provider; } catch { return false; } }
function sameAccount(a, b) { try { return Boolean(a && b && uiWalletAccountsAreSame(a, b)); } catch { return false; } }
const supportsSigning = account => account?.chains?.includes(EXPECTED.chain) && SIGN_FEATURES.some(feature => account.features.includes(feature));
export const isExplicitRejection = error => error?.code === 4001 ||
  (error?.name === 'WalletStandardError' && error?.context?.__code === 4001000);
export function formatTimestamp(value) {
  const time = Number(value);
  ensure(Number.isSafeInteger(time) && time > 0, 'The verified season time is invalid.');
  return new Date(time).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long' });
}
export function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
function suiAmount(mist) {
  const amount = BigInt(mist), sign = amount < 0n ? '-' : '', absolute = amount < 0n ? -amount : amount;
  const fraction = String(absolute % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return sign + String(absolute / 1000000000n) + (fraction ? '.' + fraction : '') + ' SUI';
}

// Public receipt metadata only. Unknown or inaccessible state never permits a
// second wallet handoff. Only an explicit rejection can clear its own request.
export class WaterAttemptJournal {
  constructor(storage) { this.storage = storage; }
  read() {
    const raw = this.storage.getItem(ATTEMPT_KEY);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      ensure(value?.sender === EXPECTED.sender && value.registryId === EXPECTED.registryId &&
        value.seedId === EXPECTED.seedId && value.plantDigest === EXPECTED.plantDigest &&
        typeof value.nonce === 'string' && value.nonce.length > 0 &&
        ['requesting', 'submitted', 'uncertain', 'failed', 'confirmed', 'observed-existing'].includes(value.phase), 'Unrecognized saved watering request.');
      ensure(value.digest == null || isValidTransactionDigest(value.digest), 'Invalid saved transaction digest.');
      ensure(value.kindSha256 == null || /^[0-9a-f]{64}$/.test(value.kindSha256), 'Invalid saved watering fingerprint.');
      ensure(value.phase === 'observed-existing' || value.kindSha256, 'Saved watering binding is missing.');
      return value;
    } catch { return { phase: 'unrecognized', nonce: 'unrecognized', digest: null }; }
  }
  write(value) {
    const record = { ...value, sender: EXPECTED.sender, registryId: EXPECTED.registryId,
      seedId: EXPECTED.seedId, plantDigest: EXPECTED.plantDigest };
    const raw = JSON.stringify(record);
    this.storage.setItem(ATTEMPT_KEY, raw);
    ensure(this.storage.getItem(ATTEMPT_KEY) === raw && this.read()?.phase !== 'unrecognized', 'The browser could not save the watering request.');
    return record;
  }
  clearRejected(nonce) {
    const current = this.read();
    ensure(current?.nonce === nonce && current.digest == null && current.phase === 'requesting', 'The saved wallet request changed. Verify its status before continuing.');
    this.storage.removeItem(ATTEMPT_KEY);
    ensure(this.read() === null, 'The saved request could not be cleared.');
  }
  clearVerifiedFailure(nonce, digest, kindSha256) {
    const current = this.read();
    ensure(current?.phase === 'failed' && current.nonce === nonce && current.digest === digest &&
      current.kindSha256 === kindSha256, 'The saved failed request changed. Verify it again before retrying.');
    this.storage.removeItem(ATTEMPT_KEY);
    ensure(this.read() === null, 'The failed request could not be cleared.');
  }
}

export function createWateringController({ window: win, document: doc, dAppKit, now = () => Date.now() }) {
  const ids = ['origin-warning', 'wallet-list', 'wallet-status', 'account-controls', 'account-select',
    'use-account', 'connected-address', 'disconnect', 'check-water', 'acknowledge', 'submit-water',
    'checks', 'checked-at', 'gas-estimate', 'gas-status', 'gas-note', 'expected-admin', 'expected-package',
    'expected-registry', 'expected-seed', 'expected-plant', 'expected-kind', 'countdown-label', 'countdown',
    'countdown-note', 'water-opens', 'season-cutoff', 'chain-status', 'chain-checked', 'current-gp',
    'current-streak', 'seed-state', 'refresh-state', 'status-panel', 'status-title', 'status-message',
    'receipt-panel', 'receipt-heading', 'receipt-message', 'receipt-digest', 'receipt-seed', 'receipt-growth',
    'receipt-streak', 'receipt-gas', 'receipt-watered', 'receipt-cutoff', 'receipt-link', 'copy-receipt',
    'recovery-panel', 'recovery-message', 'verify-form', 'transaction-digest', 'verify-receipt',
    'failure-panel', 'failure-message', 'retry-water'];
  const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
  ensure(Object.values(el).every(Boolean), 'The watering page is incomplete. Reload before continuing.');
  assertExpectedOrigin(win.location.origin);
  const state = { busy: null, provider: null, session: null, generation: 0, review: null, accountOptions: [],
    attempt: null, storageError: null, receipt: null, failure: null, chain: null, chainReadAt: null, readError: null,
    connected: false, destroyed: false };
  const unsubscribers = [];
  let journal, expirationTimer, refreshTimer, tickTimer;
  const checkOptions = () => ({ now: now(), nowMs: now() });
  for (const [id, value] of [['expected-admin', EXPECTED.sender], ['expected-package', EXPECTED.packageId],
    ['expected-registry', EXPECTED.registryId], ['expected-seed', EXPECTED.seedId], ['expected-plant', EXPECTED.plantDigest]]) el[id].textContent = value;
  el['water-opens'].textContent = formatTimestamp(EXPECTED.waterReadyMs);
  el['season-cutoff'].textContent = formatTimestamp(EXPECTED.cutoffMs);
  function status(title, message, tone = '') {
    el['status-panel'].hidden = false;
    el['status-panel'].className = 'notice status-panel ' + tone;
    el['status-title'].textContent = title; el['status-message'].textContent = message;
  }
  function invalidateReview() {
    state.review = null; el.acknowledge.checked = false; el.checks.hidden = true;
    el['gas-status'].textContent = 'Check when ready';
    el['gas-status'].className = 'pill'; el['gas-estimate'].textContent = 'Not estimated';
    win.clearTimeout(expirationTimer);
  }
  function invalidateSession(message) {
    state.generation += 1; state.session = null; invalidateReview();
    el['connected-address'].hidden = true;
    if (message) { el['wallet-status'].textContent = message; if (!state.attempt) status('Select the administrator again', message, 'warning'); }
  }
  function readAttempt() {
    if (state.storageError) return state.attempt;
    try { state.attempt = journal.read(); }
    catch (error) { state.storageError = messageOf(error); }
    return state.attempt;
  }
  function saveAttempt(value) {
    try { state.attempt = journal.write(value); }
    catch (error) { state.storageError = messageOf(error); state.attempt = { ...value }; throw error; }
    return state.attempt;
  }
  const eligibleWallets = () => dAppKit.stores.$wallets.get().filter(wallet => wallet.name === 'Slush');
  function currentPinnedWallet() {
    const wallets = eligibleWallets();
    ensure(wallets.length === 1, 'Keep one Slush browser extension available, then connect it explicitly.');
    ensure(state.provider && sameProvider(wallets[0], state.provider), 'The Slush provider changed. Disconnect and reconnect the intended extension.');
    return wallets[0];
  }
  function assertSession(generation = state.generation) {
    assertExpectedOrigin(win.location.origin);
    ensure(generation === state.generation && state.session, 'The selected account changed. Select the administrator and check watering again.');
    ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network, 'Select Sui mainnet before checking watering.');
    const wallet = currentPinnedWallet(), connection = dAppKit.stores.$connection.get();
    ensure(connection.isConnected && sameProvider(connection.wallet, state.provider) && sameAccount(connection.account, state.session.account), 'The connected account changed. Select the administrator again.');
    const account = wallet.accounts.find(candidate => sameAccount(candidate, state.session.account));
    ensure(account && uiWalletAccountBelongsToUiWallet(account, wallet) && supportsSigning(account), 'The selected account is no longer available for Sui mainnet. Reconnect Slush.');
    assertAdministrator(account.address, EXPECTED.chain);
    ensure(account.address === state.session.account.address, 'The administrator account changed.');
    return { wallet, account };
  }
  const hasSession = () => { try { assertSession(); return true; } catch { return false; } };
  function chainFresh() {
    if (!state.chain || state.readError || state.chainReadAt === null) return false;
    const time = Date.parse(state.chain.checkpoint.timestamp), age = now() - time;
    return Number.isFinite(time) && age >= -30000 && age <= EXPECTED.maxAgeMs && now() - state.chainReadAt <= EXPECTED.maxAgeMs;
  }
  function estimatedClock() { return Number(state.chain.clockMs) + Math.max(0, now() - state.chainReadAt); }
  function chainReady() { return chainFresh() && state.chain.status === 'ready' && estimatedClock() < Number(EXPECTED.cutoffMs); }
  function renderChain() {
    const chain = state.chain;
    if (chain) {
      el['current-gp'].textContent = chain.growthPoints;
      el['current-streak'].textContent = chain.wateringStreak;
      el['water-opens'].textContent = formatTimestamp(EXPECTED.waterReadyMs);
      el['chain-checked'].textContent = 'Last verified ' + new Date(state.chainReadAt).toLocaleTimeString('en-US') + ' · checkpoint ' + chain.checkpoint.sequenceNumber;
    } else { el['current-gp'].textContent = '—'; el['current-streak'].textContent = '—'; }
    if (!chainFresh()) {
      el['chain-status'].textContent = state.readError ? 'Read unavailable' : chain ? 'Refresh needed' : 'Checking mainnet';
      el['chain-status'].className = 'pill';
      el['countdown-label'].textContent = 'LIVE WATERING STATUS'; el.countdown.textContent = '—';
      el['countdown-note'].textContent = state.readError ? 'The latest state could not be verified. Refresh status to restore the countdown.' : chain ? 'This check is no longer current. Refresh status before watering.' : 'Reading your Seed and the Sui Clock. No wallet connection is needed.';
      el['seed-state'].textContent = chain ? 'Last verified state' : 'Reading Seed';
      return;
    }
    el['chain-status'].textContent = 'Mainnet verified'; el['chain-status'].className = 'pill ready';
    const current = estimatedClock(), cutoff = Number(EXPECTED.cutoffMs), opens = Number(EXPECTED.waterReadyMs);
    if (chain.status === 'watered') {
      el['countdown-label'].textContent = 'FIRST WATERING RECORDED'; el.countdown.textContent = 'Complete';
      el['countdown-note'].textContent = 'Your Seed has already been watered. Verify its transaction below to recover the receipt.';
      el['seed-state'].textContent = 'Watered';
    } else if (chain.status === 'closed' || current >= cutoff) {
      el['countdown-label'].textContent = 'SEASON 1 GROWING WINDOW'; el.countdown.textContent = 'Closed';
      el['countdown-note'].textContent = 'The first-watering window has ended. Existing receipts can still be verified.';
      el['seed-state'].textContent = 'Growing ended';
    } else if (current < opens) {
      el['countdown-label'].textContent = 'FIRST WATERING OPENS IN'; el.countdown.textContent = formatCountdown(opens - current);
      el['countdown-note'].textContent = 'Hours : minutes : seconds · Your Seed begins watered. Its next watering opens after 21 hours, 36 minutes.';
      el['seed-state'].textContent = 'Growing';
    } else if (chain.status !== 'ready') {
      el['countdown-label'].textContent = 'CHECKING THE WATERING WINDOW'; el.countdown.textContent = 'Almost ready';
      el['countdown-note'].textContent = 'The timer has reached the opening time. Refreshing mainnet eligibility before enabling watering.';
      el['seed-state'].textContent = 'Checking eligibility';
    } else {
      el['countdown-label'].textContent = 'WATERING WINDOW CLOSES IN'; el.countdown.textContent = formatCountdown(cutoff - current);
      el['countdown-note'].textContent = 'Your first watering is available. Connect Slush and review the current network fee before the season closes.';
      el['seed-state'].textContent = 'Ready to water';
    }
  }
  function syncUI() {
    const busy = Boolean(state.busy), selected = hasSession();
    const blocked = Boolean(state.attempt || state.storageError || state.receipt || state.chain?.status === 'watered');
    const ready = chainReady(), fresh = state.review && now() - state.review.checkedAt < EXPECTED.maxAgeMs && ready;
    el['check-water'].disabled = busy || blocked || !selected || !ready;
    el['check-water'].textContent = state.busy === 'checking' ? 'Checking watering…' : state.review ? 'Refresh watering check' : 'Check watering';
    el.acknowledge.disabled = busy || blocked || !selected || !fresh;
    el['submit-water'].disabled = busy || blocked || !selected || !fresh || !el.acknowledge.checked;
    el['submit-water'].textContent = state.busy === 'submitting' ? 'Checking and opening Slush…' : state.receipt ? 'Watering confirmed' : state.attempt ? 'Verification required' : 'Review watering in Slush ↗';
    el['account-select'].disabled = busy || !state.connected;
    el['use-account'].disabled = busy || !state.connected || el['account-select'].value === '';
    el.disconnect.disabled = busy || !state.connected;
    el['refresh-state'].disabled = busy; el['verify-receipt'].disabled = busy;
    el['retry-water'].disabled = busy || !ready || state.storageError || !state.failure ||
      state.attempt?.phase !== 'failed' || state.attempt?.nonce !== state.failure.nonce ||
      state.attempt?.digest !== state.failure.digest || state.attempt?.kindSha256 !== state.failure.kindSha256;
    el['refresh-state'].textContent = state.busy === 'refreshing' ? 'Refreshing…' : 'Refresh status';
    for (const button of el['wallet-list'].querySelectorAll('button')) button.disabled = busy || state.connected;
    renderChain();
  }
  function populateAccounts(wallet) {
    const previous = el['account-select'].value === '' ? null : state.accountOptions[Number(el['account-select'].value)];
    state.accountOptions = wallet?.accounts ? [...wallet.accounts] : [];
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select an account';
    el['account-select'].replaceChildren(placeholder);
    state.accountOptions.forEach((account, index) => {
      const option = doc.createElement('option'); option.value = String(index);
      option.textContent = account.address === EXPECTED.sender ? 'Administrator · ' + account.address : account.address;
      el['account-select'].append(option);
    });
    const previousIndex = previous ? state.accountOptions.findIndex(account => sameAccount(account, previous)) : -1;
    el['account-select'].value = previousIndex >= 0 ? String(previousIndex) : '';
  }
  function renderWallets() {
    const wallets = eligibleWallets(); el['wallet-list'].replaceChildren();
    if (wallets.length !== 1) {
      const note = doc.createElement('p'); note.className = 'small-text';
      note.textContent = wallets.length ? 'More than one Slush provider is available. Keep the intended extension enabled, then reload.' : 'Use a browser with the Slush extension installed and enabled when you are ready to water. The countdown works without a wallet.';
      el['wallet-list'].append(note); return;
    }
    const button = doc.createElement('button'); button.type = 'button'; button.id = 'connect-slush'; button.className = 'button secondary';
    button.textContent = state.connected ? 'Slush connected' : 'Connect Slush browser extension';
    button.addEventListener('click', () => connect(wallets[0])); el['wallet-list'].append(button);
  }
  function connectionChanged() {
    const connection = dAppKit.stores.$connection.get();
    state.connected = Boolean(connection.isConnected && state.provider && sameProvider(connection.wallet, state.provider));
    if (state.session) { try { assertSession(); } catch { invalidateSession('Slush’s account or connection changed. Explicitly select the administrator again.'); } }
    el['account-controls'].hidden = !state.connected;
    populateAccounts(state.connected ? connection.wallet : null); renderWallets(); syncUI();
  }
  async function connect(wallet) {
    if (state.busy || state.connected) return;
    state.busy = 'connecting'; invalidateSession();
    try {
      assertExpectedOrigin(win.location.origin);
      const current = eligibleWallets(), provider = getWalletForHandle(wallet);
      ensure(current.length === 1 && sameProvider(current[0], provider), 'The available Slush provider changed. Reload and connect again.');
      state.provider = provider; syncUI();
      el['wallet-status'].textContent = 'Approve the connection in the Slush browser extension.';
      await dAppKit.connectWallet({ wallet: current[0] });
      const connection = dAppKit.stores.$connection.get();
      ensure(connection.isConnected && sameProvider(connection.wallet, provider), 'Slush did not return the selected provider.');
      el['wallet-status'].textContent = 'Connected. Choose an account and select “Use selected account”.'; el['account-select'].value = '';
    } catch (error) { state.provider = null; status('Connection not completed', messageOf(error), 'warning'); }
    finally { state.busy = null; connectionChanged(); }
  }
  function chooseAccount() {
    if (state.busy) return; invalidateSession();
    try {
      const wallet = currentPinnedWallet(); ensure(el['account-select'].value !== '', 'Choose an account first.');
      const choice = state.accountOptions[Number(el['account-select'].value)];
      const account = wallet.accounts.find(candidate => sameAccount(candidate, choice));
      ensure(account && supportsSigning(account), 'That account is not available for Sui mainnet.');
      ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network, 'Select Sui mainnet in Slush.');
      assertAdministrator(account.address, EXPECTED.chain); dAppKit.switchAccount({ account });
      state.session = { account }; state.generation += 1; assertSession();
      el['connected-address'].textContent = account.address; el['connected-address'].hidden = false;
      el['wallet-status'].textContent = 'Administrator selected · Slush · Sui mainnet';
      if (!state.attempt) status('Administrator selected', chainReady() ? 'Check watering to review this Seed’s Growth Points and current network fee.' : 'Your account is ready. The watering check becomes available when mainnet confirms the opening time.');
    } catch (error) { state.session = null; status('Select the required administrator', messageOf(error) + ' Required account: ' + EXPECTED.sender, 'warning'); }
    syncUI();
  }
  async function disconnect() {
    if (state.busy) return; invalidateSession(); state.provider = null;
    try { await dAppKit.disconnectWallet(); } catch (error) { status('Connection could not be closed', messageOf(error), 'warning'); }
    el['wallet-status'].textContent = 'Connecting only shares your account address.'; connectionChanged();
  }
  async function graphql(query, variables = {}) {
    const abort = new AbortController(), timer = win.setTimeout(() => abort.abort(), 25000);
    try {
      const response = await win.fetch(EXPECTED.graphqlEndpoint || EXPECTED.endpoint, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
      ensure(response.ok, 'Mainnet read failed (HTTP ' + response.status + '). Refresh status to try again.');
      return await response.json();
    } finally { win.clearTimeout(timer); }
  }
  async function inspectChain(guard = () => {}) {
    const raw = await graphql(INPUTS_QUERY, INPUT_VARIABLES); guard();
    const chain = await inspectWaterState(raw, checkOptions()); guard(); return chain;
  }
  function acceptChain(chain) {
    state.chain = chain; state.chainReadAt = now(); state.readError = null;
    if (chain.status !== 'ready') invalidateReview();
    if (chain.status === 'watered') {
      if (!readAttempt() && !state.storageError) saveAttempt({ nonce: win.crypto.randomUUID(), phase: 'observed-existing', digest: null, at: now() });
      if (!state.receipt) {
        el['recovery-message'].textContent = 'Watering is already recorded for this Seed. Verify the watering digest to recover its receipt. A suggested digest must pass the full receipt check.';
        if (!el['transaction-digest'].value && chain.digestCandidate) el['transaction-digest'].value = chain.digestCandidate;
      }
    }
  }
  async function refreshState({ quiet = false } = {}) {
    if (state.busy || state.destroyed) return;
    state.busy = 'refreshing'; syncUI();
    try {
      acceptChain(await inspectChain());
      if (!quiet && !state.receipt && !state.attempt) status('Seed status refreshed', state.chain.status === 'waiting' ? 'Your Seed is growing. The first watering opens ' + formatTimestamp(EXPECTED.waterReadyMs) + '.' : state.chain.status === 'ready' ? 'The watering window is open. Connect Slush and check watering to review the current fee.' : 'The growing period has ended. Existing watering receipts can still be verified.');
    } catch (error) {
      state.readError = messageOf(error); invalidateReview();
      if (!quiet) status('Seed status could not be verified', messageOf(error), 'warning');
    } finally { state.busy = null; syncUI(); }
  }
  async function freshReview(generation) {
    const guard = () => assertSession(generation); guard();
    const chain = await inspectChain(guard); acceptChain(chain);
    if (chain.status !== 'ready') return { chain };
    const loaded = await buildReviewedWater(chain); guard();
    const raw = await graphql(SIMULATION_QUERY, { ...INPUT_VARIABLES, transaction: loaded.simulationTransaction }); guard();
    const simulation = await validateSimulation(raw, loaded, chain, checkOptions()); guard();
    return { chain, loaded, simulation, generation, checkedAt: now() };
  }
  function displayReview(review) {
    state.review = review; el.acknowledge.checked = false; el.checks.hidden = false;
    el['gas-estimate'].textContent = suiAmount(review.simulation.gasEstimateMist);
    el['gas-status'].textContent = 'Fresh simulation'; el['gas-status'].className = 'pill ready';
    el['gas-note'].textContent = 'Estimated network gas only. Watering makes no purchase or reward-pool payment. Slush sets the final gas budget.';
    el['expected-kind'].textContent = review.loaded.kindSha256;
    el['checked-at'].textContent = 'Checked ' + new Date(review.checkedAt).toLocaleTimeString('en-US') + ' · review expires after two minutes.';
    win.clearTimeout(expirationTimer);
    expirationTimer = win.setTimeout(() => { if (state.review === review) { invalidateReview(); syncUI(); } }, EXPECTED.maxAgeMs);
  }
  function explainNotReady(chain) {
    status(chain.status === 'watered' ? 'This Seed has already been watered' : chain.status === 'closed' ? 'The watering window is closed' : 'Your Seed is growing',
      chain.status === 'watered' ? 'Verify its watering transaction below. Another first-watering request is disabled.' : chain.status === 'closed' ? 'Watering cannot execute after the Season 1 cutoff. You can still recover an existing receipt.' : 'The first watering opens ' + formatTimestamp(EXPECTED.waterReadyMs) + '. The countdown updates automatically.');
  }
  async function checkWater() {
    if (state.busy || readAttempt() || state.storageError || state.receipt || !chainReady() || !hasSession()) return;
    state.busy = 'checking'; invalidateReview(); const generation = state.generation; syncUI();
    status('Checking watering', 'Verifying your exact Seed, the current watering window, its Growth Points and a simulation of one watering.');
    try {
      const review = await freshReview(generation);
      if (review.chain.status !== 'ready') explainNotReady(review.chain);
      else { ensure(!readAttempt() && !state.storageError, 'A wallet request needs verification.'); displayReview(review);
        status('Ready for your review', 'One watering is expected to add 14 Growth Points, taking this Seed from 10 to 24. Review the network fee and acknowledge before opening Slush.'); }
    } catch (error) { invalidateReview(); status('Watering check stopped', messageOf(error), 'warning'); }
    finally { state.busy = null; syncUI(); }
  }
  function receiptConfirmed(receipt) {
    state.receipt = receipt; state.failure = null; el['failure-panel'].hidden = true; invalidateReview();
    try { saveAttempt({ ...state.attempt, nonce: state.attempt?.nonce || win.crypto.randomUUID(), phase: 'confirmed', digest: receipt.digest,
      kindSha256: receipt.kindSha256 || receipt.exactKindSha256, at: now() }); } catch { /* Keep the verified receipt visible. */ }
    el['receipt-panel'].hidden = false; el['receipt-heading'].textContent = 'Your first watering is confirmed.';
    el['receipt-message'].textContent = 'The successful transaction raised this Seed from ' + receipt.previousGrowthPoints + ' to ' + receipt.growthPoints + ' Growth Points. Only network gas was charged.' + (receipt.hasAdvanced ? ' Later activity is separate from this receipt.' : '');
    el['receipt-digest'].textContent = receipt.digest; el['receipt-seed'].textContent = receipt.seedId;
    el['receipt-growth'].textContent = receipt.previousGrowthPoints + ' → ' + receipt.growthPoints + ' GP';
    el['receipt-streak'].textContent = receipt.wateringStreak;
    el['receipt-gas'].textContent = suiAmount(receipt.gasEstimateMist);
    el['receipt-watered'].textContent = formatTimestamp(receipt.wateredAtMs);
    el['receipt-cutoff'].textContent = formatTimestamp(receipt.cutoffMs);
    el['receipt-link'].href = 'https://suiscan.xyz/mainnet/tx/' + encodeURIComponent(receipt.digest);
    status('Watering confirmed on mainnet', 'The actual transaction, Seed update and network fee have been verified. Your first-watering test is complete.', 'success');
    syncUI();
  }
  function acceptReceiptObservation(raw) {
    // A receipt and the current state are different observations. Read the
    // already-fetched live fields rather than showing historical GP as current.
    const { transaction: _transaction, simulateTransaction: _simulation, ...live } = raw.response?.data ?? raw.data;
    try { acceptChain(inspectWaterState({ data: live }, checkOptions())); }
    catch (error) { state.chain = null; state.chainReadAt = null; state.readError = messageOf(error); }
  }
  function confirmedFailure(error, raw) {
    const failure = error?.confirmedFailure, saved = readAttempt();
    if (!failure || !saved?.digest || !saved.kindSha256 || failure.digest !== saved.digest ||
      failure.kindSha256 !== saved.kindSha256 || failure.seedId !== EXPECTED.seedId) return false;
    // Only validated on-chain failure metadata can expose retry. A generic
    // wallet error, an arbitrary candidate digest or unrecognized journal cannot.
    saveAttempt({ ...saved, phase: 'failed' });
    state.failure = { ...failure, nonce: saved.nonce };
    acceptReceiptObservation(raw); invalidateReview();
    el['failure-panel'].hidden = false;
    el['failure-message'].textContent = 'This exact transaction failed without watering your Seed. The confirmed net network gas was ' +
      suiAmount(failure.gasEstimateMist) + '. ' + (failure.permitsRetry ?
      'You can explicitly retry after another check of this failed transaction and the unchanged Seed. A new simulation and approval are required.' :
      'A retry is available only while mainnet confirms that the original Seed is eligible and the watering window is open.');
    el['transaction-digest'].value = failure.digest;
    status('Failed watering verified', 'The transaction failed and the Seed remains unwatered. Review the recovery option below; no new transaction has been submitted.', 'warning');
    syncUI(); return true;
  }
  async function verifyDigest(digest, waitForInclusion = false) {
    ensure(isValidTransactionDigest(digest), 'Paste a complete Sui transaction digest from Slush.');
    if (waitForInclusion) {
      try { await dAppKit.getClient(EXPECTED.network).waitForTransaction({ digest, timeout: 15000, pollSchedule: [0, 500, 1500, 3000] }); }
      catch { /* An indexing timeout never enables another request. */ }
    }
    let pending;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await new Promise(resolve => win.setTimeout(resolve, attempt * 1200));
      try {
        const raw = await graphql(CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest });
        let receipt;
        try { receipt = await validateConfirmedWater(raw, digest, checkOptions()); }
        catch (error) { if (confirmedFailure(error, raw)) return error.confirmedFailure; throw error; }
        const saved = readAttempt();
        if (saved?.digest) ensure(saved.digest === receipt.digest, 'Use the digest already returned by Slush for this request.');
        if (saved?.kindSha256) ensure(saved.kindSha256 === (receipt.kindSha256 || receipt.exactKindSha256), 'The receipt differs from the watering reviewed for this request.');
        acceptReceiptObservation(raw); receiptConfirmed(receipt); return receipt;
      } catch (error) { pending = error; if (error?.code !== 'CONFIRMATION_PENDING') throw error; }
    }
    throw pending;
  }
  function uncertain(error, nonce = null) {
    invalidateReview(); const current = readAttempt();
    if (!state.storageError && nonce && current?.nonce === nonce && current.phase !== 'confirmed') {
      try { saveAttempt({ ...current, phase: error?.code === 'TRANSACTION_FAILED' ? 'failed' : 'uncertain' }); } catch { /* Keep memory lock. */ }
    }
    const failed = error?.code === 'TRANSACTION_FAILED';
    status(failed ? 'The transaction did not succeed' : 'Watering receipt needs verification', messageOf(error) +
      (state.attempt ? ' Another watering request is disabled. Verify the original digest from Slush activity before continuing.' : ' No new wallet request was opened by this check.'), 'warning');
    if (state.attempt?.digest) el['transaction-digest'].value = state.attempt.digest;
    syncUI();
  }
  function assertFreshReview(review) {
    const timestamp = Date.parse(review.chain.checkpoint.timestamp);
    ensure(Number.isFinite(timestamp) && timestamp <= now() + 30000 && now() - timestamp <= EXPECTED.maxAgeMs &&
      now() - review.checkedAt <= EXPECTED.maxAgeMs && chainReady(), 'The chain check expired or the watering window closed. Refresh the review.');
  }
  async function submitWater() {
    if (state.busy || state.receipt || readAttempt() || state.storageError || !chainReady()) return;
    const acknowledged = state.review, generation = state.generation;
    let handedOff = false, nonce;
    try {
      assertSession(generation);
      ensure(acknowledged && el.acknowledge.checked && now() - acknowledged.checkedAt < EXPECTED.maxAgeMs, 'Check watering and acknowledge the current review first.');
      ensure(win.navigator.locks?.request, 'This browser cannot protect against duplicate requests. Use a current browser with Slush.');
      state.busy = 'submitting'; syncUI();
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling watering. Finish its request and verify the result here.');
        ensure(!readAttempt() && !state.storageError, 'An earlier wallet request needs verification.');
        status('Checking once more before Slush', 'Refreshing the Seed, watering window and network fee before opening the wallet review.');
        const fresh = await freshReview(generation);
        if (fresh.chain.status !== 'ready') { explainNotReady(fresh.chain); return; }
        ensure(fresh.loaded.kindSha256 === acknowledged.loaded.kindSha256, 'The exact Seed input changed. Review watering again.');
        if (fresh.simulation.gasEstimateMist !== acknowledged.simulation.gasEstimateMist || fresh.simulation.growthPoints !== acknowledged.simulation.growthPoints) {
          displayReview(fresh); status('The watering review changed', 'Review the refreshed network fee and Growth Points, acknowledge them, then select “Review watering in Slush” again.', 'warning'); return;
        }
        await validateWalletTransaction(fresh.loaded.transaction, fresh.loaded); assertFreshReview(fresh);
        const { account } = assertSession(generation);
        ensure(el.acknowledge.checked && state.review === acknowledged, 'The acknowledgement or account changed. Review watering again.');
        ensure(!readAttempt() && !state.storageError, 'Another wallet request needs verification.');
        nonce = win.crypto.randomUUID();
        saveAttempt({ nonce, phase: 'requesting', digest: null, kindSha256: fresh.loaded.kindSha256, at: now() });
        assertSession(generation); handedOff = true;
        status('Review watering in Slush', 'Approve one watering of your test Seed. The only charge is network gas. This page verifies the actual Growth Points after your decision.');
        let result;
        try { result = await dAppKit.signAndExecuteTransaction({ transaction: fresh.loaded.transaction, account, network: EXPECTED.network }); }
        catch (error) {
          if (!isExplicitRejection(error)) throw error;
          try { journal.clearRejected(nonce); state.attempt = null; invalidateReview(); status('Watering cancelled in Slush', 'Slush reported that you rejected this request. Run a fresh watering check to continue.'); }
          catch (journalError) { uncertain(journalError, nonce); }
          return;
        }
        const digest = result?.Transaction?.digest || result?.FailedTransaction?.digest;
        ensure(isValidTransactionDigest(digest || ''), 'Slush did not return a verifiable transaction digest.');
        saveAttempt({ ...state.attempt, phase: 'submitted', digest });
        status('Verifying the watering receipt', 'Slush returned a digest. Checking successful execution, the actual Seed update and network fee.');
        await verifyDigest(digest, true);
      });
    } catch (error) {
      if (handedOff || state.attempt) uncertain(error, nonce);
      else { invalidateReview(); status('Wallet review did not open', messageOf(error), 'warning'); }
    } finally { state.busy = null; syncUI(); }
  }
  async function verifyFromForm(event) {
    event.preventDefault(); if (state.busy) return; state.busy = 'verifying'; syncUI();
    try {
      const digest = el['transaction-digest'].value.trim();
      ensure(!state.attempt?.digest || digest === state.attempt.digest, 'Use the digest already returned by Slush for this request.');
      status('Checking the watering receipt', 'Reading the exact transaction, Seed effects and network fee from mainnet.');
      await verifyDigest(digest, true);
    } catch (error) { uncertain(error); }
    finally { state.busy = null; syncUI(); }
  }
  async function retryConfirmedFailure() {
    if (state.busy || state.receipt || state.storageError || !state.failure || !chainReady()) return;
    const failure = state.failure;
    state.busy = 'retrying'; syncUI();
    try {
      ensure(win.navigator.locks?.request, 'This browser cannot protect failure recovery across tabs. Use a current browser with Slush.');
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling this watering request. Its recorded failure remains locked; finish that tab’s operation before retrying.');
        const saved = readAttempt();
        ensure(saved?.phase === 'failed' && saved.nonce === failure.nonce && saved.digest === failure.digest &&
          saved.kindSha256 === failure.kindSha256, 'The saved request changed. Verify the failed receipt again.');
        const raw = await graphql(CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest: failure.digest });
        let verified;
        try { await validateConfirmedWater(raw, failure.digest, checkOptions()); }
        catch (error) { verified = error.confirmedFailure; if (!verified) throw error; }
        ensure(verified?.status === 'failed' && verified.permitsRetry === true &&
          verified.currentStatus === 'ready' && verified.digest === failure.digest &&
          verified.kindSha256 === failure.kindSha256 && verified.seedId === EXPECTED.seedId,
        'The original failure and current unwatered Seed no longer permit a retry. Refresh the status and verify the receipt.');
        acceptReceiptObservation(raw); ensure(chainReady(), 'The watering window is no longer open.');
        journal.clearVerifiedFailure(failure.nonce, failure.digest, failure.kindSha256);
        state.attempt = null; state.failure = null; el['failure-panel'].hidden = true; invalidateReview();
        status('Ready for a new watering review', 'The original failed transaction and unchanged Seed are verified. Check watering again, review the new gas estimate and acknowledge before opening Slush.');
      });
    } catch (error) { status('Retry could not be enabled', messageOf(error), 'warning'); }
    finally { state.busy = null; syncUI(); }
  }
  function onStorage(event) {
    if (event.key !== ATTEMPT_KEY && event.key !== null) return;
    readAttempt();
    if (state.attempt) { invalidateReview(); if (!state.receipt && !state.busy) status('A wallet request is recorded', 'A watering request from this browser needs verification before continuing.', 'warning'); }
    syncUI();
  }
  function scheduleRefresh() {
    refreshTimer = win.setTimeout(async () => { if (state.destroyed) return; if (!doc.hidden) await refreshState({ quiet: true }); if (!state.destroyed) scheduleRefresh(); }, REFRESH_MS);
  }
  function tick() {
    if (state.destroyed) return;
    if (state.review && (!chainFresh() || !chainReady() || now() - state.review.checkedAt >= EXPECTED.maxAgeMs)) invalidateReview();
    syncUI(); tickTimer = win.setTimeout(tick, 1000);
  }
  try {
    journal = new WaterAttemptJournal(win.localStorage); readAttempt();
    const probe = ATTEMPT_KEY + ':storage-check'; win.localStorage.setItem(probe, 'available');
    ensure(win.localStorage.getItem(probe) === 'available', 'The browser could not save a request marker.'); win.localStorage.removeItem(probe);
  } catch (error) { state.storageError = messageOf(error); }
  el['use-account'].addEventListener('click', chooseAccount);
  el['account-select'].addEventListener('change', () => { invalidateSession(); el['wallet-status'].textContent = 'Select “Use selected account” to confirm your choice.'; syncUI(); });
  el.disconnect.addEventListener('click', disconnect);
  el['refresh-state'].addEventListener('click', () => refreshState());
  el['check-water'].addEventListener('click', checkWater); el.acknowledge.addEventListener('change', syncUI);
  el['submit-water'].addEventListener('click', submitWater); el['verify-form'].addEventListener('submit', verifyFromForm);
  el['retry-water'].addEventListener('click', retryConfirmedFailure);
  el['copy-receipt'].addEventListener('click', async () => {
    if (!state.receipt) return;
    const receipt = state.receipt;
    try { await win.navigator.clipboard.writeText(['Arboretum first watering · Sui mainnet', 'Transaction: ' + receipt.digest,
      'Seed: ' + receipt.seedId, 'Registry: ' + receipt.registryId, 'Package: ' + receipt.packageId,
      'Growth Points: ' + receipt.previousGrowthPoints + ' → ' + receipt.growthPoints, 'Watering streak: ' + receipt.wateringStreak,
      'Payment: network gas only', 'Network fee: ' + suiAmount(receipt.gasEstimateMist),
      'Watered at: ' + new Date(Number(receipt.wateredAtMs)).toISOString(),
      'Growing cutoff: ' + new Date(Number(receipt.cutoffMs)).toISOString()].join('\n')); el['copy-receipt'].textContent = 'Receipt copied'; }
    catch { status('Copy the receipt', 'Select and copy the transaction digest and Seed details shown in the receipt.'); }
  });
  win.addEventListener('storage', onStorage);
  unsubscribers.push(dAppKit.stores.$wallets.subscribe(connectionChanged), dAppKit.stores.$connection.subscribe(connectionChanged), dAppKit.stores.$currentNetwork.subscribe(connectionChanged));
  if (state.storageError) status('Browser storage is required for watering', 'Status remains available. Enable storage for www.treegrow.xyz and reload before opening a wallet request.', 'warning');
  else if (state.attempt) { status('A previous watering request needs verification', 'Verify its actual receipt before continuing. Reloading does not submit another transaction.', 'warning'); if (state.attempt.digest) el['transaction-digest'].value = state.attempt.digest; }
  const ready = refreshState({ quiet: true }); scheduleRefresh(); tick();
  return { ready, refresh: refreshState, getState: () => ({ ...state, accountOptions: [...state.accountOptions] }),
    destroy() { state.destroyed = true; invalidateSession(); for (const timer of [expirationTimer, refreshTimer, tickTimer]) win.clearTimeout(timer);
      unsubscribers.forEach(unsubscribe => unsubscribe()); win.removeEventListener('storage', onStorage); } };
}

export function bootWateringPage(win = window, doc = document) {
  try {
    assertExpectedOrigin(win.location.origin);
    const dAppKit = createDAppKit({ networks: ['mainnet'], defaultNetwork: 'mainnet', autoConnect: false,
      storage: null, slushWalletConfig: null, enableBurnerWallet: false,
      createClient: () => new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }) });
    return createWateringController({ window: win, document: doc, dAppKit });
  } catch (error) {
    const notice = doc.getElementById('origin-warning'); if (notice) { notice.hidden = false; notice.textContent = messageOf(error); }
    const wallets = doc.getElementById('wallet-list'); if (wallets) wallets.textContent = 'Open https://www.treegrow.xyz/admin/watering-test/ to review watering.';
    return null;
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') bootWateringPage();
