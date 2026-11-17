import test from 'node:test';
import assert from 'node:assert/strict';
import { createWateringPlan as plan, createWateringCalendar as calendar, WATERING_INTERVAL_MS } from './watering-plan.mjs';

// Synthetic scheduling fixtures only; these are not on-chain Season 4 receipts.
const registryId = '0x' + 'a'.repeat(64);
const digest = '8PitEh5UEu5WeFKbZ2kZcr1QRixFZeq1NBXX7mxkSm9R';
const planted = Date.parse('2026-11-16T19:00:00.500Z');
const opens = planted + WATERING_INTERVAL_MS;
const cutoff = planted + 48 * 60 * 60 * 1000;
function fixture() {
  const cycle = { status: 'confirmed', action: 'rollover', seasonId: '4', registryId, digest, cutoffMs: String(cutoff) };
  const plant = { status: 'confirmed', action: 'plant', seasonId: '4', registryId, digest,
    cycleDigest: digest, seedId: '0x' + 'b'.repeat(64), plantedAtMs: String(planted),
    waterReadyMs: String(opens), cutoffMs: String(cutoff), canWaterBeforeCutoff: true };
  return [plant, cycle, { seasonId: '4', registryId,
    pageUrl: 'https://www.treegrow.xyz/admin/season-four/', nowMs: planted + 60_000 }];
}
const run = (edit, fn = plan) => { const x = fixture(); edit?.(...x); return fn(...x); };

test('rounds the first appointment up, never before watering opens', () => {
  const p = run(); assert.equal(p.status, 'scheduled');
  assert.equal(p.reminders[0].atMs, Date.parse('2026-11-17T16:37:00Z'));
  assert.ok(p.reminders[0].atMs >= opens);
});
test('backup is fifteen minutes later and before the cutoff', () => {
  const p = run(); assert.equal(p.reminders[1].atMs - p.reminders[0].atMs, 900_000);
  assert.ok(p.reminders[1].atMs < cutoff);
});
test('a timestamp exactly on a minute is not moved earlier', () => {
  const p = run((a) => { a.plantedAtMs = String(planted - 500); a.waterReadyMs = String(opens - 500); });
  assert.equal(p.reminders[0].atMs, opens - 500);
});
test('at watering opening, shows water-now instead of a past reminder', () => {
  assert.equal(run((a,b,o) => { o.nowMs = opens; }).status, 'water-now');
});
test('during the open window, no stale calendar is exported', () => {
  assert.throws(() => run((a,b,o) => { o.nowMs = opens + 1; }, calendar), /water-now/);
});
test('cutoff is exclusive', () => {
  assert.equal(run((a,b,o) => { o.nowMs = cutoff; }).status, 'closed');
});
test('old completed Seasons cannot create another watering reminder', () => {
  const p = run((a,b,o) => { o.nowMs = cutoff + 86400_000; o.claimConfirmed = true; });
  assert.equal(p.status, 'completed'); assert.deepEqual(p.reminders, []);
});
test('verified watering suppresses additional schedules', () => {
  assert.equal(run((a,b,o) => { o.wateringConfirmed = true; }).status, 'completed');
});
test('different season is rejected', () => assert.throws(() => run(a => { a.seasonId = '3'; }), /season mismatch/));
test('different registry is rejected', () => assert.throws(() => run(a => { a.registryId = '0x' + 'c'.repeat(64); }), /Registry mismatch/));
test('a different rollover receipt is rejected', () => assert.throws(() => run(a => { a.cycleDigest = 'different'; }), /different cycle/));
test('unconfirmed receipt is rejected', () => assert.throws(() => run(a => { a.status = 'simulated'; }), /Confirmed planting/));
test('waterReady cannot be edited to bypass the interval', () => assert.throws(() => run(a => { a.waterReadyMs = String(opens - 1); }), /interval mismatch/));
test('mismatching cutoff is rejected', () => assert.throws(() => run(a => { a.cutoffMs = String(cutoff + 1); }), /cutoff mismatch/));
test('invalid Seed object is rejected', () => assert.throws(() => run(a => { a.seedId = '0x123'; }), /Seed identifier/));
test('invalid digest is rejected', () => assert.throws(() => run(a => { a.digest = '0'.repeat(44); }), /transaction digest/));
test('different site cannot be embedded into a calendar', () => assert.throws(() => run((a,b,o) => { o.pageUrl = 'https://example.com/admin/season-four/'; }), /destination/));
test('credentials and query parameters are rejected', () => {
  assert.throws(() => run((a,b,o) => { o.pageUrl = 'https://user@www.treegrow.xyz/admin/season-four/'; }), /destination/);
  assert.throws(() => run((a,b,o) => { o.pageUrl += '?redirect=other'; }), /destination/);
});
test('invalid and unsafe timestamps fail closed', () => {
  for (const n of [NaN, Infinity, 0, -1, Number.MAX_SAFE_INTEGER + 1, '1e12', null, true]) {
    assert.throws(() => run((a,b,o) => { o.nowMs = n; }), /timestamp/);
  }
});
test('does not schedule a backup at or after cutoff', () => {
  const p = run((a,b) => { a.cutoffMs = b.cutoffMs = String(Math.ceil(opens / 60_000) * 60_000 + 900_000); });
  assert.equal(p.reminders.length, 1);
});
test('no event when minute rounding eliminates the window', () => {
  assert.equal(run((a,b) => { a.cutoffMs = b.cutoffMs = String(opens + 100); }).status, 'window-too-short');
});
test('calendar has two UTC events, stable identities, and display alarms', () => {
  const ics = run(null, calendar).replace(/\r\n /g, '');
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length, 2);
  assert.equal((ics.match(/BEGIN:VALARM/g)||[]).length, 2);
  assert.match(ics, /DTSTART:20261117T163700Z/);
  assert.match(ics, /DTSTART:20261117T165200Z/);
  assert.match(ics, /skip if already confirmed/);
});
test('export folds every line to no more than 75 UTF-8 octets', () => {
  const ics = run(null, calendar);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.ok(ics.endsWith('\r\n'));
});
test('DST display follows America/Chicago rather than hardcoded UTC offset', () => {
  const fmt = n => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: false }).format(n);
  const p = run(); assert.equal(fmt(p.reminders[0].atMs), '10:37');
});
test('never claims to authorize a transaction or guarantee notification delivery', () => {
  const p = run(); assert.equal(p.authorizesTransaction, false); assert.equal(p.notificationDeliveryGuaranteed, false);
});
test('inputs stay unchanged and plan collections are frozen', () => {
  const args = fixture(), before = JSON.stringify(args), p = plan(...args);
  assert.equal(JSON.stringify(args), before); assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.reminders));
  assert.ok(Object.isFrozen(p.reminders[0]));
});

test('subsecond windows do not produce zero-duration calendar events', () => {
  const first = Math.ceil(opens / 60_000) * 60_000;
  assert.equal(run((a,b) => { a.cutoffMs = b.cutoffMs = String(first + 500); }).status, 'window-too-short');
});
test('backup ending in the same whole second as cutoff is omitted', () => {
  const first = Math.ceil(opens / 60_000) * 60_000;
  assert.equal(run((a,b) => { a.cutoffMs = b.cutoffMs = String(first + 900_000 + 500); }).reminders.length, 1);
});
test('timestamps outside four-digit calendar years are rejected', () => {
  assert.throws(() => run((a,b,o) => { o.nowMs = 253_402_300_800_000; }), /timestamp/);
});
