// Read-only verification of the confirmed setup's disabled application binding.
// Run from any directory with Node 24+:
// node --use-env-proxy /path/to/verify-bindings.mjs [new-output.json]
// Without an output path, prints JSON. An existing evidence file is never overwritten.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SETTLEMENT_DEPLOYMENT, REVIEW_ONLY } from '../../../deployment-config.mjs';
import { createReader } from '../../../reader.mjs';
import { makeRoutes, selectRoute, routeType, objectMatchesRoute, moveFields,
  normalizeSettlementFields } from '../../../model.mjs';
import { EXPECTED as LEGACY } from '../../../../settlement-admin/upgrade-core.mjs';
import { LEGACY_TYPE_ORIGINS } from '../../../../settlement-admin/upgrade-constants.mjs';
import { assertReviewBuild, DEDICATED_PREVIEW } from '../../../../scripts/build-policy.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const read = relative => JSON.parse(fs.readFileSync(path.join(here, relative), 'utf8'));
const manifest = read('../../confirmed-deployment.json');
const verified = read('verification.json');
const primary = read('receipt.json').response.data;
const endpoint = 'https://graphql.mainnet.sui.io/graphql';
const genesisDigest = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
const requests = [];

assert.equal(REVIEW_ONLY, true);
assert.equal(SETTLEMENT_DEPLOYMENT.enabled, false);
assert.equal(SETTLEMENT_DEPLOYMENT.SUPPORTS_CANOPY_CHALLENGES, false);
assert.ok(Object.isFrozen(SETTLEMENT_DEPLOYMENT));
assert.ok(Object.isFrozen(SETTLEMENT_DEPLOYMENT.TYPE_ORIGINS));
assert.deepEqual(SETTLEMENT_DEPLOYMENT, manifest.reviewOnlyConfigurationCandidate);
assert.equal(manifest.runtimeConfigurationChanged, true);
assert.equal(manifest.websiteDeploymentChanged, false);
assert.equal(manifest.settlementRouteEnabled, false);
assert.equal(manifest.gameplayTransactionsEnabled, false);
for (const [key, manifestKey] of Object.entries({ PACKAGE_ID: 'packageId', TYPE_PACKAGE_ID: 'typeOrigin',
  REGISTRY_ID: 'registryId', ADMIN_CAP_ID: 'adminCapId' })) {
  assert.equal(SETTLEMENT_DEPLOYMENT[key], manifest[manifestKey]);
  assert.equal(SETTLEMENT_DEPLOYMENT[key], verified.receipt[manifestKey]);
}
assert.equal(primary.transaction.digest, manifest.setupTransaction);
assert.equal(primary.transaction.effects.status, 'SUCCESS');
assert.equal(primary.transaction.effects.checkpoint.sequenceNumber, manifest.checkpoint);
assert.equal(primary.transaction.effects.checkpoint.timestamp, manifest.confirmedAt);
const created = primary.transaction.effects.objectChanges.nodes.filter(change => change.idCreated && change.outputState);
assert.deepEqual(created.map(change => change.address).sort(), [manifest.registryId, manifest.adminCapId].sort());
const packageOrigins = packageObject => Object.fromEntries(packageObject.typeOrigins
  .filter(origin => origin.module === 'settlement').map(origin => [origin.struct, origin.definingId]));
const published = primary.upgradeTransaction.effects.objectChanges.nodes
  .find(change => change.address === manifest.packageId)?.outputState?.asMovePackage;
assert.ok(published, 'The verified receipt must include the actual published package.');
assert.deepEqual(packageOrigins(published), SETTLEMENT_DEPLOYMENT.TYPE_ORIGINS);
assert.equal(Object.keys(SETTLEMENT_DEPLOYMENT.TYPE_ORIGINS).length, 39);

const legacy = { NETWORK: 'mainnet', PACKAGE_ID: LEGACY.packageId, TYPE_PACKAGE_ID: LEGACY.originalPackageId,
  REGISTRY_ID: LEGACY.legacyRegistry, ADMIN_CAP_ID: LEGACY.legacyAdminCap,
  TYPE_ORIGINS: Object.fromEntries(LEGACY_TYPE_ORIGINS.map(origin => [origin.struct, origin.definingId])) };
