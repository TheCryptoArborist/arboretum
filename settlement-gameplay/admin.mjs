import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidTransactionDigest } from '@mysten/sui/utils';
import { uiWalletAccountsAreSame, uiWalletAccountBelongsToUiWallet } from '@wallet-standard/ui';
import { getWalletForHandle } from '@wallet-standard/ui-registry';
import {
  PLANT_EXPECTED as EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES, inspectPlantState,
  NFT_PAGE_QUERY, nextNFTPageVariables, appendNFTPage,
  buildReviewedPlant, validateSimulation, validateConfirmedPlant, validateWalletTransaction,
  assertAdministrator, assertExpectedOrigin,
} from './plant-core.mjs';

const ATTEMPT_KEY = 'arboretum:first-plant:v1:season-1:attempt';
const REQUEST_LOCK = 'arboretum:first-plant:v1:season-1:wallet';

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
export class PlantAttemptJournal {
  constructor(storage) { this.storage = storage; }
  read() {
    const raw = this.storage.getItem(ATTEMPT_KEY);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      ensure(value && value.sender === EXPECTED.sender && value.registryId === EXPECTED.registryId &&
        value.startDigest === EXPECTED.startDigest && value.seasonId === '1' &&
        typeof value.nonce === 'string' && ['requesting', 'submitted', 'uncertain', 'failed', 'confirmed', 'observed-existing'].includes(value.phase),
      'Unrecognized saved planting request.');
      ensure(value.digest == null || isValidTransactionDigest(value.digest), 'Invalid saved transaction digest.');
      ensure(value.nftId == null || /^0x[0-9a-f]{64}$/.test(value.nftId), 'Invalid saved NFTree identity.');
      ensure(value.kindSha256 == null || /^[0-9a-f]{64}$/.test(value.kindSha256), 'Invalid saved planting fingerprint.');
      ensure(value.phase === 'observed-existing' || (value.nftId && value.kindSha256), 'Saved planting binding is missing.');
      return value;
    } catch {
      return { phase: 'unrecognized', nonce: 'unrecognized', digest: null };
    }
  }
  write(value) {
    const record = { ...value, sender: EXPECTED.sender, registryId: EXPECTED.registryId,
      startDigest: EXPECTED.startDigest, seasonId: '1' };
    const encoded = JSON.stringify(record);
    this.storage.setItem(ATTEMPT_KEY, encoded);
    ensure(this.storage.getItem(ATTEMPT_KEY) === encoded, 'The browser could not save the planting request.');
    const checked = this.read();
    ensure(checked?.phase !== 'unrecognized', 'The planting request could not be bound to the reviewed NFTree.');
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

export function createGameplayController({ window: win, document: doc, dAppKit, now = () => Date.now() }) {
  const el = Object.fromEntries([
    'origin-warning', 'wallet-list', 'wallet-status', 'account-controls', 'account-select',
    'use-account', 'connected-address', 'disconnect', 'load-nfts', 'nft-controls', 'nft-select', 'selected-nft', 'nft-status',
    'check-plant', 'checks', 'checked-at', 'acknowledge', 'submit-plant', 'gas-estimate', 'gas-status', 'gas-note',
    'expected-admin', 'expected-package', 'expected-registry', 'expected-start', 'expected-kind',
    'season-cutoff', 'latest-plant-note', 'projected-water', 'status-panel', 'status-title', 'status-message',
    'receipt-panel', 'receipt-heading', 'receipt-state-message', 'receipt-digest', 'receipt-seed', 'receipt-nft',
    'receipt-gas', 'receipt-planted', 'receipt-next-water', 'receipt-cutoff', 'receipt-registry', 'receipt-package',
    'receipt-link', 'copy-receipt', 'recovery-panel', 'recovery-message', 'verify-form', 'transaction-digest',
    'verify-receipt', 'check-existing',
  ].map(id => [id, doc.getElementById(id)]));
  ensure(Object.values(el).every(Boolean), 'The administrator page is incomplete. Reload before continuing.');
  assertExpectedOrigin(win.location.origin);

  let journal;
  const state = {
    busy: null, provider: null, session: null, generation: 0, review: null,
    accountOptions: [], ownedNFTs: [], selectedNFT: null, attempt: null, storageError: null, receipt: null, existing: null,
    connected: false, destroyed: false,
  };
  const unsubscribers = [];
  let expirationTimer;
  el['expected-admin'].textContent = EXPECTED.sender;
  el['expected-package'].textContent = EXPECTED.packageId;
  el['expected-registry'].textContent = EXPECTED.registryId;
  el['expected-start'].textContent = EXPECTED.startDigest;
  el['season-cutoff'].textContent = `Growing ends: ${formatTimestamp(EXPECTED.cutoffMs)}.`;
  el['latest-plant-note'].textContent = `Plant before ${formatTimestamp(String(BigInt(EXPECTED.cutoffMs) - BigInt(EXPECTED.wateringIntervalMs)))} to leave time for another watering before this season ends. The overnight clock change is included.`;

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
    state.ownedNFTs = [];
    state.selectedNFT = null;
    el['nft-controls'].hidden = true;
    el['nft-select'].value = '';
    el['selected-nft'].textContent = '';
    el['nft-status'].textContent = '';
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
      state.attempt = { ...value, sender: EXPECTED.sender, registryId: EXPECTED.registryId, startDigest: EXPECTED.startDigest, seasonId: '1' };
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
      'The selected account changed. Select the administrator and check planting again.');
    ensure(dAppKit.stores.$currentNetwork.get() === EXPECTED.network,
      'Select Sui mainnet before checking planting.');
    const wallet = currentPinnedWallet();
    const connection = dAppKit.stores.$connection.get();
    ensure(connection.isConnected && sameProvider(connection.wallet, state.provider) &&
      sameAccount(connection.account, state.session.account),
    'The connected account changed. Select the administrator and check planting again.');
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
      'A planting request needs verification. Copy its original transaction digest from Slush activity, or check your current test Seed. These checks only read mainnet.';
    if (state.attempt?.digest) el['transaction-digest'].value = state.attempt.digest;
  }
  function syncUI() {
    const busy = Boolean(state.busy);
    const blocked = Boolean(state.attempt || state.storageError || state.receipt || state.existing);
    const selected = canUseSession();
    const fresh = state.review && now() - state.review.checkedAt < EXPECTED.maxAgeMs;
    el['load-nfts'].disabled = busy || blocked || !selected;
    el['load-nfts'].textContent = state.busy === 'loading' ? 'Loading NFTrees…' : state.ownedNFTs.length ? 'Refresh my NFTrees' : 'Load my NFTrees';
    el['nft-select'].disabled = busy || blocked || !selected;
    el['check-plant'].disabled = busy || blocked || !selected || !state.selectedNFT;
    el['check-plant'].textContent = state.busy === 'checking' ? 'Checking planting…' : state.review ? 'Refresh planting check' : 'Check planting';
    el.acknowledge.disabled = busy || blocked || !selected || !state.selectedNFT || !fresh;
    el['submit-plant'].disabled = busy || blocked || !selected || !state.selectedNFT || !fresh || !el.acknowledge.checked;
    el['submit-plant'].textContent = state.busy === 'submitting' ? 'Checking and opening Slush…' :
      state.receipt ? 'Test Seed confirmed' : state.attempt ? 'Verification required' : 'Review planting in Slush ↗';
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
      if (!state.attempt && !state.storageError) status('Administrator selected', 'Load your NFTrees, explicitly select one, then check the single 0.01 SUI test planting.');
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
    const result = await request(EXPECTED.graphqlEndpoint || EXPECTED.endpoint, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    ensure(result && typeof result === 'object', 'The mainnet response was incomplete.');
    return result;
  }
  async function readComplete(query, variables, guard = () => {}) {
    let result = await graphql(query, variables);
    guard();
    let pages = 0;
    for (let next = nextNFTPageVariables(result); next; next = nextNFTPageVariables(result)) {
      ensure(pages < 100, 'The NFTree inventory exceeds this review limit. No wallet request will be opened.');
      const page = await graphql(NFT_PAGE_QUERY, next);
      guard();
      result = appendNFTPage(result, page);
      pages += 1;
    }
    return result;
  }
  async function inspectChain(guard = () => {}) {
    const proof = await graphql(PROOF_QUERY, PROOF_VARIABLES);
    guard();
    const inputs = await readComplete(INPUTS_QUERY, INPUT_VARIABLES, guard);
    guard();
    const chain = await inspectPlantState(inputs, proof, { now: now() });
    guard();
    return { ...chain, proof };
  }
  function formatTimestamp(value) {
    const time = Number(value);
    ensure(Number.isSafeInteger(time) && time > 0, 'The verified season time is invalid.');
    return new Date(time).toLocaleString(undefined, {
      timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long',
    });
  }
  function nftIdentity(nft) {
    return JSON.stringify([nft?.objectId, nft?.objectType, String(nft?.version), nft?.digest]);
  }
  function populateNFTs(nfts) {
    state.ownedNFTs = nfts.map(nft => ({ ...nft }));
    state.selectedNFT = null;
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select an NFTree';
    el['nft-select'].replaceChildren(placeholder);
    for (const nft of state.ownedNFTs) {
      const option = doc.createElement('option');
      option.value = nft.objectId;
      option.textContent = `${nft.name || 'NFTree'} · ${nft.objectId}`;
      el['nft-select'].append(option);
    }
    el['nft-select'].value = '';
    el['selected-nft'].textContent = '';
    el['nft-controls'].hidden = !nfts.length;
    el['nft-status'].textContent = nfts.length ? `${nfts.length} owned NFTree${nfts.length === 1 ? '' : 's'} verified. Choose one for this test Seed.` :
      'No directly owned NFTrees from the configured collection were found in this administrator account.';
  }
  function chooseNFT() {
    if (state.busy) return;
    state.generation += 1;
    invalidateReview();
    state.selectedNFT = null;
    try {
      assertSession();
      const selected = state.ownedNFTs.find(nft => nft.objectId === el['nft-select'].value);
      ensure(selected, 'Choose one of the NFTrees from the verified inventory.');
      state.selectedNFT = { ...selected };
      el['selected-nft'].textContent = selected.objectId;
      status('NFTree selected', 'Check planting to verify this NFTree, the Season 1 window, the 0.01 SUI payment and current network fee.');
    } catch (error) {
      el['selected-nft'].textContent = '';
      if (el['nft-select'].value) status('Select an available NFTree', errorMessage(error), 'warning');
    }
    syncUI();
  }
  function showClosed(chain) {
    state.existing = chain;
    invalidateReview();
    status('The growing window is closed', 'This page cannot plant after the confirmed Season 1 cutoff. Existing planting receipts can still be verified below.', 'warning');
    showRecovery();
  }
  async function loadNFTs() {
    if (state.busy || readAttempt() || state.storageError || state.receipt || state.existing) return;
    state.busy = 'loading';
    invalidateReview();
    state.selectedNFT = null;
    state.ownedNFTs = [];
    el['nft-controls'].hidden = true;
    const generation = state.generation;
    syncUI();
    status('Loading your NFTrees', 'Reading the confirmed test season and the administrator’s complete NFTree and Seed inventories. This check does not request a transaction.');
    try {
      const chain = await inspectChain(() => assertSession(generation));
      if (chain.status === 'already-planted') await existingPlant(chain);
      else if (chain.status === 'closed') showClosed(chain);
      else {
        ensure(chain.status === 'ready', 'The first planting is not ready.');
        ensure(!readAttempt() && !state.storageError, 'A wallet request from this browser needs verification.');
        populateNFTs(chain.ownedNFTs);
        status(chain.ownedNFTs.length ? 'Choose an NFTree' : 'No owned NFTree available',
          chain.ownedNFTs.length ? 'Select one NFTree below, then check the 0.01 SUI planting. Your selection is never automatic.' :
          'The administrator needs a directly owned NFTree from the configured collection for this planting test.',
          chain.ownedNFTs.length ? '' : 'warning');
      }
    } catch (error) {
      status('NFTree loading stopped', errorMessage(error), 'warning');
    } finally { state.busy = null; syncUI(); }
  }
  async function freshReview(generation) {
    const guard = () => assertSession(generation);
    guard();
    const selected = state.selectedNFT;
    ensure(selected, 'Explicitly select an NFTree before checking planting.');
    const chain = await inspectChain(guard);
    if (chain.status !== 'ready') return { chain };
    const liveNFT = chain.ownedNFTs.find(nft => nft.objectId === selected.objectId);
    ensure(liveNFT && nftIdentity(liveNFT) === nftIdentity(selected),
      'The selected NFTree or its ownership reference changed. Refresh your NFTrees and select it again.');
    const loaded = await buildReviewedPlant(selected.objectId, chain);
    guard();
    ensure(state.selectedNFT && nftIdentity(state.selectedNFT) === nftIdentity(selected),
      'The selected NFTree changed. Check planting again.');
    const rawSimulation = await readComplete(SIMULATION_QUERY, {
      ...INPUT_VARIABLES, transaction: loaded.simulationTransaction,
    }, guard);
    guard();
    const simulation = await validateSimulation(rawSimulation, loaded, chain, chain.proof,
      { maxGasMist: EXPECTED.maxGasMist, now: now() });
    guard();
    return { loaded, chain, simulation, selectedNFT: selected, checkedAt: now(), generation };
  }
  function displayReview(review) {
    state.review = review;
    el.acknowledge.checked = false;
    el['gas-estimate'].textContent = `${review.simulation.gasEstimateSui} SUI`;
    el['gas-status'].textContent = 'Fresh simulation';
    el['gas-status'].className = 'pill ready';
    el['gas-note'].textContent = 'Estimated additional network fee from the successful simulation. The gross planting payment is 0.01 SUI. Slush sets the final gas budget.';
    el['expected-kind'].textContent = review.loaded.kindSha256;
    el['projected-water'].textContent = review.simulation.canWaterBeforeCutoff ?
      `Estimated next watering: ${formatTimestamp(review.simulation.waterReadyMs)}. The actual planting time sets your final watering window.` :
      `This planting would become eligible for watering at ${formatTimestamp(review.simulation.waterReadyMs)}, after the season closes. It would have 10 Growth Points at planting with no later watering window in Season 1.`;
    el.checks.hidden = false;
    el['checked-at'].textContent = `Checked at ${new Date(review.checkedAt).toLocaleTimeString()} · Mainnet checkpoint ${review.simulation.checkpoint.sequenceNumber}`;
    win.clearTimeout(expirationTimer);
    expirationTimer = win.setTimeout(() => {
      if (state.review === review) { invalidateReview(); syncUI(); }
    }, EXPECTED.maxAgeMs);
  }
  function assertFreshReview(review) {
    const checkedNow = now();
    for (const checkpoint of [review.chain.checkpoint, review.simulation.checkpoint]) {
      const observedAt = Date.parse(checkpoint.timestamp);
      ensure(Number.isFinite(observedAt) && observedAt <= checkedNow + 30000 && checkedNow - observedAt <= EXPECTED.maxAgeMs,
        'The chain check became too old before the wallet handoff. Refresh the planting check.');
    }
  }
  async function checkPlant() {
    if (state.busy || readAttempt() || state.storageError || state.receipt || state.existing) return;
    state.busy = 'checking';
    invalidateReview();
    const generation = state.generation;
    syncUI();
    status('Checking planting', 'Verifying the selected NFTree and current Season 1 state, then simulating one 0.01 SUI planting.');
    try {
      const review = await freshReview(generation);
      if (review.chain.status === 'already-planted') await existingPlant(review.chain);
      else if (review.chain.status === 'closed') showClosed(review.chain);
      else {
        ensure(!readAttempt() && !state.storageError, 'A wallet request from this browser needs verification.');
        displayReview(review);
        status('Ready for your review', 'The selected NFTree and one-Seed simulation are verified. Review the 0.01 SUI payment, allocation, additional network fee and watering window before acknowledging.');
      }
    } catch (error) {
      invalidateReview();
      status('Planting check stopped', errorMessage(error), 'warning');
    } finally { state.busy = null; syncUI(); }
  }
  function receiptConfirmed(receipt) {
    state.receipt = receipt;
    invalidateReview();
    const kindSha256 = receipt.kindSha256 || receipt.exactKindSha256;
    try {
      saveAttempt({ ...state.attempt, nonce: state.attempt?.nonce || win.crypto.randomUUID(),
        phase: 'confirmed', digest: receipt.digest, nftId: receipt.nftId, kindSha256,
        seedId: receipt.seedId, at: now() });
    } catch { /* Verified receipt remains visible if storage becomes unavailable. */ }
    el['receipt-digest'].textContent = receipt.digest;
    el['receipt-seed'].textContent = receipt.seedId;
    el['receipt-nft'].textContent = receipt.nftId;
    el['receipt-gas'].textContent = `${receipt.gasEstimateSui} SUI`;
    el['receipt-registry'].textContent = receipt.registryId;
    el['receipt-package'].textContent = receipt.packageId;
    el['receipt-planted'].textContent = formatTimestamp(receipt.plantedAtMs);
    el['receipt-next-water'].textContent = formatTimestamp(receipt.waterReadyMs);
    el['receipt-cutoff'].textContent = formatTimestamp(receipt.cutoffMs);
    el['receipt-heading'].textContent = 'Your first test Seed is planted.';
    el['receipt-state-message'].textContent = `The actual planting created one version-1 Seed with 10 Growth Points and left your NFTree owned. The 0.01 SUI payment allocated 0.007 SUI to the reward pool, 0.0028 SUI to the treasury wallet and 0.0002 SUI to the developer wallet. ${receipt.canWaterBeforeCutoff ? 'Keep this receipt for the next watering test; this page does not water the Seed.' : 'Its next watering eligibility falls after this season’s cutoff.'}${receipt.hasAdvanced ? ' Later Seed or Registry activity is separate from this original planting receipt.' : ''}`;
    el['receipt-link'].href = `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(receipt.digest)}`;
    el['receipt-panel'].hidden = false;
    el['recovery-panel'].hidden = true;
    el['gas-estimate'].textContent = `${receipt.gasEstimateSui} SUI`;
    el['gas-status'].textContent = 'Confirmed fee';
    el['gas-status'].className = 'pill ready';
    el['gas-note'].textContent = 'Actual net network fee from the confirmed planting receipt, additional to the 0.01 SUI gross planting payment.';
    el['expected-kind'].textContent = kindSha256;
    status('Test Seed confirmed', `The exact first planting is verified at mainnet checkpoint ${receipt.checkpoint.sequenceNumber}. Next watering becomes eligible ${formatTimestamp(receipt.waterReadyMs)}. Copy the receipt for the next test step.`, 'success');
    syncUI();
  }
  async function verifyDigest(digest, waitForInclusion = false) {
    ensure(isValidTransactionDigest(digest), 'Paste a complete Sui transaction digest from Slush.');
    if (waitForInclusion) {
      try { await dAppKit.getClient(EXPECTED.network).waitForTransaction({ digest, timeout: 15000, pollSchedule: [0, 500, 1500, 3000] }); }
      catch { /* A read timeout never permits another paid planting. */ }
    }
    let pending;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await new Promise(resolve => win.setTimeout(resolve, attempt * 1200));
      try {
        const proof = await graphql(PROOF_QUERY, PROOF_VARIABLES);
        const raw = await readComplete(CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest });
        const receipt = await validateConfirmedPlant(raw, digest, proof, { now: now() });
        const saved = readAttempt();
        if (saved?.nftId) ensure(saved.nftId === receipt.nftId, 'The receipt uses a different NFTree from this wallet request.');
        if (saved?.kindSha256) ensure(saved.kindSha256 === (receipt.kindSha256 || receipt.exactKindSha256), 'The receipt differs from the planting reviewed for this wallet request.');
        receiptConfirmed(receipt);
        return receipt;
      } catch (error) {
        pending = error;
        if (error?.code !== 'CONFIRMATION_PENDING') throw error;
      }
    }
    throw pending;
  }
  async function existingPlant(chain) {
    state.existing = chain;
    invalidateReview();
    const attempt = readAttempt();
    if (!attempt && !state.storageError) saveAttempt({ nonce: win.crypto.randomUUID(), phase: 'observed-existing', digest: null, at: now() });
    status('The first-Seed test has on-chain activity', 'Another first planting is disabled. Verify your original planting receipt if available to recover its Seed ID and exact watering time.', 'warning');
    showRecovery(chain.firstSeed ? 'This administrator already has a Seed in Season 1. Use its original planting transaction from Slush activity. A prefilled candidate may be later activity and can be replaced until verified.' : 'The test Registry has advanced beyond the empty first-plant state. This page cannot prepare another first planting. A prefilled transaction is only a candidate and must pass receipt verification.');
    const digest = state.attempt?.digest || chain.digestCandidate;
    if (digest) { el['transaction-digest'].value = digest; await verifyDigest(digest); }
  }
  function uncertain(error, title = 'Wallet request needs verification', ownedNonce = null) {
    invalidateReview();
    const current = readAttempt();
    if (!state.storageError && ownedNonce && current?.nonce === ownedNonce && current.phase !== 'confirmed') {
      try { saveAttempt({ ...current, phase: error?.code === 'TRANSACTION_FAILED' ? 'failed' : 'uncertain' }); }
      catch { /* Preserve the in-memory lock. */ }
    }
    const failed = error?.code === 'TRANSACTION_FAILED';
    status(failed ? 'The transaction did not succeed' : title,
      `${errorMessage(error)} ${failed ? 'A network fee may have been charged.' : 'The transaction may already have been submitted.'} Another planting request is disabled. Verify the receipt before continuing.`, 'warning');
    showRecovery();
    syncUI();
  }
  async function submitPlant() {
    if (state.busy || state.receipt || readAttempt() || state.storageError || state.existing) return;
    let handedOff = false, nonce;
    const acknowledgedReview = state.review;
    const generation = state.generation;
    try {
      assertSession(generation);
      ensure(acknowledgedReview && el.acknowledge.checked && now() - acknowledgedReview.checkedAt < EXPECTED.maxAgeMs,
        'Refresh the planting check and acknowledge the current review first.');
      ensure(win.navigator.locks?.request, 'This browser cannot protect against duplicate wallet requests. Open the canonical page in a current browser with Slush.');
      state.busy = 'submitting'; syncUI();
      await win.navigator.locks.request(REQUEST_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        ensure(lock, 'Another tab is handling this planting. Finish its wallet request and verify the result here.');
        ensure(!readAttempt() && !state.storageError, 'An earlier wallet request needs verification.');
        status('Checking once more before Slush', 'Refreshing the selected NFTree, Season 1 state and simulation before opening the wallet review.');
        const fresh = await freshReview(generation);
        if (fresh.chain.status === 'already-planted') { await existingPlant(fresh.chain); return; }
        if (fresh.chain.status === 'closed') { showClosed(fresh.chain); return; }
        ensure(fresh.loaded.kindSha256 === acknowledgedReview.loaded.kindSha256 &&
          fresh.loaded.nftId === acknowledgedReview.loaded.nftId, 'The exact planting changed. Select the NFTree and review again.');
        if (fresh.simulation.gasEstimateMist !== acknowledgedReview.simulation.gasEstimateMist ||
          fresh.simulation.canWaterBeforeCutoff !== acknowledgedReview.simulation.canWaterBeforeCutoff) {
          displayReview(fresh);
          status('The planting review changed', 'Review the refreshed network fee and watering window, acknowledge them, then select “Review planting in Slush” again.', 'warning');
          return;
        }
        await validateWalletTransaction(fresh.loaded.transaction, fresh.loaded);
        assertFreshReview(fresh);
        const { account } = assertSession(generation);
        ensure(el.acknowledge.checked && state.review === acknowledgedReview && state.selectedNFT?.objectId === fresh.loaded.nftId,
          'The acknowledgement, NFTree or account changed during the final check. Review planting again.');
        ensure(!readAttempt() && !state.storageError, 'Another wallet request needs verification.');
        nonce = win.crypto.randomUUID();
        saveAttempt({ nonce, phase: 'requesting', digest: null, nftId: fresh.loaded.nftId, kindSha256: fresh.loaded.kindSha256, at: now() });
        // Keep the final identity check and sole wallet request adjacent: no
        // awaited operation may silently change the selected account or NFTree.
        assertSession(generation);
        handedOff = true;
        status('Review planting in Slush', 'Review the selected NFTree, one 0.01 SUI planting payment and additional network fee. This page verifies the actual Seed and payment allocation after your decision.');
        let result;
        try {
          result = await dAppKit.signAndExecuteTransaction({ transaction: fresh.loaded.transaction, account, network: EXPECTED.network });
        } catch (error) {
          if (!isExplicitRejection(error)) throw error;
          try {
            journal.clearRejected(nonce); state.attempt = null; invalidateReview();
            status('Planting cancelled in Slush', 'Slush reported that you rejected the request. No transaction was submitted by this request. Run a fresh planting check to continue.');
          } catch (journalError) { uncertain(journalError, undefined, nonce); }
          return;
        }
        const digest = result?.Transaction?.digest || result?.FailedTransaction?.digest;
        ensure(isValidTransactionDigest(digest || ''), 'Slush did not return a verifiable transaction digest.');
        saveAttempt({ ...state.attempt, nonce, phase: 'submitted', digest });
        status('Verifying the planting receipt', 'Slush returned a transaction digest. Checking the actual Seed, NFTree ownership, payment allocation and watering time at a confirmed checkpoint.');
        await verifyDigest(digest, true);
      });
    } catch (error) {
      if (handedOff || state.attempt) uncertain(error, undefined, nonce);
      else { invalidateReview(); status('Wallet review did not open', errorMessage(error), 'warning'); }
    } finally { state.busy = null; syncUI(); }
  }
  async function verifyFromForm(event) {
    event.preventDefault();
    if (state.busy) return;
    state.busy = 'verifying'; syncUI();
    try {
      const digest = el['transaction-digest'].value.trim();
      ensure(isValidTransactionDigest(digest), 'Paste a complete Sui transaction digest from Slush.');
      ensure(!state.attempt?.digest || digest === state.attempt.digest, 'Use the transaction digest already returned by Slush for this wallet request.');
      status('Verifying the planting receipt', 'Checking the actual first-Seed planting, NFTree, payment and season against the confirmed start.');
      await verifyDigest(digest, true);
    } catch (error) { uncertain(error, 'Receipt not yet verified'); }
    finally { state.busy = null; syncUI(); }
  }
  async function checkExisting() {
    if (state.busy) return;
    state.busy = 'verifying'; syncUI();
    try {
      status('Checking the current test Seed', 'Reading the fixed Season 1 proof and administrator’s current Seed inventory on mainnet.');
      const chain = await inspectChain();
      if (chain.status === 'already-planted') await existingPlant(chain);
      else if (chain.status === 'closed') showClosed(chain);
      else if (state.attempt || state.existing) status('No confirmed first planting found yet', 'A wallet request may still be pending. Its lock remains in place. Check Slush activity for the original digest; this observation does not authorize another planting.', 'warning');
      else status('Ready for the first test Seed', 'The confirmed Season 1 is open and this administrator has no test Seed. Connect Slush, select the administrator and load your NFTrees to review planting.');
    } catch (error) { uncertain(error, 'Current Seed could not be verified'); }
    finally { state.busy = null; syncUI(); }
  }
  function onStorage(event) {
    if (event.key !== ATTEMPT_KEY && event.key !== null) return;
    const previous = state.attempt;
    readAttempt();
    if (state.attempt && state.attempt !== previous) {
      invalidateReview();
      if (!state.receipt && !state.busy) { status('A wallet request is recorded', 'A planting request from this browser needs verification before continuing.', 'warning'); showRecovery(); }
    }
    syncUI();
  }
  try {
    journal = new PlantAttemptJournal(win.localStorage);
    readAttempt();
    const probe = `${ATTEMPT_KEY}:storage-check`;
    win.localStorage.setItem(probe, 'available');
    ensure(win.localStorage.getItem(probe) === 'available', 'The browser could not save a request marker.');
    win.localStorage.removeItem(probe);
  } catch (error) { state.storageError = errorMessage(error); }
  el['use-account'].addEventListener('click', chooseAccount);
  el['account-select'].addEventListener('change', () => { invalidateSession(); el['wallet-status'].textContent = 'Select “Use selected account” to confirm your choice.'; syncUI(); });
  el.disconnect.addEventListener('click', disconnect);
  el['load-nfts'].addEventListener('click', loadNFTs);
  el['nft-select'].addEventListener('change', chooseNFT);
  el['check-plant'].addEventListener('click', checkPlant);
  el.acknowledge.addEventListener('change', syncUI);
  el['submit-plant'].addEventListener('click', submitPlant);
  el['verify-form'].addEventListener('submit', verifyFromForm);
  el['check-existing'].addEventListener('click', checkExisting);
  el['copy-receipt'].addEventListener('click', async () => {
    if (!state.receipt) return;
    const receipt = state.receipt;
    try {
      await win.navigator.clipboard.writeText(`Arboretum first test Seed · Sui mainnet\nTransaction: ${receipt.digest}\nSeed: ${receipt.seedId}\nNFTree: ${receipt.nftId}\nRegistry: ${receipt.registryId}\nPackage: ${receipt.packageId}\nSeason: 1 · test inventory version 1\nPlanting payment: 0.01 SUI\nReward pool: 0.007 SUI\nTreasury wallet: 0.0028 SUI\nDeveloper wallet: 0.0002 SUI\nNetwork fee: ${receipt.gasEstimateSui} SUI\nGrowth Points at planting: 10\nPlanted at: ${new Date(Number(receipt.plantedAtMs)).toISOString()}\nNext watering eligible: ${new Date(Number(receipt.waterReadyMs)).toISOString()}\nGrowing cutoff: ${new Date(Number(receipt.cutoffMs)).toISOString()}`);
      el['copy-receipt'].textContent = 'Receipt copied';
    } catch { status('Copy the receipt', 'Select and copy the transaction digest, Seed ID and watering time shown in the receipt.'); }
  });
  win.addEventListener('storage', onStorage);
  unsubscribers.push(dAppKit.stores.$wallets.subscribe(connectionChanged));
  unsubscribers.push(dAppKit.stores.$connection.subscribe(connectionChanged));
  unsubscribers.push(dAppKit.stores.$currentNetwork.subscribe(connectionChanged));
  if (state.storageError) {
    status('Browser storage is required', 'This page needs browser storage to remember an unresolved planting request. Enable storage for www.treegrow.xyz and reload before reviewing planting.', 'warning');
    showRecovery('If you already opened a wallet request, verify its receipt below. Signing stays disabled while browser storage is unavailable.');
  } else if (state.attempt) {
    status('A previous wallet request needs verification', 'Verify its onchain planting receipt before continuing. Reloading does not submit another transaction.', 'warning'); showRecovery();
  } else showRecovery('Already planted? Verify the original planting receipt or check the administrator’s current test Seed. These read-only checks work without connecting a wallet.');
  syncUI();
  return {
    getState: () => ({ ...state, accountOptions: [...state.accountOptions], ownedNFTs: [...state.ownedNFTs], selectedNFT: state.selectedNFT ? { ...state.selectedNFT } : null }),
    destroy() { state.destroyed = true; invalidateSession(); win.clearTimeout(expirationTimer); unsubscribers.forEach(unsubscribe => unsubscribe()); win.removeEventListener('storage', onStorage); },
  };
}
export function bootGameplayPage(win = window, doc = document) {
  try {
    assertExpectedOrigin(win.location.origin);
    const dAppKit = createDAppKit({
      networks: ['mainnet'], defaultNetwork: 'mainnet', autoConnect: false,
      storage: null, slushWalletConfig: null, enableBurnerWallet: false,
      createClient: () => new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }),
    });
    return createGameplayController({ window: win, document: doc, dAppKit });
  } catch (error) {
    const notice = doc.getElementById('origin-warning');
    if (notice) { notice.hidden = false; notice.textContent = errorMessage(error); }
    const wallets = doc.getElementById('wallet-list');
    if (wallets) wallets.textContent = 'Open https://www.treegrow.xyz/admin/gameplay-test/ to review planting.';
    return null;
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') bootGameplayPage();
