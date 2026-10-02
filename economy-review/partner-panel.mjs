import {readCurrentPartnerSeason,createReaderClient,partnerReportCsv,DEPLOYMENT} from './live-reader.mjs';
import {formatSui} from './ledger.mjs';
const money=v=>v==null?'—':formatSui(v).replace(/0+$/,'').replace(/\.$/,'');
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export function mountPartnerPanel(root,{readReport,allowDemo=false,demoReport=null,initialReport=null,requireAdmin=false,assetBase='/assets/shop/crates/'}={}){
 root.classList.add('partner-report');let report=null,generation=0,controller=null,failedRefresh=false;
 const header=el('div',undefined,'pr-heading'),heading=el('div');heading.append(el('p','SEASONAL TREASURY ACCOUNTING','pr-eyebrow'),el('h3','Partner Chest Revenue'));
 header.append(heading,el('span','READ ONLY','pr-chip'));root.append(header);
 root.append(el('p','BOOM and VICTORY are tracked separately in the existing treasury. The approved partner rate is 10% of each chest’s treasury proceeds.','pr-intro'));
 const bar=el('div',undefined,'pr-toolbar'),selector=el('select');selector.setAttribute('aria-label','Report source');
 const live=el('option','On-chain testing season');live.value='live';selector.append(live);
 if(allowDemo){const demo=el('option','Illustrative public season — sample data');demo.value='demo';selector.append(demo);}
 const refresh=el('button','Read on-chain receipts'),csv=el('button','Export CSV'),json=el('button','Export JSON');refresh.className='pr-primary';csv.disabled=json.disabled=true;
 bar.append(selector,refresh,csv,json);root.append(bar);
 const status=el('p','No report has been loaded. Reading receipts does not connect a wallet or move funds.','pr-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const facts=el('p','', 'pr-facts'),cards=el('div',undefined,'pr-cards'),notes=el('div',undefined,'pr-notes');root.append(status,facts,cards,notes);
 const treasury=el('details'),summary=el('summary','Treasury and accounting rules');treasury.append(summary,el('p',DEPLOYMENT.treasuryWallet,'pr-address'),el('p','Funds remain in this wallet. This report does not reserve SUI or execute swaps. NFTree-to-TREE accounting is separate.'));
 root.append(treasury);
 function clear(){report=null;csv.disabled=json.disabled=true;cards.replaceChildren();notes.replaceChildren();facts.textContent='';}
 function render(r){
  clear();report=r;failedRefresh=false;const demo=r.mode==='demo';
  csv.disabled=json.disabled=false;root.dataset.mode=r.mode;
  status.className='pr-status '+(demo?'pr-demo':'pr-test');
  status.textContent=demo?'ILLUSTRATION ONLY · Fictional sales, not live revenue or token purchases.':r.coverage.complete?'TEST ECONOMY · Supported paid receipts reconciled. No production token-purchase budget applies.':'PARTIAL TEST REPORT · Some records or historical coverage require review. Do not treat these as final totals.';
  facts.textContent=demo?'Sample season · 30 SUI per chest · 20% of the sample purchases have a referral.':`Testing season ${r.season.id} · On-chain data through ${new Date(r.coverage.throughTimestamp).toLocaleString()} · Checkpoint ${r.coverage.throughCheckpoint}`;
  if(!demo)facts.append(el('span',`Receipt window: ${new Date(r.season.startMs).toISOString()} to ${new Date(r.season.endMs).toISOString()} (end excluded).`,'pr-window'));
  for(const row of r.rows){
   const card=el('article',undefined,'pr-card'),top=el('div',undefined,'pr-card-title'),img=el('img');
   img.src=assetBase+(row.tier===5?'boom-chest.png':'victory-chest.png');img.alt=row.chest+' original chest artwork';img.width=68;img.height=68;
   top.append(img,el('h4',row.chest+' Chest'));card.append(top);
   const count=el('p',row.paidChestCount,'pr-count');count.append(el('span',' paid chests'));card.append(count);
   const dl=el('dl');
   for(const [label,value]of [['Gross chest sales',money(row.grossMist)+' SUI'],['Treasury proceeds',money(row.treasuryMist)+' SUI'],[demo?'10% illustrative purchase budget':'Production purchase budget',demo?money(row.purchaseBudgetMist)+' SUI':'Not applicable to testing'],['SUI spent on tokens','Not reconciled'],['Tokens received','Not reconciled'],['Unspent purchase budget','Not reconciled']]){dl.append(el('dt',label),el('dd',value));}
   card.append(dl);const detail=el('details');detail.append(el('summary','Referral and player-pool breakdown'));
   detail.append(el('p',`Referral: ${money(row.referralMist)} SUI · Pool allocation: ${money(row.poolMist)} SUI · Developer allocation: ${money(row.developerMist)} SUI`));
   if(!demo)detail.append(el('p','Pool/developer amounts use the pinned routing model. This is not a full historical reward-pool audit.'));
   card.append(detail);cards.append(card);
  }
  notes.append(el('p',demo?'The example uses the approved 10% rate but creates no spending obligation. Actual spend and token receipts are deliberately not invented.':'Testing purchases stay outside the public-season partner allocation. Paid sales are counted at purchase—not at opening or resale.'));
  if(r.needsReview?.length){const detail=el('details');detail.append(el('summary',`${r.needsReview.length} item(s) need review`));for(const n of r.needsReview)detail.append(el('p',n.reason));notes.append(detail);}
  if(r.unassignedEvents?.length)notes.append(el('p',`${r.unassignedEvents.length} partner event(s) occurred after the growing period and remain unassigned.`));
  if(!demo&&r.receipts?.length){const detail=el('details');detail.append(el('summary','View checked purchase transactions'));
   for(const digest of new Set(r.receipts.map(x=>x.transactionDigest))){const a=el('a',digest,'pr-address');if(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(digest)){a.href='https://suivision.xyz/txblock/'+encodeURIComponent(digest);a.target='_blank';a.rel='noopener noreferrer';}detail.append(a);}
   notes.append(detail);
  }
 }
 async function load(){
  if(requireAdmin&&!window.arb?.isAdmin(window.arb.getAddress())){status.textContent='Open the Admin Console with an authorized wallet to use this panel. No wallet connection is requested by this report.';return;}
  const ticket=++generation;controller?.abort();controller=new AbortController();refresh.disabled=true;csv.disabled=json.disabled=true;
  status.className='pr-status';status.textContent='Reading confirmed Sui data…';
  try{
   const r=selector.value==='demo'?demoReport:await (readReport?readReport():readCurrentPartnerSeason({read:createReaderClient({signal:controller.signal}),onProgress:text=>{if(ticket===generation)status.textContent=text;}}));
   if(ticket!==generation)return;if(!r)throw Error('No sample report available');render(r);
  }catch(e){if(ticket!==generation)return;failedRefresh=true;status.className='pr-status pr-error';status.textContent=`Read not completed: ${e.message}${report?' The displayed report is the previous saved read, not refreshed data.':''}`;csv.disabled=json.disabled=!report;}
  finally{if(ticket===generation)refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 selector.addEventListener('change',()=>{++generation;controller?.abort();refresh.disabled=false;clear();refresh.textContent=selector.value==='demo'?'Load sample report':'Read on-chain receipts';status.textContent='Report source changed. Load the selected source to see its results.';});
 json.addEventListener('click',()=>{if(report)download(`arboretum-partner-${report.mode}-${report.season?.id||'demo'}.json`,JSON.stringify(report,null,2),'application/json');});
 csv.addEventListener('click',()=>{if(report)download(`arboretum-partner-${report.mode}-${report.season?.id||'demo'}.csv`,partnerReportCsv(report),'text/csv');});
 if(initialReport)render(initialReport);
 return {load,render,snapshotAttachment(seasonId){
  if(!report||report.mode!=='live_test'||String(seasonId)!==String(report.season.id))return {status:'not_loaded_for_snapshot_season'};
  return {status:report.status,mode:report.mode,retrievedAt:report.retrievedAt,coverage:report.coverage,rows:report.rows,
   refreshFailed:failedRefresh,stale:Date.now()-Date.parse(report.retrievedAt)>300000,productionBudgetApplicable:false,tokenPurchasesAuthorized:false};
 },destroy(){generation++;controller?.abort();root.replaceChildren();}};
}
if(typeof document!=='undefined'){
 const root=document.getElementById('partner-revenue-mount');
 if(root)window.arbPartnerReport=mountPartnerPanel(root,{requireAdmin:true});
}
