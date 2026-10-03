/** Presentation-only models. No network, wallet, storage or transaction access. */
export const WATER_READY_MS = 77_760_000;
export const STALE_AFTER_MS = 120_000;
export const STAGES = [
  ['First Planting','Seedling','first-planting','planted',0],
  ['Taking Root','Rooted','taking-root','rooted',3],
  ['First Growth Ring','Growth Ring','first-ring','ring',7],
  ['Branching Out','Branching','branching','branch',14],
  ['Canopy Rise','Canopy','canopy','canopy',21],
  ['Ancient Growth','Ancient','ancient','ancient',25],
  ['Season Harvest','Harvest','harvest','harvest',30],
];
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
export function duration(ms) {
  if (!finite(ms) || ms < 0) return 'Unavailable';
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${rest}m` : `${minutes}m`;
}
export function care(seed, now) {
  if (!seed) return {kind:'unknown', label:'Status unavailable'};
  if (seed.state === 'dead' || seed.rawState === 2) return {kind:'dead', label:'Dead', hint:'Review recovery options'};
  if (!finite(now) || now <= 0) return {kind:'unknown', label:'Check timing', hint:'Refresh the season status'};
  if (finite(seed.bottomlessExpiry) && seed.bottomlessExpiry > now) return {kind:'protected', label:'Auto-protected', hint:`Protection: ${duration(seed.bottomlessExpiry-now)} left`, at:Number(seed.bottomlessExpiry)};
  if (!finite(seed.lastWatered) || seed.lastWatered <= 0 || seed.lastWatered > now) return {kind:'unknown',label:'Check timing',hint:'Watering time unavailable; refresh'};
  const at = Number(seed.lastWatered) + WATER_READY_MS;
  const wilt = seed.state === 'wilting' || seed.rawState === 1;
  return at <= now ? {kind:'ready',label:wilt?'Wilting · water ready':'Ready to water',hint:'Manual watering window is open',wilting:wilt,at}
    : {kind:'waiting',label:wilt?'Wilting · waiting':'Waiting',hint:`Next watering in ${duration(at-now)}`,wilting:wilt,at};
}
export function counts(seeds, now) {
  const out = {ready:0,waiting:0,protected:0,wilting:0,dead:0,unknown:0};
  for (const seed of seeds) { const s=care(seed,now);out[s.kind]++;if(s.wilting)out.wilting++; }
  return out;
}
export function matches(seed, filter, now) {
  const c=care(seed,now);
  return filter==='all' || (filter==='wilt' && c.wilting) || (filter==='dead' && c.kind==='dead') || (filter==='ready' && c.kind==='ready');
}
export function growth(seed={}) {
  if(!seed || seed.state==='dead')return {label:seed?'Dead':'Empty',short:seed?'Dead':'Empty',cls:seed?'dead':'empty',art:'planted',progress:0,next:seed?'Review recovery options':'Plant during an open season',requirement:seed?'Recovery required':'No Seed',daysToNext:0,nextStage:'—'};
  const streak=Math.max(0,Number(seed.streak)||0), gp=Math.max(0,Number(seed.growthPoints)||0);
  const score=Math.max(streak,Math.floor(gp/25));
  let index=0;for(let i=1;i<STAGES.length;i++)if(score>=STAGES[i][4])index=i;
  const [label,short,cls,art,at]=STAGES[index], next=STAGES[index+1];
  const requirement=next?`${next[4]} streak days OR ${next[4]*25} GP`:'Final visual milestone reached';
  return {label,short,cls,art,at,score,progress:next?Math.min(100,(score-at)/(next[4]-at)*100):100,
    next:next?`Next: ${next[0]} · ${requirement}`:'Visual milestone complete · check Rewards for eligibility',
    nextLabel:next?.[0]||'Visual milestone complete',nextStage:next?.[0]||'Season Harvest',
    nextAt:next?.[4]||30,daysToNext:next?Math.max(1,next[4]-score):0,requirement};
}
export function advice({address,phase='unknown',loaded=false,fresh=false,seeds=[],nowMs}) {
  if(!address)return {kind:'connect',title:'Connect your wallet',copy:'Load your garden before choosing a care action.',action:'Connect Wallet'};
  if(phase.startsWith('ended'))return {kind:'rewards',title:'Growing period complete',copy:'Watering is closed. Review your season rewards and eligibility; availability is not guaranteed.',action:'View Season Rewards'};
  if(phase==='inactive'||phase==='scheduled')return {kind:'rewards',title:'Waiting for a growing season',copy:'There is no open growing period yet. Review previous-season rewards or browse your items.',action:'View Season Rewards'};
  if(phase==='paused')return {kind:'refresh',title:'Season paused',copy:'Care actions are paused. Refresh the status or review your rewards.',action:'Refresh Status'};
  if(phase!=='active')return {kind:'refresh',title:'Verify the season first',copy:'Season status is unavailable. Refresh before choosing a care action.',action:'Refresh Status'};
  if(!loaded||!fresh)return {kind:'refresh',title:'Refresh your garden',copy:loaded?'Showing previously loaded information. Refresh before acting.':'Your garden has not loaded yet. Empty slots and counts are not confirmed.',action:'Refresh Garden'};
  const c=counts(seeds,nowMs);
  if(!seeds.length)return {kind:'plant',title:'Plant your first Seed',copy:'Use an eligible NFTree to start your growing-season path. Review the wallet request before approving.',action:'Plant Seed'};
  if(c.wilting)return {kind:'wilt',title:'Care for wilting Seeds first',copy:`${c.wilting} wilting Seed${c.wilting===1?'':'s'} need attention before reviewing dead Seeds.`,action:'Review Wilting Seeds'};
  if(c.ready)return {kind:'water',title:'Ready for daily care',copy:`${c.ready} Seed${c.ready===1?' is':'s are'} ready for manual watering. Auto-protected and waiting Seeds are excluded.`,action:`Water Ready Seeds · ${c.ready}`};
  if(c.dead)return {kind:'dead',title:'Review dead Seeds',copy:'Review the available recovery options. Resetting and item use may consume assets.',action:'Review Dead Seeds'};
  if(c.unknown)return {kind:'refresh',title:'Some timing is unavailable',copy:'Refresh to check incomplete watering information; it is not treated as ready.',action:'Refresh Garden'};
  return {kind:'items',title:'Your garden is covered for now',copy:`Waiting: ${c.waiting} · Auto-protected: ${c.protected}. Watch the timers before the next care action.`,action:'Review My Items'};
}
/** Stable, browser-session display positions. These are not claimed to be on-chain slot IDs. */
export function slotOrder(seeds, previous=new Map()) {
  const ids=new Set(seeds.map(s=>s.objectId));
  const slots=new Map([...previous].filter(([id,n])=>ids.has(id)&&n>=1&&n<=8));
  for(const s of seeds)if(!slots.has(s.objectId)){
    const used=new Set(slots.values());const n=Array.from({length:8},(_,i)=>i+1).find(x=>!used.has(x));
    if(n)slots.set(s.objectId,n);
  }
  return slots;
}
