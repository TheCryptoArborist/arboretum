// Build the focused Season 4 owner watering test; preserve the completed test pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-cycle-four');
const output = path.join(root, 'dist/admin/season-four');
const sha = value => createHash('sha256').update(value).digest('hex');
export const SEASON_FOUR_FILES = Object.freeze([
  'admin/season-four/admin.css', 'admin/season-four/admin.mjs', 'admin/season-four/index.html',
]);

export async function buildSeasonFour() {
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
  assert.ok(html.includes('/admin/season-four/admin.mjs'));
  assert.ok(html.includes('/admin/season-four/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline Season 4 scripts.');
  assert.ok(!html.includes('next=season-four'), 'Use the direct route; the retained compatibility entrance is not extended.');
  assert.deepEqual(fs.readdirSync(output).sort(), ['admin.css', 'admin.mjs', 'index.html']);
  return { route: '/admin/season-four/', authorizedOrigin: 'https://www.treegrow.xyz',
    inventoryVersion: 1, seasonId: 4, durationMs: '172800000', ownerWalletApprovalRequired: true,
    transactionScope: 'owner-season-four-focused-watering', testerCodeRequiredOnDedicatedSite: false,
    generalGameplayEnabled: false, productionUpgradeEnabled: false,
    emittedSha256: Object.fromEntries(SEASON_FOUR_FILES.map(name => [name, sha(fs.readFileSync(path.join(root, 'dist', name)))])) };
}

export function verifySeasonFourPreservation(allFiles) {
  const raw = fs.readFileSync(path.join(root, 'settlement-cycle-three/verification/hosted/candidate.json'));
  assert.equal(sha(raw), '8904cc2096ba97078213de4ffd3e1a9ba7917c1bc4df15df20223fb8bd79909c',
    'The published Season 3 candidate record changed.');
  const candidate = JSON.parse(raw);
  assert.equal(candidate.sourceCommit, '5d17306758518579bf523ab8a7f9e8cb198a9fe8');
  assert.equal(candidate.sourceTree, 'a17cff6a8a442d1518bf69331fd600731868e3dd');
  assert.equal(candidate.applicationFiles.length, 109);
  assert.deepEqual([...allFiles].sort(), [...candidate.applicationFiles.map(item => item.path), ...SEASON_FOUR_FILES].sort(),
    'Only the three Season 4 runtime files may be added.');
  for (const item of candidate.applicationFiles) {
    const file = path.join(root, 'dist', item.path);
    assert.ok(fs.lstatSync(file).isFile(), 'Existing application asset must remain a regular file: ' + item.path);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, item.bytes, 'Existing application size changed: ' + item.path);
    assert.equal(sha(bytes), item.sha256, 'Existing application bytes changed: ' + item.path);
  }
  assert.equal(sha(fs.readFileSync(path.join(root, 'netlify.toml'))), candidate.sourceConfigSha256,
    'The source deployment configuration changed.');
  return { baselineDeployId: '6af36b1211851adcba7aa254', existingApplicationFilesPreserved: 109,
    changedApplicationFiles: [], addedRuntimeFiles: SEASON_FOUR_FILES, completeApplicationFileCount: 112 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildSeasonFour(), null, 2));
