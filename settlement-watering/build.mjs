// Build the protected first-watering review without activating general gameplay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-watering');
const output = path.join(root, 'dist/admin/watering-test');

export async function buildOwnerWatering() {
  assertReviewBuild();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version, '2.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version, '1.6.1');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, name), path.join(output, name));
  await build({ entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'none' });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/watering-test/admin.mjs'));
  assert.ok(html.includes('/admin/watering-test/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline watering scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure')).includes('/admin/'));
  const files = fs.readdirSync(output).sort();
  assert.deepEqual(files, ['admin.css', 'admin.mjs', 'index.html']);
  return { route: '/admin/watering-test/', authorizedOrigin: 'https://www.treegrow.xyz',
    seedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d',
    plantingDigest: 'FM5QeE2Eb2tQwQeSsTKz8s4a81mZVqde5kF2HAEmyisB',
    inventoryVersion: 1, seasonId: 1, ownerWalletApprovalRequired: true,
    transactionScope: 'single-first-owner-seed-watering', wateringPaymentMist: '0',
    generalGameplayEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(files.map(name => ['admin/watering-test/' + name,
      createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildOwnerWatering(), null, 2));
