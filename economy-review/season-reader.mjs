/** Read-only seasonal discovery. Archive identity is proven from its creation
 * transaction, not browser storage, its name, or a supplied season number.
 * This adapter is deliberately limited to the existing TESTING economy.
 */
import {DEPLOYMENT,createReaderClient,scanEvents,getTransaction,readSeasonReceipts} from './live-reader.mjs';
const T=DEPLOYMENT.typeOrigin+'::arboretum::';
const address=x=>{if(typeof x!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(x))throw Error('Invalid object address');return '0x'+x.slice(2).toLowerCase().padStart(64,'0');};
const integer=x=>{if(!/^(0|[1-9]\d*)$/.test(String(x))||BigInt(x)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid season integer');return Number(x);};
const stamp=x=>{const n=Date.parse(x);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid checkpoint time');return n;};
const contents=(o,type)=>{if(o?.asMoveObject?.contents?.type?.repr!==T+type)throw Error('Unexpected object type');return o.asMoveObject.contents.json;};
// Historical start transactions observed in the schema probe. These are lookup
// hints, never trusted season values. Every fetched transaction is revalidated.
const START_HINTS=['81hEU3WzpLdgwFhUT75qtvAu6hs11TQt1yUpTAchscjY','3KDAeqfbGJCAZ57MjVsC6dN4u2gCXyEUmpt151Gcs5o1','5CVNRZN9AP6c6x8FP4BTTpaFeL68KBFL31LhDx6tE7L2'];
const START_PACKAGES=new Set([DEPLOYMENT.packageId,DEPLOYMENT.typeOrigin,'0xb6f93eb9efc6a1e6760efc2d5f0e07064ed6e72665ef7401a9047f7889e551d7','0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914']);
function boundCalls(tx,functions,packages){
 if(tx?.effects?.status!=='SUCCESS'||tx.effects.events?.pageInfo?.hasNextPage!==false||tx.transactionJson?.digest!==tx.digest)throw Error('Incomplete or unsuccessful provenance transaction');
 const p=tx.transactionJson?.kind?.programmableTransaction;
 if(tx.transactionJson?.kind?.kind!=='PROGRAMMABLE_TRANSACTION'||!Array.isArray(p?.inputs)||!Array.isArray(p?.commands))throw Error('Unsupported provenance transaction');
 return p.commands.map(c=>c.moveCall).filter(c=>c&&packages.has(address(c.package))&&c.module==='arboretum'&&functions.includes(c.function)&&c.arguments?.[1]?.kind==='INPUT'&&p.inputs[c.arguments[1].input]?.kind==='SHARED'&&address(p.inputs[c.arguments[1].input].objectId)===DEPLOYMENT.registryId);
}
export function verifyOpening(tx,season,watermark){
 const calls=boundCalls(tx,['start_season','start_season_for_duration'],START_PACKAGES);
 const events=tx.effects.events.nodes.filter(e=>e.contents?.type?.repr===T+'SeasonStarted'&&String(e.contents.json?.season_id)===season.id);
 if(calls.length!==1||events.length!==1||integer(tx.effects.checkpoint?.sequenceNumber)>watermark)throw Error('Season opening not uniquely bound to this registry');
 const e=events[0],start=integer(e.contents.json.start_ms),call=calls[0];let duration=DEPLOYMENT.durationMs;
 if(call.function==='start_season_for_duration'){
  const arg=call.arguments[3],input=arg?.kind==='INPUT'?tx.transactionJson.kind.programmableTransaction.inputs[arg.input]:null;
  if(input?.kind!=='PURE')throw Error('Missing season duration');const b=atob(input.pure);if(b.length!==8)throw Error('Invalid duration encoding');let n=0n;for(let i=7;i>=0;i--)n=(n<<8n)+BigInt(b.charCodeAt(i));duration=integer(n);
 }
 if(duration<=0||duration>DEPLOYMENT.durationMs||start+duration!==season.endMs||start-(DEPLOYMENT.durationMs-duration)!==season.storedStartMs)throw Error('Season timestamps do not match opening transaction');
 const startMs=Math.max(start,stamp(tx.effects.checkpoint.timestamp));if(startMs>=season.endMs)throw Error('Invalid season interval');
 return {startMs,event:e,transaction:tx};
}
export function verifyArchive(o,tx,watermark){
 const f=contents(o,'SeasonArchive'),id=address(o.address);
 const calls=boundCalls(tx,['finalize_season_archive_now','reset_season'],new Set([DEPLOYMENT.packageId]));
 const es=tx.effects.events.nodes.filter(e=>e.contents?.type?.repr===T+'SeasonArchived'&&address(e.contents.json?.archive_id)===id);
 if(calls.length!==1||es.length!==1||integer(tx.effects.checkpoint?.sequenceNumber)>watermark)throw Error('Archive creation proof unavailable or belongs to another registry');
 const e=es[0].contents.json;
 for(const k of ['season_id','finalized_at_ms','claim_deadline_ms','total_growth_points','total_seeds'])if(String(f[k])!==String(e[k]))throw Error('Archive creation fields differ from object');
 const storedStartMs=integer(f.season_start_ms),endMs=integer(f.season_end_ms),finalizedAtMs=integer(f.finalized_at_ms),claimDeadlineMs=integer(f.claim_deadline_ms);
 if(!storedStartMs||endMs-storedStartMs!==DEPLOYMENT.durationMs||finalizedAtMs<storedStartMs||claimDeadlineMs<finalizedAtMs||typeof f.swept!=='boolean')throw Error('Invalid archive timing or state');
 return {key:'archive:'+id,id:String(integer(f.season_id)),kind:'archived',archiveId:id,storedStartMs,endMs,receiptEndMs:Math.min(endMs,finalizedAtMs),finalizedAtMs,claimDeadlineMs,swept:f.swept,archiveVersion:String(o.version),creationTransaction:tx.digest,evidence:{object:o,creationTransaction:tx}};
}
export function networkState(state){
 if(state?.chainIdentifier!==DEPLOYMENT.chainIdentifier||address(state.registry?.address)!==DEPLOYMENT.registryId)throw Error('Wrong network or registry');
 const fields=contents(state.registry,'Registry'),range=state.serviceConfig?.availableRange,tip=state.checkpoint;
 if(!range?.first||!range?.last)throw Error('Historical coverage unavailable');
 const watermark=integer(range.last.sequenceNumber)<integer(tip.sequenceNumber)?range.last:tip;
 return {fields,watermark:{sequenceNumber:integer(watermark.sequenceNumber),timestamp:watermark.timestamp},earliestTimestampMs:stamp(range.first.timestamp),throughTimestampMs:stamp(watermark.timestamp)};
}
export async function discoverPartnerSeasons({read=createReaderClient(),maxPages=30,onProgress=()=>{}}={}){
 const state=await read('state',{registry:DEPLOYMENT.registryId}),net=networkState(state),issues=[],seasons=[],objects=new Map(),txCache=new Map();
 const tx=async digest=>{if(!txCache.has(digest))txCache.set(digest,getTransaction(read,digest));return txCache.get(digest);};
 onProgress('Discovering current and archived testing seasons…');
 let after=null,objectsComplete=false;const cursors=new Set();
 for(let p=0;p<maxPages;p++){
  const d=await read('archiveObjects',{type:T+'SeasonArchive',after}),c=d.objects;
  if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')throw Error('Malformed archive list');
  for(const o of c.nodes){contents(o,'SeasonArchive');const k=address(o.address);if(objects.has(k)&&JSON.stringify(objects.get(k))!==JSON.stringify(o))throw Error('Archive changed during pagination');objects.set(k,o);}
  if(!c.pageInfo.hasNextPage){objectsComplete=true;break;}const next=c.pageInfo.endCursor;if(!next||cursors.has(next))throw Error('Archive pagination stalled');cursors.add(next);after=next;
 }
 const options={watermark:net.watermark.sequenceNumber,startMs:0,maxPages};
 const archived=await scanEvents(read,T+'SeasonArchived',options),starts=await scanEvents(read,T+'SeasonStarted',options);
 for(const o of objects.values()){
  const id=address(o.address),f=contents(o,'SeasonArchive');
  const hints=new Set(archived.nodes.filter(e=>address(e.contents.json.archive_id)===id).map(e=>e.transaction.digest));
  if(o.previousTransaction?.digest)hints.add(o.previousTransaction.digest);
  const proven=[];for(const digest of hints){try{proven.push(verifyArchive(o,await tx(digest),net.watermark.sequenceNumber));}catch{}}
  if(proven.length===1)seasons.push(proven[0]);else issues.push({archiveId:id,seasonId:String(f.season_id),reason:'Archive found, but its unique creation/registry proof is unavailable. Not included as a verified season.'});
 }
 const storedStartMs=integer(net.fields.season_start_ms),id=String(integer(net.fields.current_season_id));
 if(storedStartMs){
  if(seasons.some(s=>s.id===id))throw Error('Registry and archive disagree; refresh the season list');
  seasons.push({key:'current:'+id,id,kind:'current',storedStartMs,endMs:storedStartMs+DEPLOYMENT.durationMs,receiptEndMs:storedStartMs+DEPLOYMENT.durationMs});
 }
 if(new Set(seasons.map(s=>s.id)).size!==seasons.length)throw Error('Conflicting archives for one season');
 for(const s of seasons){
  const hints=new Set(starts.nodes.filter(e=>String(e.contents.json.season_id)===s.id).map(e=>e.transaction.digest));
  // Point lookups of observed historical IDs recover boundary evidence, not
  // missing purchase history. An expired event range still remains partial.
  if(!hints.size)for(const digest of START_HINTS)hints.add(digest);
  const matches=[];for(const digest of hints){try{matches.push(verifyOpening(await tx(digest),s,net.watermark.sequenceNumber));}catch{}}
  if(matches.length!==1){s.selectable=false;issues.push({seasonId:s.id,reason:'Season opening transaction could not be verified.'});continue;}
  s.startMs=matches[0].startMs;s.openingEvidence=matches[0];s.selectable=s.startMs<s.receiptEndMs;
  if(!s.selectable)issues.push({seasonId:s.id,reason:'Season has no verified positive receipt interval.'});
 }
 const last=await read('state',{registry:DEPLOYMENT.registryId});networkState(last);
 if(String(last.registry.version)!==String(state.registry.version))throw Error('Registry changed during discovery; refresh before selecting a season');
 seasons.sort((a,b)=>Number(b.id)-Number(a.id));
 return {kind:'partner-season-catalogue',mode:'live_test',retrievedAt:new Date().toISOString(),seasons,issues,state,network:net,
  discovery:{objectsComplete,archiveEventsPagesRead:archived.allPagesRead,startEventsPagesRead:starts.allPagesRead,historyMayBePruned:true},
  note:'Lists discoverable archive objects with verified registry/opening evidence. An empty list is not proof no historical season ever existed.',transactionsSubmitted:0};
}
export async function readSelectedPartnerSeason(key,{read=createReaderClient(),maxPages=30,onProgress=()=>{},catalogue=null}={}){
 // Always rediscover from source before reporting. A caller's cache is not proof.
 void catalogue;
 const c=await discoverPartnerSeasons({read,maxPages,onProgress}),s=c.seasons.find(x=>x.key===key);
 if(!s||!s.selectable)throw Error('Selected season is unavailable or changed. Reload seasons.');
 const season={...s,...c.network,currentRegistryVersion:String(c.state.registry.version)};delete season.fields;
 const r=await readSeasonReceipts({read,maxPages,onProgress,state:c.state,season,startMs:s.startMs,
  seasonStartEvent:s.openingEvidence.event,seasonStartTransaction:s.openingEvidence.transaction,receiptEndMs:s.receiptEndMs,trackUnassigned:s.kind!=='archived'});
 r.season.kind=s.kind;r.season.selectionKey=s.key;r.season.archiveId=s.archiveId??null;r.season.claimDeadlineMs=s.claimDeadlineMs??null;r.season.swept=s.swept??null;
 r.evidence.seasonDiscovery={discovery:c.discovery,issues:c.issues,archive:s.evidence??null};
 return r;
}
