/** Review-only reward presentation. Reads wallet APIs; never signs or submits. */
const PROTOCOLS = new Set(['legacy', 'settlement']);
const ROUTE_PATHS = {legacy:'/game.html', settlement:'/settlement-game.html'};
const MIST_PER_SUI = 1_000_000_000n;
const MAX_AGE_MS = 120_000;

function uint(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
}

/** Missing and invalid values remain null; 0n renders as an explicit zero. */
export function formatMist(value) {
  const amount=uint(value);
  if(amount===null)return null;
  const fraction=(amount%MIST_PER_SUI).toString().padStart(9,'0').replace(/0+$/,'');
  return `${(amount/MIST_PER_SUI).toLocaleString('en-US')}${fraction?'.'+fraction:''} SUI`;
}
const points=value=>uint(value)?.toLocaleString('en-US')??'Unavailable';
const unavailable=reason=>({status:'unknown',label:'Unavailable',amountLabel:'Reward amount',amount:'Unavailable',
  reason:reason||'The reward state could not be verified. Refresh to try again.',action:null});

/** Trust explicit reward states and validated amounts, never raw cleared GP. */
export function rewardPresentation(reward, protocol) {
  if(protocol==='legacy')return {status:'legacy',label:'Under review',amountLabel:'Existing-season reward',
    amount:'Under review',reason:'Existing-season rewards are being reconciled. An approved transition decision is needed before an amount can be presented.',action:null};
  if(protocol!=='settlement'||!reward||typeof reward!=='object')return unavailable();
  const amount=uint(reward.amountMist);
  const common={status:reward.status,amountLabel:'Reward amount',amount:'Unavailable',reason:reward.reason||'',action:null};
  switch(reward.status){
    case 'processed':return {...common,label:'Processed',reason:reward.reason||'The matching receipt is needed to verify how much was paid.'};
    case 'paid':
      if(amount===null||amount===0n||uint(reward.paidMist)!==amount)return unavailable('The matching payment receipt is unavailable.');
      return {...common,label:'Reward paid',amountLabel:'Receipt-confirmed payment',amount:formatMist(amount)};
    case 'processed_zero':
      if(amount!==0n||uint(reward.paidMist)!==0n)return unavailable('The matching zero-value receipt is unavailable.');
      return {...common,label:'Processed · zero reward',amountLabel:'Receipt-confirmed payment',amount:formatMist(0n),reason:'The matching receipt confirms that this Seed was processed with no SUI payment.'};
    case 'claimable':
      if(amount===null||amount===0n||reward.claimable!==true||reward.processable!==true)return unavailable('Reward eligibility or its amount could not be verified.');
      return {...common,label:'Reward available',amountLabel:'Cutoff reward',amount:formatMist(amount),action:'Review reward',
        reason:reward.reason||'The cutoff allocation is fixed. This review build does not submit the claim.'};
    case 'zero_entitlement':
      if(amount!==0n||reward.claimable!==false||reward.processable!==true)return unavailable('The zero-value entitlement could not be verified.');
      return {...common,label:'Zero reward',amountLabel:'Cutoff reward',amount:formatMist(0n),action:'Review zero-value processing',
        reason:'This Seed has a verified zero-value entitlement. It can be recorded as processed, with no SUI payment; processing is disabled in this review build.'};
    case 'estimate':
      if(amount===null||reward.estimated!==true)return unavailable('The current estimate could not be verified.');
      return {...common,label:'Estimate · before cutoff',amountLabel:'Current estimate',amount:formatMist(amount),
        reason:reward.reason||'Care, eligibility, and funding can change until cutoff. This is not a fixed entitlement.'};
    case 'expired':
      return {...common,label:'Claim window closed',amountLabel:'Expired allocation',amount:formatMist(reward.entitlementMist)||'Unavailable',
        reason:reward.reason||'The fixed claim deadline has passed. This allocation is no longer available to claim.'};
    case 'inactive':return {...common,label:'No active season',amount:'Not available',reason:'The current growing season has not been activated.'};
    case 'scheduled':return {...common,label:'Season not started',amount:'Not available',reason:'This season has not reached its start time.'};
    default:return unavailable(reward.reason);
  }
}

