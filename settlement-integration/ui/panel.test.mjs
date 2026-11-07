import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRegistryReview,registryPresentation,formatMist} from './panel.mjs';
import {applyPartnerReport} from '../../economy-review/build-admin-preview.mjs';
import {seasonView,validateSnapshot} from '../../season-status/model.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const REGISTRY='0x'+'a'.repeat(64),OTHER='0x'+'b'.repeat(64);
const NOW=Date.parse('2026-10-31T06:00:00Z');
const stats=(changes={})=>({protocol:'settlement',readOnly:true,registryId:REGISTRY,
  checkpoint:340015724,nowMs:NOW,currentSeasonId:0,seasonStartMs:0,seasonEndMs:0,
  totalSeeds:0,totalGrowthPoints:0,remainingPoolMist:'0',treasuryMist:'0',paused:false,...changes});
const view=value=>registryPresentation(value,REGISTRY,{now:NOW});

test('a completed empty Registry read shows no active season and exact verified zeros',()=>{
  const result=view(stats());
  assert.equal(result.status,'inactive');assert.equal(result.title,'No active season');
  assert.equal(result.pool,'0 SUI');assert.equal(result.treasury,'0 SUI');
  assert.equal(result.seeds,'0');assert.equal(result.growthPoints,'0');
  assert.equal(result.gardenTitle,'The new garden is empty');
  assert.doesNotMatch(result.title,/Season 0|ended/);
  assert.equal(result.checkpoint,'340015724');assert.equal(result.registryId,REGISTRY);
});

test('pool amounts retain MIST precision and large integer values',()=>{
  const result=view(stats({remainingPoolMist:'1000000001',treasuryMist:'12345678901234567890',
    totalSeeds:2,totalGrowthPoints:50,currentSeasonId:1,seasonStartMs:NOW-1000,seasonEndMs:NOW+10000}));
  assert.equal(result.pool,'1.000000001 SUI');assert.equal(result.treasury,'12,345,678,901.23456789 SUI');
  assert.equal(result.status,'active');assert.match(result.gardenTitle,/Seeds are recorded/);
  assert.equal(formatMist(undefined),null);assert.equal(formatMist(-1),null);
});

test('missing, malformed, or mismatched public fields never become zero',()=>{
  for(const field of ['checkpoint','nowMs','currentSeasonId','seasonStartMs','seasonEndMs','totalSeeds','totalGrowthPoints','remainingPoolMist','treasuryMist','paused']){
    const value=stats();delete value[field];assert.throws(()=>view(value),undefined,field);
  }
  for(const changes of [{remainingPoolMist:'bad'},{treasuryMist:-1},{totalSeeds:Number.MAX_SAFE_INTEGER+1},
    {registryId:OTHER},{registryId:null},{protocol:'legacy'},{readOnly:false},{paused:'false'},
    {seasonEndMs:NOW+1},{seasonStartMs:NOW,seasonEndMs:NOW-1}])assert.throws(()=>view(stats(changes)));
});

test('stale, zero, and far-future network clocks are unavailable',()=>{
  for(const nowMs of [0,NOW-120001,NOW+15001])assert.throws(()=>view(stats({nowMs})));
  assert.equal(view(stats({nowMs:NOW-120000})).status,'inactive');
});

test('inactive takes precedence over epoch zero while later real seasons remain distinguishable',()=>{
  assert.equal(view(stats()).status,'inactive');
  assert.equal(view(stats({currentSeasonId:2,seasonStartMs:NOW+1,seasonEndMs:NOW+10000})).status,'scheduled');
  assert.equal(view(stats({currentSeasonId:2,seasonStartMs:NOW-10000,seasonEndMs:NOW-1})).title,'Season 2 ended');
  assert.equal(view(stats({currentSeasonId:2,seasonStartMs:NOW-1,seasonEndMs:NOW+10000,paused:true})).status,'paused');
});

function harness({read=async()=>stats(),timeoutMs=1000}={}){
  const ids=['sr-registry','sr-registry-title','sr-registry-copy','sr-registry-pool','sr-registry-treasury',
    'sr-registry-seeds','sr-registry-gp','sr-registry-refresh','sr-registry-evidence','sr-registry-checkpoint',
    'sr-registry-time','sr-registry-id','sr-garden-title','sr-garden-copy'];
  const elements=new Map(ids.map(id=>[id,{textContent:'',dataset:{},hidden:false,disabled:false,
    listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);}}]));
  const calls={reads:0,wallet:0};let time=NOW;
  const noWallet=()=>{calls.wallet++;throw Error('A public Registry read must not access a wallet');};
  let api={CONTRACT:{REGISTRY_ID:REGISTRY,READ_ONLY:true},
    getIntegrationStatus:()=>({protocol:'settlement',reviewOnly:true,readOnly:true}),
    getSeasonStats:()=>{calls.reads++;return read();},getAddress:noWallet,connectWallet:noWallet,signAndExecute:noWallet};
  const controller=createRegistryReview({document:{getElementById:id=>elements.get(id)||null},getApi:()=>api,now:()=>time,timeoutMs});
  return {controller,calls,el:id=>elements.get(id),get api(){return api;},set api(value){api=value;},
    setRead:fn=>{read=fn;},setTime:value=>{time=value;}};
}

