// Presentation-only pass, after all existing site builds. Gameplay is never edited.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=path.join(root,'dist/player-guide.html');
const original=await fs.readFile(dest,'utf8');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const expected='885a34075dc8aebe919e1f49854c1b82df1f8cc884f3e6e5654eddc1e7659b89';
if(hash(original)!==expected) throw new Error('Guide source drift: reconcile the guide before applying the presentation pass.');
let html=original;
function once(a,b){if(html.split(a).length!==2)throw new Error('Guide marker not unique: '+a.slice(0,70));html=html.replace(a,b);}
once('<body>','<body data-guide-polish="1">');
once('</head>','<link rel="stylesheet" href="/guide/guide.css">\n</head>');
once('<span class="brand-icon" aria-hidden="true">🌳</span>','<span class="brand-icon" aria-hidden="true"><img src="/arboretum-protocol-logo.png" alt="" width="40" height="40"></span>');
once('href="https://treegrow.xyz/">Back to game ↗','href="/game.html">Back to game ↗');
once('<section class="hero" id="start">','<section class="hero" id="start"><div class="guide-cover"><div class="guide-cover-copy">');
once('<div class="callout warning"><strong>Read this before testing</strong>', '</div><div class="guide-cover-art" aria-hidden="true"><img src="/hero.png" alt="" width="775" height="964"></div></div><div class="callout warning"><strong>Read this before testing</strong>');
const crateNames=['Seedling','Grove','Canopy','Ancient','Mythic'];
const gallery='<div class="guide-crate-gallery" aria-hidden="true">'+crateNames.map(n=>'<div class="guide-crate-art"><img src="/assets/shop/crates/'+n.toLowerCase()+'-crate.jpg" alt="" width="1024" height="1024" loading="lazy"></div>').join('')+'</div>';
once('<section class="section" id="crates">','<section class="section" id="crates">'+gallery);
for(const [id,img] of [['boom-chest','boom-chest.png'],['victory-chest','victory-chest.png']]){
 once('<article class="card" id="'+id+'">','<article class="card" id="'+id+'"><img class="guide-partner-art" src="/assets/shop/crates/'+img+'" alt="" aria-hidden="true" width="256" height="256" loading="lazy">');
}
let rarityCount=0;
html=html.replace(/<details class="tool"([^>]+)>([\s\S]*?)<\/details>/g,(all,attrs,inside)=>{
 const rarity=inside.match(/class="summary-meta">(Common|Uncommon|Rare|Legendary) ·/);
 if(!rarity)throw new Error('Missing original rarity');rarityCount++;
 return '<details class="tool" data-rarity="'+rarity[1].toLowerCase()+'"'+attrs+'>'+inside+'</details>';
});
if(rarityCount!==20)throw new Error('Expected original 20 tools');
let tables=0;
html=html.replace(/<div class="table-wrap">/g,()=>'<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable guide table '+(++tables)+'">');
const scripts=x=>Array.from(x.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g),m=>m[0]);
if(JSON.stringify(scripts(original))!==JSON.stringify(scripts(html))) throw new Error('Original guide JavaScript changed');
const ids=x=>Array.from(x.matchAll(/\bid="([^"]+)"/g),m=>m[1]).sort();
if(JSON.stringify(ids(original))!==JSON.stringify(ids(html)))throw new Error('Original guide anchor changed');
// Exact original semantic text, including all amounts, warnings, dates and source notes.
const text=x=>x.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/🌳/g,'').replace(/\s+/g,' ').trim();
if(text(original)!==text(html))throw new Error('Guide text changed; this pass must be presentation-only.');
const beforeLinks=Array.from(original.matchAll(/href="([^"]+)"/g),m=>m[1]).sort();
const afterLinks=Array.from(html.matchAll(/href="([^"]+)"/g),m=>m[1]).filter(s=>s!=='/guide/guide.css').map(s=>s==='/game.html'?'https://treegrow.xyz/':s).sort();
if(JSON.stringify(beforeLinks)!==JSON.stringify(afterLinks))throw new Error('Unexpected link destination change');
await fs.mkdir(path.join(root,'dist/guide'),{recursive:true});
await fs.copyFile(path.join(root,'content/player-guide-polish.css'),path.join(root,'dist/guide/guide.css'));
await fs.writeFile(dest,html);
await fs.mkdir(path.join(root,'guide-results'),{recursive:true});
await fs.writeFile(path.join(root,'guide-results/polish-build.json'),JSON.stringify({baselineSha256:expected,guideSha256:hash(html),semanticTextUnchanged:true,originalScriptsUnchanged:true,originalAnchorsUnchanged:true,toolCount:rarityCount,accessibleTables:tables,returnLink:'/game.html',scope:'Guide presentation and return navigation only; content retains its original source/date/verification labels.'},null,2)+'\n');
console.log('Guide polished: all original text, 20 tools, anchors and scripts preserved.');
