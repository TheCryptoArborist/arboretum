// Build the isolated 48-hour Season 2 owner flow without changing general gameplay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-cycle');
const output = path.join(root, 'dist/admin/season-two');
const sha = value => createHash('sha256').update(value).digest('hex');
export const CYCLE_FILES = Object.freeze([
  'admin/season-two/admin.css', 'admin/season-two/admin.mjs', 'admin/season-two/index.html',
]);

export async function buildOwnerCycle() {
  assertReviewBuild();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version, '2.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version, '1.6.1');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, name), path.join(output, name));
  await build({ entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'none',
    logOverride: { 'import-is-undefined': 'error' } });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/season-two/admin.mjs'));
  assert.ok(html.includes('/admin/season-two/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline Season 2 scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure')).includes('/admin/'));
  assert.deepEqual(fs.readdirSync(output).sort(), ['admin.css', 'admin.mjs', 'index.html']);
  return { route: '/admin/season-two/', authorizedOrigin: 'https://www.treegrow.xyz',
    inventoryVersion: 1, seasonId: 2, durationMs: '172800000', ownerWalletApprovalRequired: true,
    transactionScope: 'owner-season-two-48-hour-cycle', testerCodeRequiredOnDedicatedSite: false,
    generalGameplayEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(CYCLE_FILES.map(name => [name, sha(fs.readFileSync(path.join(root, 'dist', name)))])) };
}

export function verifyCyclePreservation(allFiles) {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'tester-access-release/verification/hosted/candidate.json')));
  assert.equal(candidate.sourceCommit, '05c0a9d9799ba6bc096051650320099db3def8a8');
  assert.equal(candidate.applicationFiles.length, 103);
  assert.deepEqual([...allFiles].sort(), [...candidate.applicationFiles.map(item => item.path), ...CYCLE_FILES].sort(),
    'Only the three Season 2 runtime files may be added.');
  for (const item of candidate.applicationFiles) {
    const bytes = fs.readFileSync(path.join(root, 'dist', item.path));
    assert.equal(bytes.length, item.bytes, 'Existing application size changed: ' + item.path);
    assert.equal(sha(bytes), item.sha256, 'Existing application bytes changed: ' + item.path);
  }
  return { baselineDeployId: '6aeea0b254e028ece344267c', existingApplicationFilesPreserved: 103,
    changedApplicationFiles: [], addedRuntimeFiles: CYCLE_FILES, completeApplicationFileCount: 106 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildOwnerCycle(), null, 2));
