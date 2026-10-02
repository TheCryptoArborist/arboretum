import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createReaderClient,READ_QUERIES,readCurrentPartnerSeason,DEPLOYMENT,partnerReportCsv} from './live-reader.mjs';
import {applyPartnerReport,buildPreview} from './build-admin-preview.mjs';
import {READ_QUERIES as fixedQueries} from './read-queries.mjs';
const T=DEPLOYMENT.typeOrigin+'::arboretum::';
const millis=1_700_000_000_000;
function fixture({gap=false,ended=true,mismatch=false}={}) {
 const checkpoint={sequenceNumber:100,timestamp:new Date(millis+(ended?DEPLOYMENT.durationMs+1:1000)).toISOString()};
 const event={sequenceNumber:0,contents:{type:{repr:T+'SeasonStarted'},json:{season_id:'3',start_ms:String(millis)}},transaction:{digest:'fixture-start',effects:{status:'SUCCESS',checkpoint:{sequenceNumber:1,timestamp:new Date(millis).toISOString()}}}};
 return async (op,v)=>{
  if(op==='state')return {chainIdentifier:DEPLOYMENT.chainIdentifier,checkpoint,serviceConfig:{availableRange:{first:{sequenceNumber:0,timestamp:new Date(millis+(gap?1:-1)).toISOString()},last:checkpoint}},registry:{address:DEPLOYMENT.registryId,version:'1',asMoveObject:{contents:{type:{repr:T+'Registry'},json:{season_start_ms:String(millis),current_season_id:'3'}}}}};
  if(op==='events')return {events:{nodes:v.type.endsWith('SeasonStarted')?[event]:[],pageInfo:{hasPreviousPage:false,startCursor:null}}};
  if(op==='transaction')return {transaction:{digest:'fixture-start',transactionJson:{kind:{programmableTransaction:{inputs:[{kind:'SHARED',objectId:DEPLOYMENT.registryId}]}}},effects:{status:'SUCCESS',checkpoint:event.transaction.effects.checkpoint,events:{nodes:mismatch?[]:[event],pageInfo:{hasNextPage:false}}}}};
  throw Error('Unexpected query');
 };
}
test('one fixed query definition, precise event retention filters',()=>{assert.equal(READ_QUERIES,fixedQueries);assert.match(READ_QUERIES.state,/filters:\["type","beforeCheckpoint"\]/)});
test('runtime sends precise query, not unused parallel definition',async()=>{let q;const read=createReaderClient({fetchImpl:async(u,o)=>{q=JSON.parse(o.body).query;return {ok:true,status:200,json:async()=>({data:{ok:true}})}}});await read('state');assert.equal(q,fixedQueries.state)});
test('completed empty supported season may have zero receipts but no production budget',async()=>{const r=await readCurrentPartnerSeason({read:fixture()});assert.equal(r.coverage.complete,true);assert.equal(r.coverage.finalForSeason,true);for(const row of r.rows){assert.equal(row.paidChestCount,'0');assert.equal(row.purchaseBudgetMist,null)}assert.equal(r.transactionsSubmitted,0)});
test('reaching pagination end does not erase missing historical coverage',async()=>{const r=await readCurrentPartnerSeason({read:fixture({gap:true})});assert.equal(r.coverage.allPagesRead,true);assert.equal(r.coverage.complete,false);assert.equal(r.coverage.finalForSeason,false);assert.match(r.status,/PARTIAL/)});
test('active season cannot be marked final even when caught up',async()=>{const r=await readCurrentPartnerSeason({read:fixture({ended:false})});assert.equal(r.coverage.complete,true);assert.equal(r.coverage.finalForSeason,false)});
test('season-start discovery must match successful transaction event',async()=>assert.rejects(()=>readCurrentPartnerSeason({read:fixture({mismatch:true})}),/evidence mismatch/));
test('CSV carries the historical coverage watermark and incomplete flag',async()=>{const r=await readCurrentPartnerSeason({read:fixture({gap:true})});const csv=partnerReportCsv(r);assert.match(csv,/earliestAvailableTimestamp/);assert.match(csv,/throughCheckpoint/);assert.match(csv,/"false"/);assert.match(csv,/PARTIAL/)});
test('admin overlay preserves original snapshot and injects separate attachment',()=>{const src=fs.readFileSync('index.html','utf8');const changed=applyPartnerReport(src);assert.match(changed,/partnerRevenue:window.arbPartnerReport/);assert.match(changed,/partner-revenue-mount/);assert.throws(()=>applyPartnerReport(changed),/already applied/)});
test('ambiguous HTML cannot be silently patched',()=>assert.throws(()=>applyPartnerReport('<html></html>'),/Ambiguous/));
test('production build remains blocked',()=>{const prior=process.env.CONTEXT;process.env.CONTEXT='production';try{assert.throws(()=>buildPreview(),/production build blocked/)}finally{if(prior===undefined)delete process.env.CONTEXT;else process.env.CONTEXT=prior}});
test('build includes the read-query module imported by the runtime',()=>{const src=fs.readFileSync('economy-review/build-admin-preview.mjs','utf8');assert.match(src,/'read-queries.mjs'/)});
test('all approved rate and existing treasury decisions preserved',()=>{const d=JSON.parse(fs.readFileSync('economy-review/decisions.json'));assert.equal(d.funding.BOOM.allocationBasisPoints,1000);assert.equal(d.funding.VICTORY.allocationBasisPoints,1000);assert.equal(d.guardrails.fundingFromPool,false);assert.equal(d.tokenPurchasesAuthorized,false);assert.equal(d.guardrails.treeBudgetFromGameReceipts,false)});
