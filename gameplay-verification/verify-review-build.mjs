// Rebuild the accepted gated review with the wallet correction and verify the
// shipped bytes. This script has no wallet, network, signing, or deploy path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(root, relative));
const commands = [
  ['python3', 'scripts/build-player-guide.py'],
  ['node', 'scripts/build-guide-site.mjs'],
  ['node', 'scripts/build-prelaunch.mjs'],
  ['node', 'scripts/polish-player-guide.mjs'],
  ['python3', 'scripts/build-public-guide.py'],
  ['python3', 'scripts/build-reward-first.py'],
  ['node', 'scripts/build-season-status.mjs'],
  ['node', 'economy-review/build-admin-preview.mjs'],
  ['node', 'economy-review/build-garden-ux-preview.mjs'],
];
const preserve = ['index.html', 'wallet.js', 'garden.js', 'sui-sdk.bundle.js',
  'contract/sources/arboretum.move', 'netlify/edge-functions/tester-gate.ts',
  'netlify/edge-functions/public-player-guide.ts', 'netlify/functions/calendar-reminder.js'];
const before = Object.fromEntries(preserve.map(file => [file, sha(read(file))]));
assert.equal(before['index.html'], 'd097ef796f14380c0d2e9e3dcfecab0fead13808d6c26a20497b5b9bd0123701',
  'The reviewed game HTML changed; investigate before rebuilding its overlays.');

fs.rmSync(dist, { recursive: true, force: true });
for (const [executable, script] of commands) {
  execFileSync(executable, [script], {
    cwd: root, env: { ...process.env, CONTEXT: 'branch-deploy' },
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
  });
  console.log(`Built ${script}`);
}
for (const file of preserve) assert.equal(sha(read(file)), before[file], `Build changed source: ${file}`);
for (const file of ['wallet.js', 'garden.js', 'sui-sdk.bundle.js']) {
  assert.equal(sha(read(`dist/${file}`)), before[file], `Shipped bytes differ from tested source: ${file}`);
}

// Resolve actual module imports in the newly shipped wallet and its bundle.
// Missing runtime files are a deployment failure even when unit tests pass.
const visited = new Set();
function verifyImports(relative) {
  const file = path.resolve(dist, relative);
  assert.ok(file.startsWith(dist + path.sep), `Module escapes the publish directory: ${relative}`);
  if (visited.has(file)) return;
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const patterns = [/\b(?:import|export)\s+(?:[^;'"\n]+?\s+from\s*)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const dependency = path.resolve(path.dirname(file), match[1]);
    verifyImports(path.relative(dist, dependency));
  }
}
verifyImports('wallet.js');

const game = read('dist/game.html').toString('utf8');
assert.ok(game.includes('/economy-review/garden-ux.mjs'), 'Accepted Garden overlay is missing.');
assert.ok(game.includes('/economy-review/partner-panel.mjs'), 'Partner accounting overlay is missing.');
assert.ok(game.includes('/season-status/garden-status.mjs'), 'Season status overlay is missing.');
assert.ok(!/<script\b/i.test(read('dist/index.html').toString('utf8')), 'Public landing unexpectedly loads script.');
assert.ok(!fs.existsSync(path.join(dist, 'gameplay-verification')), 'Verification evidence must not be published as game assets.');

const report = {
  verifiedAt: new Date().toISOString(),
  acceptedSourceCommit: 'bea71961a1ec9c1b0fec63535c90c6eb941a8c03',
  buildContext: 'branch-deploy', commands: commands.map(command => command.join(' ')),
  sourceUnchangedByBuild: before,
  shipped: Object.fromEntries(['index.html', 'player-guide.html', 'game.html', 'wallet.js',
    'garden.js', 'sui-sdk.bundle.js', 'season-status/garden-status.mjs',
    'economy-review/garden-ux.mjs'].map(file => [file, sha(read(`dist/${file}`))])),
  walletModuleDependencies: [...visited].map(file => path.relative(dist, file)).sort(),
  acceptedReviewOverlaysPresent: true,
  transactionsSubmitted: 0, deploymentsCreated: 0,
};
fs.mkdirSync(path.join(root, 'gameplay-verification/evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'gameplay-verification/evidence/build-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
