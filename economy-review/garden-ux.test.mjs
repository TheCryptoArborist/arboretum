import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {care,counts,matches,growth,slotOrder,advice,WATER_READY_MS,duration} from './garden-ux-model.mjs';
import {transform,transformSeason,build} from './build-garden-ux-preview.mjs';
const now=1800000000000,seed=(x={})=>({objectId:'a',state:'alive',rawState:0,lastWatered:now-WATER_READY_MS,streak:2,growthPoints:50,...x});
for(const [name,s,kind]of [
 ['ready boundary',seed(),'ready'],['before boundary',seed({lastWatered:now-WATER_READY_MS+1}),'waiting'],
 ['dead first',seed({state:'dead',bottomlessExpiry:now+1000}),'dead'],
 ['protection excluded',seed({bottomlessExpiry:now+1000}),'protected'],
 ['protection expiry',seed({bottomlessCanActive:true,bottomlessExpiry:now}),'ready'],
 ['missing time',seed({lastWatered:0}),'unknown'],['future timestamp',seed({lastWatered:now+1}),'unknown'],
 ['invalid timestamp',seed({lastWatered:'bad'}),'unknown']])test(name,()=>assert.equal(care(s,now).kind,kind));
test('unknown clock never invents readiness',()=>assert.equal(care(seed(),null).kind,'unknown'));
test('waiting is not counted as watered today',()=>assert.deepEqual(counts([seed(),seed({lastWatered:now}),seed({bottomlessExpiry:now+1}),seed({state:'dead'})],now),{ready:1,waiting:1,protected:1,wilting:0,dead:1,unknown:0}));
test('wilting priority above dead',()=>assert.equal(advice({address:'x',phase:'active',loaded:true,fresh:true,nowMs:now,seeds:[seed({state:'dead'}),seed({state:'wilting'})]}).kind,'wilt'));
for(const phase of ['ended','ended-paused','inactive','scheduled','paused','unknown'])test('no care suggestion when '+phase,()=>assert.ok(['refresh','rewards'].includes(advice({address:'x',phase,loaded:true,fresh:true,nowMs:now,seeds:[seed()]}).kind)));
test('unloaded inventory is not an empty garden',()=>assert.equal(advice({address:'x',phase:'active',loaded:false,fresh:false,seeds:[]}).kind,'refresh'));
test('stale inventory is not actionable',()=>assert.equal(advice({address:'x',phase:'active',loaded:true,fresh:false,seeds:[seed()]}).kind,'refresh'));
test('disconnected view only offers connect',()=>assert.equal(advice({phase:'ended'}).kind,'connect'));
test('verified empty active garden offers planting',()=>assert.equal(advice({address:'x',phase:'active',loaded:true,fresh:true,seeds:[]}).kind,'plant'));
test('Ready filter excludes protected and waiting',()=>{assert.equal(matches(seed(),'ready',now),true);assert.equal(matches(seed({bottomlessExpiry:now+1}),'ready',now),false);assert.equal(matches(seed({lastWatered:now}),'ready',now),false);});
test('stable slot numbers on reordered results',()=>{const a=seed(),b=seed({objectId:'b'});const slots=slotOrder([a,b]);assert.deepEqual([...slotOrder([b,a],slots)],[['a',1],['b',2]]);});
test('deleted slot reused without renumbering surviving Seed',()=>{const a=seed(),b=seed({objectId:'b'}),c=seed({objectId:'c'});const slots=slotOrder([a,b]);const result=slotOrder([b,c],slots);assert.equal(result.get('b'),2);assert.equal(result.get('c'),1);});
test('filter never mutates input or ID',()=>{const data=[seed(),seed({objectId:'b',state:'dead'})];const before=JSON.stringify(data);assert.equal(data.filter(s=>matches(s,'dead',now))[0].objectId,'b');assert.equal(JSON.stringify(data),before);});
test('GP and streak threshold retained, label not days',()=>{const s=growth(seed({growthPoints:175,streak:1}));assert.equal(s.label,'First Growth Ring');assert.equal(s.score,7);assert.match(s.requirement,/14 streak days OR 350 GP/);assert.doesNotMatch(s.next,/in \d+d/);});
test('final visual stage does not promise claim',()=>{const s=growth(seed({streak:30}));assert.equal(s.label,'Season Harvest');assert.match(s.next,/check Rewards for eligibility/);assert.doesNotMatch(s.next,/Ready to claim/);});
test('dead appearance preserved',()=>assert.equal(growth(seed({state:'dead'})).cls,'dead'));
test('duration is rounded up',()=>{assert.equal(duration(1),'1m');assert.equal(duration(3600000),'1h 0m');assert.equal(duration(NaN),'Unavailable');});
test('transform rejects unknown source',()=>assert.throws(()=>transform('<html></html>'),/reviewed/));
test('season accessor addition rejects unexpected input',()=>assert.throws(()=>transformSeason('unknown'),/Unrecognized/));
test('production and unset contexts fail before writes',()=>{const old=process.env.CONTEXT;for(const context of ['production','deploy-preview','']){process.env.CONTEXT=context;assert.throws(()=>build('/not-a-real-directory'),/branch-review only/);}if(old===undefined)delete process.env.CONTEXT;else process.env.CONTEXT=old;});
test('new runtime does not construct, sign, execute or fetch transactions',()=>{const s=fs.readFileSync('economy-review/garden-ux.mjs','utf8');assert.doesNotMatch(s,/fetch\s*\(|new Transaction|signAndExecute|executeTransaction|moveCall\(|splitCoins\(/);});

test('closed and unverified views hide legacy secondary care prompts',()=>{
 const css=fs.readFileSync('economy-review/garden-ux.css','utf8');
 for(const selector of ['.next-move-grid','#next-move-kicker','#alert-bar'])assert.ok(css.includes('.garden-ux[data-ux-ready="false"] '+selector));
});
