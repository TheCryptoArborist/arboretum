// Add only the Season 4 owner page after the unchanged 109-file review build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
export const SEASON_FOUR_FILES = Object.freeze(['admin/season-four/admin.css', 'admin/season-four/admin.mjs', 'admin/season-four/index.html']);
export function baselineCandidate() {
  const bytes = fs.readFileSync(path.join(root, 'settlement-cycle-three/verification/hosted/candidate.json'));
  assert.equal(hash(bytes), '8904cc2096ba97078213de4ffd3e1a9ba7917c1bc4df15df20223fb8bd79909c');
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.sourceCommit, '5d17306758518579bf523ab8a7f9e8cb198a9fe8');
  assert.equal(candidate.sourceTree, 'a17cff6a8a442d1518bf69331fd600731868e3dd');
  assert.equal(candidate.applicationFiles.length, 109);
  return candidate;
}
export function verifySeasonFourPreservation(publishDir = path.join(root, 'dist')) {
  const baseline = baselineCandidate(), files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      assert(!entry.isSymbolicLink(), 'No symlink in application inventory: ' + full);
      if (entry.isDirectory()) walk(full);
      else { assert(entry.isFile(), 'Unexpected application entry'); files.push(path.relative(publishDir, full)); }
    }
  }
  walk(publishDir);
  assert.deepEqual(files.sort(), [...baseline.applicationFiles.map(item => item.path), ...SEASON_FOUR_FILES].sort(),
    'Only the three Season 4 runtime files may be added.');
  for (const item of baseline.applicationFiles) {
    const bytes = fs.readFileSync(path.join(publishDir, item.path));
    assert.equal(bytes.length, item.bytes, 'Preserved file size changed: ' + item.path);
    assert.equal(hash(bytes), item.sha256, 'Preserved file changed: ' + item.path);
  }
  for (const name of SEASON_FOUR_FILES) assert(fs.statSync(path.join(publishDir, name)).size > 0, 'Empty Season 4 asset');
  assert.equal(hash(fs.readFileSync(path.join(root, 'netlify.toml'))), baseline.sourceConfigSha256,
    'The source deployment configuration changed.');
  return { baselineDeployId: '6af36b1211851adcba7aa254', existingApplicationFilesPreserved: 109,
    addedRuntimeFiles: SEASON_FOUR_FILES, changedExistingApplicationFiles: [], completeApplicationFileCount: 112 };
}
export async function buildSeasonFour() {
  assertReviewBuild(); baselineCandidate();
  for (const [pkg, version] of [['@mysten/sui', '2.19.0'], ['@mysten/dapp-kit-core', '1.6.1']])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'))).version, version);
  const input = path.join(root, 'settlement-cycle-four'), output = path.join(root, 'dist/admin/season-four');
  fs.mkdirSync(output, { recursive: true });
  for (const file of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, file), path.join(output, file));
  await build({ entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false,
    legalComments: 'none', logOverride: { 'import-is-undefined': 'error' } });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert(html.includes('/admin/season-four/admin.mjs') && html.includes('/admin/season-four/admin.css'));
  assert(html.includes('/admin/season-three/'));
  assert(html.includes('7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL'));
  assert(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline scripts');
  const report = { preparedAt: new Date().toISOString(), route: '/admin/season-four/',
    seasonId: 4, durationMs: '172800000', ownerWalletApprovalRequired: true,
    generalGameplayEnabled: false, productionUpgradeEnabled: false, published: false,
    ...verifySeasonFourPreservation(),
    emittedSha256: Object.fromEntries(SEASON_FOUR_FILES.map(name => [name, hash(fs.readFileSync(path.join(root, 'dist', name)))])) };
  const folder = path.join(input, 'verification/build'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildSeasonFour(), null, 2));
