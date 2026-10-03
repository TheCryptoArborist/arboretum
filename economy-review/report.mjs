/** Render an input report only; there is no live fetch or transaction path. */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildReport, reportCsv} from './ledger.mjs';
try {
  const [inputPath, outPath] = process.argv.slice(2);
  if (!inputPath || !outPath || process.argv.length !== 4) throw new Error('Usage: node economy-review/report.mjs INPUT.json OUTPUT_DIRECTORY');
  const input = JSON.parse(readFileSync(resolve(inputPath),'utf8'));
  const report = buildReport(input);
  const out = resolve(outPath); mkdirSync(out,{recursive:true});
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(out,'report.csv'),reportCsv(report));
  console.log(`${report.status}: ${report.rows.length} grouped rows; ${report.needsReview.length} records need review. No funds moved.`);
} catch (error) {
  console.error(`Report not generated: ${error.message}`);
  process.exitCode = 1;
}