export function validateRewardOptions(value, protocol) {
  if(!PROTOCOLS.has(protocol)||!value||value.protocol!==protocol||!Array.isArray(value.entries)
      ||uint(value.checkpoint)===null||uint(value.nowMs)===null||uint(value.nowMs)===0n){
    throw Error('The selected garden reward snapshot is incomplete.');
  }
  const seen=new Set();
  for(const entry of value.entries){
    const id=entry?.seed?.objectId;
    if(typeof id!=='string'||!/^0x[0-9a-f]{64}$/i.test(id)||seen.has(id.toLowerCase())){
      throw Error('The owned Seed inventory is missing an identity or contains duplicate records.');
    }
    seen.add(id.toLowerCase());
  }
  return value;
}

/** Only completed, current reads from the selected read-only Registry render totals. */
export function registryPresentation(value, expectedRegistryId, {now=Date.now(),maxAgeMs=MAX_AGE_MS}={}) {
  const address=/^0x[0-9a-f]{64}$/i;
  if(!address.test(expectedRegistryId||'')||!value||value.protocol!=='settlement'||value.readOnly!==true
      ||typeof value.registryId!=='string'||value.registryId.toLowerCase()!==expectedRegistryId.toLowerCase()){
    throw Error('The selected New seasons Registry could not be verified.');
  }
  const names=['checkpoint','nowMs','currentSeasonId','seasonStartMs','seasonEndMs','totalSeeds','totalGrowthPoints','remainingPoolMist','treasuryMist'];
  const fields=Object.fromEntries(names.map(name=>[name,uint(value[name])]));
  if(Object.values(fields).some(amount=>amount===null)||fields.nowMs===0n||fields.nowMs>BigInt(Number.MAX_SAFE_INTEGER)
      ||typeof value.paused!=='boolean')throw Error('The Registry snapshot is incomplete. No totals have been assumed.');
  const chainTime=Number(fields.nowMs);
  if(!Number.isFinite(now)||!Number.isFinite(maxAgeMs)||maxAgeMs<0||now-chainTime>maxAgeMs||chainTime-now>15_000){
    throw Error('This Registry snapshot is no longer current. Refresh to read the network again.');
  }
  const start=fields.seasonStartMs,end=fields.seasonEndMs;
  if((start===0n&&end!==0n)||(start>0n&&end<=start))throw Error('The Registry season timing is inconsistent.');
  let status,title,copy;
  if(start===0n){
    status='inactive';title='No active season';
    copy='The rewards system is set up. A new season has not started.';
  }else if(fields.nowMs<start){
    status='scheduled';title=`Season ${fields.currentSeasonId} has not started`;
    copy='The configured season start is still ahead. This page is available for read-only review.';
  }else if(fields.nowMs>=end){
    status='ended';title=`Season ${fields.currentSeasonId} ended`;
    copy='The growing period has ended. Open Rewards to review owned Seeds and their recorded reward state.';
  }else{
    status=value.paused?'paused':'active';title=`Season ${fields.currentSeasonId} ${value.paused?'paused':'is growing'}`;
    copy='This page shows the recorded season state. Transactions remain disabled in this review.';
  }
  return Object.freeze({status,title,copy,registryId:expectedRegistryId,checkpoint:fields.checkpoint.toString(),nowMs:chainTime,
    time:new Date(chainTime).toISOString().replace('T',' ').replace('Z',' UTC'),
    pool:formatMist(fields.remainingPoolMist),treasury:formatMist(fields.treasuryMist),
    seeds:points(fields.totalSeeds),growthPoints:points(fields.totalGrowthPoints),
    gardenTitle:fields.totalSeeds===0n?'The new garden is empty':'Seeds are recorded in this garden',
    gardenCopy:fields.totalSeeds===0n
      ?'The verified Registry contains no planted Seeds. Your existing garden and its history are available through Existing garden above.'
      :'Connect a wallet and open Rewards to review its owned Seeds. The existing garden has a separate history.'});
}

