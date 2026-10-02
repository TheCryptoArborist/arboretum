/**
 * Read-only, review-stage partner-purchase bookkeeping. Never signs or executes.
 * A matching SUI debit/token credit is evidence of balance movement, NOT proof
 * of a swap or its business purpose. Explicit human classification is required.
 * Imported evidence and sales are never upgraded to independently verified data.
 */
import { createHash } from 'node:crypto';
import { buildReport, mist } from './ledger.mjs';

export const TREASURY = '0x6f1020c2fd6c91129f7cb5e0d651295e87f7245f96b7d090715c89b38197e77f';
export const CHAIN = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const ENDPOINT = 'https://graphql.mainnet.sui.io/graphql';
export const PURCHASE_QUERY = `query PartnerPurchaseEvidence($digest: String!) {
  chainIdentifier
  checkpoint { sequenceNumber timestamp }
  transaction(digest: $digest) {
    digest transactionJson
    effects {
      status checkpoint { sequenceNumber timestamp }
      balanceChangesJson
      gasEffects { gasSummary { computationCost storageCost storageRebate } }
    }
  }
}`;
const partners = ['BOOM', 'VICTORY'];
const SUI = '0x' + '2'.padStart(64, '0') + '::sui::SUI';
const requireThat = (test, message) => { if (!test) throw new Error(message); };
function address(s) {
  requireThat(typeof s === 'string' && /^0x[0-9a-f]{1,64}$/i.test(s), 'Invalid address');
  return '0x' + s.slice(2).toLowerCase().padStart(64, '0');
}
function coinType(s) {
  requireThat(typeof s === 'string', 'Canonical partner coin type is not configured');
  const m = /^(0x[0-9a-f]{1,64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/i.exec(s);
  requireThat(m, 'Unsupported coin type; use a verified non-generic coin type');
  return `${address(m[1])}::${m[2]}::${m[3]}`;
}
function uint(s, name) {
  // GraphQL UInt53 values may arrive as numbers; refuse unsafe conversion.
  if (typeof s === 'number') {
    requireThat(Number.isSafeInteger(s) && s >= 0, `${name}: unsafe number`);
    s = String(s);
  }
  return mist(s, name);
}
function signed(s) {
  requireThat(typeof s === 'string' && /^(0|[1-9]\d*|-[1-9]\d*)$/.test(s), 'Invalid balance change');
  const n = BigInt(s); mist(n < 0n ? -n : n); return n;
}
function timestamp(s) {
  requireThat(typeof s === 'string' && /Z$/.test(s), 'Missing UTC evidence timestamp');
  const n = Date.parse(s);
  requireThat(Number.isSafeInteger(n) && n >= 0, 'Invalid timestamp'); return BigInt(n);
}
function digest(s) {
  requireThat(typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s), 'Invalid transaction digest');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0; while (n) { ++bytes; n >>= 8n; }
  requireThat(bytes + (s.match(/^1*/)[0].length) === 32, 'Digest must decode to 32 bytes');
  return s;
}
function plain(s, name) {
  requireThat(typeof s === 'string' && s.trim().length > 0 && s.length <= 300 && !/[\x00-\x1f]/.test(s), `${name}: invalid text`);
  return s;
}
function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
}
export function evidenceHash(evidence) {
  return createHash('sha256').update(canonical(evidence)).digest('hex');
}

