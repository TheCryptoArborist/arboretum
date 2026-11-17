import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReviewBuild, DEDICATED_PREVIEW, getBuildPolicy } from './build-policy.mjs';
import { getBuildSteps } from './build-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalSite = 'a344fb31-10b4-4eea-9562-067d90a39607';
const unknownSite = '00000000-0000-4000-8000-000000000000';
const envFor = siteId => ({ NETLIFY: 'true', CONTEXT: 'production', SITE_ID: siteId });
const previewEnv = envFor(DEDICATED_PREVIEW.siteId);
const reviewConfig = { reviewOnly: true, settlementEnabled: false };
function childEnv(env) {
  const result = { ...process.env };
  for (const key of ['NETLIFY', 'CONTEXT', 'SITE_ID']) delete result[key];
  return { ...result, ...env };
}

for (const [name, siteId] of [['original', originalSite], ['unknown', unknownSite]]) {
  test(`${name} site's production cannot run the review entry point`, () => {
    assert.throws(() => assertReviewBuild(envFor(siteId)), /production build blocked/);
    const result = spawnSync(process.execPath, ['settlement-integration/build-review.mjs'], {
      cwd: root, env: childEnv(envFor(siteId)), encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /production build blocked/);
  });
}

test('the pinned dedicated preview keeps its actual production context', () => {
  const env = { ...previewEnv };
  const policy = assertReviewBuild(env);
  assert.equal(policy.providerContext, 'production');
  assert.equal(policy.dedicatedPreview, true);
  assert.equal(policy.publicProduction, false);
  assert.deepEqual(env, previewEnv, 'Policy checks must not rewrite provider variables');
});

test('site name or URL cannot substitute for the provider-assigned site ID', () => {
  assert.throws(() => assertReviewBuild({ ...envFor(unknownSite), SITE_NAME: 'arboretum-preview', URL: DEDICATED_PREVIEW.origin }), /production build blocked/);
  assert.throws(() => assertReviewBuild({ CONTEXT: 'production', SITE_ID: DEDICATED_PREVIEW.siteId }), /production build blocked/);
});

test('dedicated preview fails closed if transactions or settlement activation change', () => {
  assert.throws(() => getBuildPolicy(previewEnv, { ...reviewConfig, reviewOnly: false }), /transactions to stay disabled/);
  assert.throws(() => getBuildPolicy(previewEnv, { ...reviewConfig, settlementEnabled: true }), /settlement activation to stay disabled/);
  assert.throws(() => getBuildPolicy({ ...previewEnv, CONTEXT: 'dev' }), /real Netlify deploy context/);
});

test('read-only route availability is permitted on the dedicated preview and never activates gameplay', () => {
  const config = { ...reviewConfig, settlementReviewEnabled: true };
  assert.equal(assertReviewBuild(previewEnv, config).dedicatedPreview, true);
  assert.equal(assertReviewBuild({}, config).publicProduction, false);
  for (const env of [previewEnv, {}, { NETLIFY: 'true', SITE_ID: originalSite, CONTEXT: 'branch-deploy' }]) {
    assert.throws(() => assertReviewBuild(env, { ...config, settlementEnabled: true }), /mutually exclusive/);
    assert.throws(() => assertReviewBuild(env, { ...config, settlementReviewEnabled: false, settlementEnabled: true }),
      /settlement activation to stay disabled/);
    assert.throws(() => assertReviewBuild(env, { ...config, reviewOnly: false }), /transactions to stay disabled/);
  }
  assert.throws(() => assertReviewBuild(envFor(originalSite), config), /production build blocked/);
  assert.throws(() => assertReviewBuild(envFor(unknownSite), config), /production build blocked/);
});

test('environment flags cannot turn compiled read-only review availability into activation or change site policy', () => {
  const attemptedOverrides = { SETTLEMENT_ENABLED: 'true', SETTLEMENT_REVIEW_ENABLED: 'false',
    REVIEW_ONLY: 'false', ARBORETUM_SETTLEMENT_ENABLED: 'true', ARBORETUM_READ_ONLY: 'false' };
  assert.deepEqual(assertReviewBuild({ ...previewEnv, ...attemptedOverrides }), assertReviewBuild(previewEnv));
  assert.throws(() => assertReviewBuild({ ...envFor(originalSite), ...attemptedOverrides }), /production build blocked/);
});

test('real branch and pull-request contexts are preserved for child builders', () => {
  for (const context of ['branch-deploy', 'deploy-preview']) {
    const env = { ...envFor(originalSite), CONTEXT: context };
    assert.equal(assertReviewBuild(env).providerContext, context);
  }
  assert.equal(assertReviewBuild({}).providerContext, null);
});

test('dispatcher retains the established public pipeline on other sites', () => {
  const originalCommand = 'python3 scripts/build-player-guide.py && node scripts/build-guide-site.mjs && node scripts/build-prelaunch.mjs && node scripts/polish-player-guide.mjs && python3 scripts/build-public-guide.py && python3 scripts/build-reward-first.py && node scripts/build-season-status.mjs';
  for (const env of [{}, envFor(originalSite), envFor(unknownSite)]) {
    assert.equal(getBuildSteps(env).map(step => step.join(' ')).join(' && '), originalCommand);
  }
  assert.deepEqual(getBuildSteps(previewEnv), [['node', 'settlement-integration/build-review.mjs']]);
});

test('public production approvals cannot enable indexing on the dedicated preview', () => {
  const approvals = {
    ARBORETUM_PRELAUNCH_APPROVED: 'true',
    ARBORETUM_REWARD_FIRST_APPROVED: 'true',
    ARBORETUM_SEASON_STATUS_APPROVED: '2026-10-01',
  };
  assert.equal(getBuildPolicy({ ...previewEnv, ...approvals }).publicProduction, false);
  assert.equal(getBuildPolicy({ ...envFor(originalSite), ...approvals }).publicProduction, true);
});

test('Python builders read the same policy without replacing CONTEXT', () => {
  for (const env of [previewEnv, envFor(originalSite)]) {
    const result = spawnSync('python3', ['-c',
      'import json, os, sys; sys.path.insert(0, "scripts"); from build_policy import get_build_policy; print(json.dumps({"policy": get_build_policy(), "context_after": os.environ["CONTEXT"]}))'], {
      cwd: root, env: childEnv(env), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.policy, getBuildPolicy(env));
    assert.equal(output.context_after, 'production');
  }
});
