// Read-only presentation of the existing mainnet season rules. No transactions.
export const SEASON_DURATION_MS = 2_592_000_000;
export const MAX_SNAPSHOT_AGE_MS = 120_000;
export const SEASON_ENDED_MESSAGE = 'This season has ended. Watering is closed. Open Rewards → Monthly Pool to check your season rewards and claim eligibility.';
const uint = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;

export function validateSnapshot(registry, clockMs) {
  if (!registry || !uint(registry.current_season_id) || !uint(registry.season_start_ms) ||
      typeof registry.paused !== 'boolean' || !uint(clockMs) || Number(clockMs) <= 0) {
    throw new Error('Season status could not be verified.');
  }
  return { registry, chainNowMs: Number(clockMs) };
}

export function seasonView(snapshot, ageMs = 0) {
  if (!snapshot || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_SNAPSHOT_AGE_MS) {
    return { phase: 'unknown', title: 'Season status unavailable', canWater: false,
      copy: 'Refresh to check the season. Watering is temporarily disabled in this view until the status is verified.',
      timeLabel: 'Season timing', timeText: 'Awaiting network confirmation', endMs: 0,
      claimText: 'Open Rewards to review your season and any previous-season rewards.' };
  }
  const { registry: r, chainNowMs } = validateSnapshot(snapshot.registry, snapshot.chainNowMs);
  const now = chainNowMs + ageMs;
  const start = Number(r.season_start_ms), id = Number(r.current_season_id);
  const end = start > 0 ? start + SEASON_DURATION_MS : 0;
  let view;
  if (!start) {
    view = { phase: 'inactive', title: 'No active growing season', canWater: false,
      copy: 'The next growing season has not started. Previous-season rewards are separate from the next season.',
      claimText: 'Open Rewards → Monthly Pool to check previous-season claims. An archive may need to be configured before it is visible here.' };
  } else if (now >= end) {
    view = { phase: r.paused ? 'ended-paused' : 'ended', title: `Season ${id} ended`, canWater: false,
      copy: 'The growing period is over. Watering is closed for this season.',
      claimText: r.paused ? 'Current-season claims are paused. Check Rewards for updates; archived claims have their own rules.' :
        'Open Rewards → Monthly Pool to check your eligible Seeds and claim available rewards.' };
  } else if (now < start) {
    view = { phase: 'scheduled', title: `Season ${id} has not started`, canWater: false,
      copy: 'Wait for the season to start before watering.', claimText: 'Season rewards follow the end of the growing period.' };
  } else {
    view = { phase: r.paused ? 'paused' : 'active', title: r.paused ? `Season ${id} paused` : `Season ${id} is growing`, canWater: !r.paused,
      copy: r.paused ? 'Watering is paused. The season clock continues to run.' : 'Care for your Seeds before the season closes. Use tools before the watering you want to boost.',
      claimText: 'This season’s rewards unlock after the growing period. Check Rewards for your projected share.' };
  }
  const activeClock = start > 0 && now < end;
  return { ...view, id, endMs: end, nowMs: now,
    remainingMs: activeClock ? Math.max(0, end - now) : 0,
    timeLabel: activeClock ? 'Season closes in' : end ? 'Growing period closed' : 'Season timing',
    timeText: activeClock ? countdown(end - now) : end ? 'Watering closed' : 'Waiting for the next season' };
}

export function countdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 86400)}d ${String(Math.floor(seconds % 86400 / 3600)).padStart(2,'0')}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2,'0')}m ${String(seconds % 60).padStart(2,'0')}s`;
}

// Abort 6 is reused by claim_reward before the end: require the exact function too.
export function seasonAbortMessage(error, packageId) {
  const text = String(error?.message ?? error ?? '');
  if (!packageId || !text.toLowerCase().includes(packageId.toLowerCase()) ||
      !text.includes('::arboretum::assert_season_active') ||
      !/MoveAbort/i.test(text) || !/abort\s+code\s*:\s*6(?:\D|$)/i.test(text)) return null;
  return SEASON_ENDED_MESSAGE;
}

export function archiveNote(archive, nowMs) {
  if (!uint(nowMs) || !archive || !uint(archive.seasonId) || !uint(archive.claimDeadlineMs) || !Number(archive.claimDeadlineMs)) return null;
  if (archive.swept || nowMs > Number(archive.claimDeadlineMs)) return { open: false, text: `Season ${archive.seasonId} archive claim window is closed.`, deadlineMs: Number(archive.claimDeadlineMs) };
  return { open: true, text: `Season ${archive.seasonId} archive claim window is open, subject to Seed eligibility.`, deadlineMs: Number(archive.claimDeadlineMs) };
}