/** Public read controller: deliberately does not access any wallet or transaction API. */
export function createRegistryReview({document:doc,getApi,now=Date.now,timeoutMs=25_000}={}) {
  const panel=doc?.getElementById('sr-registry');
  if(!panel)return null;
  const $=id=>doc.getElementById(id);
  const text=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
  let snapshot=null,receivedAt=0,inFlight=null;
  function configuration(){
    const api=getApi?.(),status=api?.getIntegrationStatus?.();
    if(!api||status?.protocol!=='settlement'||status.reviewOnly!==true||status.readOnly!==true
        ||api.CONTRACT?.READ_ONLY!==true||typeof api.getSeasonStats!=='function'
        ||!/^0x[0-9a-f]{64}$/i.test(api.CONTRACT.REGISTRY_ID||'')){
      throw Error('The read-only New seasons configuration is not available yet.');
    }
    return {api,registryId:api.CONTRACT.REGISTRY_ID};
  }
  function clear(status,message){
    snapshot=null;receivedAt=0;panel.dataset.state=status;
    const loading=status==='loading';
    text('sr-registry-title',loading?'Checking the new garden':'Season status unavailable');
    text('sr-registry-copy',message);
    for(const id of ['pool','treasury','seeds','gp'])text('sr-registry-'+id,loading?'Checking…':'Unavailable');
    text('sr-registry-checkpoint','Unavailable');text('sr-registry-time','Unavailable');text('sr-registry-id','Unavailable');
    text('sr-garden-title',loading?'Checking the garden':'Garden state unavailable');
    text('sr-garden-copy',loading?'Reading the Registry on Sui mainnet. You do not need to connect a wallet.':'The garden has not been confirmed empty. Refresh to verify its state.');
    if($('sr-registry-evidence'))$('sr-registry-evidence').hidden=true;
  }
  function render(view){
    snapshot=view;receivedAt=now();panel.dataset.state=view.status;
    for(const [key,value]of Object.entries({title:view.title,copy:view.copy,pool:view.pool,treasury:view.treasury,
      seeds:view.seeds,gp:view.growthPoints,checkpoint:view.checkpoint,time:view.time,id:view.registryId}))text('sr-registry-'+key,value);
    text('sr-garden-title',view.gardenTitle);text('sr-garden-copy',view.gardenCopy);
    if($('sr-registry-evidence'))$('sr-registry-evidence').hidden=false;
  }
  async function refresh(){
    if(inFlight)return inFlight;
    clear('loading','Reading the selected Registry and network clock at one checkpoint.');
    const button=$('sr-registry-refresh');if(button)button.disabled=true;
    // Deferring the read also makes the in-flight record exist before a
    // synchronous provider failure reaches cleanup.
    const promise=Promise.resolve().then(async()=>{
      let timeout;
      try{
        const selected=configuration();
        const value=await Promise.race([selected.api.getSeasonStats(),new Promise((_,reject)=>{
          timeout=setTimeout(()=>reject(Error('The Registry read timed out. Refresh to try again.')),timeoutMs);
        })]);
        const current=configuration();
        if(current.api!==selected.api||current.registryId!==selected.registryId)throw Error('The selected garden changed during the read. Refresh to verify it again.');
        render(registryPresentation(value,selected.registryId,{now:now()}));return true;
      }catch(error){
        clear('unavailable',error?.message||'The Registry could not be verified. Refresh to try again.');return false;
      }finally{clearTimeout(timeout);if(button)button.disabled=false;inFlight=null;}
    });
    inFlight=promise;return promise;
  }
  function expire(){
    if(snapshot&&(now()-receivedAt>MAX_AGE_MS||now()-snapshot.nowMs>MAX_AGE_MS||now()<receivedAt)){
      clear('unavailable','This Registry snapshot is no longer current. Refresh to read the network again.');return true;
    }
    return false;
  }
  $('sr-registry-refresh')?.addEventListener('click',()=>void refresh());
  return Object.freeze({refresh,expire});
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
  const registry=createRegistryReview({document,getApi:()=>window.arb});
  if(registry){
    window.arbSettlementRegistry=registry;
    document.addEventListener('wallet-sdk-ready',()=>void registry.refresh());
    document.addEventListener('visibilitychange',()=>{registry.expire();if(!document.hidden)void registry.refresh();});
    setInterval(()=>{registry.expire();if(!document.hidden)void registry.refresh();},30000);
    void registry.refresh();
  }
  const $=id=>document.getElementById(id);
  const panel=$('settlement-rewards');
  if(panel){
    let snapshot=null,receivedAt=0,generation=0,inFlight=null,phase='loading';
    const text=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
    const node=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
    const owner=()=>{try{return window.arb?.getAddress?.()||null;}catch{return null;}};
    const integration=()=>{
      const value=window.arb?.getIntegrationStatus?.();
      const expected=document.documentElement.dataset.reviewProtocol;
      if(!value||value.reviewOnly!==true||!PROTOCOLS.has(value.protocol)||value.protocol!==expected){
        throw Error('The review configuration for this garden could not be verified.');
      }
      return value;
    };
    const protocolLabel=id=>id==='legacy'?'Existing garden':'New seasons';
    const shortAddress=id=>`${id.slice(0,8)}…${id.slice(-6)}`;
    const dateText=value=>{
      const amount=uint(value);
      if(amount===null||amount>8_640_000_000_000_000n)return 'Unavailable';
      return new Date(Number(amount)).toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC');
    };
    const state=(label,description='')=>{
      const box=$('sr-state');box.replaceChildren(node('strong','',label));
      if(description)box.append(node('p','',description));
      box.hidden=false;
    };

    function renderRoutes(status){
      const root=$('sr-routes');root.replaceChildren();
      const routes=window.arb?.getProtocolRoutes?.();
      if(!Array.isArray(routes)||routes.length!==2||new Set(routes.map(route=>route?.id)).size!==2){
        root.append(node('span','sr-route sr-route-unavailable','Garden routes unavailable'));
        return;
      }
      for(const id of ['legacy','settlement']){
        const route=routes.find(item=>item?.id===id);
        if(!route)throw Error('The garden route list is incomplete.');
        const selected=id===status.protocol;
        const available=route.available===true&&route.href===ROUTE_PATHS[id];
        const control=node(available?'a':'span','sr-route'+(selected?' sr-route-selected':'')+(available?'':' sr-route-unavailable'));
        control.dataset.route=id;
        control.append(node('strong','',protocolLabel(id)));
        if(available){control.href=ROUTE_PATHS[id];if(selected)control.setAttribute('aria-current','page');}
        else control.setAttribute('aria-disabled','true');
        const detail=selected?'Selected · '+(id==='legacy'?'existing protocol':route.readOnly?'read only':'new protocol')
          :available?(route.readOnly?'Open read-only view':'Open garden'):route.reason||'Unavailable · awaiting activation';
        control.append(node('small','',detail));
        root.append(control);
      }
    }

    function syncProjection(){
      let value='Unavailable';
      if(!owner())value='Connect wallet';
      else if(phase==='loading')value='Loading…';
      else if(snapshot&&Date.now()-receivedAt<=MAX_AGE_MS){
        if(snapshot.protocol==='legacy')value='Under review';
        else if(snapshot.entries.some(row=>rewardPresentation(row.reward,snapshot.protocol).status==='unknown'))value='Unavailable';
        else if(!snapshot.entries.length)value='No Seeds';
        else if(snapshot.entries.every(row=>row.reward?.status==='estimate')){
          value=formatMist(snapshot.entries.reduce((total,row)=>total+uint(row.reward.amountMist),0n))+' (estimate)';
        }else value='See Rewards';
      }
      for(const id of ['hero-earn-proj','h-proj','d-sui','r-proj','roi-pct'])text(id,value);
    }

    function clearResult(nextPhase){
      snapshot=null;receivedAt=0;phase=nextPhase;
      $('sr-entries').replaceChildren();$('sr-evidence').hidden=true;
      text('sr-count','Unavailable');text('sr-checkpoint','Unavailable');text('sr-network-time','Unavailable');
      syncProjection();
    }

    function renderEntry(entry,protocol){
      const reward=entry.reward,presentation=rewardPresentation(reward,protocol);
      const card=node('article','sr-seed');card.dataset.rewardStatus=presentation.status;
      const heading=node('div','sr-seed-heading');
      const title=node('div');title.append(node('h4','',`Seed ${shortAddress(entry.seed.objectId)}`),
        node('p','sr-seed-season',`Season ${points(reward?.seasonId??entry.seed.rawFields?.season_id??entry.seed.seasonId)}${entry.archiveId?' · archived':''}`));
      heading.append(title,node('span','sr-badge sr-badge-'+presentation.status,presentation.label));
      const metrics=node('dl','sr-seed-metrics');
      const metric=(label,value)=>{const item=node('div');item.append(node('dt','',label),node('dd','',value));metrics.append(item);};
      metric(presentation.amountLabel,presentation.amount);
      const gp=protocol==='legacy'?entry.seed.rawFields?.growth_points??entry.seed.growthPoints
        :reward?.status==='estimate'?reward.projectionGP:reward?.eligibleGP;
      metric(protocol==='legacy'?'Recorded Growth Points':reward?.status==='estimate'?'Current Growth Points':'Cutoff Growth Points',points(gp));
      card.append(heading,metrics);
      if(presentation.reason)card.append(node('p','sr-seed-reason',presentation.reason));
      if(protocol==='settlement'&&(reward?.seasonEndMs!=null||reward?.claimDeadlineMs!=null)){
        const times=node('div','sr-seed-times');
        for(const [label,value]of [['Cutoff',reward.seasonEndMs],['Claim deadline',reward.claimDeadlineMs]]){
          const item=node('div');item.append(node('span','',label),node('time','',dateText(value)));times.append(item);
        }
        card.append(times);
      }
      const details=node('details','sr-seed-details');details.append(node('summary','','Seed identity'));
      details.append(node('code','',entry.seed.objectId));
      if(entry.archiveId){details.append(node('span','','Matching archive'),node('code','',entry.archiveId));}
      card.append(details);
      if(presentation.action){
        const action=node('button','sr-button sr-seed-action',presentation.action);action.type='button';
        action.addEventListener('click',()=>void openClaims(entry.seed.objectId));card.append(action);
      }
      return card;
    }

    function renderSnapshot(view,address){
      snapshot=view;receivedAt=Date.now();phase='ready';
      const unknown=view.entries.some(entry=>rewardPresentation(entry.reward,view.protocol).status==='unknown');
      text('sr-count',view.entries.length.toLocaleString('en-US'));
      text('sr-read-status',unknown?'Snapshot read · some rewards unavailable':'Snapshot read');
      text('sr-checkpoint',String(view.checkpoint));text('sr-network-time',dateText(view.nowMs));text('sr-owner-full',address);
      $('sr-evidence').hidden=false;
      const entries=$('sr-entries');entries.replaceChildren();
      for(const entry of view.entries)entries.append(renderEntry(entry,view.protocol));
      if(!view.entries.length)state('No Seeds found in this garden','The completed owned-Seed read returned no Seeds for this wallet and protocol. This does not determine rewards in another garden.');
      else if(view.protocol==='legacy')state('Under review','The existing garden has its own reward history. No transition amount is presented as owed or claimable.');
      else if(unknown)state('Some reward data is unavailable','Available records are shown below. Missing records are not counted as zero.');
      else $('sr-state').hidden=true;
      syncProjection();
    }

    async function refresh(){
      let status;
      try{status=integration();renderRoutes(status);}catch(error){
        ++generation;clearResult('unavailable');state('Unavailable',error.message);
        text('sr-read-status','Review configuration unavailable');return false;
      }
      const address=owner();
      text('sr-protocol',protocolLabel(status.protocol));
      text('sr-title',status.protocol==='legacy'?'Existing garden rewards':'New-season rewards');
      text('sr-intro',status.protocol==='legacy'
        ?'Recorded Seed history is available for review. Existing-season reward amounts remain under review.'
        :'Review each Seed’s estimate, cutoff entitlement, fixed claim window, and verified payment status.');
      text('sr-owner',address?shortAddress(address):'Not connected');
      $('sr-connect').hidden=!!address;
      if(!address){
        ++generation;clearResult('disconnected');state('Connect your wallet','Use Connect wallet to read the Seeds you own in this garden. Connecting does not submit a transaction.');
        text('sr-read-status','Wallet not connected');$('sr-refresh').disabled=false;return false;
      }
      if(typeof window.arb?.getRewardOptions!=='function'){
        ++generation;clearResult('unavailable');state('Unavailable','The reward reader has not loaded. Refresh after the wallet tools are ready.');text('sr-read-status','Reward reader unavailable');return false;
      }
      if(inFlight?.address===address&&inFlight.protocol===status.protocol)return inFlight.promise;
      const ticket=++generation;
      clearResult('loading');state('Reading reward data','Checking owned Seeds and their reward history at one network checkpoint.');
      text('sr-read-status','Reading the Sui network…');$('sr-refresh').disabled=true;
      const current=()=>ticket===generation&&owner()===address;
      const promise=(async()=>{
        let timeout;
        try{
          const data=await Promise.race([window.arb.getRewardOptions(address),new Promise((_,reject)=>{
            timeout=setTimeout(()=>reject(Error('The reward read timed out. Refresh to try again.')),25000);
          })]);
          if(!current())return false;
          integration();
          const view=validateRewardOptions(data,status.protocol);
          renderSnapshot(view,address);return true;
        }catch(error){
          if(!current())return false;
          clearResult('unavailable');state('Unavailable',error?.message||'The reward snapshot could not be verified.');
          text('sr-read-status','Reward read failed');return false;
        }finally{
          clearTimeout(timeout);
          if(current())$('sr-refresh').disabled=false;
          if(inFlight?.ticket===ticket)inFlight=null;
        }
      })();
      inFlight={address,protocol:status.protocol,ticket,promise};
      return promise;
    }

    async function openClaims(seedId=null){
      // This handler deliberately has no transaction path, even if a caller
      // changes a button label or invokes the global function directly.
      window.setRewardTab?.('season');
      if(typeof window.doc==='function')window.doc('rewards-sec');
      else location.hash='rewards-sec';
      const note=$('sr-action-note');note.hidden=false;
      note.textContent='Review only. Wallet connections and reward reads are available; transactions are disabled in this build.';
      if(seedId)note.textContent+=` Selected Seed: ${shortAddress(seedId)}.`;
      panel.focus({preventScroll:true});panel.scrollIntoView({behavior:'smooth',block:'start'});
      await refresh();
      return {submitted:false,reason:'REVIEW_ONLY'};
    }

    function onWalletChanged(){
      ++generation;inFlight=null;clearResult('loading');$('sr-action-note').hidden=true;
      void refresh();
    }

    window.arbSettlementPanel=Object.freeze({refresh,openClaims,onWalletChanged,syncProjection});
    $('sr-refresh').addEventListener('click',()=>void refresh());
    $('sr-connect').addEventListener('click',()=>{
      const walletButton=$('wallet-btn');
      if(walletButton)walletButton.click();
      else state('Wallet connection unavailable','Reload the review page to restore the wallet controls.');
    });
    document.addEventListener('wallet-sdk-ready',()=>void refresh());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
    setInterval(()=>{if(!document.hidden)void refresh();else if(snapshot&&Date.now()-receivedAt>MAX_AGE_MS){clearResult('unavailable');state('Unavailable','This snapshot is no longer current. Refresh to read reward data again.');}},30000);
    void refresh();
  }
}
