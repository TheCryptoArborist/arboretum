// Add only the owner-approved, exact upgrade route to the protected review.
// Existing gameplay continues to use its transaction-disabled review wallet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-admin');
const output = path.join(root, 'dist/admin/settlement-upgrade');
const evidence = path.join(root, 'settlement-integration/release/evidence/20261031-review');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const kindSha256 = '1b62257103c3a67c36607a7471180cee64159115274b774149282da1d7b443e0';

export async function buildAdministratorUpgrade() {
  assertReviewBuild();
  const kind = fs.readFileSync(path.join(evidence, 'upgrade-kind.b64'), 'utf8').trim();
  assert.equal(sha256(Buffer.from(kind, 'base64')), kindSha256,
    'Administrator route must contain the exact approved upgrade kind.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version,
    '2.19.0', 'Review serializer changes before upgrading the SDK.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version,
    '1.6.1', 'Review wallet adapter changes before updating the toolkit.');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) {
    fs.copyFileSync(path.join(input, name), path.join(output, name));
  }
  fs.writeFileSync(path.join(output, 'upgrade-kind.b64'), kind + '\n');
  await build({
    entryPoints: [path.join(input, 'admin.mjs')],
    outfile: path.join(output, 'admin.mjs'), bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', minify: true, sourcemap: false,
    legalComments: 'none',
  });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/settlement-upgrade/admin.mjs'));
  assert.ok(html.includes('/admin/settlement-upgrade/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline administrator scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  const publicPaths = gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure'));
  assert.ok(!publicPaths.includes('/admin/'), 'Administrator route must remain tester-protected.');
  const files = fs.readdirSync(output).sort();
  assert.deepEqual(files, ['admin.css', 'admin.mjs', 'index.html', 'upgrade-kind.b64']);
  return {
    route: '/admin/settlement-upgrade/',
    authorizedOrigin: 'https://www.treegrow.xyz',
    exactUpgradeKindSha256: kindSha256,
    gameplayTransactionsEnabled: false,
    ownerWalletApprovalRequired: true,
    registrySetupEnabled: false,
    emittedSha256: Object.fromEntries(files.map(name => [
      'admin/settlement-upgrade/' + name, sha256(fs.readFileSync(path.join(output, name))),
    ])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildAdministratorUpgrade(), null, 2));
}