test('public status loads while disconnected and never calls wallet APIs',async()=>{
  const h=harness();assert.equal(await h.controller.refresh(),true);
  assert.equal(h.calls.reads,1);assert.equal(h.calls.wallet,0);
  assert.equal(h.el('sr-registry').dataset.state,'inactive');
  assert.equal(h.el('sr-registry-pool').textContent,'0 SUI');
  assert.equal(h.el('sr-registry-evidence').hidden,false);
});

test('failed refresh clears previously verified amounts, identities, and empty-state claims',async()=>{
  const h=harness();await h.controller.refresh();
  h.setRead(async()=>{throw Error('Synthetic network failure');});
  assert.equal(await h.controller.refresh(),false);
  for(const id of ['pool','treasury','seeds','gp','checkpoint','time','id'])assert.equal(h.el('sr-registry-'+id).textContent,'Unavailable');
  assert.equal(h.el('sr-registry').dataset.state,'unavailable');
  assert.equal(h.el('sr-registry-evidence').hidden,true);
  assert.equal(h.el('sr-garden-title').textContent,'Garden state unavailable');
  assert.match(h.el('sr-garden-copy').textContent,/not been confirmed empty/);
  assert.equal(h.el('sr-registry-refresh').disabled,false);
  h.setRead(async()=>stats());assert.equal(await h.controller.refresh(),true);
});

test('refresh deduplicates pending reads and hides old totals while awaiting verification',async()=>{
  let resolve;const h=harness();await h.controller.refresh();
  h.setRead(()=>new Promise(done=>{resolve=done;}));
  const first=h.controller.refresh(),second=h.controller.refresh();await Promise.resolve();
  assert.equal(h.calls.reads,2);assert.equal(h.el('sr-registry-pool').textContent,'Checking…');
  assert.equal(h.el('sr-registry-refresh').disabled,true);
  resolve(stats());assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(h.calls.reads,2);assert.equal(h.calls.wallet,0);
});

test('a provider or Registry change across the read discards the response',async()=>{
  for(const change of ['api','registry','permission']){
    let resolve;const h=harness({read:()=>new Promise(done=>{resolve=done;})});
    const pending=h.controller.refresh();await Promise.resolve();
    if(change==='api')h.api={...h.api};
    if(change==='registry')h.api.CONTRACT={REGISTRY_ID:OTHER,READ_ONLY:true};
    if(change==='permission')h.api.CONTRACT.READ_ONLY=false;
    resolve(stats());assert.equal(await pending,false,change);
    assert.equal(h.el('sr-registry-pool').textContent,'Unavailable');assert.equal(h.calls.wallet,0);
  }
});

test('unavailable startup can recover after the correct reader loads',async()=>{
  const h=harness(),api=h.api;h.api=null;
  assert.equal(await h.controller.refresh(),false);assert.equal(h.calls.reads,0);
  assert.equal(h.el('sr-registry-refresh').disabled,false);
  h.api=api;assert.equal(await h.controller.refresh(),true);
});

test('late results after a timed-out read cannot restore stale or unverified totals',async()=>{
  let resolve;const h=harness({read:()=>new Promise(done=>{resolve=done;}),timeoutMs:5});
  assert.equal(await h.controller.refresh(),false);
  resolve(stats());await Promise.resolve();await Promise.resolve();
  assert.equal(h.el('sr-registry').dataset.state,'unavailable');
  assert.equal(h.el('sr-registry-pool').textContent,'Unavailable');
});

test('stale displayed state expires without waiting for another read',async()=>{
  const h=harness();await h.controller.refresh();h.setTime(NOW+120001);
  assert.equal(h.controller.expire(),true);assert.equal(h.el('sr-registry').dataset.state,'unavailable');
  assert.equal(h.el('sr-registry-seeds').textContent,'Unavailable');assert.equal(h.controller.expire(),false);
});

