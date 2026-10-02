import test from 'node:test';import assert from 'node:assert/strict';
import {DEPLOYMENT as D,verifyTransaction,validateState,scanEvents,createReaderClient,READ_QUERIES,partnerReportCsv} from './live-reader.mjs';
const A=x=>'0x'+x.toString(16).padStart(64,'0'),T=D.typeOrigin+'::arboretum::',S='0x'+'2'.padStart(64,'0')+'::sui::SUI';
const clone=x=>structuredClone(x);
function tx({tier=5,referred=false,quantity=1}={}){
 const buyer=A(101),ref=A(102),digest='SYNTHETIC_NOT_A_TRANSACTION';
 const inputs=[{kind:'PURE',pure:'gJaYAAAAAAA='},{kind:'SHARED',objectId:D.registryId},{kind:'PURE',pure:btoa(String.fromCharCode(tier))}];
 const commands=[],nodes=[];for(let i=0;i<quantity;i++){
  const split=commands.length;commands.push({splitCoins:{coin:{kind:'GAS'},amounts:[{kind:'INPUT',input:0}]}});
  commands.push({moveCall:{package:D.packageId,module:'arboretum',function:'buy_crate',arguments:[{kind:'INPUT',input:1},{kind:'INPUT',input:2},{kind:'RESULT',result:split,subresult:0}]}});
  if(referred)nodes.push({sequenceNumber:nodes.length,contents:{type:{repr:T+'ReferralPaid'},json:{referrer:ref,referee:buyer,amount_mist:'100000'}}});
  nodes.push({sequenceNumber:nodes.length,contents:{type:{repr:T+'CratePurchased'},json:{crate_id:A(200+i),buyer,tier}}});
 }
 return {digest,transactionJson:{digest,sender:buyer,gasPayment:{owner:buyer},kind:{kind:'PROGRAMMABLE_TRANSACTION',programmableTransaction:{inputs,commands}}},effects:{status:'SUCCESS',checkpoint:{sequenceNumber:123,timestamp:'2026-09-06T00:00:00Z'},events:{nodes,pageInfo:{hasNextPage:false}},balanceChangesJson:[{address:D.treasuryWallet,coinType:S,amount:String((referred?2772000:2800000)*quantity)}]}};
}
for(const tier of [5,6])for(const referred of [false,true])test(`exact tier ${tier} referral ${referred}`,()=>{
 const r=verifyTransaction(tx({tier,referred}));assert.equal(r.status,'verified_test_payment');assert.equal(r.receipts[0].treasuryMist,referred?'2772000':'2800000');
});
test('batch binds two different receipts once',()=>assert.equal(verifyTransaction(tx({quantity:2,referred:true})).receipts.length,2));
const defects={
 'failed transaction':t=>t.effects.status='FAILURE',
 'unknown status':t=>delete t.effects.status,
 'partial events':t=>t.effects.events.pageInfo.hasNextPage=true,
 'wrong package':t=>t.transactionJson.kind.programmableTransaction.commands[1].moveCall.package=A(9),
 'promo':t=>t.transactionJson.kind.programmableTransaction.commands[1].moveCall.function='send_promo_crate',
 'wrong event tier':t=>t.effects.events.nodes[0].contents.json.tier=6,
 'wrong event buyer':t=>t.effects.events.nodes[0].contents.json.buyer=A(9),
 'unknown price/change':t=>t.transactionJson.kind.programmableTransaction.inputs[0].pure='AJBL/AYAAAA=',
 'missing treasury':t=>t.effects.balanceChangesJson=[],
 'wrong treasury credit':t=>t.effects.balanceChangesJson[0].amount='1',
 'ambiguous treasury credit':t=>t.effects.balanceChangesJson.push(clone(t.effects.balanceChangesJson[0])),
 'unrelated transfer':t=>t.transactionJson.kind.programmableTransaction.commands.push({transferObjects:{}}),
 'treasury paid gas':t=>t.transactionJson.gasPayment.owner=D.treasuryWallet,
 'wrong digest':t=>t.transactionJson.digest='other',
 'wrong pure width':t=>t.transactionJson.kind.programmableTransaction.inputs[0].pure='AA==',
};
for(const [name,mutate]of Object.entries(defects))test(`fails closed: ${name}`,()=>{const t=tx();mutate(t);const r=verifyTransaction(t);assert.equal(r.status,'review');assert.deepEqual(r.receipts,[]);});
test('foreign registry visibly excluded',()=>{const t=tx();t.transactionJson.kind.programmableTransaction.inputs[1].objectId=A(8);assert.equal(verifyTransaction(t).status,'excluded');});
test('referral amount must reconcile',()=>{const t=tx({referred:true});t.effects.events.nodes[0].contents.json.amount_mist='99999';assert.equal(verifyTransaction(t).status,'review');});
function ev(stamp=2000,digest='test',index=0){return {sequenceNumber:index,contents:{type:{repr:T+'CratePurchased'},json:{tier:5}},transaction:{digest,effects:{status:'SUCCESS',checkpoint:{sequenceNumber:10,timestamp:new Date(stamp).toISOString()}}}};}
const page=(nodes,more=false,cursor='a')=>({events:{nodes,pageInfo:{hasPreviousPage:more,startCursor:cursor}}});
test('pagination reaches lower boundary',async()=>{let calls=0;const read=async(n,v)=>{assert.equal(v.ceiling,101);return ++calls===1?page([ev(2000)],true,'a'):page([ev(500,'old')],true,'b');};const x=await scanEvents(read,T+'CratePurchased',{watermark:100,startMs:1000});assert.equal(x.allPagesRead,true);assert.equal(x.nodes.length,1);assert.equal(calls,2);});
test('page limit never means complete',async()=>{const x=await scanEvents(async()=>page([ev()],true),T+'CratePurchased',{watermark:100,startMs:1000,maxPages:1});assert.equal(x.allPagesRead,false);});
test('stalled cursor rejects',async()=>assert.rejects(()=>scanEvents(async()=>page([ev()],true),T+'CratePurchased',{watermark:100,startMs:1000}),/stalled/));
test('wrong filter rejects',async()=>assert.rejects(()=>scanEvents(async()=>page([ev()]),'other',{watermark:100,startMs:1000}),/wrong type/));
test('past watermark rejects',async()=>assert.rejects(()=>scanEvents(async()=>page([ev()]),T+'CratePurchased',{watermark:9,startMs:1000}),/watermark/));
test('empty fully read connection handled explicitly',async()=>assert.equal((await scanEvents(async()=>page([]),T+'CratePurchased',{watermark:100,startMs:1000})).allPagesRead,true));
test('query errors do not accept partial data',async()=>{const read=createReaderClient({fetchImpl:async()=>({ok:true,status:200,json:async()=>({data:{registry:{}},errors:[{message:'partial'}]})})});await assert.rejects(()=>read('state'),/partial data/);});
test('only fixed read operations',async()=>{let calls=0;const read=createReaderClient({fetchImpl:async()=>{calls++;}});await assert.rejects(()=>read('executeTransaction'),/Unsupported/);assert.equal(calls,0);});
test('request never sends credentials, follows redirects, or uses mutation',async()=>{const read=createReaderClient({fetchImpl:async(url,opts)=>{assert.equal(url,D.endpoint);assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.ok(JSON.parse(opts.body).query.startsWith('query '));return {ok:true,status:200,json:async()=>({data:{done:true}})};}});assert.deepEqual(await read('state'),{done:true});});
test('network failure explicitly rejects',async()=>{const read=createReaderClient({fetchImpl:async()=>{throw Error('offline')}});await assert.rejects(()=>read('state'),/unavailable/);});
test('all query selections have balanced braces',()=>{for(const q of Object.values(READ_QUERIES)){assert.equal((q.match(/{/g)||[]).length,(q.match(/}/g)||[]).length);assert.ok(!/\bmutation\b|executeTransaction|simulateTransaction/.test(q));}});
test('wrong chain fails',()=>assert.throws(()=>validateState({chainIdentifier:'wrong'}),/network/));
test('CSV neutralizes formulas and leaves unrecorded spend empty',()=>{const s=partnerReportCsv({status:'live_test',rows:[{chest:'=HYPERLINK("x")',spentMist:null}]});assert.ok(s.includes("'=HYPERLINK"));assert.ok(!s.includes('undefined'));});
