/** Explicit, one-shot read; no scheduled polling or financial actions. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readCurrentPartnerSeason,partnerReportCsv} from './live-reader.mjs';
const out=resolve(process.argv[2]||'economy-review-results/live-read');mkdirSync(out,{recursive:true});
try{
 const report=await readCurrentPartnerSeason();
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(resolve(out,'report.csv'),partnerReportCsv(report));
 const summary={status:report.status,retrievedAt:report.retrievedAt,season:report.season,coverage:report.coverage,
   rows:report.rows,needsReview:report.needsReview,unassignedEvents:report.unassignedEvents.length,
   transactionCount:report.evidence.transactions.length,transactionsSubmitted:0,productionActivated:false};
 writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
 if(!report.coverage.complete)process.exitCode=2;
}catch(e){writeFileSync(resolve(out,'failure.json'),JSON.stringify({status:'READ_FAILED',message:e.message,transactionsSubmitted:0},null,2));console.error(e.message);process.exitCode=1;}
