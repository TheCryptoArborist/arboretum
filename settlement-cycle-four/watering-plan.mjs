/**
 * Reminder preparation only. Never authorizes a transaction or proves that a
 * receipt is authentic. Call only AFTER the existing mainnet receipt validator
 * has succeeded; reverify stored digests before using saved receipts.
 * No network, storage, wallet, notification subscription, or signing side effects.
 */
export const WATERING_INTERVAL_MS = 21 * 60 * 60 * 1000 + 36 * 60 * 1000;
const MINUTE = 60_000;
const ADDRESS = /^0x[0-9a-f]{64}$/;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function requireValue(ok, message) { if (!ok) throw new TypeError(message); }
function timestamp(value, label) {
  requireValue(typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)), `${label}: invalid timestamp`);
  const result = Number(value);
  requireValue(Number.isSafeInteger(result) && result > 0 && result <= 253_402_300_799_999, `${label}: invalid timestamp`);
  return result;
}
function txDigest(value) {
  requireValue(typeof value === 'string' && value.length >= 32 && value.length <= 44, 'Invalid transaction digest');
  let n = 0n;
  for (const c of value) {
    const digit = BASE58.indexOf(c); requireValue(digit >= 0, 'Invalid transaction digest');
    n = n * 58n + BigInt(digit);
  }
  const leadingZeros = value.match(/^1*/)[0].length;
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
  requireValue(bytes + leadingZeros === 32, 'Invalid transaction digest length');
  return value;
}
/** Scheduling advice, not on-chain eligibility or receipt authentication. */
export function createWateringPlan(plant, cycle, options) {
  requireValue(options && /^[1-9]\d*$/.test(options.seasonId), 'Expected season is required');
  requireValue(ADDRESS.test(options.registryId), 'Expected Registry is required');
  const url = new URL(options.pageUrl);
  requireValue(url.origin === 'https://www.treegrow.xyz' && !url.username && !url.password &&
    !url.search && !url.hash && /^\/admin\/[a-z0-9-]+\/$/.test(url.pathname), 'Unapproved reminder destination');
  const now = timestamp(options.nowMs, 'Current time');
  requireValue(plant?.status === 'confirmed' && plant.action === 'plant', 'Confirmed planting receipt required');
  requireValue(cycle?.status === 'confirmed' && cycle.action === 'rollover', 'Confirmed season receipt required');
  requireValue(plant.seasonId === options.seasonId && cycle.seasonId === options.seasonId, 'Receipt season mismatch');
  requireValue(plant.registryId === options.registryId && cycle.registryId === options.registryId, 'Receipt Registry mismatch');
  requireValue(plant.cycleDigest === cycle.digest, 'Planting belongs to a different cycle');
  txDigest(plant.digest); txDigest(cycle.digest);
  requireValue(ADDRESS.test(plant.seedId), 'Invalid Seed identifier');
  const planted = timestamp(plant.plantedAtMs, 'Planting time');
  const opens = timestamp(plant.waterReadyMs, 'Watering time');
  const cutoff = timestamp(cycle.cutoffMs, 'Growing cutoff');
  requireValue(opens - planted === WATERING_INTERVAL_MS, 'Watering interval mismatch');
  requireValue(timestamp(plant.cutoffMs, 'Planting cutoff') === cutoff && planted < cutoff, 'Growing cutoff mismatch');
  requireValue(plant.canWaterBeforeCutoff !== false && opens < cutoff, 'No watering window');
  const base = { seasonId: options.seasonId, seedId: plant.seedId, plantingDigest: plant.digest,
    cycleDigest: cycle.digest, pageUrl: url.href, opensMs: opens, cutoffMs: cutoff,
    notificationDeliveryGuaranteed: false, authorizesTransaction: false };
  if (options.claimConfirmed || options.wateringConfirmed) return Object.freeze({ ...base, status: 'completed', reminders: Object.freeze([]) });
  if (now >= cutoff) return Object.freeze({ ...base, status: 'closed', reminders: Object.freeze([]) });
  if (now >= opens) return Object.freeze({ ...base, status: 'water-now', reminders: Object.freeze([]) });
  const first = Math.ceil(opens / MINUTE) * MINUTE;
  if (first >= Math.floor(cutoff / 1000) * 1000) return Object.freeze({ ...base, status: 'window-too-short', reminders: Object.freeze([]) });
  const reminders = [Object.freeze({ kind: 'primary', atMs: first })];
  const backup = first + 15 * MINUTE;
  if (backup < Math.floor(cutoff / 1000) * 1000) reminders.push(Object.freeze({ kind: 'backup', atMs: backup }));
  return Object.freeze({ ...base, status: 'scheduled', reminders: Object.freeze(reminders) });
}
function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function fold(line) {
  let result = '', segment = '', bytes = 0;
  for (const c of line) {
    const length = new TextEncoder().encode(c).length;
    if (bytes + length > 75) { result += segment + '\r\n'; segment = ' '; bytes = 1; }
    segment += c; bytes += length;
  }
  return result + segment;
}
const utc = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** Local calendar export. Importing does not guarantee phone alerts. */
export function createWateringCalendar(plant, cycle, options) {
  const plan = createWateringPlan(plant, cycle, options);
  requireValue(plan.status === 'scheduled', `Calendar unavailable: ${plan.status}`);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Arboretum//Watering appointment preparation//EN', 'CALSCALE:GREGORIAN'];
  for (const reminder of plan.reminders) {
    const isBackup = reminder.kind === 'backup';
    lines.push('BEGIN:VEVENT',
      `UID:season-${plan.seasonId}-water-${plan.seedId}-${reminder.kind}@treegrow.xyz`,
      `DTSTAMP:${utc(options.nowMs)}`, `DTSTART:${utc(reminder.atMs)}`,
      `DTEND:${utc(Math.min(reminder.atMs + MINUTE, Math.floor(plan.cutoffMs / 1000) * 1000))}`,
      `SUMMARY:${isBackup ? 'Backup: water' : 'Water'} your Arboretum Season ${plan.seasonId} Seed`,
      `URL:${plan.pageUrl}`, 'TRANSP:TRANSPARENT',
      `DESCRIPTION:${escapeText(`${isBackup ? 'Skip this reminder if watering is already confirmed. ' : ''}Open the test page and refresh status. Run the watering check, review the fee, and personally approve in Slush. The page must recheck current on-chain eligibility. Growing cutoff (UTC): ${new Date(plan.cutoffMs).toISOString()}. Planting receipt: ${plan.plantingDigest}. This event does not submit transactions or guarantee phone notification delivery.`)}`,
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY',
      `DESCRIPTION:${isBackup ? 'Backup watering check; skip if already confirmed.' : 'Return to Arboretum for your watering check.'}`,
      'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
