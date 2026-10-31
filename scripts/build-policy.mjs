// The dedicated preview project's primary deploy is called "production" by
// Netlify. Its role is still a gated, transaction-disabled review. Pin its
// provider-assigned identity instead of adding a general production override.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_ONLY, SETTLEMENT_DEPLOYMENT } from '../settlement-integration/deployment-config.mjs';

export const DEDICATED_PREVIEW = Object.freeze({
  siteId: 'd425445d-4980-49be-8ab2-12e7527ba281',
  origin: 'https://www.treegrow.xyz',
});
const deployment = Object.freeze({ reviewOnly: REVIEW_ONLY, settlementEnabled: SETTLEMENT_DEPLOYMENT.enabled });

export function getBuildPolicy(env = process.env, config = deployment) {
  const providerContext = env.CONTEXT || null;
  const dedicatedPreview = env.NETLIFY === 'true' && env.SITE_ID === DEDICATED_PREVIEW.siteId;
  if (dedicatedPreview) {
    assert.ok(['production', 'branch-deploy', 'deploy-preview'].includes(providerContext),
      'The dedicated preview requires a real Netlify deploy context.');
    assert.equal(config.reviewOnly, true, 'The dedicated preview requires transactions to stay disabled.');
    assert.equal(config.settlementEnabled, false, 'The dedicated preview requires settlement activation to stay disabled.');
  }
  return Object.freeze({
    providerContext,
    siteId: env.SITE_ID || null,
    dedicatedPreview,
    publicProduction: providerContext === 'production' && !dedicatedPreview,
  });
}

export function assertReviewBuild(env = process.env, config = deployment) {
  const policy = getBuildPolicy(env, config);
  assert.ok(!policy.publicProduction, 'Settlement review production build blocked on this site.');
  if (env.NETLIFY && !policy.dedicatedPreview) {
    assert.ok(['branch-deploy', 'deploy-preview'].includes(policy.providerContext),
      'A Netlify review must be an isolated branch or pull-request preview.');
  }
  assert.equal(config.reviewOnly, true, 'This build requires transactions to stay disabled.');
  return policy;
}

// Python presentation builders use this JSON interface so the site identity and
// safety checks have one source of truth. Only nonsecret policy facts are emitted.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--json', 'Use --json to inspect the build policy.');
  process.stdout.write(JSON.stringify(getBuildPolicy()) + '\n');
}
