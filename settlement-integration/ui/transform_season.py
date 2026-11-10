"""Correct settlement claim wording in the emitted garden-status module.

The same emitted asset can serve both routes: the existing garden retains its
current wording. This changes presentation only, never watering eligibility.
Usage: python settlement-integration/ui/transform_season.py dist/season-status/garden-status.mjs
"""
from pathlib import Path
import sys

ANCHOR = 'function currentView() { return seasonView(snapshot, snapshot ? performance.now()-receivedAt : 0); }'
REPLACEMENT = '''function currentView() {
  const view=seasonView(snapshot,snapshot?performance.now()-receivedAt:0);
  if(window.arb?.getIntegrationStatus?.().protocol!=='settlement')return view;
  let claimText='Reward status unavailable. Open Rewards to refresh each Seed’s reward state.';
  if(view.phase.startsWith('ended')){
    claimText=view.nowMs>view.endMs+604800000
      ?'The fixed seven-day claim window has ended. Open Rewards to review expired or processed Seed rewards.'
      :'Settlement rewards use cutoff eligibility. Gameplay pause does not pause the fixed seven-day claim window. Open Rewards to review each Seed.';
  }else if(view.phase==='active'||view.phase==='paused'){
    claimText='Rewards shown before cutoff are estimates. Gameplay pause does not stop the season clock or extend the later claim deadline.';
  }else if(view.phase==='inactive'||view.phase==='scheduled'){
    claimText='Current-season rewards are not available yet. Open Rewards to review any matching previous-season archive.';
  }
  const readOnly=window.arb?.getIntegrationStatus?.().readOnly===true;
  if(readOnly&&view.phase==='inactive')return {...view,title:'No active season',
    copy:'The rewards system is set up. A new season has not started.',canWater:false,claimText};
  return {...view,canWater:readOnly?false:view.canWater,claimText};
}'''

READ_ANCHOR = 'async function readSnapshot() {'
READ_REPLACEMENT = '''async function readSnapshot() {
  if(window.arb?.getIntegrationStatus?.().protocol==='settlement'){
    // Reuse the typed, checkpoint-bound reader. A failed or mismatched Registry
    // must not leave a second season panel displaying an unverified zero state.
    const api=window.arb,registryId=api.CONTRACT?.REGISTRY_ID;
    const stats=await api.getSeasonStats();
    if(window.arb!==api||stats.protocol!=='settlement'||stats.registryId!==registryId
        ||stats.readOnly!==true||api.CONTRACT?.READ_ONLY!==true
        ||stats.checkpoint==null||!Number.isSafeInteger(stats.nowMs)||stats.nowMs<=0
        ||Date.now()-stats.nowMs>120000||stats.nowMs-Date.now()>15000){
      throw new Error('The New seasons snapshot could not be verified.');
    }
    return validateSnapshot({current_season_id:stats.currentSeasonId,
      season_start_ms:stats.seasonStartMs,paused:stats.paused},stats.nowMs);
  }'''


def transform(source):
    if source.count(ANCHOR) != 1:
        raise ValueError('Unrecognized or already transformed season-status currentView')
    if source.count(READ_ANCHOR) != 1:
        raise ValueError('Unrecognized or already transformed season-status reader')
    return source.replace(ANCHOR, REPLACEMENT, 1).replace(READ_ANCHOR, READ_REPLACEMENT, 1)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    target = Path(sys.argv[1]).resolve()
    protected = Path(__file__).resolve().parents[2] / 'season-status' / 'garden-status.mjs'
    if target == protected:
        raise SystemExit('Only an emitted season-status module may be transformed.')
    target.write_text(transform(target.read_text()))
    print('Updated emitted settlement claim wording: ' + str(target))
