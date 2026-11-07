import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { uiWalletAccountsAreSame, uiWalletAccountBelongsToUiWallet } from '@wallet-standard/ui';
import { getWalletForHandle } from '@wallet-standard/ui-registry';
import {
  EXPECTED, TIP_QUERY, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY,
  CONFIRM_QUERY, CONFIRM_VARIABLES, loadReviewedUpgrade, validatePreflight,
  validateSimulation, validateConfirmedUpgrade, validateWalletTransaction,
  assertAdministrator, assertExpectedOrigin,
} from './upgrade-core.mjs';

const PACKET_PATH = '/admin/settlement-upgrade/upgrade-kind.b64';
const ATTEMPT_KEY = 'arboretum:settlement-upgrade:v12:attempt';
const REQUEST_LOCK = 'arboretum:settlement-upgrade:v12:wallet';
const DIGEST_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const SIGN_FEATURES = ['sui:signAndExecuteTransaction', 'sui:signAndExecuteTransactionBlock'];

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message.slice(0, 600) : 'The check could not be completed.';
}
function sameProvider(handle, provider) {
  try { return getWalletForHandle(handle) === provider; } catch { return false; }
}
function sameAccount(first, second) {
  try { return Boolean(first && second && uiWalletAccountsAreSame(first, second)); } catch { return false; }
}
function supportsSigning(account) {
  return account?.chains?.includes(EXPECTED.chain) && SIGN_FEATURES.some(feature => account.features.includes(feature));
}
export function isExplicitRejection(error) {
  // Unrecognized wallet/network errors remain uncertain. They must never clear
  // a potentially submitted transaction merely because their text says "cancel".
  return error?.code === 4001 ||
    (error?.name === 'WalletStandardError' && error?.context?.__code === 4001000);
}

// The journal contains public receipt metadata only. A malformed/inaccessible
// journal fails closed, as losing it could otherwise invite a second submission.
export class UpgradeAttemptJournal {
  constructor(storage) { this.storage = storage; }
  read() {
    const raw = this.storage.getItem(ATTEMPT_KEY);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      ensure(value && value.kindSha256 === EXPECTED.kindSha256 && value.sender === EXPECTED.sender &&
        typeof value.nonce === 'string' && typeof value.phase === 'string', 'Unrecognized saved wallet request.');
      ensure(value.digest == null || DIGEST_PATTERN.test(value.digest), 'Invalid saved transaction digest.');
      return value;
    } catch {
      return { phase: 'unrecognized', nonce: 'unrecognized', digest: null };
    }
  }
  write(value) {
    const record = { ...value, sender: EXPECTED.sender, kindSha256: EXPECTED.kindSha256 };
    const encoded = JSON.stringify(record);
    this.storage.setItem(ATTEMPT_KEY, encoded);
    ensure(this.storage.getItem(ATTEMPT_KEY) === encoded, 'The browser could not save the wallet request.');
    return record;
  }
  clearRejected(nonce) {
    const current = this.read();
    ensure(current?.nonce === nonce && current.digest == null && current.phase === 'requesting',
      'The saved wallet request changed. Verify its status before continuing.');
    this.storage.removeItem(ATTEMPT_KEY);
    ensure(this.read() === null, 'The saved wallet request could not be cleared.');
  }
}

