// Append the approved season panel without changing source gameplay or public pages.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
export function applySeasonStatus(original){
  let html=original;
  if(html.includes('id="garden-season-status"'))throw new Error('Run the clean base build before this pass.');
  function once(from,to){if(html.split(from).length!==2)throw new Error('Unexpected game insertion point: '+from.slice(0,70));html=html.replace(from,to);}
  once('  <div id="garden-guide" class="player-path">',fs.readFileSync(path.join(root,'season-status/panel.html'),'utf8')+'\n  <div id="garden-guide" class="player-path">');
  once('</head>','<link rel="stylesheet" href="/season-status/panel.css">\n</head>');
  once('</body>','<script type="module" src="/season-status/garden-status.mjs"></script>\n</body>');
  const guard="  if(!window.arbSeasonStatus){toast('Season status is loading. Please wait a moment.','tw');return;}\n  if(!(await window.arbSeasonStatus.canWater()))return;\n";
  for(const signature of ['async function doWaterAll(){','async function doWaterSeed(oid){'])once(signature+'\n  if(needWallet())return;',signature+'\n  if(needWallet())return;\n'+guard);
  once('function friendlyTxError(action,e){','function friendlyTxError(action,e){\n  const seasonMessage=window.arbSeasonStatus?.explainError(action,e);\n  if(seasonMessage)return seasonMessage;');
  once("toast(`Batch water failed: ${e.message || e}`,'td');","toast(friendlyTxError('Batch Water',e),'tw',10000);");
  return html;
}
function build(){
  if(process.env.CONTEXT==='production'&&process.env.ARBORETUM_SEASON_STATUS_APPROVED!=='2026-10-01')throw new Error('Season status production build requires owner approval.');
  const dist=path.join(root,'dist');
  const keep=['index.html','player-guide.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html','guide/player-guide.js','guide/player-guide.css','prelaunch/site.css'];
  const before=Object.fromEntries(keep.map(n=>[n,hash(fs.readFileSync(path.join(dist,n)))]));
  const html=applySeasonStatus(fs.readFileSync(path.join(dist,'game.html'),'utf8'));
  fs.mkdirSync(path.join(dist,'season-status'),{recursive:true});
  for(const file of ['model.mjs','garden-status.mjs','panel.css'])fs.copyFileSync(path.join(root,'season-status',file),path.join(dist,'season-status',file));
  fs.writeFileSync(path.join(dist,'game.html'),html);
  for(const [file,digest] of Object.entries(before))if(hash(fs.readFileSync(path.join(dist,file)))!==digest)throw new Error('Out-of-scope change: '+file);
  fs.mkdirSync(path.join(root,'season-status-results'),{recursive:true});
  fs.writeFileSync(path.join(root,'season-status-results/build.json'),JSON.stringify({approved:'2026-10-01',gameHtml:hash(html),preserved:before,transactions:0},null,2));
  console.log('Season status built; only gated game presentation changed.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--transform')process.stdout.write(applySeasonStatus(fs.readFileSync(process.argv[3],'utf8')));
  else build();
}
