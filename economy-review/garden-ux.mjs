/** Gated-preview presentation layer. Uses existing reads and existing user-click actions only. */
import {care, counts, growth, advice, matches, slotOrder, STALE_AFTER_MS, loadedGardenTotals, isEndedView} from './garden-ux-model.mjs';
const bridge=window.arbGardenBridge, $=id=>document.getElementById(id), root=$('garden-sec');
const text=(id,value)=>{const e=$(id);if(e&&e.textContent!==String(value))e.textContent=String(value);};
const make=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content)e.textContent=content;return e;};
let owner=null, serial=0, pending=null, loaded=false, lastSuccess=0, status='disconnected', slots=new Map(), painting=false, disposed=false;
let tools=[],crates=[], loadedTotals=null;
let closedLayout=false;
const originals={};
function view(){return window.arbSeasonStatus?.getView?.()||{phase:'unknown',canWater:false};}
function fresh(){return loaded&&status==='ready'&&performance.now()-lastSuccess<=STALE_AFTER_MS;}
function current(ticket,address){return ticket===serial&&address===owner&&bridge.address()===address;}
function clearPending(){if(pending?.timer)clearTimeout(pending.timer);pending=null;}
function reset(address){clearPending();owner=address;serial++;loaded=false;lastSuccess=0;slots=new Map();status=address?'unloaded':'disconnected';tools=[];crates=[];loadedTotals=null;paint();}
function begin(address){
 if(owner!==address)reset(address);
 if(pending)return null;
 const ticket=++serial;status='loading';
 pending={ticket,timer:setTimeout(()=>{if(current(ticket,address)){serial++;clearPending();status='error';paint();}},20000)};
 paint();return ticket;
}
function accept(ticket,address,seeds){if(current(ticket,address))slots=slotOrder(seeds,slots);}
function complete(ticket,address){if(!current(ticket,address))return;clearPending();loadedTotals=loadedGardenTotals(bridge.seeds(),tools);loaded=true;lastSuccess=performance.now();status='ready';paint();}
function fail(ticket,address){if(!current(ticket,address))return;clearPending();status='error';paint();}
function retry(){void window.arbSeasonStatus?.refresh();void window.refreshGarden();}
function openRewards(){window.setRewardTab?.('season');window.doc?.('rewards-sec');}
function act(kind){
 const a=currentAdvice();
 // Re-evaluate at click time: stale/ended views must not dispatch a care action.
 if(kind!==a.kind){paint();return;}
 if(kind==='connect')window.handleWalletBtn();
 else if(kind==='rewards')openRewards();
 else if(kind==='refresh')retry();
 else if(kind==='wilt')window.applyFilterValue('wilt');
 else if(kind==='dead')window.applyFilterValue('dead');
 else if(kind==='items'){window.setStrategyTab?.('owned');window.doc?.('tools-sec');}
 else if(kind==='plant')window.doPlant();
 else if(kind==='water')void window.doWaterAll();
}
function currentAdvice(){return advice({address:bridge.address(),phase:view().phase,loaded,fresh:fresh(),seeds:bridge.seeds()||[],nowMs:view().nowMs});}
function setAction(id,a){const button=$(id);if(!button)return;text(id,a.action);button.removeAttribute('onclick');button.onclick=()=>act(a.kind);button.disabled=Boolean(pending&&a.kind==='refresh');button.title=a.copy;}
function setup(){
 root.classList.add('garden-ux');
 setupEndedSummary();
 const sync=make('div','garden-sync');sync.id='garden-sync';
 const statusText=make('span');statusText.id='garden-sync-text';statusText.setAttribute('role','status');statusText.setAttribute('aria-live','polite');statusText.setAttribute('aria-atomic','true');
 const refresh=make('button','gbtn','Refresh Garden');refresh.id='garden-sync-refresh';refresh.type='button';refresh.onclick=retry;
 sync.append(statusText,refresh);root.querySelector('.sec-hdr').after(sync);
 const check=$('garden-check');root.insertBefore(check,root.querySelector('.garden-command-layout'));
 const more=make('details','garden-more-actions');more.append(make('summary','','More garden actions'));more.append($('live-actions'));check.after(more);
 text('garden-watered','—');$('garden-watered').nextElementSibling.textContent='Waiting';
 $('garden-ready').nextElementSibling.textContent='Ready now';
 const p=make('div','garden-stat');const n=make('strong','','—');n.id='garden-protected';p.append(n,make('span','','Auto-protected'));$('garden-watered').parentElement.after(p);
 const filter=$('gfilter');const option=make('option','','Ready to water');option.value='ready';filter.append(option);
 filter.setAttribute('aria-label','Filter your Seeds');
 const grid=$('garden-grid');grid.before(root.querySelector('.garden-board-tools'));
 const empty=make('div','garden-filter-empty');empty.id='garden-filter-empty';empty.hidden=true;empty.setAttribute('role','status');
 const msg=make('span');msg.id='garden-filter-message';const show=make('button','gbtn','Show All Seeds');show.type='button';show.onclick=()=>window.applyFilterValue('all');empty.append(msg,show);grid.before(empty);
 const unavailable=make('div','garden-load-placeholder','Connect your wallet to load your garden.');unavailable.id='garden-load-placeholder';grid.before(unavailable);
 // Keep original season IDs and controls, but move secondary content out of the main mobile view.
 const panel=$('garden-season-status'), details=make('details','garden-season-details');details.append(make('summary','','Season details & claim guidance'));
 for(const node of [ $('garden-season-claims'),panel.querySelector('.garden-season-help'),$('garden-season-end'),$('garden-season-verified'),$('garden-season-archive') ])if(node)details.append(node);
 panel.append(details);
 const days=$('garden-next-days');if(days?.parentElement){days.parentElement.replaceChildren(days,document.createTextNode(' progression remaining'));}
 const nav=make('p','garden-mainnet-note','Sui mainnet · Care actions use real transactions. Browsing and refreshing do not require a transaction approval.');sync.after(nav);
 grid.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.empty-slot')){e.preventDefault();e.target.click();}});
 root.addEventListener('click',guardAction,true);
}
function guardAction(event){
 const e=event.target.closest('button,[onclick]');if(!e)return;
 const code=e.getAttribute('onclick')||'';
 const seasonal=/\b(?:doPlant\w*|doWater\w*|doRevive\w*|doResetSeed|doApplyTool|doOpenCrate|handleEmptySeedSlot)\s*\(/.test(code)||e.classList.contains('empty-slot');
 if(seasonal&&(!fresh()||view().phase!=='active')){event.preventDefault();event.stopImmediatePropagation();window.toast?.(currentAdvice().copy,'tw');}
}
function cardStatus(seed,v){
 if(!fresh())return {label:'Refresh needed',hint:'Previously loaded Seed; current status is not verified'};
 if(v.phase!=='active')return {label:v.phase.startsWith('ended')?'Season ended':v.phase==='paused'?'Season paused':'Care unavailable',hint:v.phase.startsWith('ended')?'Watering closed · check Rewards for eligibility':'Refresh the season status before acting'};
 return care(seed,v.nowMs);
}
function decorateGrid(){
 const grid=$('garden-grid');if(!grid)return;
 const seeds=bridge.seeds()||[], byId=new Map(seeds.map(s=>[s.objectId,s]));const v=view();
 const filter=$('gfilter')?.value||'all';
 const show=Boolean(owner&&loaded);grid.hidden=!show;
 const placeholder=$('garden-load-placeholder');placeholder.hidden=show;
 if(!show){placeholder.textContent=!owner?'Connect your wallet to load your garden.':status==='error'?'Unable to load your garden. Counts and empty slots are not confirmed. Use Refresh Garden to retry.':'Loading your garden… Your inventory is not yet confirmed.';}
 let visible=0;const used=new Set(slots.values()), emptyPositions=Array.from({length:8},(_,i)=>i+1).filter(i=>!used.has(i));
 for(const card of grid.querySelectorAll('.gc')){
  const seed=byId.get(card.dataset.seedId);
  if(!seed){
   const number=emptyPositions.shift();card.dataset.gardenSlot=String(number||'');const label=card.querySelector('.gc-slot-label');if(label)label.textContent=`Slot ${number||''}`;
   card.hidden=filter!=='all'||!show||isEndedView(v.phase);card.setAttribute('role','button');card.tabIndex=show&&v.phase==='active'&&fresh()?0:-1;
   const unavailable=v.phase!=='active'||!fresh();
   const copy=card.querySelector('.empty-slot-copy'),cta=card.querySelector('.empty-slot-cta');
   if(copy)copy.textContent=unavailable?'Empty slot. Planting requires an open season and refreshed inventory.':'Mint or use an NFTree to plant here.';
   if(cta)cta.textContent=unavailable?'Planting unavailable':'Unlock / Plant';
   card.setAttribute('aria-disabled',String(unavailable));card.setAttribute('aria-label',`Slot ${number}: empty${v.phase==='active'?' — check NFTree eligibility to plant':' — planting is not open'}`);continue;
  }
  const n=slots.get(seed.objectId);card.dataset.gardenSlot=String(n||'');const label=card.querySelector('.gc-slot-label');if(label)label.textContent=`Slot ${n}`;
  const isMatch=matches(seed,filter,v.nowMs);card.hidden=!show||!isMatch;if(isMatch)visible++;
  const state=cardStatus(seed,v), stage=growth(seed);const set=(sel,value)=>{const e=card.querySelector(sel);if(e&&e.textContent!==value)e.textContent=value;};
  set('.gc-status',state.label);set('.gc-status-hint',state.hint||'');set('.gc-stage-next',stage.next);
  card.title=isEndedView(v.phase)?`Slot ${n} · Loaded ${stage.label} appearance. Growing period closed; displayed GP and streak are not a finalized reward calculation.`:`Slot ${n} · ${stage.label} · ${stage.requirement}. Visual progression does not determine reward eligibility.`;
  const statusEl=card.querySelector('.gc-status');if(statusEl)statusEl.className=`gc-status ${state.kind==='ready'?'ready':state.kind==='dead'?'danger':state.wilting?'warn':'done'}`;
  for(const b of card.querySelectorAll('.gc-actions button')){
   const water=/\bdoWaterSeed\(/.test(b.getAttribute('onclick')||'');
   b.disabled=!fresh()||v.phase!=='active'||(water&&care(seed,v.nowMs).kind!=='ready');
   b.title=state.hint||state.label;
   if(water)b.textContent=v.phase.startsWith('ended')?'Watering closed':state.kind==='protected'?'Auto-protected':state.kind==='waiting'?'Waiting':state.kind==='ready'?'Water Seed':'Water unavailable';
  }
 }
 // Sort actual full inventory positions; filtered cards remain hidden in their original identity.
 const ordered=[...grid.querySelectorAll('.gc')].sort((a,b)=>Number(a.dataset.gardenSlot)-Number(b.dataset.gardenSlot));
 if(ordered.some((c,i)=>grid.children[i]!==c))for(const card of ordered)grid.append(card);
 const empty=$('garden-filter-empty');empty.hidden=!show||filter==='all'||visible>0;
 if(!empty.hidden){const name={wilt:'wilting',dead:'dead',ready:'ready-to-water'}[filter]||'matching';text('garden-filter-message',seeds.length?`No ${name} Seeds in this loaded view. Other Seeds are hidden by the filter—not empty planting slots.`:'Your loaded garden has no Seeds. Show all slots to review planting availability.');}
}
function paintReminder(seeds,v){
 const wrap=$('daily-reminder');wrap.classList.toggle('show',Boolean(owner));bridge.clearCountdown();
 const active=owner&&fresh()&&v.phase==='active';
 const cs=seeds.map(s=>care(s,v.nowMs));const ready=cs.filter(s=>s.kind==='ready');
 const future=cs.filter(s=>['waiting','protected'].includes(s.kind)&&s.at>v.nowMs).sort((a,b)=>a.at-b.at)[0];
 const at=active?(ready.length?v.nowMs:future?.at||null):null;
 const copy=!active?currentAdvice().copy:ready.length?`${ready.length} Seeds ready for manual watering.`:future?future.kind==='protected'?'Next check: auto-water protection expires. Refresh before choosing your next action.':'Next manual watering window. Keep an eye on the individual Seed timers.':'No watering time is available yet.';
 text('daily-reminder-copy',copy);text('daily-reminder-time',active?(ready.length?'Ready now':future?.hint?.replace(/^.*?: /,'')||'Not scheduled'):'Not scheduled');
 text('daily-reminder-risk',!active?'Care unavailable':ready.length?'Ready':future?.kind==='protected'?'Auto-protected':'Waiting');
 bridge.reminder({at,text:copy,status:active?'Garden care':'Not scheduled'});
 for(const b of wrap.querySelectorAll('button'))b.disabled=!at;
}
function paintGrowth(seeds,v,a){
 const wrap=$('garden-next-growth');wrap.classList.add('show');
 const alive=seeds.filter(s=>s.state!=='dead').map(seed=>({seed,stage:growth(seed)})).sort((a,b)=>a.stage.daysToNext-b.stage.daysToNext);
 const best=alive[0];
 if(!owner||!loaded||v.phase!=='active'||!fresh()||!best){
  text('garden-next-growth-title',a.title);text('garden-next-growth-copy',a.copy);
  text('garden-next-growth-score','Visual growth, the growing period, and reward eligibility are separate. Review Rewards for eligibility.');text('garden-next-stage','—');text('garden-next-days','—');text('garden-next-gp',loaded?seeds.reduce((n,s)=>n+Number(s.growthPoints||0),0).toLocaleString():'—');
 }else{
  const {seed,stage}=best;
  text('garden-next-growth-title',stage.daysToNext?`Slot ${slots.get(seed.objectId)} · Progress toward ${stage.nextStage}`:`Slot ${slots.get(seed.objectId)} · Final visual milestone`);
  text('garden-next-growth-copy',`Next visual requirement: ${stage.requirement}.`);
  text('garden-next-growth-score','Progress uses the greater of streak days or whole Growth Points ÷ 25. This is not a countdown, a promised completion date, or claim eligibility.');
  text('garden-next-stage',stage.nextStage);text('garden-next-days',stage.daysToNext?`${stage.daysToNext} score step${stage.daysToNext===1?'':'s'}`:'Complete');text('garden-next-gp',Number(seed.growthPoints||0).toLocaleString());
 }
 setAction('garden-next-growth-action',a);
}
/** A compact ended-season presentation of the last successfully loaded inventory.
 * This code only formats existing state and changes visibility. It cannot claim,
 * purchase, start a season, or convert the loaded totals into final results.
 */
function setupEndedSummary(){
 const summary=make('section','garden-ended-summary');summary.id='garden-ended-summary';summary.hidden=true;
 summary.setAttribute('aria-label','Loaded garden summary');
 const metrics=make('dl','garden-ended-metrics');
 for(const [key,label]of [['seeds','Seeds loaded'],['growthPoints','Loaded Growth Points'],['items','Arborist Items'],['care','Garden care']]){
  const cell=make('div','garden-ended-metric');const term=make('dt','',label),value=make('dd','','—');value.id='garden-ended-'+key;cell.append(term,value);
  if(key==='items'){const uses=make('span','garden-ended-uses','Uses unavailable');uses.id='garden-ended-uses';cell.append(uses);}
  metrics.append(cell);
 }
 const note=make('p','garden-ended-note');note.id='garden-ended-note';summary.append(metrics,note);$('garden-check').append(summary);
 const unused=make('div','garden-ended-unused');unused.id='garden-ended-unused';unused.hidden=true;
 const title=make('p');title.id='garden-ended-unused-title';
 const list=make('ul','garden-ended-slot-list');list.setAttribute('aria-label','Unused display slots');
 for(let n=1;n<=8;n++){const li=make('li','',`Slot ${n}`);li.dataset.endedSlot=String(n);list.append(li);}
 unused.append(title,list);$('garden-grid').after(unused);
 originals.focusTitle=$('garden-check').querySelector('.garden-focus>strong').textContent;
 originals.plantingCopy=root.querySelector('.garden-slots-copy').textContent;
}
function paintEndedSummary(seeds,v){
 const ended=isEndedView(v.phase);root.dataset.uxEnded=String(ended);
 const summary=$('garden-ended-summary');summary.hidden=!ended;
 for(const stat of $('garden-check').querySelectorAll(':scope>.garden-stat'))stat.hidden=ended;
 const rail=root.querySelector('.garden-daily-rail');rail.hidden=ended;
 // Keep the original panels for active/paused/unknown states; remove only the
 // duplicate ended-season prompts. Existing guards still disable every action.
 $('garden-next-growth').hidden=ended;
 const focus=$('garden-check').querySelector('.garden-focus>strong');
 focus.textContent=ended&&owner?'Growing period complete':originals.focusTitle;
 if(ended&&owner)text('garden-focus-copy',v.phase==='ended-paused'
  ?'The growing period is closed. Current-season claims are paused; check Rewards for status and any eligible archived claims.'
  :'Planting and watering are closed for this season. Review Rewards for eligibility and any available claims.');
 const copy=root.querySelector('.garden-slots-copy');
 copy.textContent=ended?'Loaded Seed artwork, Growth Points and streaks. These are not finalized season results.':originals.plantingCopy;
 const format=value=>value===null||value===undefined?'—':BigInt(value).toLocaleString();
 const totals=owner&&loaded?loadedTotals:null;
 for(const key of ['seeds','growthPoints','items'])text('garden-ended-'+key,format(totals?.[key]));
 text('garden-ended-uses',totals?.uses===null||totals?.uses===undefined?'Uses unavailable':`${format(totals.uses)} uses remaining`);
 text('garden-ended-care',v.phase==='ended-paused'?'Closed · claims paused':'Closed');
 const note=!owner?'Connect your wallet to load this summary.':!loaded
  ?'Inventory has not loaded. Counts are not confirmed.':!fresh()
  ?'Previously loaded inventory — refresh needed. Not final season results or confirmed claim amounts.'
  :'Latest loaded inventory — not final season results or confirmed claim amounts.';
 text('garden-ended-note',note);summary.dataset.inventory=totals?(fresh()?'loaded':'previous'):'unavailable';
 const unused=$('garden-ended-unused'),used=new Set(slots.values());
 const positions=Array.from({length:8},(_,i)=>i+1).filter(n=>!used.has(n));
 unused.hidden=!ended||!owner||!loaded||$('gfilter').value!=='all'||!positions.length;
 text('garden-ended-unused-title',`${positions.length} unused display slot${positions.length===1?'':'s'} · Planting is closed for this season.`);
 for(const li of unused.querySelectorAll('li'))li.hidden=used.has(Number(li.dataset.endedSlot));
 // Compact cards reflect the full, admitted inventory; filtering never changes
 // identity or manufactures an open planting position.
 const n=root.querySelectorAll('#garden-grid [data-seed-id]').length;
 root.style.setProperty('--ended-columns',String(Math.max(1,Math.min(4,n))));
 if(ended&&!closedLayout&&document.activeElement?.closest('.garden-daily-rail,.gc-actions,#garden-next-growth,#garden-season-rewards')){
  $('garden-primary-action').focus({preventScroll:true});
 }
 closedLayout=ended;
}
function paint(){
 if(!root||!bridge||painting||disposed)return;painting=true;
 try{
  if(owner!==bridge.address()){reset(bridge.address());}
  const v=view(),seeds=bridge.seeds()||[],a=currentAdvice(),live=Boolean(owner&&loaded&&fresh()&&v.phase==='active');
  root.dataset.uxPhase=v.phase;root.dataset.uxReady=String(live);
  const minutes=Math.floor((performance.now()-lastSuccess)/60000);
  const label=!owner?'Connect your wallet to load your garden.':status==='loading'?(loaded?'Refreshing your garden… Showing the last loaded inventory.':'Loading your garden…'):status==='error'?(loaded?'Couldn’t refresh. Showing previously loaded information. Retry before acting.':'Unable to load your garden. Retry; this is not a confirmed empty garden.'):!fresh()?'Garden information needs a refresh.':minutes?`Garden inventory updated ${minutes}m ago.`:'Garden inventory updated just now.';
  text('garden-sync-text',label);$('garden-sync').dataset.status=status==='ready'&&!fresh()?'stale':status;
  $('garden-sync-refresh').disabled=Boolean(pending)||!owner;$('garden-grid').setAttribute('aria-busy',String(Boolean(pending)));
  const c=owner&&loaded?counts(seeds,v.nowMs):null;
  for(const [id,key]of [['garden-ready','ready'],['garden-watered','waiting'],['garden-protected','protected'],['garden-wilting','wilting'],['garden-dead','dead']])text(id,c&&fresh()&&v.phase==='active'?c[key]:'—');
  if(!loaded)for(const id of ['g-gp','g-wilt','g-dead'])text(id,'—');
  text('garden-focus-copy',a.copy);setAction('garden-primary-action',a);
  text('next-move-title',a.title);text('next-move-copy',a.copy);text('next-move-detail',a.copy);text('next-move-badge',v.phase==='active'?'Garden care':'Season status');setAction('next-move-action',a);
  paintReminder(seeds,v);paintGrowth(seeds,v,a);decorateGrid();paintEndedSummary(seeds,v);
  const water=$('btn-water-all');if(water){text('btn-water-all',live?`Water Ready Seeds · ${c?.ready||0}`:'Watering unavailable');water.disabled=!live||!c?.ready;}
  for(const b of root.querySelectorAll('#live-actions button,#garden-items-nudge button,#garden-slot-nudge button')){
   if(/\b(?:doPlant\w*|doApplyTool|doOpenCrate)\(/.test(b.getAttribute('onclick')||'')){
    if(!live){if(!b.hasAttribute('data-ux-disabled'))b.dataset.uxDisabled=String(b.disabled);b.disabled=true;}
    else if(b.hasAttribute('data-ux-disabled')){b.disabled=b.dataset.uxDisabled==='true';delete b.dataset.uxDisabled;}
   }
  }
  // Recommendations outside an open, loaded growing period are replaced, not merely grayed out.
  for(const e of root.querySelectorAll('.garden-buy-crates-banner,.garden-support-utility,.daily-goals'))e.hidden=!live;
  text('garden-items-copy',!live?'Browse owned items. Applying items and opening crates are not part of this closed/unverified garden view.':`${tools.length} item objects and ${crates.length} unopened crates in the loaded inventory.`);
 }finally{painting=false;}
}
if(bridge&&root){
 setup();
 window.arbGardenUX={begin,current,accept,complete,fail,reset,slot:id=>slots.get(id),paint};
 for(const name of ['renderGarden','updateDailyGardenCheck','updateGardenNextGrowth','updateGardenReminder','updateNextMovePanel','renderDailyGoals','renderGardenItemsNudge','renderGardenCrateNudge']){
  if(typeof window[name]!=='function')continue;
  originals[name]=window[name];
  window[name]=function(...args){
   if(name==='renderGardenItemsNudge'){tools=args[0]||[];crates=args[2]||[];}
   const result=originals[name].apply(this,args);paint();return result;
  };
 }
 originals.seedGrowthStage=window.seedGrowthStage;window.seedGrowthStage=growth;
 document.addEventListener('arboretum:season-view',paint);
 document.addEventListener('visibilitychange',paint);
 reset(bridge.address());
 if(bridge.address())void window.refreshGarden();
 window.addEventListener('pagehide',()=>{disposed=true;clearPending();document.removeEventListener('arboretum:season-view',paint);document.removeEventListener('visibilitychange',paint);},{once:true});
}
