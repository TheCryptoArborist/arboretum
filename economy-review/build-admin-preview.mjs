/** Review-only overlay: existing source, wallet, contracts and deployment stay unchanged. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function applyPartnerReport(original){
 let html=original;if(html.includes('partner-revenue-mount'))throw Error('Partner report already applied');
 const once=(from,to)=>{if(html.split(from).length!==2)throw Error('Ambiguous insertion point');html=html.replace(from,to);};
 once('      <div class="adm-card">\n        <h4>Deposit to Pool</h4>','      <div class="adm-wide" id="partner-revenue-mount"></div>\n\n      <div class="adm-card">\n        <h4>Deposit to Pool</h4>');
 once('</head>','<link rel="stylesheet" href="/economy-review/partner-panel.css">\n</head>');
 once('</body>','<script type="module" src="/economy-review/partner-panel.mjs"></script>\n</body>');
 once("      kind:'arboretum-season-snapshot',","      kind:'arboretum-season-snapshot',\n      partnerRevenue:window.arbPartnerReport?.snapshotAttachment(stats.currentSeasonId)||{status:'not_loaded'},");
 return html;
}
export function buildPreview(dist=path.join(root,'dist')){
 if(process.env.CONTEXT==='production')throw Error('Partner report is review-only; production build blocked');
 const game=path.join(dist,'game.html');if(!fs.existsSync(game))throw Error('Build the existing gated site first');
 const keep=['index.html','player-guide.html','wallet.js','garden.js','sui-sdk.bundle.js'];
 const hash=n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,n))).digest('hex');
 const before=Object.fromEntries(keep.map(n=>[n,hash(n)]));
 fs.writeFileSync(game,applyPartnerReport(fs.readFileSync(game,'utf8')));
 const target=path.join(dist,'economy-review');fs.mkdirSync(target,{recursive:true});
 for(const name of ['ledger.mjs','live-reader.mjs','partner-panel.mjs','partner-panel.css'])fs.copyFileSync(path.join(root,'economy-review',name),path.join(target,name));
 for(const [n,h]of Object.entries(before))if(hash(n)!==h)throw Error('Unapproved protected-file change: '+n);
 return {reviewOnly:true,preserved:before,gameSha256:hash('game.html'),transactions:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildPreview(process.argv[2]),null,2));
