// Build the isolated first-owner Seed review without enabling the general game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-gameplay');
const output = path.join(root, 'dist/admin/gameplay-test');
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function buildOwnerGameplay() {
  assertReviewBuild();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version, '2.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version, '1.6.1');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, name), path.join(output, name));
  await build({
    entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'none',
  });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/gameplay-test/admin.mjs'));
  assert.ok(html.includes('/admin/gameplay-test/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline owner gameplay scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure')).includes('/admin/'),
    'The owner gameplay page must remain tester-protected.');
  const files = fs.readdirSync(output).sort();
  assert.deepEqual(files, ['admin.css', 'admin.mjs', 'index.html']);
  return {
    route: '/admin/gameplay-test/', authorizedOrigin: 'https://www.treegrow.xyz',
    packageId: '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a',
    registryId: '0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9',
    confirmedSeasonStartDigest: 'HEKxugzt8jjFK3bVxdxzBDkWaiRwefawMQb9PtuNy9uW',
    inventoryVersion: 1, seasonId: 1, ownerWalletApprovalRequired: true,
    ownerGameplayEnabled: true, transactionScope: 'single-first-owner-seed-plant',
    generalGameplayEnabled: false, fundingOperationsEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(files.map(name => [
      'admin/gameplay-test/' + name, sha256(fs.readFileSync(path.join(output, name))),
    ])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildOwnerGameplay(), null, 2));
}
