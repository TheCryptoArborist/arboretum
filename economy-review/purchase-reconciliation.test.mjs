import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TREASURY, CHAIN, PURCHASE_QUERY, evidenceHash, inspectPurchaseEvidence, fetchPurchaseEvidence, reconcilePartnerPurchases} from './purchase-reconciliation.mjs';
import {exampleInput, exampleSale, decisions} from './example.mjs';
const types = {BOOM:'0xba::boom::BOOM', VICTORY:'0xca::victory::VICTORY'}; // Fictional test types, never live configuration.
const clone = x => structuredClone(x);
function id(n=0) { return '1'.repeat(31) + '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[n]; }
function evidence(n=0, partner='BOOM') {
  return {chainIdentifier:CHAIN, checkpoint:{sequenceNumber:100,timestamp:'1970-01-01T00:00:06.000Z'},
    transaction:{digest:id(n), transactionJson:{digest:id(n),sender:TREASURY,gasPayment:{owner:TREASURY},
      kind:{kind:'PROGRAMMABLE_TRANSACTION',programmableTransaction:{commands:[{moveCall:{package:'0xaa',module:'example',function:'fictional_swap'}}]}}},
      effects:{status:'SUCCESS',checkpoint:{sequenceNumber:90,timestamp:'1970-01-01T00:00:05.000Z'},
        balanceChangesJson:[{address:TREASURY,coinType:'0x2::sui::SUI',amount:'-510000000'},
          {address:TREASURY,coinType:types[partner],amount:'1000000'}],
        gasEffects:{gasSummary:{computationCost:'8000000',storageCost:'3000000',storageRebate:'1000000'}}}}};
}
function entry(n=0, partner='BOOM', seasonId='DEMO-1') {
  const e=evidence(n,partner);
  return {seasonId,partner,evidence:e,review:{decision:'partner_purchase_confirmed_for_accounting',
    evidenceSha256:evidenceHash(e),reviewer:'FICTIONAL TEST REVIEWER',note:'Synthetic accounting example, not an executed trade.',reviewedAt:'1970-01-01T00:00:07.000Z'}};
}
const sales = () => exampleInput([exampleSale(1,5,false),exampleSale(2,5,false),exampleSale(3,6,true)]);
function refreshHash(e){e.review.evidenceSha256=evidenceHash(e.evidence);return e;}

test('approval and wallet policy remain unchanged and coin types unconfigured',()=>{
  assert.equal(decisions.funding.BOOM.allocationBasisPoints,1000);
  assert.equal(decisions.funding.VICTORY.allocationBasisPoints,1000);
  assert.equal(decisions.partnerAccounting.treasuryWallet,TREASURY);
  assert.deepEqual(decisions.partnerCoinTypes,{BOOM:null,VICTORY:null});
  assert.equal(decisions.tokenPurchasesAuthorized,false);
});
test('net treasury debit counts gas exactly once and does not claim a verified swap',()=>{
 const r=inspectPurchaseEvidence(evidence(), 'BOOM', types);
 assert.equal(r.treasuryDebitMist,'510000000');assert.equal(r.gasNetCostMist,'10000000');
 assert.equal(r.nonGasSuiOutflowMist,'500000000');assert.equal(r.tokensReceivedBaseUnits,'1000000');
 assert.equal(r.swapVerified,false);assert.equal(r.transactionsSubmitted,0);
});
test('negative net gas rebate is preserved, not charged a second time',()=>{
 const e=evidence();e.transaction.effects.gasEffects.gasSummary={computationCost:1,storageCost:2,storageRebate:4};
 const r=inspectPurchaseEvidence(e,'BOOM',types);
 assert.equal(r.gasNetCostMist,'-1');assert.equal(r.nonGasSuiOutflowMist,'510000001');
});
const invalid = [
 ['wrong network',e=>e.chainIdentifier='other'],
 ['failure',e=>e.transaction.effects.status='FAILURE'],
 ['unknown status',e=>delete e.transaction.effects.status],
 ['wrong sender',e=>e.transaction.transactionJson.sender='0x3'],
 ['other gas payer',e=>e.transaction.transactionJson.gasPayment.owner='0x3'],
 ['wrong digest',e=>e.transaction.transactionJson.digest=id(2)],
 ['invalid digest',e=>e.transaction.digest='not-a-digest'],
 ['future checkpoint',e=>e.transaction.effects.checkpoint.sequenceNumber=101],
 ['future time',e=>e.transaction.effects.checkpoint.timestamp='1970-01-01T00:00:08.000Z'],
 ['missing checkpoint',e=>delete e.transaction.effects.checkpoint],
 ['no balances',e=>delete e.transaction.effects.balanceChangesJson],
 ['ambiguous credit',e=>e.transaction.effects.balanceChangesJson.push(clone(e.transaction.effects.balanceChangesJson[1]))],
 ['wrong received token',e=>e.transaction.effects.balanceChangesJson[1].coinType=types.VICTORY],
 ['wrong destination',e=>e.transaction.effects.balanceChangesJson[1].address='0x3'],
 ['no token credit',e=>e.transaction.effects.balanceChangesJson[1].amount='0'],
 ['token debit',e=>e.transaction.effects.balanceChangesJson[1].amount='-1'],
 ['no SUI debit',e=>e.transaction.effects.balanceChangesJson[0].amount='1'],
 ['numeric balance',e=>e.transaction.effects.balanceChangesJson[0].amount=-1],
 ['missing gas',e=>delete e.transaction.effects.gasEffects],
 ['unsafe gas number',e=>e.transaction.effects.gasEffects.gasSummary.computationCost=Number.MAX_SAFE_INTEGER+1],
 ['no non-gas outflow',e=>e.transaction.effects.balanceChangesJson[0].amount='-10000000'],
 ['mixed treasury assets',e=>e.transaction.effects.balanceChangesJson.push({address:TREASURY,coinType:'0xda::other::OTHER',amount:'1'})],
 ['non-PTB',e=>e.transaction.transactionJson.kind.kind='SYSTEM'],
 ['missing commands',e=>e.transaction.transactionJson.kind.programmableTransaction.commands=[]]
];
for(const [name,mutate] of invalid)test(`hold unsupported evidence: ${name}`,()=>{
 const e=evidence();mutate(e);assert.throws(()=>inspectPurchaseEvidence(e,'BOOM',types));
});
test('unknown types and ticker substitution are not inferred',()=>{
 assert.throws(()=>inspectPurchaseEvidence(evidence(),'BOOM',decisions.partnerCoinTypes));
 assert.throws(()=>inspectPurchaseEvidence(evidence(),'BOOM',{BOOM:'BOOM'}));
 assert.throws(()=>inspectPurchaseEvidence(evidence(),'BOOM',{BOOM:types.BOOM,VICTORY:types.BOOM}));
 assert.throws(()=>inspectPurchaseEvidence(evidence(),'BOOM',{BOOM:'0x2::sui::SUI'}));
});
test('reordered JSON keys hash identically',()=>{
 const e=evidence(), x={transaction:e.transaction,checkpoint:e.checkpoint,chainIdentifier:e.chainIdentifier};
 assert.equal(evidenceHash(x),evidenceHash(e));
});
test('separate partner totals, exact remainder and later-season execution attribution',()=>{
 const r=reconcilePartnerPurchases(sales(),[entry(0),entry(1,'VICTORY')],types);
 assert.equal(r.rows[0].budgetProjectionMist,'1680000000');
 assert.equal(r.rows[0].recordedTreasuryDebitMist,'510000000');
 assert.equal(r.rows[0].budgetLessRecordedSpendProjectionMist,'1170000000');
 assert.equal(r.rows[1].budgetProjectionMist,'831600000');
 assert.equal(r.rows[1].budgetLessRecordedSpendProjectionMist,'321600000');
 assert.equal(r.status,'SYNTHETIC_RECONCILIATION_NOT_LIVE');
 assert.equal(r.rows[0].actualUnspentCashMist,null);assert.equal(r.tokenPurchasesAuthorized,false);
 assert.equal(r.matched[0].seasonId,'DEMO-1'); // Transaction time is after DEMO-1 ended.
});
test('multiple purchases use budget once each; over-budget records are shown, not hidden',()=>{
 const r=reconcilePartnerPurchases(sales(),[entry(0),entry(1),entry(2),entry(3)],types);
 const row=r.rows[0];assert.equal(row.recordedTreasuryDebitMist,'2040000000');
 assert.equal(row.journalOverBudget,true);assert.equal(row.amountMissingFromBudgetProjectionMist,'360000000');
 assert.equal(row.budgetLessRecordedSpendProjectionMist,'-360000000');
});
for(const target of ['same season','different season','different partner'])test(`duplicate transaction rejected: ${target}`,()=>{
 const a=entry(),b=clone(a);if(target==='different season')b.seasonId='DEMO-2';if(target==='different partner')b.partner='VICTORY';
 assert.throws(()=>reconcilePartnerPurchases(sales(),[a,b],types),/Duplicate/);
});
for(const [name,mutate] of [
 ['missing human review',e=>delete e.review],
 ['stale evidence hash',e=>e.evidence.transaction.effects.balanceChangesJson[1].amount='999'],
 ['empty reviewer',e=>e.review.reviewer=' '],
 ['empty note',e=>e.review.note=''],
 ['review predates transaction',e=>e.review.reviewedAt='1970-01-01T00:00:01.000Z'],
 ['unknown season',e=>e.seasonId='absent'],
 ['purchase predates season',e=>{e.evidence.transaction.effects.checkpoint.timestamp='1970-01-01T00:00:00.000Z';refreshHash(e);}],
 ['not a partner',e=>e.partner='TREE']
])test(`journal review remains explicit: ${name}`,()=>{
 const e=entry();mutate(e);const r=reconcilePartnerPurchases(sales(),[e],types);
 assert.equal(r.needsReview.length,1);assert.equal(r.matched.length,0);
 assert.equal(r.rows[0].budgetLessRecordedSpendProjectionMist,null);
});
test('unconfigured real partner types leave entries pending and amount available unknown',()=>{
 const r=reconcilePartnerPurchases(sales(),[entry()],decisions.partnerCoinTypes);
 assert.equal(r.needsReview.length,1);assert.equal(r.rows[0].balanceAvailableToSpendMist,null);
});
test('partial sales coverage cannot yield a spendable remainder',()=>{
 const s=sales();s.coverage.fromTimestampMs='1400';const r=reconcilePartnerPurchases(s,[entry()],types);
 assert.equal(r.rows[0].recordedTreasuryDebitMist,'510000000');
 assert.equal(r.rows[0].budgetLessRecordedSpendProjectionMist,null);
});
test('sales needing review block the remainder but keep known reviewed spending visible',()=>{
 const s=sales();s.records.push({status:'unknown'});const r=reconcilePartnerPurchases(s,[entry()],types);
 assert.equal(r.rows[0].recordedTreasuryDebitMist,'510000000');
 assert.equal(r.rows[0].status,'REVIEW_REQUIRED');
});
test('imported self-asserted evidence never becomes independently verified',()=>{
 const s=sales();s.mode='import';const r=reconcilePartnerPurchases(s,[entry()],types);
 assert.equal(r.status,'REVIEW_RECONCILIATION_NOT_AUDITED');
 assert.equal(r.rows[0].coverageIndependentlyVerified,false);
 assert.equal(r.rows[0].actualUnspentCashMist,null);
});
test('an empty supplied journal is not proof of zero actual wallet spend',()=>{
 const r=reconcilePartnerPurchases(sales(),[],types);
 assert.equal(r.rows[0].recordedTreasuryDebitMist,'0');
 assert.equal(r.rows[0].actualUnspentCashMist,null);
 assert.match(r.journalCoverage,/not_a_wallet_history_audit/);
});
test('no accidental rate or network substitution',()=>{
 const s=sales();s.scenarioTreasuryBasisPoints=2500;assert.throws(()=>reconcilePartnerPurchases(s,[],types));
 s.scenarioTreasuryBasisPoints=1000;s.domain.network='sui:testnet';assert.throws(()=>reconcilePartnerPurchases(s,[],types));
});
test('point reader sends one fixed query, no credentials and no transaction submission',async()=>{
 let calls=0;const e=evidence();const result=await fetchPurchaseEvidence(id(),{fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,'https://graphql.mainnet.sui.io/graphql');
  assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');
  assert.deepEqual(JSON.parse(opts.body),{query:PURCHASE_QUERY,variables:{digest:id()}});
  return {ok:true,json:async()=>({data:e})};
 }});assert.equal(calls,1);assert.deepEqual(result,e);
});
for(const [name,response] of [
 ['http',{ok:false,status:429}],
 ['partial',{ok:true,json:async()=>({data:evidence(),errors:[{message:'partial'}]})}],
 ['wrong network',{ok:true,json:async()=>({data:{...evidence(),chainIdentifier:'other'}})}],
 ['missing transaction',{ok:true,json:async()=>({data:{chainIdentifier:CHAIN,transaction:null}})}]
])test(`point reader rejects ${name}`,async()=>{
 await assert.rejects(fetchPurchaseEvidence(id(),{fetchImpl:async()=>response}));
});
test('invalid digest rejected before network call',async()=>{
 await assert.rejects(fetchPurchaseEvidence('not-a-digest',{fetchImpl:async()=>assert.fail('network must not be called')}));
});
test('source contains no signer, mutation or automatic swap implementation',()=>{
 const source=fs.readFileSync(new URL('./purchase-reconciliation.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/signAndExecute|executeTransaction\s*\(|mutation\s*\{/);
});
