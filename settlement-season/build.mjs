// Build one protected owner-wallet first-season route with the reviewed packet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-season');
const output = path.join(root, 'dist/admin/season-test');
const evidence = path.join(root, 'settlement-integration/verification/season-test-20261031/mainnet');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const kindSha256 = '6c89e6e0c74aa30a0b258194805566947469a3ed4fc1cfef97e4d9ecc71922f1';

export async function buildAdministratorSeason() {
  assertReviewBuild();
  const kind = fs.readFileSync(path.join(evidence, 'unsigned-start-kind.b64'), 'utf8').trim();
  const kindBytes = Buffer.from(kind, 'base64');
  assert.equal(kindBytes.length, 258);
  assert.equal(sha256(kindBytes), kindSha256, 'Season route must contain the exact reviewed first-start kind.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version, '2.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version, '1.6.1');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, name), path.join(output, name));
  fs.writeFileSync(path.join(output, 'start-kind.b64'), kind + '\n');
  await build({
    entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'none',
  });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/season-test/admin.mjs'));
  assert.ok(html.includes('/admin/season-test/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline administrator scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure')).includes('/admin/'),
    'The owner test page must remain tester-protected.');
  const files = fs.readdirSync(output).sort();
  assert.deepEqual(files, ['admin.css', 'admin.mjs', 'index.html', 'start-kind.b64']);
  return {
    route: '/admin/season-test/', authorizedOrigin: 'https://www.treegrow.xyz',
    exactStartKindSha256: kindSha256, exactStartKindBytes: kindBytes.length,
    packageId: '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a',
    registryId: '0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9',
    proposedDurationMs: '86400000', inventoryVersion: 1,
    ownerWalletApprovalRequired: true, firstSeasonStartEnabled: true,
    gameplayTransactionsEnabled: false, fundingEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(files.map(name => [
      'admin/season-test/' + name, sha256(fs.readFileSync(path.join(output, name))),
    ])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildAdministratorSeason(), null, 2));
}
