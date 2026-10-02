import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReport, splitShop, scenarioBudget, mist, formatSui, reportCsv, U64_MAX} from './ledger.mjs';
import {exampleInput, exampleSale, decisions} from './example.mjs';
const report = (records, edit = () => {}) => { const v=exampleInput(records); edit(v); return buildReport(v); };
const noRef = exampleSale(1), ref = exampleSale(2,5,true);
const clone = v => structuredClone(v);

test('approved standard ladder and planting target are exact',()=>{
 assert.deepEqual(decisions.crates.slice(0,5).map(x=>x.priceMist),['5000000000','10000000000','25000000000','50000000000','100000000000']);
 assert.equal(decisions.planting.priceMist,'10000000000');
 assert.ok(decisions.crates.slice(0,5).every(x=>x.status==='approved_price_not_activated'));
});
test('partner target is provisional and supply prices are not silently approved',()=>{
 assert.ok(decisions.crates.slice(5).every(x=>x.priceMist==='30000000000'&&x.status==='provisional_target'));
 assert.ok(decisions.supplyDrops.every(x=>x.priceMist===null));
});
test('NFTree funds TREE separately with no inferred percentage',()=>{
 assert.equal(decisions.funding.TREE.source,'project_received_NFTree_revenue');
 assert.equal(decisions.funding.TREE.allocationBasisPoints,null);
 assert.equal(decisions.guardrails.treeBudgetFromGameReceipts,false);
});
test('10 percent of partner treasury is approved; no live allocation or trading enabled',()=>{
 for(const k of ['BOOM','VICTORY']){
  assert.equal(decisions.funding[k].allocationBasisPoints,1000);
  assert.equal(decisions.funding[k].status,'approved_rate_not_activated');
  assert.equal(decisions.funding[k].approvedAt,'2026-10-02T01:50:52Z');
  assert.equal(decisions.funding[k].illustrativeBasisPoints,undefined);
  assert.equal(decisions.partnerCoinTypes[k],null);
 }
 assert.equal(decisions.deploymentAuthorized,false);assert.equal(decisions.tokenPurchasesAuthorized,false);
});
test('30 SUI no-referral allocation reconciles exactly',()=>{
 assert.deepEqual(splitShop('30000000000',false),{grossMist:30000000000n,referralMist:0n,poolMist:21000000000n,developerMist:600000000n,treasuryMist:8400000000n});
 assert.equal(scenarioBudget('8400000000',1000),840000000n);
});
test('30 SUI referred allocation reconciles exactly',()=>{
 assert.deepEqual(splitShop('30000000000',true),{grossMist:30000000000n,referralMist:300000000n,poolMist:20790000000n,developerMist:594000000n,treasuryMist:8316000000n});
 assert.equal(scenarioBudget('8316000000',1000),831600000n);
});
test('integer conservation and rounding hold across 10000 synthetic price cases',()=>{
 for(let i=0n;i<10000n;i++){
  const x=splitShop(i*7919n,i%2n===0n);
  assert.equal(x.grossMist,x.referralMist+x.poolMist+x.developerMist+x.treasuryMist);
  for(const k of [0,1,1000,2500,10000])assert.ok(scenarioBudget(x.treasuryMist,k)<=x.treasuryMist);
 }
});
test('u64 maximum stays exact without float conversion',()=>{
 const x=splitShop(U64_MAX,true);assert.equal(x.grossMist,x.referralMist+x.poolMist+x.developerMist+x.treasuryMist);
 assert.equal(mist(U64_MAX.toString()),U64_MAX);
});
for(const value of [-1,1,1.5,'-1','1.5','1e9','01',' 1','',null,undefined,{},U64_MAX+1n]){
 test('reject unsafe or noncanonical MIST input '+String(value),()=>assert.throws(()=>mist(value)));
}
test('eligibility cannot be guessed from a truthy value',()=>assert.throws(()=>splitShop('30000000000','yes')));
test('invalid percentage is rejected',()=>{for(const b of [-1,10001,2.5,'2500',null])assert.throws(()=>scenarioBudget('1000',b));});
test('BOOM and Victory quantities and budgets stay separate',()=>{
 const x=report([noRef,ref,exampleSale(3,6)]);
 assert.equal(x.rows.length,2);assert.equal(x.rows[0].paidChestCount,'2');assert.equal(x.rows[1].paidChestCount,'1');
 assert.equal(x.rows[0].tokenTarget,'BOOM');assert.equal(x.rows[1].tokenTarget,'VICTORY');
 assert.equal(x.rows[0].scenarioBudgetMist,'1671600000');assert.equal(x.rows[1].scenarioBudgetMist,'840000000');
});
test('regular crate gross is not a TREE or partner acquisition budget',()=>{
 const x=report([exampleSale(3,0)]);assert.equal(x.rows[0].tokenTarget,null);assert.equal(x.rows[0].scenarioBudgetMist,null);
});
test('duplicate receipt ingestion is idempotent',()=>{
 const x=report([noRef,clone(noRef)]);assert.equal(x.rows[0].paidChestCount,'1');assert.equal(x.duplicateInputRecordsIgnored,1);
});
test('normalized address casing cannot double count',()=>{
 const a=clone(noRef);a.packageId='0xCAFE';a.registryId='0xBEEF';a.receiptId=a.receiptId.toUpperCase().replace('0X','0x');
 const x=report([noRef,a]);assert.equal(x.rows[0].paidChestCount,'1');
});
test('conflicting valid records for one receipt refuse report generation',()=>{
 const a=clone(noRef);a.timestampMs='1600';assert.throws(()=>report([noRef,a]),/conflicting duplicate/);
});
test('one event cannot identify two distinct receipts',()=>{
 const a=clone(noRef);a.receiptId='0x1234';assert.throws(()=>report([noRef,a]),/conflicting duplicate/);
});
test('three paid receipts in one batch count as three',()=>{
 const rr=[1,2,3].map(i=>({...exampleSale(i),transactionDigest:'synthetic-batch',eventIndex:String(i)}));
 assert.equal(report(rr).rows[0].paidChestCount,'3');
});
test('aggregate quantity without per-chest receipts is quarantined',()=>{
 const x=report([{...noRef,quantity:3}]);assert.equal(x.rows.length,0);assert.equal(x.needsReview.length,1);
});
test('opening next season never reattributes an earlier purchase',()=>{
 const a={...noRef,kind:'opening',timestampMs:'3500'};const x=report([noRef,a]);
 assert.equal(x.rows[0].seasonId,'DEMO-1');assert.equal(x.rows[0].paidChestCount,'1');assert.equal(x.excluded[0].reason,'opening');
});
test('start inclusive and end exclusive attribution',()=>{
 const a={...exampleSale(1),timestampMs:'1000'},b={...exampleSale(2),timestampMs:'1999'},c={...exampleSale(3),timestampMs:'2000'};
 const x=report([a,b,c]);assert.equal(x.rows.find(r=>r.seasonId==='DEMO-1').paidChestCount,'2');
 const u=x.rows.find(r=>r.seasonId===null);assert.equal(u.paidChestCount,'1');assert.equal(u.scenarioBudgetMist,null);assert.ok(x.reviewRequired);
});
test('next season remains a separate ledger',()=>{
 const x=report([noRef,exampleSale(4,5,false,'DEMO-2')]);assert.equal(x.rows.length,2);assert.deepEqual(x.rows.map(x=>x.seasonId),['DEMO-1','DEMO-2']);
});
test('an event cannot overwrite checkpoint-derived season attribution',()=>{
 const x=report([{...noRef,seasonId:'DEMO-2'}]);assert.equal(x.rows.length,0);assert.match(x.needsReview[0].reason,/contradicts/);
});
test('overlapping or duplicate seasons rejected',()=>{
 assert.throws(()=>report([],i=>i.seasons[1].startMs='1500'),/overlapping/);
 assert.throws(()=>report([],i=>i.seasons[1].id='DEMO-1'),/duplicate/);
});
test('season must have positive duration and complete frozen price table',()=>{
 assert.throws(()=>report([],i=>i.seasons[0].endMs='1000'));
 assert.throws(()=>report([],i=>delete i.seasons[0].cratePricesMist[0]));
});
test('zero-price and generic legacy purchase events are not counted as paid sales',()=>{
 const a={...noRef,evidenceKind:'CratePurchased'};
 const b={...exampleSale(2),...Object.fromEntries(['grossMist','referralMist','poolMist','developerMist','treasuryMist'].map(k=>[k,'0']))};
 const x=report([a,b]);assert.equal(x.rows.length,0);assert.equal(x.needsReview.length,2);
});
for(const kind of ['opening','transfer','promo','test_inventory','nftree_revenue']){
 test(kind+' does not enter partner revenue',()=>{
  const x=report([{...noRef,kind}]);assert.equal(x.rows.length,0);assert.equal(x.excluded[0].reason,kind);
 });
}
test('failed and unknown transactions are different',()=>{
 const x=report([{...noRef,status:'failure'},{...noRef,status:'pending'}]);
 assert.equal(x.excluded[0].reason,'failed_transaction');assert.equal(x.needsReview.length,1);
});
test('foreign registry/package/network/economy cannot enter approved domain totals',()=>{
 for(const [key,value] of [['registryId','0xdead'],['packageId','0xdead'],['network','sui:testnet'],['economyVersion','1']]){
  const x=report([{...noRef,[key]:value}]);assert.equal(x.rows.length,0);assert.equal(x.excluded[0].reason,'foreign_economy_domain');
 }
});
test('payment allocation mismatches require review',()=>{
 for(const k of ['referralMist','poolMist','developerMist','treasuryMist']){
  const x=report([{...noRef,[k]:(BigInt(noRef[k])+1n).toString()}]);assert.equal(x.rows.length,0);assert.match(x.needsReview[0].reason,/allocation mismatch/);
 }
});
test('gross is actual checkout price, not gross input coin or gas',()=>{
 const x=report([{...noRef,...Object.fromEntries(Object.entries(splitShop('31000000000',false)).map(([k,v])=>[k,v.toString()]))}]);
 assert.equal(x.rows.length,0);assert.match(x.needsReview[0].reason,/frozen season price/);
});
test('historical sales use their frozen season price not a changed current catalogue',()=>{
 const x=report([noRef],i=>{i.seasons[1].cratePricesMist={...i.seasons[1].cratePricesMist,5:'60000000000'};});
 assert.equal(x.rows[0].grossMist,'30000000000');
});
test('coverage limits quarantine newer records',()=>{
 const x=report([noRef],i=>i.coverage.throughCheckpoint='99');assert.equal(x.rows.length,0);assert.ok(x.reviewRequired);
});
test('a partial window never becomes a complete season statement',()=>{
 const x=report([noRef],i=>{i.coverage.throughTimestampMs='1500';i.coverage.allPagesRead=false;});
 assert.equal(x.seasonCoverage[0].suppliedWindowCoversSeason,false);assert.ok(x.reviewRequired);
});
test('coverage is never certified just because input claims all pages read',()=>{
 const x=report([noRef]);assert.equal(x.sourceCoverage.independentlyVerified,false);assert.equal(x.seasonCoverage[0].certification,'none_importer_claim_only');
});
test('import is labeled unverified; fixtures are explicitly not live sales',()=>{
 assert.equal(report([noRef]).status,'SYNTHETIC_DEMO_NOT_LIVE_SALES');
 assert.equal(report([noRef],i=>i.mode='import').status,'UNVERIFIED_IMPORT_NOT_A_PAYMENT_AUTHORIZATION');
});
test('pending is null, never misrepresented as money already reserved or spent',()=>{
 const x=report([noRef]);for(const k of ['authorizedBudgetMist','actuallyReservedMist','spentMist','tokensReceived'])assert.equal(x.rows[0][k],null);
 assert.equal(x.tokenPurchasesAllowed,false);assert.equal(x.liveDeploymentAllowed,false);assert.equal(x.nftreePercentage,null);
});
test('scenario omitted means no implicitly activated policy',()=>{
 const x=report([noRef],i=>delete i.scenarioTreasuryBasisPoints);assert.equal(x.rows[0].scenarioBudgetMist,null);
});
test('activation or execution request is rejected',()=>{
 assert.throws(()=>report([noRef],i=>i.activePartnerBasisPoints=2500));
 assert.throws(()=>report([noRef],i=>i.allowExecution=true));
});
test('scenario change never reduces player allocation',()=>{
 const a=report([noRef],i=>i.scenarioTreasuryBasisPoints=0),b=report([noRef],i=>i.scenarioTreasuryBasisPoints=10000);
 assert.equal(a.rows[0].poolMist,b.rows[0].poolMist);assert.equal(b.rows[0].scenarioBudgetMist,b.rows[0].treasuryMist);
});
test('per-receipt floor not aggregate floor',()=>{
 const rows=[1,2].map(i=>({...exampleSale(i),...Object.fromEntries(Object.entries(splitShop('13',false)).map(([k,v])=>[k,v.toString()]))}));
 const x=report(rows,i=>{i.seasons.forEach(s=>s.cratePricesMist[5]='13');i.scenarioTreasuryBasisPoints=2500;});
 assert.equal(x.rows[0].scenarioBudgetMist,'2');
});
test('JSON exports base-unit integers as exact strings',()=>{
 const x=report([noRef]);assert.equal(JSON.parse(JSON.stringify(x)).rows[0].poolMist,'21000000000');assert.equal(formatSui('20790000000'),'20.790000000');
});
test('CSV protects formula-like text and preserves missing budgets',()=>{
 const x=report([noRef]);x.rows[0].seasonId='=unsafe';const csv=reportCsv(x);
 assert.ok(csv.includes('"\'=unsafe"'));assert.ok(csv.includes('"projection_only_not_reserved"'));assert.ok(csv.includes('"","","",""'));
});
test('synthetic example arithmetic for mixed referrals is exact',()=>{
 const x=buildReport(exampleInput());assert.equal(x.rows[0].paidChestCount,'100');assert.equal(x.rows[0].poolMist,'2095800000000');
 assert.equal(x.rows[0].scenarioBudgetMist,'83832000000');assert.equal(x.rows[1].scenarioBudgetMist,'41916000000');
});
test('module contains no wallet signer or network request implementation',()=>{
 const text=readFileSync(new URL('./ledger.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(text,/\bfetch\s*\(|signAndExecute|executeTransaction\s*\(|setPrivateKey/);
});

// Rate approval does not authorize spending and does not change the player allocation.
test('approved 10 percent applies to treasury, not gross, without changing the pool',()=>{
 for(const referred of [false,true]){
  const row=report([exampleSale(1,5,referred)]).rows[0];
  const original=splitShop('30000000000',referred);
  assert.equal(BigInt(row.scenarioBudgetMist),original.treasuryMist/10n);
  assert.equal(BigInt(row.poolMist),original.poolMist);
  assert.equal(BigInt(row.developerMist),original.developerMist);
  assert.equal(original.treasuryMist-BigInt(row.scenarioBudgetMist),referred?7484400000n:7560000000n);
  assert.equal(row.authorizedBudgetMist,null);assert.equal(row.actuallyReservedMist,null);
 }
});