const runtimeRoutes = makeRoutes(legacy, SETTLEMENT_DEPLOYMENT);
assert.equal(selectRoute(runtimeRoutes).id, 'legacy');
assert.equal(runtimeRoutes.settlement.available, false);
assert.throws(() => selectRoute(runtimeRoutes, 'settlement'), { code: 'CONTRACT_ROUTE_UNAVAILABLE' });
// This detached clone only exercises the pure model; it is never saved, built,
// passed to a wallet, or used to change route availability in the application.
const validationRoute = selectRoute(makeRoutes(legacy, { ...SETTLEMENT_DEPLOYMENT, enabled: true }), 'settlement');
const policy = assertReviewBuild({ NETLIFY: 'true', CONTEXT: 'production', SITE_ID: DEDICATED_PREVIEW.siteId });
assert.equal(policy.dedicatedPreview, true);

const reader = createReader({ fetchImpl: async (url, options) => {
  assert.equal(url, endpoint);
  assert.equal(options.method, 'POST');
  const request = JSON.parse(options.body);
  const operation = request.query.match(/^query (BindingNetwork|BindingPackage|IntegrationState|IntegrationObject)\b/)?.[1];
  assert.ok(operation, 'Only the four explicit public-read operations are permitted.');
  assert.doesNotMatch(request.query, /\bmutation\b|simulateTransaction|executeTransaction/);
  requests.push({ operation, variables: request.variables });
  return fetch(url, options);
} });
const network = await reader.query('query BindingNetwork { checkpoint { sequenceNumber timestamp digest } ' +
  'genesis: checkpoint(sequenceNumber: 0) { sequenceNumber digest } }');
assert.deepEqual(network.genesis, { sequenceNumber: 0, digest: genesisDigest });
const checkpoint = network.checkpoint;
assert.ok(Number.isSafeInteger(checkpoint.sequenceNumber) && checkpoint.sequenceNumber >= manifest.checkpoint);
const observedAt = Date.parse(checkpoint.timestamp);
assert.ok(Number.isFinite(observedAt) && observedAt <= Date.now() + 30000 && Date.now() - observedAt <= 120000,
  'The current mainnet checkpoint must be fresh.');

const reads = await Promise.allSettled([
  reader.state(SETTLEMENT_DEPLOYMENT.REGISTRY_ID, checkpoint.sequenceNumber),
  reader.object(SETTLEMENT_DEPLOYMENT.ADMIN_CAP_ID, checkpoint.sequenceNumber),
  reader.query('query BindingPackage($package:SuiAddress!,$registry:SuiAddress!,$cp:UInt53!){' +
    'checkpoint(sequenceNumber:$cp){sequenceNumber query{' +
    'package:object(address:$package){asMovePackage{address version typeOrigins{module struct definingId}}}' +
    'registry:object(address:$registry){owner{__typename ... on Shared{initialSharedVersion}}}' +
    '}}}', { package: SETTLEMENT_DEPLOYMENT.PACKAGE_ID, registry: SETTLEMENT_DEPLOYMENT.REGISTRY_ID,
      cp: checkpoint.sequenceNumber }),
]);
const failures = reads.filter(result => result.status === 'rejected');
if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Mainnet binding reads failed.');
const [state, adminCap, identity] = reads.map(result => result.value);
assert.equal(state.checkpoint, checkpoint.sequenceNumber);
assert.equal(identity.checkpoint.sequenceNumber, checkpoint.sequenceNumber);
const livePackage = identity.checkpoint.query.package.asMovePackage;
const registryOwner = identity.checkpoint.query.registry.owner;
assert.equal(livePackage.address, SETTLEMENT_DEPLOYMENT.PACKAGE_ID);
assert.equal(String(livePackage.version), '12');
assert.deepEqual(packageOrigins(livePackage), SETTLEMENT_DEPLOYMENT.TYPE_ORIGINS);
assert.equal(livePackage.typeOrigins.filter(origin => origin.module === 'settlement').length, 39);
assert.equal(registryOwner.__typename, 'Shared');
assert.equal(String(registryOwner.initialSharedVersion), String(manifest.registryInitialSharedVersion));
assert.equal(objectMatchesRoute(state.registry, validationRoute, 'Registry'), true);
assert.equal(objectMatchesRoute(adminCap, validationRoute, 'AdminCap', { registryBound: true }), true);
assert.equal(adminCap.owner.__typename, 'AddressOwner');
assert.equal(adminCap.owner.address.address, manifest.administrator);
assert.deepEqual(moveFields(adminCap), { id: manifest.adminCapId, version: '1', registry_id: manifest.registryId });
assert.equal(moveFields(state.registry).admin, manifest.administrator);
assert.equal(moveFields(state.registry).total_seeds, '0');
assert.equal(moveFields(state.registry).treasury, '0');
const normalized = normalizeSettlementFields(state.registry, { route: validationRoute, nowMs: state.nowMs });
for (const key of ['seasonId', 'seasonStartMs', 'seasonEndMs', 'claimDeadlineMs', 'poolMist', 'remainingPoolMist', 'totalGP', 'eligibleGP'])
  assert.equal(normalized[key], 0n, 'Expected the confirmed empty setup: ' + key);
