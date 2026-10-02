import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {buildReport, splitShop, reportCsv} from './ledger.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export const decisions = JSON.parse(readFileSync(resolve(here, 'decisions.json'), 'utf8'));
const domain = {network:'sui:mainnet', packageId:'0xcafe', registryId:'0xbeef', economyVersion:'2'};
const stringify = v => JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
export function exampleSale(i, tier = 5, referred = false, season = 'DEMO-1') {
  const gross = decisions.crates[tier].priceMist;
  return stringify({kind:'paid_chest', status:'success', evidenceKind:'reconciled_paid_receipt_v1',
    ...domain, receiptId:'0x'+(i+1000).toString(16), transactionDigest:'synthetic-transaction-'+i,
    eventIndex:'0', checkpoint:String(i+100), timestampMs: season==='DEMO-1'?'1500':'3500',
    tier, referralEligible:referred, ...splitShop(gross,referred)});
}
export function exampleInput(records) {
  const prices=Object.fromEntries(decisions.crates.map(x=>[x.tier,x.priceMist]));
  return {mode:'fixture',domain,
    seasons:[{id:'DEMO-1',startMs:'1000',endMs:'2000',cratePricesMist:prices},
      {id:'DEMO-2',startMs:'3000',endMs:'4000',cratePricesMist:prices}],
    scenarioTreasuryBasisPoints:2500,
    coverage:{fromTimestampMs:'1000',throughTimestampMs:'5000',throughCheckpoint:'999999',allPagesRead:true,queryErrors:false},
    records:records??[
      ...Array.from({length:100},(_,i)=>exampleSale(i,5,i>=80)),
      ...Array.from({length:50},(_,i)=>exampleSale(i+100,6,i>=40))
    ]};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const out=resolve(here,'example-output'); mkdirSync(out,{recursive:true});
  const input=exampleInput(), report=buildReport(input);
  writeFileSync(resolve(out,'synthetic-input.json'),JSON.stringify(input,null,2)+'\n');
  writeFileSync(resolve(out,'synthetic-season-report.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(out,'synthetic-season-report.csv'),reportCsv(report));
  console.log(JSON.stringify({status:report.status,rows:report.rows,transactionsSubmitted:0},null,2));
}
