import { validateSnapshot, seasonView, seasonAbortMessage, archiveNote, SEASON_ENDED_MESSAGE } from './model.mjs';

// This module only reads state and opens an existing tab. Never sign or auto-claim.
let snapshot = null, receivedAt = 0, inFlight = null, archive = null, lastPhase = '';
const locked = new Map();
const $ = id => document.getElementById(id);
function text(id, value) { const e=$(id); if(e && e.textContent!==String(value)) e.textContent=String(value); }
function notify(message) {
  if (typeof window.toast === 'function') window.toast(message, 'tw', 10000);
  else text('garden-season-copy', message);
}
function currentView() { return seasonView(snapshot, snapshot ? performance.now()-receivedAt : 0); }
function timeText(ms) {
  if (!ms) return '';
  const date=new Date(ms);
  return `${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'long'}).format(date)} · ${date.toISOString().slice(0,19).replace('T',' ')+' UTC'}`;
}
function unlock(button) {
  const old=locked.get(button);if(!old)return;
  button.disabled=old.disabled;
  if(old.title===null)button.removeAttribute('title');else button.title=old.title;
  button.removeAttribute('data-season-locked');locked.delete(button);
}
function syncWaterButtons(view=currentView()) {
  document.querySelectorAll('button').forEach(button=>{
    const handler=button.getAttribute('onclick')||'';
    const watering=/\bdoWater(?:All|Seed)\s*\(/.test(handler) || (typeof window.doWaterAll==='function' && button.onclick===window.doWaterAll);
    // Existing game buttons can change roles after a refresh or disconnect.
    if(!watering){unlock(button);return;}
    if (!view.canWater) {
      if (!locked.has(button)) locked.set(button,{ disabled:button.disabled, title:button.getAttribute('title') });
      if (!button.disabled) button.disabled=true;
      button.setAttribute('data-season-locked','true');
      button.title=view.phase.startsWith('ended')?'Season ended — watering closed.':view.title;
    } else unlock(button);
  });
  for(const button of locked.keys()) if(!button.isConnected)locked.delete(button);
}
function render() {
  const view=currentView(), panel=$('garden-season-status');
  if(!panel)return;
  panel.dataset.phase=view.phase;
  text('garden-season-title',view.title);
  text('garden-season-copy',view.copy);
  text('garden-season-time-label',view.timeLabel);
  text('garden-season-time',view.timeText);
  text('garden-season-end',view.endMs?`Season cutoff: ${timeText(view.endMs)}`:'');
  text('garden-season-claims',view.claimText);
  text('garden-season-verified',snapshot&&view.phase!=='unknown'?'Timing checked against the Sui network.':'Network status not verified.');
  const note=view.phase!=='unknown'?archiveNote(archive,view.nowMs):null;
  text('garden-season-archive',note?`${note.text} Deadline: ${timeText(note.deadlineMs)}`:'');
  // Do not keep announcing seconds to assistive technologies.
  if(lastPhase!==view.phase){text('garden-season-announcement',view.title);lastPhase=view.phase;}
  syncWaterButtons(view);
}
async function readSnapshot() {
  const contract=window.arb?.CONTRACT;
  if(!contract?.REGISTRY_ID)throw new Error('Game tools are still loading.');
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const query=`query GardenSeasonStatus($registry: SuiAddress!) {
      registry: object(address: $registry) { asMoveObject { contents { json } } }
      clock: object(address: "0x6") { asMoveObject { contents { json } } }
    }`;
    const response=await fetch('https://graphql.mainnet.sui.io/graphql',{
      method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',signal:controller.signal,
      body:JSON.stringify({query,variables:{registry:contract.REGISTRY_ID}})
    });
    if(!response.ok)throw new Error('Season status request failed.');
    const result=await response.json();
    if(result.errors?.length)throw new Error('Season status could not be verified.');
    return validateSnapshot(result.data?.registry?.asMoveObject?.contents?.json,result.data?.clock?.asMoveObject?.contents?.json?.timestamp_ms);
  } finally {clearTimeout(timeout);}
}
async function refresh() {
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    const button=$('garden-season-refresh');if(button)button.disabled=true;
    try {
      snapshot=await readSnapshot();receivedAt=performance.now();render();
      archive=null;
      // Optional archive metadata must never stall the watering preflight.
      const forSnapshot=snapshot;
      if(window.arb?.getConfiguredSeasonArchiveId?.()){
        Promise.resolve().then(()=>window.arb.getSeasonArchive()).then(value=>{
          if(snapshot===forSnapshot){archive=value;render();}
        }).catch(()=>{});
      }
      render();return true;
    }catch(error){snapshot=null;archive=null;render();return false;}
    finally{if(button)button.disabled=false;inFlight=null;}
  })();
  return inFlight;
}
async function canWater() {
  const verified=await refresh();const view=currentView();
  if(!verified||!view.canWater){notify(view.phase.startsWith('ended')?SEASON_ENDED_MESSAGE:view.copy);return false;}
  return true;
}
function explainError(action,error) {
  const message=seasonAbortMessage(error,window.arb?.CONTRACT?.PACKAGE_ID);
  if(message)void refresh();
  return message;
}
function openRewards() {
  if(typeof window.setRewardTab==='function')window.setRewardTab('season');
  else $('reward-tab-season-btn')?.click();
  if(typeof window.doc==='function')window.doc('rewards-sec');
  else location.hash='rewards-sec';
}
window.arbSeasonStatus={refresh,canWater,explainError};
$('garden-season-rewards')?.addEventListener('click',openRewards);
$('garden-season-refresh')?.addEventListener('click',()=>void refresh());
const garden=$('garden-sec');
if(garden)new MutationObserver(()=>syncWaterButtons()).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
render();
if(window.arb)void refresh();else document.addEventListener('wallet-sdk-ready',()=>void refresh(),{once:true});
setInterval(()=>{if(!document.hidden)render();},1000);
setInterval(()=>{if(!document.hidden&&window.arb)void refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(window.arb)void refresh();}});
