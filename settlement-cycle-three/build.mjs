// Build the focused Season 3 owner watering test; preserve the completed test pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-cycle-three');
const output = path.join(root, 'dist/admin/season-three');
const sha = value => createHash('sha256').update(value).digest('hex');
export const FOCUSED_FILES = Object.freeze([
  'admin/season-three/admin.css', 'admin/season-three/admin.mjs', 'admin/season-three/index.html',
]);

export async function buildFocusedOwnerCycle() {
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
  assert.ok(html.includes('/admin/season-three/admin.mjs'));
  assert.ok(html.includes('/admin/season-three/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline Season 3 scripts.');
  assert.ok(!html.includes('next=season-three'), 'Use the direct route; the retained compatibility entrance is not extended.');
  assert.deepEqual(fs.readdirSync(output).sort(), ['admin.css', 'admin.mjs', 'index.html']);
  return { route: '/admin/season-three/', authorizedOrigin: 'https://www.treegrow.xyz',
    inventoryVersion: 1, seasonId: 3, durationMs: '172800000', ownerWalletApprovalRequired: true,
    transactionScope: 'owner-season-three-focused-watering', testerCodeRequiredOnDedicatedSite: false,
    generalGameplayEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(FOCUSED_FILES.map(name => [name, sha(fs.readFileSync(path.join(root, 'dist', name)))])) };
}

export function verifySeasonThreePreservation(allFiles) {
  const raw = fs.readFileSync(path.join(root, 'settlement-cycle/verification/plant-fields-fix/hosted/candidate.json'));
  assert.equal(sha(raw), 'cc01f1c900a368f9a3eb369a69fc25cd582863d7f9121ba8f90443172a6c05fd',
    'The published Season 2 candidate record changed.');
  const candidate = JSON.parse(raw);
  assert.equal(candidate.sourceCommit, '1062f33c881939de53ca10529ef81b5d8dbabc89');
  assert.equal(candidate.sourceTree, '84bf53034518c3e749411fb8a2fea948c3b4c8c3');
  assert.equal(candidate.applicationFiles.length, 106);
  assert.deepEqual([...allFiles].sort(), [...candidate.applicationFiles.map(item => item.path), ...FOCUSED_FILES].sort(),
    'Only the three Season 3 runtime files may be added.');
  for (const item of candidate.applicationFiles) {
    const file = path.join(root, 'dist', item.path);
    assert.ok(fs.lstatSync(file).isFile(), 'Existing application asset must remain a regular file: ' + item.path);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, item.bytes, 'Existing application size changed: ' + item.path);
    assert.equal(sha(bytes), item.sha256, 'Existing application bytes changed: ' + item.path);
  }
  assert.equal(sha(fs.readFileSync(path.join(root, 'netlify.toml'))), candidate.sourceConfigSha256,
    'The source deployment configuration changed.');
  return { baselineDeployId: '6af09274b50143d105dbb63a', existingApplicationFilesPreserved: 106,
    changedApplicationFiles: [], addedRuntimeFiles: FOCUSED_FILES, completeApplicationFileCount: 109 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildFocusedOwnerCycle(), null, 2));
