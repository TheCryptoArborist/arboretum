/**
 * Read-only accounting candidate. No network, wallet, signing, or fund custody.
 * All imports are unverified by this module: a reviewed live reader is still required.
 * One normalized paid receipt represents ONE chest, including within a batch PTB.
 */
export const U64_MAX = (1n << 64n) - 1n;
const MONEY = ['grossMist', 'referralMist', 'poolMist', 'developerMist', 'treasuryMist'];
const NAMES = ['Seedling', 'Grove', 'Canopy', 'Ancient', 'Mythic', 'BOOM', 'Victory'];
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (message) => { throw new Error(message); };

/** Accept only canonical base-unit integer strings or BigInt, never JS numbers. */
export function mist(value, label = 'amount') {
  if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))) {
    fail(`${label}: use an unsigned canonical integer string in MIST`);
  }
  const n = BigInt(value);
  if (n < 0n || n > U64_MAX) fail(`${label}: outside u64 range`);
  return n;
}
function unsigned(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail(`${label}: integer string required`);
  return BigInt(value);
}
function address(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) fail(`${label}: invalid Sui address`);
  return '0x' + value.slice(2).toLowerCase().padStart(64, '0');
}
function text(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\x00-\x1f]/.test(value)) fail(`${label}: invalid text`);
  return value;
}
function bps(value) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) fail('basis points: expected integer 0..10000');
  return BigInt(value);
}
/** Exact existing shop deduction order; NOT the separate planting-referral rule. */
export function splitShop(grossValue, referralEligible) {
  const grossMist = mist(grossValue);
  if (typeof referralEligible !== 'boolean') fail('referral eligibility must be known');
  const referralMist = referralEligible ? grossMist / 100n : 0n;
  const net = grossMist - referralMist;
  const poolMist = net * 70n / 100n;
  const developerMist = net * 2n / 100n;
  const treasuryMist = net - poolMist - developerMist;
  return {grossMist, referralMist, poolMist, developerMist, treasuryMist};
}
/** A projection only: this function does not allocate, reserve, or spend funds. */
export function scenarioBudget(treasuryValue, basisPoints) {
  return mist(treasuryValue) * bps(basisPoints) / 10000n;
}
export function formatSui(value) {
  const n = typeof value === 'bigint' ? value : unsigned(value, 'total');
  if (n < 0n) fail('negative total');
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, '0')}`;
}
function fingerprint(row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])),
    (_, v) => typeof v === 'bigint' ? v.toString() : v);
}
function validateSeasons(seasons) {
  if (!Array.isArray(seasons) || !seasons.length) fail('at least one reviewed season window required');
  const ids = new Set();
  const windows = seasons.map(s => {
    const id = text(s.id, 'season id');
    if (ids.has(id)) fail('duplicate season id');
    ids.add(id);
    const start = unsigned(s.startMs, 'season start');
    const end = unsigned(s.endMs, 'season end');
    if (end <= start) fail('season end must follow start');
    if (!s.cratePricesMist || Object.keys(s.cratePricesMist).length !== 7) fail('all seven frozen crate prices required');
    const prices = Array.from({length: 7}, (_, tier) => mist(s.cratePricesMist[tier], 'season price'));
    if (prices.some(p => p === 0n)) fail('season prices must be positive');
    return {id, start, end, prices};
  }).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  for (let i = 1; i < windows.length; i++) if (windows[i].start < windows[i - 1].end) fail('overlapping season windows');
  return windows;
}
function normalizeSale(r) {
  if (r.evidenceKind !== 'reconciled_paid_receipt_v1') fail('needs reconciled payment evidence, not a generic purchase event');
  const n = {
    kind: 'paid_chest', network: text(r.network, 'network'),
    packageId: address(r.packageId, 'package'), registryId: address(r.registryId, 'registry'),
    economyVersion: unsigned(r.economyVersion, 'economy version').toString(),
    receiptId: address(r.receiptId, 'receipt'),
    transactionDigest: text(r.transactionDigest, 'transaction digest'),
    eventIndex: unsigned(r.eventIndex, 'event index').toString(),
    checkpoint: unsigned(r.checkpoint, 'checkpoint').toString(),
    timestampMs: unsigned(r.timestampMs, 'checkpoint timestamp').toString(),
    tier: r.tier, referralEligible: r.referralEligible,
    // This is importer-supplied data, never treated as independent chain verification.
    sourceVerification: 'not_performed_by_this_module'
  };
  if (!Number.isInteger(n.tier) || n.tier < 0 || n.tier > 6) fail('unsupported crate tier');
  if (own(r, 'quantity') && r.quantity !== 1) fail('one receipt per chest required; expand batch receipts');
  if (own(r, 'seasonId')) n.seasonId = text(r.seasonId, 'event season');
  const expected = splitShop(r.grossMist, n.referralEligible);
  if (!expected.grossMist) fail('zero-price record is not a paid sale');
  for (const key of MONEY) {
    n[key] = mist(r[key], key);
    if (n[key] !== expected[key]) fail(`allocation mismatch: ${key}`);
  }
  return n;
}

/**
 * @param {object} input Normalized read-only import or synthetic fixture.
 * @returns {object} JSON-safe report. No output authorizes a transaction.
 */
export function buildReport(input) {
  if (!['fixture', 'import'].includes(input.mode)) fail('mode must be fixture or import');
  if (!Array.isArray(input.records)) fail('records must be an array');
  const windows = validateSeasons(input.seasons);
  const d = input.domain ?? {};
  const domain = {
    network: text(d.network, 'domain network'), packageId: address(d.packageId, 'domain package'),
    registryId: address(d.registryId, 'domain registry'), economyVersion: unsigned(d.economyVersion, 'domain economy').toString()
  };
  const projectionBps = input.scenarioTreasuryBasisPoints ?? null;
  if (projectionBps !== null) bps(projectionBps);
  if (input.activePartnerBasisPoints != null || input.allowExecution === true) fail('activation and execution unsupported in review build');
  const cov = input.coverage ?? {};
  const through = cov.throughTimestampMs == null ? null : unsigned(cov.throughTimestampMs, 'coverage end');
  const from = cov.fromTimestampMs == null ? null : unsigned(cov.fromTimestampMs, 'coverage start');
  const throughCheckpoint = cov.throughCheckpoint == null ? null : unsigned(cov.throughCheckpoint, 'coverage checkpoint');
  if (from !== null && through !== null && from > through) fail('inverted coverage window');
  const receipts = new Map(), events = new Map(), rows = new Map();
  const review = [], excluded = [], accepted = [];
  let duplicates = 0;
  const reject = (index, reason) => review.push({inputIndex: index, reason});
  for (let index = 0; index < input.records.length; index++) {
    const raw = input.records[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {reject(index, 'record is not an object'); continue;}
    if (raw.status === 'failure') {excluded.push({inputIndex: index, reason: 'failed_transaction'}); continue;}
    if (raw.status !== 'success') {reject(index, 'transaction status unknown'); continue;}
    if (['opening', 'transfer', 'promo', 'test_inventory', 'nftree_revenue'].includes(raw.kind)) {
      excluded.push({inputIndex: index, reason: raw.kind}); continue;
    }
    if (raw.kind !== 'paid_chest') {reject(index, 'unsupported or ambiguous revenue record'); continue;}
    let r;
    try { r = normalizeSale(raw); }
    catch (e) { reject(index, e.message); continue; }
    if (Object.keys(domain).some(k => r[k] !== domain[k])) {excluded.push({inputIndex: index, reason: 'foreign_economy_domain'}); continue;}
    const stamp = BigInt(r.timestampMs);
    if ((through !== null && stamp > through) || (from !== null && stamp < from) ||
        (throughCheckpoint !== null && BigInt(r.checkpoint) > throughCheckpoint)) {
      reject(index, 'record outside declared coverage'); continue;
    }
    const period = windows.find(s => stamp >= s.start && stamp < s.end);
    if (r.seasonId !== undefined && (!period || r.seasonId !== period.id)) {
      reject(index, 'event season contradicts checkpoint window'); continue;
    }
    if (period && r.grossMist !== period.prices[r.tier]) {reject(index, 'charged price differs from frozen season price'); continue;}
    const eventKey = `${r.transactionDigest}:${r.eventIndex}`;
    const recordKey = `${r.network}:${r.registryId}:${r.economyVersion}:${r.receiptId}`;
    const fp = fingerprint(r);
    if ((receipts.has(recordKey) && receipts.get(recordKey) !== fp) || (events.has(eventKey) && events.get(eventKey) !== fp)) {
      fail('conflicting duplicate receipt/event; refuse a potentially incorrect report');
    }
    if (receipts.has(recordKey) || events.has(eventKey)) {duplicates++; continue;}
    receipts.set(recordKey, fp); events.set(eventKey, fp);
    const seasonId = period?.id ?? null;
    if (!period) reject(index, 'paid sale outside an active season; recorded as unassigned');
    const key = JSON.stringify([seasonId, r.tier]);
    if (!rows.has(key)) rows.set(key, {
      seasonId, tier: r.tier, chest: NAMES[r.tier], paidChestCount: 0n,
      grossMist: 0n, referralMist: 0n, poolMist: 0n, developerMist: 0n, treasuryMist: 0n,
      tokenTarget: r.tier === 5 ? 'BOOM' : r.tier === 6 ? 'VICTORY' : null,
      scenarioBudgetMist: projectionBps !== null && period && r.tier >= 5 ? 0n : null,
      authorizedBudgetMist: null, actuallyReservedMist: null, spentMist: null, tokensReceived: null,
      budgetStatus: r.tier >= 5 ? 'percentage_pending_not_reserved' : 'no_partner_budget',
      sourceVerification: 'not_independently_verified'
    });
    const row = rows.get(key);
    row.paidChestCount++;
    for (const key of MONEY) row[key] += r[key];
    if (row.scenarioBudgetMist !== null) row.scenarioBudgetMist += scenarioBudget(r.treasuryMist, projectionBps);
    accepted.push({...r, attributedSeasonId: seasonId});
  }
  const dataRows = [...rows.values()].sort((a,b) => (a.seasonId ?? '').localeCompare(b.seasonId ?? '') || a.tier - b.tier);
  const report = {
    schemaVersion: 1,
    status: input.mode === 'fixture' ? 'SYNTHETIC_DEMO_NOT_LIVE_SALES' : 'UNVERIFIED_IMPORT_NOT_A_PAYMENT_AUTHORIZATION',
    sourceVerification: 'not_performed_no_live_reader_in_this_build',
    domain, sourceCoverage: {...cov, independentlyVerified: false},
    seasonCoverage: windows.map(s => ({seasonId: s.id,
      suppliedWindowCoversSeason: from !== null && through !== null && from <= s.start && through >= s.end && cov.allPagesRead === true && cov.queryErrors === false,
      certification: 'none_importer_claim_only'})),
    scenarioTreasuryBasisPoints: projectionBps, activePartnerBasisPoints: null,
    tokenPurchasesAllowed: false, liveDeploymentAllowed: false,
    treeFundingSource: 'project_received_NFTree_revenue_separate_from_game_sales',
    nftreePercentage: null, tokenAcquisitionsVerified: false,
    rows: dataRows, acceptedReceipts: accepted,
    duplicateInputRecordsIgnored: duplicates, excluded, needsReview: review,
    reviewRequired: review.length > 0 || cov.allPagesRead !== true || cov.queryErrors !== false,
    totalInputRecords: input.records.length
  };
  return JSON.parse(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v));
}

/** Spreadsheet-formula-safe export. CSV is a text report, not a workbook. */
export function reportCsv(report) {
  const fields = ['seasonId','chest','paidChestCount',...MONEY,'tokenTarget','scenarioBudgetMist',
    'authorizedBudgetMist','actuallyReservedMist','spentMist','tokensReceived','budgetStatus'];
  const cell = value => {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"','""') + '"';
  };
  return [fields.map(cell).join(','), ...report.rows.map(r => fields.map(k => cell(r[k])).join(','))].join('\r\n') + '\r\n';
}