for (const key of ['active', 'claimWindowOpen', 'finalized', 'paused']) assert.equal(normalized[key], false);
assert.equal(SETTLEMENT_DEPLOYMENT.enabled, false, 'Validation must not mutate the runtime binding.');

const sourceFiles = ['settlement-integration/deployment-config.mjs', 'settlement-integration/release/confirmed-deployment.json',
  'settlement-integration/model.mjs', 'settlement-integration/reader.mjs', 'scripts/build-policy.mjs',
  'settlement-integration/model.test.mjs', 'scripts/build-policy.test.mjs',
  'settlement-admin/upgrade-core.mjs', 'settlement-admin/upgrade-constants.mjs',
  'settlement-integration/release/evidence/20261031-confirmed-setup/verify-bindings.mjs'];
const report = {
  schemaVersion: 1, verifiedAt: new Date().toISOString(), status: 'verified_disabled_application_binding',
  endpoint, network: 'sui:mainnet', genesisDigest, checkpoint,
  networkClockMs: state.nowMs, networkClockTime: new Date(state.nowMs).toISOString(),
  setupTransaction: manifest.setupTransaction, confirmedSetupCheckpoint: manifest.checkpoint,
  runtimeConfigurationChanged: true, websiteDeploymentChanged: false, settlementRouteEnabled: false,
  reviewOnly: REVIEW_ONLY, gameplayTransactionsEnabled: false, canopyChallengesEnabled: false,
  typeOriginCount: Object.keys(SETTLEMENT_DEPLOYMENT.TYPE_ORIGINS).length,
  boundConfiguration: SETTLEMENT_DEPLOYMENT, runtimeSettlementRouteAvailable: runtimeRoutes.settlement.available,
  temporaryValidationRouteOnly: true, dedicatedPreviewPolicyAccepted: policy.dedicatedPreview,
  currentRegistry: { ...state.registry, owner: registryOwner }, currentAdminCap: adminCap,
  normalizedState: normalized, requests,
  sourceSha256: Object.fromEntries(sourceFiles.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  signaturesRequested: 0, simulationsRequested: 0, transactionsSubmitted: 0,
};
const json = JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
assert.ok(process.argv.length <= 3, 'Usage: node --use-env-proxy verify-bindings.mjs [new-output.json]');
if (process.argv[2]) {
  fs.writeFileSync(path.resolve(process.argv[2]), json, { flag: 'wx' });
  console.log('Verified disabled binding at checkpoint ' + checkpoint.sequenceNumber + ': ' + path.resolve(process.argv[2]));
} else process.stdout.write(json);
