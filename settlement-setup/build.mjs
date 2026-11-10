// Publish only the exact, separately approved empty Registry setup route.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertReviewBuild } from '../scripts/build-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'settlement-setup');
const output = path.join(root, 'dist/admin/settlement-setup');
const evidence = path.join(root, 'settlement-integration/release/evidence/20261031-empty-registry-review');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const kindSha256 = '2295013a26ba1d4e3ed9cf130a97a8123dda75aa1df6fbce256656260bdd193b';

export async function buildAdministratorSetup() {
  assertReviewBuild();
  const kind = fs.readFileSync(path.join(evidence, 'setup-kind.b64'), 'utf8').trim();
  const kindBytes = Buffer.from(kind, 'base64');
  assert.equal(kindBytes.length, 154);
  assert.equal(sha256(kindBytes), kindSha256, 'Setup route must contain the exact reviewed single-call kind.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/sui/package.json'))).version, '2.19.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mysten/dapp-kit-core/package.json'))).version, '1.6.1');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['index.html', 'admin.css']) fs.copyFileSync(path.join(input, name), path.join(output, name));
  fs.writeFileSync(path.join(output, 'setup-kind.b64'), kind + '\n');
  await build({
    entryPoints: [path.join(input, 'admin.mjs')], outfile: path.join(output, 'admin.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, legalComments: 'none',
  });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('/admin/settlement-setup/admin.mjs'));
  assert.ok(html.includes('/admin/settlement-setup/admin.css'));
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'No inline administrator scripts.');
  const gate = fs.readFileSync(path.join(root, 'netlify/edge-functions/tester-gate.ts'), 'utf8');
  assert.ok(!gate.slice(gate.indexOf('function publicPaths'), gate.indexOf('function secure')).includes('/admin/'),
    'Administrator setup must remain tester-protected.');
  const files = fs.readdirSync(output).sort();
  assert.deepEqual(files, ['admin.css', 'admin.mjs', 'index.html', 'setup-kind.b64']);
  return {
    route: '/admin/settlement-setup/', authorizedOrigin: 'https://www.treegrow.xyz',
    exactSetupKindSha256: kindSha256, exactSetupKindBytes: kindBytes.length,
    packageId: '0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a',
    confirmedUpgradeDigest: 'GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU',
    ownerWalletApprovalRequired: true, emptyRegistrySetupEnabled: true,
    gameplayTransactionsEnabled: false, seasonStartEnabled: false, fundingEnabled: false,
    emittedSha256: Object.fromEntries(files.map(name => [
      'admin/settlement-setup/' + name, sha256(fs.readFileSync(path.join(output, name))),
    ])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildAdministratorSetup(), null, 2));
}
