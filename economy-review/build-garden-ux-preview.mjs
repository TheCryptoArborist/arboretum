/** Additive gated-review transform; never changes the tracked game/wallet/contract sources. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export const INPUT_GAME='1f927e9f3ac3ea79b43636f9fd3f455cdd34174adb902751cb28c89e7240a842';
export function transform(original){
 if(sha(original)!==INPUT_GAME)throw Error('Garden UX requires the reviewed, unchanged partner preview input');
 let html=original;
 const once=(a,b)=>{if(html.split(a).length!==2)throw Error('Ambiguous Garden UX anchor: '+a.slice(0,90));html=html.replace(a,b);};
 const rg=(a,b)=>{const start=html.indexOf('async function refreshGarden(){'),end=html.indexOf('\nfunction applyFilter(){',start);if(start<0||end<0)throw Error('Refresh boundary missing');const body=html.slice(start,end);if(body.split(a).length!==2)throw Error('Refresh anchor: '+a);html=html.slice(0,start)+body.replace(a,b)+html.slice(end);};
 once('</head>','<link rel="stylesheet" href="/economy-review/garden-ux.css">\n</head>');
 once('</body>',`<script>window.arbGardenBridge={address:()=>PA,seeds:()=>ALL,stats:()=>SEASON_STATS,reminder:(value)=>{GARDEN_REMINDER=value;},clearCountdown:()=>{if(GARDEN_COUNTDOWN_TIMER)clearInterval(GARDEN_COUNTDOWN_TIMER);},slot:(seed,index)=>window.arbGardenUX?.slot(seed.objectId)||index+1};</script>\n<script type="module" src="/economy-review/garden-ux.mjs"></script>\n</body>`);
 rg('async function refreshGarden(){\n  if(!PA||!window.arb)return;\n  try{',`async function refreshGarden(){
  if(!PA||!window.arb)return;
  const uxOwner=PA, uxTicket=window.arbGardenUX?.begin(PA);
  if(uxTicket===null)return;
  const uxCurrent=()=>PA===uxOwner && (!window.arbGardenUX || window.arbGardenUX.current(uxTicket,uxOwner));
  try{`);
 rg("window.arb.getOwnedObjects(PA,'Crate'),\n      window.arb.getSeasonStats().catch(()=>SEASON_STATS)","window.arb.getOwnedObjects(PA,'Crate'),\n      window.arb.getSeasonStats()");
 rg("    if(stats)SEASON_STATS=stats;\n    const currentSeedObjects",'    if(!uxCurrent())return;\n    if(!stats)throw Error("Season inventory snapshot unavailable");\n    if(stats)SEASON_STATS=stats;\n    const currentSeedObjects');
 rg('    NFTREE_ART_BY_ID=buildNftreeArtMap(nfts);','    if(!uxCurrent())return;\n    NFTREE_ART_BY_ID=buildNftreeArtMap(nfts);');
 rg('    ALL = seeds.map(seedWithNftreeArt);','    ALL = seeds.map(seedWithNftreeArt);\n    window.arbGardenUX?.accept(uxTicket,uxOwner,ALL);');
 rg("    await updateNftreeAccess(false);\n  }catch(e){\n    console.warn('Garden refresh:', e);", "    window.arbGardenUX?.complete(uxTicket,uxOwner);\n    await updateNftreeAccess(false);\n  }catch(e){\n    if(uxCurrent())window.arbGardenUX?.fail(uxTicket,uxOwner);\n    console.warn('Garden refresh:', e);");
 once("  renderGarden(f==='wilt'?ALL.filter(s=>s.state==='wilting'):f==='dead'?ALL.filter(s=>s.state==='dead'):ALL);",'  renderGarden(ALL); // Filter visibility, never reinterpret hidden Seeds as empty slots.');
 once('    const slotLabel=`Slot ${idx+1}`;','    const slotLabel=`Slot ${s?(window.arbGardenBridge?.slot(s,idx)||idx+1):idx+1}`;');
 once('  PA=null;WALLET_NAME=null;ALL=[];','  PA=null;WALLET_NAME=null;ALL=[];\n  window.arbGardenUX?.reset(null);');
 once('function afterConnect(r){','function afterConnect(r){\n  window.arbGardenUX?.reset(PA);');
 return html;
}
export function transformSeason(original){
 const anchor='window.arbSeasonStatus={refresh,canWater,explainError};';
 if(original.split(anchor).length!==2)throw Error('Unrecognized season reader');
 return original.replace(anchor,'window.arbSeasonStatus={refresh,canWater,explainError,getView:currentView};')
 .replace('  syncWaterButtons(view);\n}',"  syncWaterButtons(view);\n  document.dispatchEvent(new CustomEvent('arboretum:season-view'));\n}");
}
export function build(dist=path.join(root,'dist')){
 if(process.env.CONTEXT!=='branch-deploy')throw Error('Garden UX is branch-review only');
 const keep=['index.html','player-guide.html','wallet.js','garden.js','sui-sdk.bundle.js','economy-review/partner-panel.mjs','economy-review/partner-reconciliation-panel.mjs'];
 const hash=n=>sha(fs.readFileSync(path.join(dist,n)));
 const before=Object.fromEntries(keep.map(n=>[n,hash(n)]));
 const game=transform(fs.readFileSync(path.join(dist,'game.html'),'utf8'));
 const season=transformSeason(fs.readFileSync(path.join(dist,'season-status/garden-status.mjs'),'utf8'));
 fs.writeFileSync(path.join(dist,'game.html'),game);fs.writeFileSync(path.join(dist,'season-status/garden-status.mjs'),season);
 for(const n of ['garden-ux-model.mjs','garden-ux.mjs','garden-ux.css'])fs.copyFileSync(path.join(root,'economy-review',n),path.join(dist,'economy-review',n));
 for(const [n,h]of Object.entries(before))if(hash(n)!==h)throw Error('Protected file changed: '+n);
 const report={reviewOnly:true,sourceInput:INPUT_GAME,preserved:before,gameSha256:hash('game.html'),seasonSha256:hash('season-status/garden-status.mjs'),transactionsSubmitted:0};
 fs.mkdirSync(path.join(root,'economy-review-results'),{recursive:true});fs.writeFileSync(path.join(root,'economy-review-results/garden-ux-build.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(build(process.argv[2]),null,2));