export function createUpgradeController({ window: win, document: doc, dAppKit }) {
  const el = Object.fromEntries([
    'origin-warning', 'wallet-list', 'wallet-status', 'account-controls', 'account-select',
    'use-account', 'connected-address', 'disconnect', 'check-release', 'checks', 'checked-at',
    'acknowledge', 'submit-upgrade', 'gas-estimate', 'gas-status', 'gas-note', 'expected-admin',
    'expected-package', 'expected-kind', 'status-panel', 'status-title', 'status-message',
    'receipt-panel', 'receipt-digest', 'receipt-package', 'receipt-link', 'copy-receipt',
    'recovery-panel', 'recovery-message', 'verify-form', 'transaction-digest', 'verify-receipt',
    'check-existing',
  ].map(id => [id, doc.getElementById(id)]));
  ensure(Object.values(el).every(Boolean), 'The administrator page is incomplete. Reload before continuing.');
  assertExpectedOrigin(win.location.origin);

  let journal;
  const state = {
    busy: null, provider: null, session: null, generation: 0, review: null,
    accountOptions: [], attempt: null, storageError: null, receipt: null,
    connected: false, destroyed: false,
  };
  const unsubscribers = [];
  let expirationTimer;
  el['expected-admin'].textContent = EXPECTED.sender;
  el['expected-package'].textContent = EXPECTED.packageId;
  el['expected-kind'].textContent = EXPECTED.kindSha256;

  function status(title, message, tone = '') {
    el['status-panel'].hidden = false;
    el['status-panel'].className = `notice status-panel ${tone}`;
    el['status-title'].textContent = title;
    el['status-message'].textContent = message;
  }
  function invalidateReview() {
    state.review = null;
    el.acknowledge.checked = false;
    el.checks.hidden = true;
    el['gas-status'].textContent = 'Refresh required';
    el['gas-status'].className = 'pill';
    win.clearTimeout(expirationTimer);
  }
  function invalidateSession(message) {
    state.generation += 1;
    state.session = null;
    invalidateReview();
    el['connected-address'].hidden = true;
    if (message) {
      el['wallet-status'].textContent = message;
      if (!state.attempt) status('Select the administrator again', message, 'warning');
    }
  }
  function readAttempt() {
    if (state.storageError) return state.attempt;
    try {
      state.attempt = journal.read();
      return state.attempt;
    } catch (error) {
      state.storageError = errorMessage(error);
      return state.attempt;
    }
  }
  function saveAttempt(value) {
    try { state.attempt = journal.write(value); }
    catch (error) {
      state.storageError = errorMessage(error);
      // Retain the in-memory lock even if storage stops working after handoff.
      state.attempt = { ...value, sender: EXPECTED.sender, kindSha256: EXPECTED.kindSha256 };
      throw error;
    }
    return state.attempt;
  }
  function eligibleWallets() {
    return dAppKit.stores.$wallets.get().filter(wallet => wallet.name === 'Slush');
  }
  function currentPinnedWallet() {
    const candidates = eligibleWallets();
    ensure(candidates.length === 1, 'Keep one Slush browser extension available, then connect it explicitly.');
    const wallet = candidates[0];
    ensure(state.provider && sameProvider(wallet, state.provider),
      'The Slush provider changed. Disconnect and reconnect the intended browser extension.');
    return wallet;
  }
  function assertSession(expectedGeneration = state.generation) {
    assertExpectedOrigin(win.location.origin);
    ensure(expectedGeneration === state.generation && state.session,
      'The selected account changed. Select the administrator and check the release again.');
    ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network,
      'Select Sui mainnet before checking the upgrade.');
    const wallet = currentPinnedWallet();
    const connection = dAppKit.stores.$connection.get();
    ensure(connection.isConnected && sameProvider(connection.wallet, state.provider) &&
      sameAccount(connection.account, state.session.account),
    'The connected account changed. Select the administrator and check the release again.');
    const account = wallet.accounts.find(candidate => sameAccount(candidate, state.session.account));
    ensure(account && uiWalletAccountBelongsToUiWallet(account, wallet) && supportsSigning(account),
      'The selected account is no longer available for Sui mainnet. Reconnect Slush.');
    assertAdministrator(account.address, EXPECTED.chain);
    ensure(account.address === state.session.account.address, 'The administrator account changed.');
    return { wallet, account };
  }
  function canUseSession() {
    try { assertSession(); return true; } catch { return false; }
  }
  function showRecovery(message) {
    el['recovery-panel'].hidden = false;
    el['recovery-message'].textContent = message ||
      'A wallet request needs verification before this page can continue. Copy its transaction digest from Slush activity, or check the current upgrade capability. These checks do not submit a transaction.';
    if (state.attempt?.digest) el['transaction-digest'].value = state.attempt.digest;
  }
  function syncUI() {
    const busy = Boolean(state.busy);
    const blocked = Boolean(state.attempt || state.storageError || state.receipt);
    const selected = canUseSession();
    const fresh = state.review && Date.now() - state.review.checkedAt < EXPECTED.maxAgeMs;
    el['check-release'].disabled = busy || blocked || !selected;
    el['check-release'].textContent = state.busy === 'checking' ? 'Checking mainnet…' :
      state.review ? 'Refresh upgrade check' : 'Check upgrade readiness';
    el.acknowledge.disabled = busy || blocked || !selected || !fresh;
    el['submit-upgrade'].disabled = busy || blocked || !selected || !fresh || !el.acknowledge.checked;
    el['submit-upgrade'].textContent = state.busy === 'submitting' ? 'Checking and opening Slush…' :
      state.receipt ? 'Upgrade confirmed' : state.attempt ? 'Verification required' : 'Review upgrade in Slush ↗';
    el['account-select'].disabled = busy || !state.connected;
    el['use-account'].disabled = busy || !state.connected || el['account-select'].value === '';
    el.disconnect.disabled = busy || !state.connected;
    el['verify-receipt'].disabled = busy;
    el['check-existing'].disabled = busy;
    for (const button of el['wallet-list'].querySelectorAll('button')) button.disabled = busy || state.connected;
  }
  function populateAccounts(wallet) {
    const previous = el['account-select'].value === '' ? null : state.accountOptions[Number(el['account-select'].value)];
    state.accountOptions = wallet?.accounts ? [...wallet.accounts] : [];
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select an account';
    el['account-select'].replaceChildren(placeholder);
    state.accountOptions.forEach((account, index) => {
      const option = doc.createElement('option');
      option.value = String(index);
      option.textContent = account.address === EXPECTED.sender ? `Administrator · ${account.address}` : account.address;
      el['account-select'].append(option);
    });
    const previousIndex = previous ? state.accountOptions.findIndex(account => sameAccount(account, previous)) : -1;
    el['account-select'].value = previousIndex >= 0 ? String(previousIndex) : '';
  }
  function renderWallets() {
    const wallets = eligibleWallets();
    el['wallet-list'].replaceChildren();
    if (wallets.length !== 1) {
      const note = doc.createElement('p');
      note.className = 'small-text';
      note.textContent = wallets.length ?
        'More than one Slush provider is available. Keep the intended Slush extension enabled, then reload.' :
        'Open this page in a browser with the Slush extension installed and enabled. Unlock Slush if needed, then reload.';
      el['wallet-list'].append(note);
      return;
    }
    const wallet = wallets[0];
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = 'connect-slush';
    button.className = 'button secondary';
    button.textContent = state.connected ? 'Slush connected' : 'Connect Slush browser extension';
    button.addEventListener('click', () => connect(wallet));
    el['wallet-list'].append(button);
  }
  function connectionChanged() {
    const connection = dAppKit.stores.$connection.get();
    state.connected = Boolean(connection.isConnected && state.provider && sameProvider(connection.wallet, state.provider));
    if (state.session) {
      try { assertSession(); }
      catch {
        invalidateSession(`Slush’s account or connection changed. Explicitly select ${EXPECTED.sender} to continue.`);
      }
    }
    el['account-controls'].hidden = !state.connected;
    populateAccounts(state.connected ? connection.wallet : null);
    renderWallets();
    syncUI();
  }
  async function connect(wallet) {
    if (state.busy || state.connected) return;
    state.busy = 'connecting';
    invalidateSession();
    try {
      assertExpectedOrigin(win.location.origin);
      const current = eligibleWallets();
      const provider = getWalletForHandle(wallet);
      ensure(current.length === 1 && sameProvider(current[0], provider), 'The available Slush provider changed. Reload and connect again.');
      state.provider = provider;
      syncUI();
      el['wallet-status'].textContent = 'Approve the connection in the Slush browser extension.';
      await dAppKit.connectWallet({ wallet: current[0] });
      const connection = dAppKit.stores.$connection.get();
      ensure(connection.isConnected && sameProvider(connection.wallet, provider), 'Slush did not return the selected provider.');
      el['wallet-status'].textContent = 'Connected. Choose an account below and select “Use selected account”.';
      // dAppKit may select its first account internally. It is deliberately not
      // accepted as the signing account until the user makes an explicit choice.
      el['account-select'].value = '';
    } catch (error) {
      state.provider = null;
      status('Connection not completed', errorMessage(error), 'warning');
      el['wallet-status'].textContent = 'Connect Slush when you are ready.';
    } finally {
      state.busy = null;
      connectionChanged();
    }
  }
  function chooseAccount() {
    if (state.busy) return;
    invalidateSession();
    try {
      const wallet = currentPinnedWallet();
      ensure(el['account-select'].value !== '', 'Choose an account first.');
      const choice = state.accountOptions[Number(el['account-select'].value)];
      const account = wallet.accounts.find(candidate => sameAccount(candidate, choice));
      ensure(account && supportsSigning(account), 'That account is not available for Sui mainnet.');
      ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network, 'Select Sui mainnet in Slush.');
      assertAdministrator(account.address, EXPECTED.chain);
      dAppKit.switchAccount({ account });
      state.session = { account };
      state.generation += 1;
      assertSession();
      el['connected-address'].textContent = account.address;
      el['connected-address'].hidden = false;
      el['wallet-status'].textContent = 'Administrator selected · Slush browser extension · Sui mainnet';
      if (!state.attempt && !state.storageError) status('Administrator selected', 'Check the release to verify the live package and current network fee.');
    } catch (error) {
      state.session = null;
      status('Select the required administrator', `${errorMessage(error)} Required administrator: ${EXPECTED.sender}`, 'warning');
      el['wallet-status'].textContent = `Choose ${EXPECTED.sender} in the list. If it is missing, allow that account in Slush and reconnect.`;
    }
    syncUI();
  }
  async function disconnect() {
    if (state.busy) return;
    invalidateSession();
    state.provider = null;
    try { await dAppKit.disconnectWallet(); }
    catch (error) { status('Connection could not be closed', errorMessage(error), 'warning'); }
    el['wallet-status'].textContent = 'Connecting only shares your account address.';
    connectionChanged();
  }

  async function request(url, options, format = 'json', limit = 25000) {
    const controller = new AbortController();
    const timer = win.setTimeout(() => controller.abort(), limit);
    try {
      const response = await win.fetch(url, { ...options, signal: controller.signal, cache: 'no-store', redirect: 'error' });
      ensure(response.ok, `The request could not be completed (HTTP ${response.status}). Try the check again.`);
      return await response[format]();
    } finally { win.clearTimeout(timer); }
  }
  async function graphql(query, variables = {}) {
    const result = await request(EXPECTED.graphqlEndpoint, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    ensure(result && typeof result === 'object', 'The mainnet response was incomplete.');
    return result;
  }
  async function inspectChain() {
    const tip = await graphql(TIP_QUERY);
    const checkpoint = tip?.data?.checkpoint?.sequenceNumber;
    ensure(Number.isSafeInteger(checkpoint) && checkpoint > 0, 'A current Sui mainnet checkpoint is unavailable.');
    const inputs = await graphql(INPUTS_QUERY, { ...INPUT_VARIABLES, checkpoint });
    return validatePreflight(inputs, tip);
  }
  async function freshReview(generation) {
    assertSession(generation);
    const encoded = await request(PACKET_PATH, { credentials: 'same-origin' }, 'text');
    ensure(encoded.length <= 60000, 'The reviewed upgrade packet has an unexpected size.');
    const loaded = await loadReviewedUpgrade(encoded);
    assertSession(generation);
    const chain = await inspectChain();
    assertSession(generation);
    if (chain.status === 'already-upgraded') return { chain };
    const simulation = await validateSimulation(await graphql(SIMULATION_QUERY, {
      transaction: loaded.simulationTransaction,
    }), { maxGasMist: EXPECTED.maxGasMist });
    assertSession(generation);
    return { loaded, chain, simulation, checkedAt: Date.now(), generation };
  }
  function displayReview(review) {
    state.review = review;
    el.acknowledge.checked = false;
    el['gas-estimate'].textContent = `${review.simulation.gasEstimateSui} SUI`;
    el['gas-status'].textContent = 'Fresh simulation';
    el['gas-status'].className = 'pill ready';
    el['gas-note'].textContent = 'Estimated network fee from the current successful simulation. Slush sets the final gas budget and shows it before approval.';
    el.checks.hidden = false;
    el['checked-at'].textContent = `Checked at ${new Date(review.checkedAt).toLocaleTimeString()} · Mainnet checkpoint ${review.simulation.checkpoint.sequenceNumber}`;
    win.clearTimeout(expirationTimer);
    expirationTimer = win.setTimeout(() => {
      if (state.review === review) { invalidateReview(); syncUI(); }
    }, EXPECTED.maxAgeMs);
  }
  function assertFreshReview(review) {
    const now = Date.now();
    for (const checkpoint of [review.chain.checkpoint, review.simulation.checkpoint]) {
      const observedAt = Date.parse(checkpoint.timestamp);
      ensure(Number.isFinite(observedAt) && observedAt <= now + 30000 && now - observedAt <= EXPECTED.maxAgeMs,
        'The chain check became too old before the wallet handoff. Refresh the release check.');
    }
  }
  async function checkRelease() {
    if (state.busy || readAttempt() || state.storageError || state.receipt) return;
    state.busy = 'checking';
    invalidateReview();
    const generation = state.generation;
    syncUI();
    status('Checking the release', 'Reading the live administrator and package, then simulating the exact reviewed transaction.');
    try {
      const review = await freshReview(generation);
      if (review.chain.status === 'already-upgraded') await existingUpgrade(review.chain);
      else {
        ensure(!readAttempt() && !state.storageError, 'A wallet request from this browser needs verification before continuing.');
        displayReview(review);
        status('Ready for your review', 'The administrator, mainnet package, and exact transaction match the approved release. Review the current fee, then acknowledge the release.');
      }
    } catch (error) {
      invalidateReview();
      status('Release check stopped', errorMessage(error), 'warning');
    } finally { state.busy = null; syncUI(); }
  }

  function receiptConfirmed(receipt) {
    state.receipt = receipt;
    invalidateReview();
    try {
      saveAttempt({ ...state.attempt, nonce: state.attempt?.nonce || win.crypto.randomUUID(),
        phase: 'confirmed', digest: receipt.digest, packageId: receipt.packageId, at: Date.now() });
    } catch { /* The verified receipt remains usable even if storage is unavailable. */ }
    el['receipt-digest'].textContent = receipt.digest;
    el['receipt-package'].textContent = receipt.packageId;
    el['receipt-link'].href = `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(receipt.digest)}`;
    el['receipt-panel'].hidden = false;
    el['recovery-panel'].hidden = true;
    el['gas-estimate'].textContent = `${receipt.gasEstimateSui} SUI`;
    el['gas-status'].textContent = 'Confirmed fee';
    el['gas-status'].className = 'pill ready';
    el['gas-note'].textContent = 'Actual net network fee from the confirmed onchain receipt.';
    status('Upgrade confirmed', `Version 12 is published at mainnet checkpoint ${receipt.checkpoint.sequenceNumber}. The exact transaction, published modules, administrator, and legacy asset types have been verified.`, 'success');
    syncUI();
  }
  async function verifyDigest(digest, waitForInclusion = false) {
    ensure(DIGEST_PATTERN.test(digest), 'Paste a complete Sui transaction digest from Slush.');
    if (waitForInclusion) {
      try { await dAppKit.getClient(EXPECTED.network).waitForTransaction({ digest, timeout: 15000, pollSchedule: [0, 500, 1500, 3000] }); }
      catch { /* A read timeout does not permit resubmission. Check the indexed receipt next. */ }
    }
    let pending;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await new Promise(resolve => win.setTimeout(resolve, attempt * 1200));
      try {
        const raw = await graphql(CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest });
        const receipt = await validateConfirmedUpgrade(raw, digest);
        receiptConfirmed(receipt);
        return receipt;
      } catch (error) {
        pending = error;
        if (error?.code !== 'CONFIRMATION_PENDING') throw error;
      }
    }
    throw pending;
  }
  async function existingUpgrade(chain) {
    invalidateReview();
    saveAttempt({ nonce: state.attempt?.nonce || win.crypto.randomUUID(), phase: 'submitted',
      digest: chain.digest, at: Date.now() });
    status('Version 12 is already recorded', 'Verifying the existing onchain receipt. Another upgrade request is disabled.');
    showRecovery();
    await verifyDigest(chain.digest);
  }
  function uncertain(error, title = 'Wallet request needs verification', ownedNonce = null) {
    invalidateReview();
    const current = readAttempt();
    // A read-only failure in a second tab must not modify the first tab's
    // in-flight request. Only the tab handling that nonce may change its phase.
    if (!state.storageError && ownedNonce && current?.nonce === ownedNonce && current.phase !== 'confirmed') {
      try { saveAttempt({ ...current, phase: error?.code === 'TRANSACTION_FAILED' ? 'failed' : 'uncertain' }); }
      catch { /* Preserve the in-memory lock and display the recovery path. */ }
    }
    const failed = error?.code === 'TRANSACTION_FAILED';
    status(failed ? 'The transaction did not succeed' : title,
      `${errorMessage(error)} ${failed ? 'A network fee may have been charged.' : 'The transaction may already have been submitted.'} Another wallet request is disabled. Verify the receipt before taking any further action.`, 'warning');
    showRecovery();
    syncUI();
  }
  async function submitUpgrade() {
    if (state.busy || state.receipt || readAttempt() || state.storageError) return;
    let handedOff = false;
    let nonce;
    const acknowledgedReview = state.review;
    const generation = state.generation;
    try {
      assertSession(generation);
      ensure(acknowledgedReview && el.acknowledge.checked && Date.now() - acknowledgedReview.checkedAt < EXPECTED.maxAgeMs,
        'Refresh the release check and acknowledge the current review first.');
      ensure(win.navigator.locks?.request, 'This browser cannot protect against duplicate wallet requests. Open the canonical page in a current browser with Slush.');
      state.busy = 'submitting';
      syncUI();
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling this upgrade. Finish its wallet request and verify the result here.');
        ensure(!readAttempt() && !state.storageError, 'An earlier wallet request needs verification.');
        status('Checking once more before Slush', 'Refreshing the chain state and simulation before opening the wallet review.');
        const fresh = await freshReview(generation);
        if (fresh.chain.status === 'already-upgraded') { await existingUpgrade(fresh.chain); return; }
        // A changed estimate receives its own acknowledgement. Even a small
        // increase must not silently replace the fee the user just reviewed.
        if (fresh.simulation.gasEstimateMist !== acknowledgedReview.simulation.gasEstimateMist) {
          displayReview(fresh);
          status('The network fee estimate changed', 'Review the updated estimate, acknowledge it, then select “Review upgrade in Slush” again.', 'warning');
          return;
        }
        await validateWalletTransaction(fresh.loaded.transaction);
        assertFreshReview(fresh);
        const { account } = assertSession(generation);
        ensure(el.acknowledge.checked && state.review === acknowledgedReview,
          'The acknowledgement or account changed during the final check. Review the release again.');
        ensure(!readAttempt() && !state.storageError, 'Another wallet request needs verification.');
        nonce = win.crypto.randomUUID();
        saveAttempt({ nonce, phase: 'requesting', digest: null, at: Date.now() });
        // No await occurs between the final identity check and the sole wallet
        // action. The explicit account/network prevent dAppKit fallback.
        assertSession(generation);
        handedOff = true;
        status('Review the upgrade in Slush', 'Confirm the administrator, Sui mainnet, and transaction details in Slush. This page will verify the onchain receipt after your decision.');
        let result;
        try {
          result = await dAppKit.signAndExecuteTransaction({
            transaction: fresh.loaded.transaction, account, network: EXPECTED.network,
          });
        } catch (error) {
          if (!isExplicitRejection(error)) throw error;
          // Clear a definite rejection while still holding the exclusive lock.
          // No second tab can acquire the request between rejection and cleanup.
          try {
            journal.clearRejected(nonce);
            state.attempt = null;
            invalidateReview();
            status('Upgrade cancelled in Slush', 'Slush reported that you rejected the request. No transaction was submitted by this request. Run a fresh release check if you decide to continue.');
          } catch (journalError) { uncertain(journalError, undefined, nonce); }
          return;
        }
        const digest = result?.Transaction?.digest || result?.FailedTransaction?.digest;
        ensure(DIGEST_PATTERN.test(digest || ''), 'Slush did not return a verifiable transaction digest.');
        saveAttempt({ ...state.attempt, nonce, phase: 'submitted', digest });
        status('Verifying the mainnet receipt', 'Slush returned a transaction digest. Waiting for a confirmed checkpoint and checking the published package.');
        await verifyDigest(digest, true);
      });
    } catch (error) {
      if (handedOff || state.attempt) uncertain(error, undefined, nonce);
      else {
        invalidateReview();
        status('Wallet review did not open', errorMessage(error), 'warning');
      }
    } finally { state.busy = null; syncUI(); }
  }
  async function verifyFromForm(event) {
    event.preventDefault();
    if (state.busy) return;
    state.busy = 'verifying';
    syncUI();
    try {
      const digest = el['transaction-digest'].value.trim();
      ensure(DIGEST_PATTERN.test(digest), 'Paste a complete Sui transaction digest from Slush.');
      ensure(!state.attempt?.digest || digest === state.attempt.digest,
        'Use the transaction digest already returned by Slush for this wallet request.');
      status('Verifying the mainnet receipt', 'Checking the transaction and published modules against the exact reviewed upgrade.');
      await verifyDigest(digest, true);
    } catch (error) { uncertain(error, 'Receipt not yet verified'); }
    finally { state.busy = null; syncUI(); }
  }
  async function checkExisting() {
    if (state.busy) return;
    state.busy = 'verifying';
    syncUI();
    try {
      status('Checking the current upgrade', 'Reading the live upgrade capability and its most recent transaction.');
      const chain = await inspectChain();
      if (chain.status === 'already-upgraded') await existingUpgrade(chain);
      else status('No confirmed version 12 found yet', 'The checked capability still records version 11. A wallet request may still be pending. Keep the request locked and check its activity in Slush; this observation does not authorize a second submission.', 'warning');
    } catch (error) { uncertain(error, 'Current upgrade could not be verified'); }
    finally { state.busy = null; syncUI(); }
  }
  function onStorage(event) {
    if (event.key !== ATTEMPT_KEY && event.key !== null) return;
    const previous = state.attempt;
    readAttempt();
    if (state.attempt && state.attempt !== previous) {
      invalidateReview();
      if (!state.receipt && !state.busy) {
        status('A wallet request is recorded', 'A request from this browser needs verification before continuing.', 'warning');
        showRecovery();
      }
    }
    syncUI();
  }

  try {
    journal = new UpgradeAttemptJournal(win.localStorage);
    readAttempt();
    // Probe an unrelated temporary key; never overwrite a real attempt.
    const probe = `${ATTEMPT_KEY}:storage-check`;
    win.localStorage.setItem(probe, 'available');
    ensure(win.localStorage.getItem(probe) === 'available', 'Browser storage is unavailable.');
    win.localStorage.removeItem(probe);
  } catch (error) { state.storageError = errorMessage(error); }

  el['use-account'].addEventListener('click', chooseAccount);
  el['account-select'].addEventListener('change', () => {
    invalidateSession();
    el['wallet-status'].textContent = 'Select “Use selected account” to confirm your choice.';
    syncUI();
  });
  el.disconnect.addEventListener('click', disconnect);
  el['check-release'].addEventListener('click', checkRelease);
  el.acknowledge.addEventListener('change', syncUI);
  el['submit-upgrade'].addEventListener('click', submitUpgrade);
  el['verify-form'].addEventListener('submit', verifyFromForm);
  el['check-existing'].addEventListener('click', checkExisting);
  el['copy-receipt'].addEventListener('click', async () => {
    if (!state.receipt) return;
    try {
      await win.navigator.clipboard.writeText(`Arboretum v12 · Sui mainnet\nTransaction: ${state.receipt.digest}\nPackage: ${state.receipt.packageId}`);
      el['copy-receipt'].textContent = 'Receipt copied';
    } catch { status('Copy the receipt', 'Select and copy the transaction digest and new package shown in the confirmed receipt.'); }
  });
  win.addEventListener('storage', onStorage);
  unsubscribers.push(dAppKit.stores.$wallets.subscribe(connectionChanged));
  unsubscribers.push(dAppKit.stores.$connection.subscribe(connectionChanged));
  unsubscribers.push(dAppKit.stores.$currentNetwork.subscribe(connectionChanged));
  if (state.storageError) {
    status('Browser storage is required', 'This page needs browser storage to remember an unresolved wallet request. Enable storage for www.treegrow.xyz and reload before reviewing the upgrade.', 'warning');
    showRecovery('If you already opened a wallet request, verify its receipt below. Signing stays disabled while browser storage is unavailable.');
  } else if (state.attempt) {
    status('A previous wallet request needs verification', 'Verify its onchain receipt before continuing. Reloading this page does not submit another transaction.', 'warning');
    showRecovery();
  }
  syncUI();
  return {
    // Exposed for focused offline tests; production initialization supplies only
    // the real DOM, canonical browser origin, and isolated dAppKit instance.
    getState: () => ({ ...state, accountOptions: [...state.accountOptions] }),
    destroy() {
      state.destroyed = true;
      invalidateSession();
      win.clearTimeout(expirationTimer);
      unsubscribers.forEach(unsubscribe => unsubscribe());
      win.removeEventListener('storage', onStorage);
    },
  };
}

export function bootUpgradePage(win = window, doc = document) {
  try {
    assertExpectedOrigin(win.location.origin);
    const dAppKit = createDAppKit({
      networks: ['mainnet'], defaultNetwork: 'mainnet', autoConnect: false,
      storage: null, slushWalletConfig: null, enableBurnerWallet: false,
      createClient: () => new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }),
    });
    return createUpgradeController({ window: win, document: doc, dAppKit });
  } catch (error) {
    const notice = doc.getElementById('origin-warning');
    if (notice) { notice.hidden = false; notice.textContent = errorMessage(error); }
    const wallets = doc.getElementById('wallet-list');
    if (wallets) wallets.textContent = 'Open https://www.treegrow.xyz/admin/settlement-upgrade/ to review this release.';
    return null;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') bootUpgradePage();
