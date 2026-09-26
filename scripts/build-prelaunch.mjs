// Run after the existing guide build. Preserve the game bytes under a gated name.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
if(process.env.NETLIFY && process.env.CONTEXT === 'production' && process.env.ARBORETUM_PRELAUNCH_APPROVED !== 'true') throw new Error('Prelaunch preview is not approved for production.');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const game=await fs.readFile(path.join(dist,'index.html'));
if(game.includes(Buffer.from('Your next season'))) throw new Error('Run the clean guide build first; refusing to overwrite the preserved game.');
// Wallet and game are compared with their source files below, not reconstructed.
const protectedFiles=['wallet.js','garden.js','sui-sdk.bundle.js'];
const before={};
for(const file of protectedFiles){const a=await fs.readFile(path.join(root,file));const b=await fs.readFile(path.join(dist,file));if(!a.equals(b))throw new Error('Unexpected built changes: '+file);before[file]=hash(b);}
await fs.copyFile(path.join(dist,'index.html'),path.join(dist,'game.html'));
await fs.mkdir(path.join(dist,'prelaunch'),{recursive:true});
let landing=await fs.readFile(path.join(root,'prelaunch/index.html'),'utf8');
const publicProduction=process.env.CONTEXT==='production' && process.env.ARBORETUM_PRELAUNCH_APPROVED==='true';
if(publicProduction) landing=landing.replace('content="noindex,nofollow"','content="index,follow"');
await fs.writeFile(path.join(dist,'index.html'),landing);
await fs.copyFile(path.join(root,'prelaunch/site.css'),path.join(dist,'prelaunch/site.css'));
const assets={'forest.jpg':'background6.jpg','hero.png':'hero.png','mark.png':'arboretum-protocol-logo.png','ancient.jpg':'assets/shop/crates/ancient-crate.jpg'};
for(const [dest,source] of Object.entries(assets)) await fs.copyFile(path.join(root,source),path.join(dist,'prelaunch',dest));
// Remove development documentation accidentally included by the older asset copy.
async function prune(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await prune(p);else if(entry.name.startsWith('.')||/\.(md|map|toml|lock|ts)$/i.test(entry.name))await fs.rm(p);}}
await prune(path.join(dist,'assets'));
await fs.writeFile(path.join(dist,'robots.txt'),publicProduction?'User-agent: *\nAllow: /$\nAllow: /index.html$\nAllow: /prelaunch/\nDisallow: /\nSitemap: https://treegrow.xyz/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
await fs.writeFile(path.join(dist,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://treegrow.xyz/</loc></url></urlset>');
if(!game.equals(await fs.readFile(path.join(dist,'game.html'))))throw new Error('Game HTML changed');
for(const [file,h] of Object.entries(before))if(hash(await fs.readFile(path.join(dist,file)))!==h)throw new Error('Game script changed');
if(/<script\b/i.test(landing))throw new Error('Public landing must not load game or wallet JavaScript');
const report={baseline:'2338affe1dd984f5bc676cec7f3763d1f37a90cf',gameHtmlUnchanged:true,gameHtmlSha256:hash(game),protectedFiles:before,landingHasWalletCode:false,publicProduction,gate:'netlify/edge-functions/tester-gate.ts',note:'Static upload alone is NOT an access-control deployment. Edge function must be bundled and verified. No change to contract targets, prices, inventory or claims.'};
await fs.mkdir(path.join(root,'prelaunch-results'),{recursive:true});
await fs.writeFile(path.join(root,'prelaunch-results/build.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
