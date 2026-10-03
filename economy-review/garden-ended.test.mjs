import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadedGardenTotals,isEndedView} from './garden-ux-model.mjs';
const tool=charges=>({content:{fields:{charges}}});
test('ended totals preserve exact loaded Seed and item counts',()=>{
 assert.deepEqual(loadedGardenTotals([{growthPoints:172},{growthPoints:172}],[tool('3'),tool(2)]),{seeds:'2',growthPoints:'344',items:'2',uses:'5'});
});
test('verified empty inventory may have zero, absent inventory may not',()=>{
 assert.deepEqual(loadedGardenTotals([],[]),{seeds:'0',growthPoints:'0',items:'0',uses:'0'});
 assert.deepEqual(loadedGardenTotals(null,undefined),{seeds:null,growthPoints:null,items:null,uses:null});
});
for(const bad of [null,undefined,'',-1,1.2,'1.2','1e3',' 1','01',false,{},Number.MAX_SAFE_INTEGER+1]){
 test('malformed count remains unavailable: '+String(bad),()=>{
  const r=loadedGardenTotals([{growthPoints:bad}],[tool(bad)]);
  assert.equal(r.growthPoints,null);assert.equal(r.uses,null);assert.equal(r.seeds,'1');assert.equal(r.items,'1');
 });
}
test('large validated decimal values sum without rounding',()=>{
 const r=loadedGardenTotals([{growthPoints:'9007199254740993'},{growthPoints:2}],[tool('18446744073709551615'),tool('1')]);
 assert.equal(r.growthPoints,'9007199254740995');assert.equal(r.uses,'18446744073709551616');
});
test('missing one record does not report a partial total as a complete total',()=>{
 assert.equal(loadedGardenTotals([{growthPoints:172},{}],[tool(2),{}]).growthPoints,null);
 assert.equal(loadedGardenTotals([{growthPoints:172}],[tool(2),{}]).uses,null);
});
test('snapshot projection leaves original arrays and item charges unchanged',()=>{
 const seeds=Object.freeze([Object.freeze({growthPoints:172})]);const tools=Object.freeze([Object.freeze(tool('2'))]);
 const before=JSON.stringify({seeds,tools});loadedGardenTotals(seeds,tools);assert.equal(JSON.stringify({seeds,tools}),before);
});
for(const phase of ['ended','ended-paused','active','paused','unknown','scheduled','inactive',undefined,'ended-unverified']){
 test('compact view is explicitly limited to ended phases: '+phase,()=>assert.equal(isEndedView(phase),phase==='ended'||phase==='ended-paused'));
}
test('ended layout retains the fresh-read, current-wallet and care guards',()=>{
 const source=fs.readFileSync('economy-review/garden-ux.mjs','utf8');
 assert.match(source,/loadedTotals=loadedGardenTotals\(bridge.seeds\(\),tools\)/);
 assert.match(source,/loadedTotals=null/);
 assert.match(source,/if\(!current\(ticket,address\)\)return/);
 assert.match(source,/seasonal&&\(!fresh\(\)\|\|view\(\).phase!=='active'\)/);
 assert.doesNotMatch(source,/fetch\s*\(|new Transaction|signAndExecute|executeTransaction|moveCall\(|splitCoins\(/);
});
test('closed presentation is scoped, and retained data is not final rewards',()=>{
 const css=fs.readFileSync('economy-review/garden-ux.css','utf8'),s=fs.readFileSync('economy-review/garden-ux.mjs','utf8');
 for(const selector of ['.gc-actions','.gc-dry','#garden-season-rewards'])assert.ok(css.includes('.garden-ux[data-ux-ended="true"] '+selector));
 assert.match(s,/not final season results or confirmed claim amounts/);
 assert.match(s,/unused.hidden=!ended/);
 assert.match(s,/summary.hidden=!ended/);
});