async function transformFile(script,source,args=[]){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arboretum-ui-review-'));
  const target=path.join(directory,script.includes('season')?'garden-status.mjs':'game.html');
  try{
    fs.writeFileSync(target,source);
    await promisify(execFile)('python3',[path.join(ROOT,'settlement-integration/ui',script),target,...args]);
    return fs.readFileSync(target,'utf8');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
let emitted;
async function gameFixtures(){
  if(!emitted){
    const source=applyPartnerReport(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'));
    emitted=Promise.all(['legacy','settlement'].map(route=>transformFile('transform_game.py',source,[route])));
  }
  return emitted;
}

test('only New seasons receives the public card and My Garden default',async()=>{
  const [legacy,settlement]=await gameFixtures();
  assert.doesNotMatch(legacy,/id="sr-registry"|data-review-disabled/);
  assert.match(legacy,/const PANEL_IDS=\['hero-sec','demo-sec'/);
  assert.match(legacy,/<span class="logo-sub">Monthly SUI Growth Cycles<\/span>/);
  assert.match(settlement,/id="sr-registry"[^>]+data-state="loading"/);
  assert.match(settlement,/const PANEL_IDS=\['garden-sec','rewards-sec'\]/);
  assert.match(settlement,/const initial=normalizePanelId\(location.hash\?\.replace\('#',''\)\|\|'garden-sec'\)/);
  assert.match(settlement,/id="sr-registry-pool">Checking…<\/strong>/);
  assert.match(settlement,/id="sr-count">Unavailable<\/strong>/);
  assert.match(settlement,/href="\/game.html"/);
  const css=fs.readFileSync(path.join(ROOT,'settlement-integration/ui/panel.css'),'utf8');
  assert.match(css,/#garden-sec>:not\(\.sec-hdr\):not\(#sr-registry\)/);
  assert.match(css,/#admin-modal/);assert.match(css,/\[data-review-disabled\]/);
});

test('emitted static economic buttons have no dispatcher and inline scripts still parse',async()=>{
  const [legacy,settlement]=await gameFixtures();
  const buttons=[...settlement.matchAll(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs)]
    .map(match=>match[0]).filter(tag=>tag.includes('data-review-disabled'));
  assert.ok(buttons.length>=20);
  for(const tag of buttons){assert.match(tag,/onclick="return false"/);assert.match(tag,/\sdisabled(?:\s|>)/);assert.match(tag,/\shidden(?:\s|>)/);}
  for(const html of [legacy,settlement])for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!/type\s*=\s*["']module["']/i.test(script[1]))new vm.Script(script[2]);
  }
});

test('shared season helper retains legacy reads and verifies New seasons through its typed public reader',async()=>{
  const output=await transformFile('transform_season.py',fs.readFileSync(path.join(ROOT,'season-status/garden-status.mjs'),'utf8'));
  const read=output.slice(output.indexOf('async function readSnapshot() {'),output.indexOf('async function refresh() {'));
  const current=output.slice(output.indexOf('function currentView() {'),output.indexOf('function timeText(ms) {'));
  let selected=stats(),fetches=0,reads=0,legacyStart=NOW-30*86400000-1;
  const status={protocol:'settlement',reviewOnly:true,readOnly:true};
  const api={CONTRACT:{REGISTRY_ID:REGISTRY,READ_ONLY:true},getIntegrationStatus:()=>status,
    getSeasonStats:async()=>{reads++;return selected;}};
  const context=vm.createContext({window:{arb:api},validateSnapshot,seasonView,performance:{now:()=>0},
    Date:class extends Date{static now(){return NOW;}},AbortController,setTimeout,clearTimeout,
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({data:{registry:{asMoveObject:{contents:{json:{
      current_season_id:'3',season_start_ms:String(legacyStart),paused:false}}}},
      clock:{asMoveObject:{contents:{json:{timestamp_ms:String(NOW)}}}}}})};}});
  new vm.Script('let snapshot=null,receivedAt=0;'+read+current+';globalThis.run=async()=>{snapshot=await readSnapshot();return currentView();};').runInContext(context);
  assert.equal((await context.run()).title,'No active season');assert.equal(reads,1);assert.equal(fetches,0);
  selected=stats({registryId:OTHER});await assert.rejects(context.run(),/could not be verified/);
  selected=stats({nowMs:NOW-120001});await assert.rejects(context.run(),/could not be verified/);
  status.protocol='legacy';status.readOnly=false;
  assert.equal((await context.run()).title,'Season 3 ended');assert.equal(fetches,1);
  legacyStart=0;
  const inactive=await context.run();
  assert.equal(inactive.title,'No active growing season');
  assert.match(inactive.copy,/Previous-season rewards are separate/);
  assert.doesNotMatch(inactive.copy,/rewards system is set up/);
});
