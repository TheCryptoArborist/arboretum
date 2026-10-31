// Produce an isolated integration review with gameplay transactions disabled.
// Each separately approved administrator operation has its own exact route.
// The established public build and original production inputs are preserved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { SETTLEMENT_DEPLOYMENT, REVIEW_ONLY } from './deployment-config.mjs';
import { assertReviewBuild, DEDICATED_PREVIEW } from '../scripts/build-policy.mjs';
import { buildAdministratorUpgrade } from '../settlement-admin/build.mjs';
import { buildAdministratorSetup } from '../settlement-setup/build.mjs';
import { buildAdministratorSeason } from '../settlement-season/build.mjs';
import { buildOwnerGameplay } from '../settlement-gameplay/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const read = name => fs.readFileSync(path.join(root, name));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const buildPolicy = assertReviewBuild();
const newSeasonsReviewAvailable = SETTLEMENT_DEPLOYMENT.reviewEnabled === true;
assert.equal(SETTLEMENT_DEPLOYMENT.enabled, false, 'The review build must not activate settlement gameplay.');

const preserved = ['index.html','wallet.js','garden.js','sui-sdk.bundle.js',
  'contract/sources/arboretum.move','contract-payout/source/settlement.move',
  'netlify/edge-functions/tester-gate.ts','netlify/edge-functions/public-player-guide.ts',
  'netlify/functions/calendar-reminder.js'];
const before = Object.fromEntries(preserved.map(file => [file,sha(read(file))]));
assert.equal(before['index.html'],'d097ef796f14380c0d2e9e3dcfecab0fead13808d6c26a20497b5b9bd0123701',
  'The accepted game source changed; review the overlay anchors before rebuilding.');
const commands = [
  ['python3','scripts/build-player-guide.py'],
  ['node','scripts/build-guide-site.mjs'],
  ['node','scripts/build-prelaunch.mjs'],
  ['node','scripts/polish-player-guide.mjs'],
  ['python3','scripts/build-public-guide.py'],
  ['python3','scripts/build-reward-first.py'],
  ['node','scripts/build-season-status.mjs'],
  ['node','economy-review/build-admin-preview.mjs'],
  ['node','economy-review/build-garden-ux-preview.mjs'],
];
const run = (executable,args) => promisify(execFile)(executable,args,{
  cwd:root,env:process.env,
  stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024,
});
fs.rmSync(dist,{recursive:true,force:true});
for(const [executable,script] of commands) {
  await run(executable,[script]);
  console.log('Built '+script);
}
const acceptedGame = fs.readFileSync(path.join(dist,'game.html'),'utf8');
const publicBefore = Object.fromEntries(['index.html','player-guide.html']
  .map(file=>[file,sha(fs.readFileSync(path.join(dist,file)))]));

fs.mkdirSync(path.join(dist,'settlement-integration'),{recursive:true});
for(const file of ['reader.mjs','model.mjs','deployment-config.mjs'])
  fs.copyFileSync(path.join(root,'settlement-integration',file),path.join(dist,'settlement-integration',file));
await build({
  entryPoints:[path.join(root,'settlement-integration/sdk-entry.mjs')],
  outfile:path.join(dist,'settlement-sdk.bundle.js'),bundle:true,format:'esm',
  platform:'browser',target:'es2022',minify:true,sourcemap:false,legalComments:'none',
});
await run('python3',['settlement-integration/build_wallet.py',path.join(dist,'wallet.js'),'legacy']);
for(const [source,target] of [['panel.mjs','settlement-panel.mjs'],['panel.css','settlement-panel.css']])
  fs.copyFileSync(path.join(root,'settlement-integration/ui',source),path.join(dist,target));
await run('python3',['settlement-integration/ui/transform_season.py',path.join(dist,'season-status/garden-status.mjs')]);
await run('python3',['settlement-integration/ui/transform_game.py',path.join(dist,'game.html'),'legacy']);
if(newSeasonsReviewAvailable) {
  const nextGame=acceptedGame.replace(
    /src="wallet\.js(?:\?[^"]*)?"/,
    'src="settlement-wallet.js?v=settlement-integration-20261020"');
  assert.notEqual(nextGame,acceptedGame,'Wallet script anchor was not found.');
  fs.writeFileSync(path.join(dist,'settlement-game.html'),nextGame);
  await run('python3',['settlement-integration/build_wallet.py',path.join(dist,'settlement-wallet.js'),'settlement']);
  await run('python3',['settlement-integration/ui/transform_game.py',path.join(dist,'settlement-game.html'),'settlement']);
} else {
  fs.copyFileSync(path.join(root,'settlement-integration/ui/awaiting-activation.html'),path.join(dist,'settlement-game.html'));
}

for(const file of preserved) assert.equal(sha(read(file)),before[file],'Build altered source: '+file);
for(const [file,hash] of Object.entries(publicBefore))
  assert.equal(sha(fs.readFileSync(path.join(dist,file))),hash,'Public page changed: '+file);
assert.ok(!/<script\b/i.test(fs.readFileSync(path.join(dist,'index.html'),'utf8')),
  'The public homepage must remain script-free.');
