/** Read-only Sui GraphQL adapter. The pinned existing deployment is TEST ECONOMY.
 * Exact-price simple purchase PTBs only; unsupported payments are held for review.
 * No keys, wallet connections, mutations, simulations, swaps, or custody.
 */
import {splitShop} from './ledger.mjs';
export const DEPLOYMENT = Object.freeze({
  endpoint:'https://graphql.mainnet.sui.io/graphql',
  chainIdentifier:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
  packageId:'0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724',
  typeOrigin:'0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b',
  registryId:'0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50',
  treasuryWallet:'0x6f1020c2fd6c91129f7cb5e0d651295e87f7245f96b7d090715c89b38197e77f',
  economy:'legacy_testing', exactPriceMist:'10000000', durationMs:2592000000,
  partnerRateBps:1000, productionActivated:false
});
const TYPE = `${DEPLOYMENT.typeOrigin}::arboretum::`;
const SUI = '0x'+'2'.padStart(64,'0')+'::sui::SUI';
const A = x => { if(typeof x!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(x))throw Error('Invalid address');return '0x'+x.slice(2).toLowerCase().padStart(64,'0'); };
const uint = x => {if(typeof x==='number'&&!Number.isSafeInteger(x))throw Error('Unsafe integer');if(!/^(0|[1-9]\d*)$/.test(String(x))||BigInt(x)>18446744073709551615n)throw Error('Invalid unsigned value');return BigInt(x);};
const seq = x => {if(!Number.isSafeInteger(x)||x<0)throw Error('Invalid checkpoint/index');return x;};
const ms = x => {const n=Date.parse(x);if(!Number.isSafeInteger(n)||n<0)throw Error('Missing or invalid timestamp');return n;};
const jsonSafe = x => JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));
import {READ_QUERIES as Q} from './read-queries.mjs';
export {Q as READ_QUERIES};
/** Only named, fixed read queries are accepted; callers cannot submit GraphQL text. */
export function createReaderClient({fetchImpl=globalThis.fetch,signal,timeoutMs=20000}={}) {
  return async function read(name,variables={}) {
    if(!Object.hasOwn(Q,name))throw Error('Unsupported read operation');
    for(let attempt=0;attempt<3;attempt++){
      const timeout=AbortSignal.timeout(timeoutMs);
      const merged=signal?AbortSignal.any([signal,timeout]):timeout;
      let r;
      try {r=await fetchImpl(DEPLOYMENT.endpoint,{method:'POST',redirect:'error',credentials:'omit',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({query:Q[name],variables}),signal:merged});}
      catch(e){throw Error(signal?.aborted?'Read cancelled':'Sui read unavailable; no complete report was produced');}
      if([429,502,503,504].includes(r.status)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));continue;}
      if(!r.ok)throw Error(`Sui read failed (HTTP ${r.status})`);
      const body=await r.json();
      if(body.errors?.length||!body.data)throw Error('Sui query '+name+' failed; partial data were not accepted: '+String(body.errors?.[0]?.message||'no data').slice(0,200));
      return body.data;
    }
    throw Error('Sui read retry limit');
  };
}
function pure(inputs,arg,width){
  if(arg?.kind!=='INPUT'||!Number.isInteger(arg.input))throw Error('Unsupported pure input');
  const input=inputs[arg.input];if(input?.kind!=='PURE'||typeof input.pure!=='string')throw Error('Missing pure bytes');
  const decoded=atob(input.pure);if(decoded.length!==width)throw Error('Unexpected BCS width');
  let n=0n;for(let i=width-1;i>=0;i--)n=(n<<8n)+BigInt(decoded.charCodeAt(i));return n;
}
function isTargetRegistry(inputs,arg){return arg?.kind==='INPUT'&&inputs[arg.input]?.kind==='SHARED'&&A(inputs[arg.input].objectId)===DEPLOYMENT.registryId;}
function payment(inputs,commands,arg,callIndex,used){
  if(arg?.kind!=='RESULT'||!Number.isInteger(arg.result)||arg.result>=callIndex)throw Error('Unsupported payment result');
  const sub=arg.subresult??0,key=`${arg.result}:${sub}`;
  if(used.has(key))throw Error('Payment result reused');used.add(key);
  const split=commands[arg.result]?.splitCoins;
  if(!split||split.coin?.kind!=='GAS'||!Number.isInteger(sub)||sub<0)throw Error('Only exact gas-split payments supported');
  return pure(inputs,split.amounts[sub],8);
}
/** Verify source facts for a tightly scoped legacy transaction, never infer production rates. */
export function verifyTransaction(tx){
  try {
    if(tx?.effects?.status!=='SUCCESS')throw Error('Transaction not successful');
    if(tx.effects.events?.pageInfo?.hasNextPage!==false)throw Error('Incomplete transaction events');
    const j=tx.transactionJson,ptb=j?.kind?.programmableTransaction;
    if(j?.digest!==tx.digest||j?.kind?.kind!=='PROGRAMMABLE_TRANSACTION'||!Array.isArray(ptb?.inputs)||!Array.isArray(ptb?.commands))throw Error('Unsupported transaction representation');
    const {inputs,commands}=ptb,sender=A(j.sender),buyer=sender;
    const events=tx.effects.events.nodes;
    if(!Array.isArray(events))throw Error('Missing events');
    const purchases=events.filter(e=>e.contents?.type?.repr===TYPE+'CratePurchased');
    const hasRegistry=inputs.some(i=>i.kind==='SHARED'&&A(i.objectId)===DEPLOYMENT.registryId);
    if(!hasRegistry)return {status:'excluded',reason:'foreign_registry',receipts:[]};
    if(commands.some(c=>c.moveCall?.function==='send_promo_crate'))return {status:'review',reason:'promotional_or_mixed_transaction_not_counted_as_paid',receipts:[]};
    const calls=[],used=new Set();
    for(let i=0;i<commands.length;i++){
      const command=commands[i];if(Object.keys(command).length!==1)throw Error('Ambiguous command');
      if(command.splitCoins){if(command.splitCoins.coin?.kind!=='GAS')throw Error('Unsupported split');continue;}
      const call=command.moveCall;
      if(!call||A(call.package)!==DEPLOYMENT.packageId||call.module!=='arboretum'||!['buy_crate','buy_boom_chest','buy_victory_chest'].includes(call.function))throw Error('Unsupported or mixed call path');
      if(call.typeArguments?.length)throw Error('Unexpected type arguments');
      const args=call.arguments;if(!Array.isArray(args)||!isTargetRegistry(inputs,args[0]))throw Error('Foreign registry argument');
      const generic=call.function==='buy_crate';if(args.length!==(generic?3:2))throw Error('Unexpected call signature');
      const tier=generic?Number(pure(inputs,args[1],1)):call.function==='buy_boom_chest'?5:6;
      if(tier<0||tier>6)throw Error('Unsupported tier');
      const amount=payment(inputs,commands,args[generic?2:1],i,used);
      if(amount!==BigInt(DEPLOYMENT.exactPriceMist))throw Error('Tendered amount not exact pinned testing price; change is not inferred');
      calls.push({tier,amount});
    }
    if(!calls.length||calls.length!==purchases.length)throw Error('Purchase count does not match calls');
    // Require event ordering and ownership to bind each paid call to a distinct chest.
    let prior=-1;const ids=new Set(),receipts=[];
    for(let i=0;i<purchases.length;i++){
      const e=purchases[i],f=e.contents.json,call=calls[i],index=seq(e.sequenceNumber);
      if(index<=prior||f.tier!==call.tier||A(f.buyer)!==buyer||ids.has(A(f.crate_id)))throw Error('Purchase event mismatch');
      ids.add(A(f.crate_id));
      const refs=events.filter(v=>v.sequenceNumber>prior&&v.sequenceNumber<index&&v.contents?.type?.repr===TYPE+'ReferralPaid');
      if(refs.length>1)throw Error('Ambiguous referral events');
      const split=splitShop(call.amount,refs.length===1);
      if(refs.length){const ref=refs[0].contents.json;if(A(ref.referee)!==buyer||A(ref.referrer)===buyer||uint(ref.amount_mist)!==split.referralMist)throw Error('Referral mismatch');}
      receipts.push({receiptId:A(f.crate_id),tier:call.tier,buyer,transactionDigest:tx.digest,eventIndex:String(index),
        checkpoint:String(seq(tx.effects.checkpoint?.sequenceNumber)),timestampMs:String(ms(tx.effects.checkpoint?.timestamp)),...split,
        evidence:'exact_pinned_price_successful_purchase_and_transaction_treasury_credit'});
      prior=index;
    }
    if(events.some(e=>![TYPE+'CratePurchased',TYPE+'ReferralPaid'].includes(e.contents?.type?.repr)))throw Error('Unexpected mixed transaction event');
    if(events.filter(e=>e.contents?.type?.repr===TYPE+'ReferralPaid').length!==receipts.filter(r=>r.referralMist>0n).length)throw Error('Unmatched referral');
    // Receiving treasury must not also pay gas or buy, otherwise net changes obscure proceeds.
    if(sender===DEPLOYMENT.treasuryWallet||A(j.gasPayment?.owner)===DEPLOYMENT.treasuryWallet)throw Error('Treasury netting requires manual reconciliation');
    const balances=tx.effects.balanceChangesJson;if(!Array.isArray(balances))throw Error('Missing balance evidence');
    const matched=balances.filter(b=>A(b.address)===DEPLOYMENT.treasuryWallet&&b.coinType===SUI);
    if(matched.length!==1||!/^\d+$/.test(matched[0].amount))throw Error('Missing or ambiguous treasury credit');
    const actual=uint(matched[0].amount),expected=receipts.reduce((s,r)=>s+r.treasuryMist,0n);
    if(actual!==expected)throw Error('Actual treasury credit differs from pinned routing');
    return {status:'verified_test_payment',treasuryCreditMist:String(actual),receipts:jsonSafe(receipts)};
  } catch(e){return {status:'review',reason:e.message,receipts:[]};}
}
export function validateState(state){
  if(state?.chainIdentifier!==DEPLOYMENT.chainIdentifier)throw Error('Wrong Sui network');
  const r=state.registry,f=r?.asMoveObject?.contents?.json;
  if(A(r?.address)!==DEPLOYMENT.registryId||r.asMoveObject.contents.type?.repr!==TYPE+'Registry')throw Error('Wrong registry/type');
  const storedStart=Number(uint(f.season_start_ms));if(!Number.isSafeInteger(storedStart)||!storedStart)throw Error('No current season. A verified archived-season descriptor is required.');
  const first=state.serviceConfig?.availableRange?.first,last=state.serviceConfig?.availableRange?.last;
  if(!first||!last)throw Error('Endpoint did not provide historical coverage');
  const tip=state.checkpoint,watermark=seq(last.sequenceNumber)<seq(tip.sequenceNumber)?last:tip;
  return {id:String(uint(f.current_season_id)),storedStartMs:storedStart,endMs:storedStart+DEPLOYMENT.durationMs,
    currentRegistryVersion:String(r.version),watermark:{sequenceNumber:seq(watermark.sequenceNumber),timestamp:watermark.timestamp},
    earliestTimestampMs:ms(first.timestamp),throughTimestampMs:ms(watermark.timestamp)};
}
export async function getTransaction(read,digest,maxEventPages=10){
  let after=null,tx=null,nodes=[],seen=new Set();
  for(let p=0;p<maxEventPages;p++){
    const data=await read('transaction',{digest,after}),t=data.transaction;
    if(!t||t.digest!==digest)throw Error('Transaction unavailable');
    if(tx&&(JSON.stringify(tx.transactionJson)!==JSON.stringify(t.transactionJson)||JSON.stringify(tx.effects.checkpoint)!==JSON.stringify(t.effects.checkpoint)||tx.effects.status!==t.effects.status||JSON.stringify(tx.effects.balanceChangesJson)!==JSON.stringify(t.effects.balanceChangesJson)))throw Error('Transaction changed across pages');
    tx??=t;const c=t.effects?.events;if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')throw Error('Malformed event connection');
    for(const e of c.nodes){const key=String(seq(e.sequenceNumber));if(seen.has(key))throw Error('Duplicate transaction event');seen.add(key);nodes.push(e);}
    if(!c.pageInfo.hasNextPage){tx.effects.events={nodes,pageInfo:{hasNextPage:false}};return tx;}
    if(!c.pageInfo.endCursor||after===c.pageInfo.endCursor)throw Error('Transaction pagination stalled');after=c.pageInfo.endCursor;
  }
  throw Error('Transaction event page limit; evidence incomplete');
}
/** Bounded backward scan at a fixed checkpoint; failures remain explicit. */
export async function scanEvents(read,type,{watermark,startMs,maxPages=30,pageSize=30}){
  let before=null,complete=false,earliestSeen=null;const nodes=[],keys=new Map(),cursors=new Set();
  for(let p=0;p<maxPages;p++){
    const data=await read('events',{type,before,ceiling:watermark+1,size:pageSize});
    const c=data.events;if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasPreviousPage!=='boolean')throw Error('Malformed root event page');
    for(const e of c.nodes){
      const cp=e.transaction?.effects?.checkpoint;
      if(!cp||seq(cp.sequenceNumber)>watermark)throw Error('Event beyond checkpoint watermark');
      const stamp=ms(cp.timestamp);earliestSeen=earliestSeen===null?stamp:Math.min(stamp,earliestSeen);
      if(e.contents?.type?.repr!==type)throw Error('Event filter returned wrong type');
      const key=`${e.transaction.digest}:${seq(e.sequenceNumber)}`,fp=JSON.stringify(e);
      if(keys.has(key)&&keys.get(key)!==fp)throw Error('Contradictory duplicate event');
      if(!keys.has(key)){keys.set(key,fp);if(stamp>=startMs)nodes.push(e);}
    }
    if(earliestSeen!==null&&earliestSeen<startMs||!c.pageInfo.hasPreviousPage){complete=true;break;}
    const next=c.pageInfo.startCursor;if(!next||cursors.has(next))throw Error('Event pagination stalled');cursors.add(next);before=next;
  }
  return {nodes,allPagesRead:complete,earliestSeen};
}
export async function readCurrentPartnerSeason({read=createReaderClient(),onProgress=()=>{},maxPages=30}={}){
  const state=await read('state',{registry:DEPLOYMENT.registryId}),season=validateState(state);
  onProgress('Checking the season boundary and confirmed purchase events…');
  const options={watermark:season.watermark.sequenceNumber,startMs:season.storedStartMs,maxPages};
  // start_season_with_duration backdates stored_start. Use the actual start transaction event.
  const starts=await scanEvents(read,TYPE+'SeasonStarted',options);
  const possible=starts.nodes.filter(e=>String(e.contents.json.season_id)===season.id&&e.transaction.effects.status==='SUCCESS');
  if(possible.length!==1)throw Error('Season opening could not be uniquely verified');
  const started=await getTransaction(read,possible[0].transaction.digest);
  const startInput=started.transactionJson?.kind?.programmableTransaction?.inputs??[];
  if(!startInput.some(x=>x.kind==='SHARED'&&A(x.objectId)===DEPLOYMENT.registryId))throw Error('Season opening belongs to another registry');
  if(started.effects.status!=='SUCCESS'||!started.effects.events.nodes.some(e=>e.sequenceNumber===possible[0].sequenceNumber&&JSON.stringify(e.contents)===JSON.stringify(possible[0].contents)))throw Error('Season opening transaction evidence mismatch');
  const eventStart=Number(uint(possible[0].contents.json.start_ms));
  const startMs=Math.max(season.storedStartMs,eventStart,ms(started.effects.checkpoint.timestamp));
  if(startMs>=season.endMs)throw Error('Invalid season boundary');
  return readSeasonReceipts({read,onProgress,maxPages,state,season,startMs,seasonStartEvent:possible[0],seasonStartTransaction:started});
}
/** Shared receipt reconciliation, used only after the public reader validates its boundary. */
export async function readSeasonReceipts({read,onProgress=()=>{},maxPages=30,state,season,startMs,seasonStartEvent,seasonStartTransaction,receiptEndMs=season.endMs,trackUnassigned=true}){
  const scan=await scanEvents(read,TYPE+'CratePurchased',{watermark:season.watermark.sequenceNumber,maxPages,startMs});
  const candidates=scan.nodes.filter(e=>[5,6].includes(e.contents.json?.tier)&&ms(e.transaction.effects.checkpoint.timestamp)<receiptEndMs);
  const outside=trackUnassigned?scan.nodes.filter(e=>[5,6].includes(e.contents.json?.tier)&&ms(e.transaction.effects.checkpoint.timestamp)>=receiptEndMs):[];
  const checked=[],needsReview=[],receipts=new Map();
  for(const digest of new Set(candidates.map(e=>e.transaction.digest))){
    onProgress(`Checking purchase transaction ${checked.length+1}…`);
    let tx,result;
    try {tx=await getTransaction(read,digest);result=verifyTransaction(tx);}
    catch(e){result={status:'review',reason:e.message,receipts:[]};}
    checked.push({digest,result,transaction:tx??null});
    if(result.status==='review')needsReview.push({digest,reason:result.reason});
    for(const r of result.receipts){
      if(![5,6].includes(r.tier))continue;
      if(Number(r.timestampMs)<startMs||Number(r.timestampMs)>=receiptEndMs||Number(r.checkpoint)>season.watermark.sequenceNumber)throw Error('Receipt escaped season boundary');
      if(receipts.has(r.receiptId)&&JSON.stringify(receipts.get(r.receiptId))!==JSON.stringify(r))throw Error('Conflicting receipt');receipts.set(r.receiptId,r);
    }
  }
  const rows=[5,6].map(tier=>{
    const items=[...receipts.values()].filter(r=>r.tier===tier);
    const totals=Object.fromEntries(['grossMist','referralMist','poolMist','developerMist','treasuryMist'].map(k=>[k,String(items.reduce((s,r)=>s+BigInt(r[k]),0n))]));
    return {seasonId:season.id,chest:tier===5?'BOOM':'Victory',tier,paidChestCount:String(items.length),...totals,
      purchaseBudgetMist:null,spentMist:null,tokensReceived:null,unspentMist:null,
      budgetStatus:'testing_receipts_excluded_from_production_allocation'};
  });
  const readComplete=scan.allPagesRead&&season.earliestTimestampMs<=startMs&&needsReview.length===0;
  return {schemaVersion:1,kind:'arboretum-partner-season-read',status:readComplete?'TEST_RECEIPTS_RECONCILED':'PARTIAL_TEST_RECEIPTS_REVIEW_REQUIRED',
    mode:'live_test',retrievedAt:new Date().toISOString(),deployment:DEPLOYMENT,season:{...season,startMs,receiptEndMs},
    coverage:{allPagesRead:scan.allPagesRead,providerCoversStart:season.earliestTimestampMs<=startMs,
      seasonEnded:season.throughTimestampMs>=receiptEndMs,throughCheckpoint:season.watermark.sequenceNumber,
      throughTimestamp:season.watermark.timestamp,earliestAvailableTimestamp:new Date(season.earliestTimestampMs).toISOString(),finalForSeason:readComplete&&season.throughTimestampMs>=receiptEndMs,complete:readComplete,scope:'pinned_type_origin_registry_and_supported_purchase_paths'},
    rows,receipts:[...receipts.values()],needsReview,unassignedEvents:outside,
    observedPartnerEventCount:candidates.length,excludedTestingReceipts:receipts.size,
    evidence:{state,seasonStartEvent,seasonStartTransaction,purchaseEvents:scan.nodes,transactions:checked},
    policy:{partnerTreasuryBasisPoints:1000,status:'approved_not_activated',automaticSwaps:false,
      treasuryWallet:DEPLOYMENT.treasuryWallet,nftreeFunding:'separate_TREE_policy',productionBudgetApplicable:false},
    tokenPurchasesAuthorized:false,transactionsSubmitted:0,
    allocationEvidence:'Tendered exact price and treasury credit reconciled; pool/developer columns are routing-model allocations, not a full historical pool audit.'};
}
export function partnerReportCsv(report){
  const fields=['status','mode','retrievedAt','throughCheckpoint','throughTimestamp','earliestAvailableTimestamp','coverageComplete','finalForSeason','seasonKind','archiveId','receiptStartMs','receiptEndMs','seasonId','chest','paidChestCount','grossMist','referralMist','poolMist','developerMist','treasuryMist','purchaseBudgetMist','spentMist','tokensReceived','unspentMist','budgetStatus'];
  const common={seasonKind:report.season?.kind,archiveId:report.season?.archiveId,receiptStartMs:report.season?.startMs,receiptEndMs:report.season?.receiptEndMs??report.season?.endMs,status:report.status,mode:report.mode,retrievedAt:report.retrievedAt,throughCheckpoint:report.coverage?.throughCheckpoint,throughTimestamp:report.coverage?.throughTimestamp,earliestAvailableTimestamp:report.coverage?.earliestAvailableTimestamp,coverageComplete:report.coverage?.complete,finalForSeason:report.coverage?.finalForSeason};
  const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r\n]/,"'$&").replaceAll('"','""')+'"';
  return [fields.map(cell).join(','),...report.rows.map(row=>{const r={...row,...common};return fields.map(k=>cell(r[k])).join(',');})].join('\r\n')+'\r\n';
}
