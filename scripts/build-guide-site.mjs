// Build a reviewable static site without modifying source index.html or game scripts.
// Run python3 scripts/build-player-guide.py first, then node scripts/build-guide-site.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const expectedIndexHash = 'd097ef796f14380c0d2e9e3dcfecab0fead13808d6c26a20497b5b9bd0123701';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const original = await fs.readFile(path.join(root, 'index.html'));
if (sha256(original) !== expectedIndexHash) {
  throw new Error('index.html changed since the reviewed checkpoint. Review the latest source before rebuilding guide navigation; do not overwrite newer work.');
}
const guide = await fs.readFile(path.join(root, 'player-guide.html'));
let html = original.toString('utf8');
const edits = [];
function insertBeforeOnce(marker, addition, label) {
  if (html.split(marker).length !== 2) throw new Error(`Expected exactly one ${label} insertion point.`);
  html = html.replace(marker, addition + marker);
  edits.push(label);
}
insertBeforeOnce(
  '      <li><a href="https://www.tree-token.xyz/" class="nav-a home-link"',
  '      <li><a href="player-guide.html" class="nav-a home-link player-guide-link" target="_blank" rel="noopener noreferrer" aria-label="How to Play — opens player guide in a new tab">How to Play</a></li>\n',
  'desktop navigation'
);
insertBeforeOnce(
  '  <a href="https://www.tree-token.xyz/" class="home-link" aria-label="Go to Tree Token main site">Home</a>',
  '  <a href="player-guide.html" class="home-link player-guide-link" target="_blank" rel="noopener noreferrer">How to Play ↗</a>\n',
  'mobile navigation'
);
const gardenStart = html.indexOf('id="garden-sec"');
if (gardenStart < 0) throw new Error('Garden section is missing.');
const nextSection = html.indexOf('<section', gardenStart + 1);
const titleStart = html.indexOf('<h2', gardenStart);
const titleEnd = html.indexOf('</h2>', titleStart);
if (titleStart < 0 || titleEnd < titleStart || (nextSection > -1 && titleEnd > nextSection)) throw new Error('Garden heading not found safely.');
const gardenHelp = '\n      <a class="gbtn guide-context-link" href="player-guide.html#watering" target="_blank" rel="noopener noreferrer">Garden help ↗</a>\n      <a class="gbtn guide-context-link" href="player-guide.html#tools" target="_blank" rel="noopener noreferrer">Tool guide ↗</a>';
html = html.slice(0, titleEnd + 5) + gardenHelp + html.slice(titleEnd + 5);
edits.push('Garden contextual help');
insertBeforeOnce(
  '                <button class="gbtn" onclick="doc(\'strategy-sec\');setStrategyTab(\'items\')">Open Item Guide</button>',
  '                <a class="gbtn guide-context-link" href="player-guide.html#crates" target="_blank" rel="noopener noreferrer">Player Guide: crates &amp; chests ↗</a>\n',
  'shop contextual help'
);
insertBeforeOnce('</head>', '<style id="player-guide-navigation-style">\n.guide-context-link{display:inline-flex;text-decoration:none;margin:.3rem .3rem .3rem 0;min-height:36px;align-items:center;}\n@media(min-width:1101px){header #nav-links{flex-wrap:wrap;row-gap:.18rem;}}\n</style>\n', 'guide link styling');
const scripts = value => Array.from(value.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi), m => m[0]);
if (JSON.stringify(scripts(original.toString('utf8'))) !== JSON.stringify(scripts(html))) throw new Error('Unexpected script modification.');
await fs.mkdir(output, { recursive: true });
// Only public static site assets. No dotfiles, credentials, source contracts, docs or build scripts.
const publicRootFiles = new Set(['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js']);
for (const item of await fs.readdir(root, { withFileTypes: true })) {
  if (item.name.startsWith('.')) continue;
  if (item.isFile() && (publicRootFiles.has(item.name) || /\.(png|jpe?g|webp|gif|svg|ico|css)$/i.test(item.name))) {
    await fs.copyFile(path.join(root,item.name), path.join(output,item.name));
  }
}
await fs.cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
await fs.writeFile(path.join(output,'index.html'), html, 'utf8');
await fs.writeFile(path.join(output,'player-guide.html'), guide);
for (const name of ['wallet.js','garden.js','sui-sdk.bundle.js']) {
  const source = await fs.readFile(path.join(root,name));
  const built = await fs.readFile(path.join(output,name));
  if (!source.equals(built)) throw new Error(`Unexpected change in ${name}`);
}
const report = { baseline:'d1dcfafb5d3090ae1866ed38d806c77b3567357a', originalIndexSha256:sha256(original), builtIndexSha256:sha256(html), guideSha256:sha256(guide), changes:edits, inlineScriptsUnchanged:true, walletGardenAndSdkUnchanged:true, note:'Read-only guide and links only. No prices, contracts, wallet calls or economic settings modified. Full browser integration and deployed-mechanics verification required before production.' };
await fs.writeFile(path.join(root,'guide-build-report.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