const game=fs.readFileSync(path.join(dist,'game.html'),'utf8');
for(const asset of ['/economy-review/garden-ux.mjs','/economy-review/partner-panel.mjs',
  '/season-status/garden-status.mjs','/settlement-panel.mjs','/settlement-panel.css'])
  assert.ok(game.includes(asset),'Review asset missing: '+asset);

const visited=new Set();
async function verifyModule(relative) {
  const full=path.resolve(dist,relative);
  assert.ok(full.startsWith(dist+path.sep),'Module escaped publish directory.');
  if(visited.has(full))return;
  visited.add(full);
  const source=fs.readFileSync(full,'utf8');
  await build({stdin:{contents:source,loader:'js',sourcefile:relative},write:false,
    bundle:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
  const patterns=[/\b(?:import|export)\s+(?:[^;'"\n]+?\s+from\s*)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
  for(const pattern of patterns)for(const match of source.matchAll(pattern))
    await verifyModule(path.relative(dist,path.resolve(path.dirname(full),match[1])));
}
await verifyModule('wallet.js');
await verifyModule('settlement-panel.mjs');
await verifyModule('season-status/garden-status.mjs');
if(newSeasonsReviewAvailable)await verifyModule('settlement-wallet.js');
let inlineCount=0;
for(const file of ['game.html','settlement-game.html']) {
  const html=fs.readFileSync(path.join(dist,file),'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if(/\bsrc\s*=/.test(match[1])||!match[2].trim())continue;
    if(/type\s*=\s*["']module/.test(match[1])) {
      await build({stdin:{contents:match[2],loader:'js'},write:false,format:'esm',logLevel:'silent'});
    } else new vm.Script(match[2],{filename:file+' inline '+inlineCount});
    inlineCount++;
  }
}
const administratorUpgrade = await buildAdministratorUpgrade();
const administratorSetup = await buildAdministratorSetup();
const administratorSeason = await buildAdministratorSeason();
const ownerGameplay = await buildOwnerGameplay();
const allFiles=[];
function list(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())list(full);else allFiles.push(path.relative(dist,full));
  }
}
list(dist);
for(const file of allFiles) assert.ok(!/(^|\/)(release|legacy-reconciliation|evidence|__pycache__|node_modules|\.git)(\/|$)/.test(file),
  'Source or review evidence was included in the published assets: '+file);
assert.deepEqual(fs.readdirSync(path.join(dist,'settlement-integration')).sort(),
  ['deployment-config.mjs','model.mjs','reader.mjs']);
const gate=read('netlify/edge-functions/tester-gate.ts').toString();
for(const route of ['/settlement-game.html','/settlement-panel.mjs','/settlement-panel.css','/settlement-sdk.bundle.js'])
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'),gate.indexOf('function secure')).includes(route),
    'Review assets must remain behind the existing tester gate.');

const files=['index.html','player-guide.html','game.html','settlement-game.html','wallet.js',
  'settlement-sdk.bundle.js','settlement-panel.mjs','settlement-panel.css',
  'settlement-integration/reader.mjs','settlement-integration/model.mjs','settlement-integration/deployment-config.mjs'];
if(newSeasonsReviewAvailable)files.push('settlement-wallet.js');
const report={
  schemaVersion:1,verifiedAt:new Date().toISOString(),
  parentCommit:'ba6faff6de7c446599a605ffa95369a325a12e3e',
  buildContext:buildPolicy.providerContext,siteId:buildPolicy.siteId,
  deploymentRole:buildPolicy.dedicatedPreview?'dedicated-preview':'isolated-review',
  previewOrigin:buildPolicy.dedicatedPreview?DEDICATED_PREVIEW.origin:null,
  reviewOnly:REVIEW_ONLY,newSeasonsConfigured:newSeasonsReviewAvailable,
  newSeasonsReviewAvailable,newSeasonsReadOnly:newSeasonsReviewAvailable,
  settlementActivationEnabled:SETTLEMENT_DEPLOYMENT.enabled===true,
  preservedSourceSha256:before,publicPagesUnchanged:true,inlineScriptsParsed:inlineCount,
  walletModuleDependencies:[...visited].map(file=>path.relative(dist,file)).sort(),
  emittedSha256:Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(path.join(dist,file)))])),
  transactionSubmissionEnabled:false,transactionSubmissionScope:'gameplay-review',
  administratorUpgrade,administratorSetup,administratorSeason,ownerGameplay,evidencePublished:false,
  hostedPreviewVerified:false,
  gateRequirement:'The existing Netlify edge functions must be bundled and verified on this protected review deployment. A static upload alone is insufficient.',
};
fs.mkdirSync(path.join(root,'settlement-integration/verification'),{recursive:true});
fs.writeFileSync(path.join(root,'settlement-integration/verification/build.json'),JSON.stringify(report,null,2)+'\n');
console.log('Verified review build: '+inlineCount+' inline scripts, '+visited.size+' module files; gameplay submission disabled; exact administrator operations isolated.');

