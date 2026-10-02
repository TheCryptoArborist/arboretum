import test from 'node:test';import assert from 'node:assert/strict';
import {DEPLOYMENT} from './live-reader.mjs';import {verifyOpening,verifyArchive,networkState,discoverPartnerSeasons,readSelectedPartnerSeason} from './season-reader.mjs';
const T=DEPLOYMENT.typeOrigin+'::arboretum::',start=1700000000000,end=start+DEPLOYMENT.durationMs,aid='0x'+'a'.repeat(64);
const object=(type,json,address=DEPLOYMENT.registryId)=>({address,version:'9',asMoveObject:{contents:{json,type:{repr:T+type}}}});
const ev=(name,json)=>({sequenceNumber:0,contents:{json,type:{repr:T+name}}});
function transaction(fn,event,time,digest='start-proof'){
 const inputs=[{kind:'IMMUTABLE_OR_OWNED',objectId:'0x1'},{kind:'SHARED',objectId:DEPLOYMENT.registryId}];
 return {digest,transactionJson:{digest,kind:{kind:'PROGRAMMABLE_TRANSACTION',programmableTransaction:{inputs,commands:[{moveCall:{package:DEPLOYMENT.packageId,module:'arboretum',function:fn,arguments:[{kind:'INPUT',input:0},{kind:'INPUT',input:1}]}}]}}},effects:{status:'SUCCESS',checkpoint:{sequenceNumber:time===start?1:9,timestamp:new Date(time).toISOString()},events:{nodes:[event],pageInfo:{hasNextPage:false}}}};
}
const opening=()=>transaction('start_season',ev('SeasonStarted',{season_id:'3',start_ms:String(start)}),start);
function archiveFixture({early=false}={}){
 const finalized=early?start+100000:end+1000;
 const f={season_id:'3',season_start_ms:String(start),season_end_ms:String(end),finalized_at_ms:String(finalized),claim_deadline_ms:String(finalized+604800000),total_growth_points:'100',total_seeds:'2',reward_pool:'10',swept:false};
 const o={...object('SeasonArchive',f,aid),previousTransaction:{digest:'archive-proof'}};
 const tx=transaction('finalize_season_archive_now',ev('SeasonArchived',{...f,archive_id:aid,reward_pool_mist:'10'}),finalized,'archive-proof');return {o,tx};
}
function fixture({archived=false,gap=false,missingProof=false,cleared=false,nextSeason=false,early=false,registryChange=false,wrongObject=false,missingOpening=false}={}){
 const a=archiveFixture({early}),o=opening();let stateReads=0;
 const cp={sequenceNumber:100,timestamp:new Date(end+20000).toISOString()};
 const rootEvent=t=>({...t.effects.events.nodes[0],transaction:{digest:t.digest,effects:{status:'SUCCESS',checkpoint:t.effects.checkpoint}}});
 return async(op,v)=>{
  if(op==='state'){stateReads++;return {chainIdentifier:DEPLOYMENT.chainIdentifier,checkpoint:cp,serviceConfig:{availableRange:{first:{sequenceNumber:0,timestamp:new Date(start+(gap?1:-1)).toISOString()},last:cp}},registry:object('Registry',{season_start_ms:archived||cleared?'0':String(start),current_season_id:'3'},DEPLOYMENT.registryId),...(registryChange&&stateReads>1?{registry:{...object('Registry',{season_start_ms:'0',current_season_id:'3'}),version:'10'}}:{})};}
  if(op==='archiveObjects')return {objects:{nodes:archived?[wrongObject?object('Tool',{},aid):a.o]:[],pageInfo:{hasNextPage:false}}};
  if(op==='events')return {events:{nodes:v.type===T+'SeasonStarted'&&!missingOpening?[rootEvent(o)]:v.type===T+'SeasonArchived'&&archived&&!missingProof?[rootEvent(a.tx)]:[],pageInfo:{hasPreviousPage:false}}};
  if(op==='transaction'){if(v.digest==='archive-proof'&&!missingProof)return {transaction:a.tx};if(v.digest==='start-proof'&&!missingOpening)return {transaction:o};throw Error('Unavailable point lookup');}
  throw Error('Unexpected operation '+op);
 };
}
test('opening verifies exact registry call and interval',()=>assert.equal(verifyOpening(opening(),{id:'3',storedStartMs:start,endMs:end},100).startMs,start));
for(const [name,change] of [
 ['wrong registry',t=>t.transactionJson.kind.programmableTransaction.inputs[1].objectId='0x2'],
 ['unused registry input',t=>t.transactionJson.kind.programmableTransaction.commands[0].moveCall.arguments[1]={kind:'INPUT',input:0}],
 ['wrong module',t=>t.transactionJson.kind.programmableTransaction.commands[0].moveCall.module='other'],
 ['wrong package',t=>t.transactionJson.kind.programmableTransaction.commands[0].moveCall.package='0x2'],
 ['failed',t=>t.effects.status='FAILURE'],
 ['partial events',t=>t.effects.events.pageInfo.hasNextPage=true],
 ['wrong digest',t=>t.transactionJson.digest='other'],
 ['beyond watermark',t=>t.effects.checkpoint.sequenceNumber=101]
])test('opening rejects '+name,()=>{const t=opening();change(t);assert.throws(()=>verifyOpening(t,{id:'3',storedStartMs:start,endMs:end},100));});
test('backdated duration must be reconstructed from exact BCS input',()=>{const t=opening(),duration=100000;const p=t.transactionJson.kind.programmableTransaction;const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(duration));p.inputs.push({kind:'PURE',pure:b.toString('base64')});p.commands[0].moveCall.function='start_season_for_duration';p.commands[0].moveCall.arguments.push({kind:'INPUT',input:0},{kind:'INPUT',input:2});const s={id:'3',storedStartMs:start-(DEPLOYMENT.durationMs-duration),endMs:start+duration};assert.equal(verifyOpening(t,s,100).startMs,start);s.endMs++;assert.throws(()=>verifyOpening(t,s,100),/timestamps/);});
test('archive validates creation fields, not mutable remaining reward balance',()=>{const {o,tx}=archiveFixture();o.asMoveObject.contents.json.reward_pool='0';assert.equal(verifyArchive(o,tx,100).archiveId,aid)});
test('early archive stops receipt accounting at actual finalization',()=>{const {o,tx}=archiveFixture({early:true});assert.equal(verifyArchive(o,tx,100).receiptEndMs,start+100000)});
for(const k of ['season_id','finalized_at_ms','claim_deadline_ms','total_growth_points','total_seeds'])test('archive rejects changed '+k,()=>{const {o,tx}=archiveFixture();o.asMoveObject.contents.json[k]='123';assert.throws(()=>verifyArchive(o,tx,100));});
test('archive with foreign registry call cannot be accepted by object ID alone',()=>{const {o,tx}=archiveFixture();tx.transactionJson.kind.programmableTransaction.inputs[1].objectId='0x2';assert.throws(()=>verifyArchive(o,tx,100));});
test('cleared active registry still discovers selectable archive',async()=>{const c=await discoverPartnerSeasons({read:fixture({archived:true})});assert.equal(c.seasons.length,1);assert.equal(c.seasons[0].selectable,true);assert.equal(c.seasons[0].kind,'archived');});
test('empty registry and no archives do not invent a season',async()=>{const c=await discoverPartnerSeasons({read:fixture({cleared:true})});assert.equal(c.seasons.length,0);assert.match(c.note,/not proof/);});
test('archive with missing creation evidence is visible as issue, not trusted',async()=>{const c=await discoverPartnerSeasons({read:fixture({archived:true,missingProof:true})});assert.equal(c.seasons.length,0);assert.equal(c.issues[0].archiveId,aid)});
test('missing opening evidence leaves archive nonselectable',async()=>{const c=await discoverPartnerSeasons({read:fixture({archived:true,missingOpening:true})});assert.equal(c.seasons[0].selectable,false)});
test('registry rollover during discovery requires retry',async()=>assert.rejects(()=>discoverPartnerSeasons({read:fixture({registryChange:true})}),/Registry changed/));
test('foreign archive object type rejected',async()=>assert.rejects(()=>discoverPartnerSeasons({read:fixture({archived:true,wrongObject:true})}),/Unexpected object/));
test('selected current season revalidates from chain, not a supplied cache',async()=>{const r=await readSelectedPartnerSeason('current:3',{read:fixture(),catalogue:{seasons:[{id:'999'}]}});assert.equal(r.season.id,'3');assert.equal(r.coverage.finalForSeason,true);assert.equal(r.rows[0].purchaseBudgetMist,null)});
test('archived-season selection records provenance and never activates partner budgets',async()=>{const r=await readSelectedPartnerSeason('archive:'+aid,{read:fixture({archived:true})});assert.equal(r.season.archiveId,aid);assert.equal(r.season.kind,'archived');assert.equal(r.transactionsSubmitted,0);assert.equal(r.policy.productionBudgetApplicable,false);assert.equal(r.unassignedEvents.length,0);});
test('archive coverage gap stays partial even though archive proof is valid',async()=>{const r=await readSelectedPartnerSeason('archive:'+aid,{read:fixture({archived:true,gap:true})});assert.equal(r.coverage.complete,false);assert.equal(r.coverage.finalForSeason,false);assert.match(r.status,/PARTIAL/)});
test('unknown selected season rejected rather than switched to current',async()=>assert.rejects(()=>readSelectedPartnerSeason('archive:missing',{read:fixture()}),/Selected season/));
test('pagination limit yields discovery warning',async()=>{const read=fixture();const c=await discoverPartnerSeasons({read:async(op,v)=>op==='archiveObjects'?{objects:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'one'}}}:read(op,v),maxPages:1});assert.equal(c.discovery.objectsComplete,false)});
test('archive cursor stall rejects',async()=>{const read=fixture();await assert.rejects(()=>discoverPartnerSeasons({read:async(op,v)=>op==='archiveObjects'?{objects:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'one'}}}:read(op,v)}),/pagination stalled/)});