/** Validate observable movement from supplied GraphQL data. No swap classification. */
export function inspectPurchaseEvidence(evidence, partner, configuredTypes) {
  requireThat(partners.includes(partner), 'Unknown partner');
  const target = coinType(configuredTypes?.[partner]);
  requireThat(target !== SUI, 'Partner token cannot be SUI');
  const other = configuredTypes?.[partner === 'BOOM' ? 'VICTORY' : 'BOOM'];
  if (other) requireThat(coinType(other) !== target, 'Partners cannot share one configured coin type');
  requireThat(evidence && evidence.chainIdentifier === CHAIN, 'Wrong or unverified network');
  const tx = evidence.transaction, j = tx?.transactionJson, effects = tx?.effects;
  const id = digest(tx?.digest);
  requireThat(j?.digest === id, 'Transaction identity mismatch');
  requireThat(effects?.status === 'SUCCESS', 'Transaction is not successful');
  requireThat(address(j.sender) === TREASURY, 'Purchase sender is not the designated treasury');
  requireThat(address(j.gasPayment?.owner) === TREASURY, 'Sponsored/other gas payer needs separate review');
  requireThat(j.kind?.kind === 'PROGRAMMABLE_TRANSACTION', 'Unsupported transaction kind');
  const checkpoint = uint(effects.checkpoint?.sequenceNumber, 'transaction checkpoint');
  const through = uint(evidence.checkpoint?.sequenceNumber, 'read checkpoint');
  const at = timestamp(effects.checkpoint?.timestamp), readAt = timestamp(evidence.checkpoint?.timestamp);
  requireThat(checkpoint <= through && at <= readAt, 'Transaction exceeds evidence watermark');
  requireThat(Array.isArray(effects.balanceChangesJson), 'Missing balance-change evidence');
  const owned = new Map();
  for (const row of effects.balanceChangesJson) {
    if (address(row.address) !== TREASURY) continue;
    const type = coinType(row.coinType);
    requireThat(!owned.has(type), 'Ambiguous duplicate treasury balance change');
    owned.set(type, signed(row.amount));
  }
  requireThat([...owned].every(([t, a]) => a === 0n || t === SUI || t === target), 'Mixed treasury assets need separate review');
  const deltaSui = owned.get(SUI), received = owned.get(target);
  requireThat(typeof deltaSui === 'bigint' && deltaSui < 0n, 'No net SUI debit from treasury');
  requireThat(typeof received === 'bigint' && received > 0n, 'No positive matching-token credit to treasury');
  const gas = effects.gasEffects?.gasSummary;
  requireThat(gas, 'Missing gas cost evidence');
  // Sui net gas: computation + storage - rebate. Do NOT add the non-refundable
  // fee again. Treasury net SUI debit already includes gas and route charges.
  const gasNet = uint(gas.computationCost, 'computation') + uint(gas.storageCost, 'storage') - uint(gas.storageRebate, 'rebate');
  const debit = -deltaSui, nonGas = debit - gasNet;
  requireThat(nonGas > 0n, 'No positive non-gas SUI outflow');
  const ptb = j.kind.programmableTransaction;
  requireThat(Array.isArray(ptb?.commands) && ptb.commands.length > 0, 'Missing transaction commands for review');
  const moveCalls = ptb.commands.filter(c => c.moveCall).map(c => ({
    package: address(c.moveCall.package), module: plain(c.moveCall.module, 'module'),
    function: plain(c.moveCall.function, 'function')
  }));
  return {
    status: 'BALANCE_MOVEMENT_CHECKED_PURPOSE_REQUIRES_REVIEW', partner,
    transactionDigest: id, evidenceSha256: evidenceHash(evidence), treasuryWallet: TREASURY,
    coinType: target, checkpoint: String(checkpoint), timestampMs: String(at),
    treasuryDebitMist: String(debit), gasNetCostMist: String(gasNet),
    nonGasSuiOutflowMist: String(nonGas), tokensReceivedBaseUnits: String(received), moveCalls,
    sourceVerification: 'supplied_evidence_not_independently_authenticated',
    swapVerified: false, tokenPurchasesAuthorized: false, transactionsSubmitted: 0
  };
}

/** Optional point read of ONE nominated transaction; never searches wallet history. */
export async function fetchPurchaseEvidence(transactionDigest, {fetchImpl = globalThis.fetch, signal} = {}) {
  digest(transactionDigest);
  const deadline = AbortSignal.timeout(20000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const r = await fetchImpl(ENDPOINT, {
    method: 'POST', redirect: 'error', credentials: 'omit', signal: combined,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: PURCHASE_QUERY, variables: {digest: transactionDigest}})
  });
  requireThat(r.ok, `Transaction read failed (HTTP ${r.status})`);
  const body = await r.json();
  requireThat(!body.errors?.length && body.data, 'Incomplete GraphQL response; evidence rejected');
  requireThat(body.data.chainIdentifier === CHAIN, 'Unexpected Sui network');
  requireThat(body.data.transaction?.digest === transactionDigest, 'Requested transaction unavailable or mismatched');
  return body.data;
}

/**
 * Full supplied journal only. Duplicate protection spans that journal, not other
 * browsers/files or omitted history. Future shared admin persistence is required.
 * This is review bookkeeping, not a spending authorization or wallet cash check.
 */
