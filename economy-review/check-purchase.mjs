/** Developer point-read helper. No signing; leaves classification pending. */
import fs from 'node:fs';
import {fetchPurchaseEvidence, inspectPurchaseEvidence} from './purchase-reconciliation.mjs';
const [partner, txDigest, outputFile] = process.argv.slice(2);
try {
  if (!['BOOM','VICTORY'].includes(partner) || !txDigest || !outputFile) {
    throw Error('Usage: node economy-review/check-purchase.mjs BOOM|VICTORY TRANSACTION_DIGEST NEW_OUTPUT.json');
  }
  if (fs.existsSync(outputFile)) throw Error('Refusing to overwrite an existing evidence file');
  const config = JSON.parse(fs.readFileSync(new URL('./decisions.json',import.meta.url),'utf8'));
  if (!config.partnerCoinTypes?.[partner]) {
    throw Error('Canonical partner coin type is not configured. No network read or token purchase attempted.');
  }
  const evidence = await fetchPurchaseEvidence(txDigest);
  const movement = inspectPurchaseEvidence(evidence,partner,config.partnerCoinTypes);
  const reviewPackage = {status:'PURPOSE_REVIEW_PENDING', partner, evidence, movement,
    reviewTemplate:{decision:'pending',reviewer:'',note:'',reviewedAt:null,evidenceSha256:movement.evidenceSha256},
    transactionsSubmitted:0,tokenPurchasesAuthorized:false};
  fs.writeFileSync(outputFile,JSON.stringify(reviewPackage,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Saved one transaction for manual accounting review. No swap was executed or automatically classified.');
} catch (error) {
  console.error(error.message); process.exitCode=1;
}