export function reconcilePartnerPurchases(salesInput, journal, configuredTypes) {
  requireThat(salesInput?.scenarioTreasuryBasisPoints === 1000, 'Use the approved 10% treasury rate');
  requireThat(salesInput.domain?.network === 'sui:mainnet', 'Unsupported sales network');
  requireThat(Array.isArray(journal), 'Journal must be an array');
  const sales = buildReport(salesInput), seen = new Set(), needsReview = [], matched = [];
  const terms = new Map(salesInput.seasons.map(s => [s.id, s]));
  const totals = new Map(sales.rows.filter(r => r.tokenTarget && r.seasonId).map(r => {
    const key = JSON.stringify([r.seasonId, r.tokenTarget]);
    return [key, {seasonId:r.seasonId, partner:r.tokenTarget, budgetProjectionMist:r.scenarioBudgetMist,
      recordedTreasuryDebitMist:0n, recordedTokenUnits:0n, journalEntryCount:0}];
  }));
  for (const [index, entry] of journal.entries()) {
    // Refuse reuse even when the duplicate has altered partner/season or bad proof.
    const id = entry?.evidence?.transaction?.digest;
    if (typeof id === 'string') {
      requireThat(!seen.has(id), 'Duplicate transaction digest across the supplied journal'); seen.add(id);
    }
    try {
      requireThat(entry && typeof entry === 'object', 'Invalid journal entry');
      const review = entry.review;
      requireThat(review?.decision === 'partner_purchase_confirmed_for_accounting', 'Manual purpose review is missing');
      plain(review.reviewer, 'reviewer'); plain(review.note, 'review note');
      requireThat(review.evidenceSha256 === evidenceHash(entry.evidence), 'Evidence changed after manual review');
      const inspected = inspectPurchaseEvidence(entry.evidence, entry.partner, configuredTypes);
      requireThat(timestamp(review.reviewedAt) >= BigInt(inspected.timestampMs), 'Review predates transaction');
      const key = JSON.stringify([entry.seasonId, entry.partner]), row = totals.get(key);
      requireThat(row && terms.has(entry.seasonId), 'No matching seasonal partner sales budget');
      requireThat(BigInt(inspected.timestampMs) >= BigInt(terms.get(entry.seasonId).startMs), 'Purchase predates attributed season');
      // Purchases after season-end are valid accounting candidates for that season.
      row.recordedTreasuryDebitMist += BigInt(inspected.treasuryDebitMist);
      row.recordedTokenUnits += BigInt(inspected.tokensReceivedBaseUnits);
      row.journalEntryCount++;
      matched.push({...inspected, seasonId:entry.seasonId, manualPurposeReview:review,
        status:'MANUALLY_CLASSIFIED_SUPPLIED_EVIDENCE'});
    } catch (e) { needsReview.push({journalIndex:index, transactionDigest:id ?? null, reason:e.message}); }
  }
  const coverageClaim = sales.seasonCoverage;
  const rows = [...totals.values()].map(row => {
    const coverage = coverageClaim.find(c => c.seasonId === row.seasonId);
    const windowComplete = coverage?.suppliedWindowCoversSeason === true;
    const blocked = !windowComplete || sales.reviewRequired || needsReview.length > 0;
    const difference = row.budgetProjectionMist == null ? null : BigInt(row.budgetProjectionMist) - row.recordedTreasuryDebitMist;
    return {...row, budgetLessRecordedSpendProjectionMist:blocked ? null : difference?.toString(),
      journalOverBudget:!blocked && difference !== null && difference < 0n,
      amountMissingFromBudgetProjectionMist:!blocked && difference !== null && difference < 0n ? String(-difference) : null,
      actualUnspentCashMist:null, balanceAvailableToSpendMist:null,
      status:blocked?'REVIEW_REQUIRED':'PROJECTION_MINUS_MANUALLY_REVIEWED_RECORDS',
      coverageIndependentlyVerified:false};
  });
  return JSON.parse(JSON.stringify({
    schemaVersion:1, status:salesInput.mode === 'fixture'?'SYNTHETIC_RECONCILIATION_NOT_LIVE':'REVIEW_RECONCILIATION_NOT_AUDITED',
    approvedTreasuryBasisPoints:1000, treasuryWallet:TREASURY, salesEvidenceStatus:sales.status,
    rows, matched, needsReview, salesNeedsReview:sales.needsReview,
    sourceVerification:'supplied_sales_and_transaction_evidence_not_independently_authenticated',
    journalCoverage:'supplied_entries_only_not_a_wallet_history_audit',
    duplicateProtection:'this_complete_supplied_journal_only_no_shared_persistent_store',
    tokenPurchasesAuthorized:false, liveDeploymentAllowed:false, fundsLocked:false,
    transactionsSubmitted:0, fundedClaimsChanged:false
  }, (_, v) => typeof v === 'bigint' ? String(v) : v));
}
