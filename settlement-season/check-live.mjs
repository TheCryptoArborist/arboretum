// Public reads and one checked unsigned first-season simulation. This driver
// never connects a wallet, signs, executes, funds, starts a season or deploys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  START_EXPECTED as EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY,
  INPUT_VARIABLES, SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES,
  loadReviewedStart, validateInputs, validateSimulation, validateConfirmedStart,
  contents, reference,
} from './start-core.mjs';

assert.equal(process.argv.length, 3, 'Usage: node settlement-season/check-live.mjs <new-output-directory>');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'Normal TLS validation is required.');
assert.equal(EXPECTED.endpoint, 'https://graphql.mainnet.sui.io/graphql');
assert.equal(EXPECTED.origin, 'https://www.treegrow.xyz');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const packetSource = 'settlement-integration/verification/season-test-20261031/mainnet/unsigned-start-kind.b64';
const sourceFiles = [
  'settlement-season/start-core.mjs', 'settlement-season/check-live.mjs',
  'settlement-setup/setup-core.mjs', 'settlement-admin/upgrade-core.mjs',
  'settlement-admin/upgrade-constants.mjs', 'settlement-integration/deployment-config.mjs',
  'package.json', 'package-lock.json', packetSource,
];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(name => [name,
  sha256(fs.readFileSync(path.join(root, name)))]));
const beforeHashes = sourceHashes();
const save = (name, value) => fs.writeFileSync(path.join(output, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requests = [];
const startedAt = now();
save('source-before.json', { capturedAt: startedAt, sourceSha256: beforeHashes });
let approvedSimulation, simulationCapture, selectedAfterObservation;

async function capture(name, method, headers, body) {
  assert.match(name, /^(confirmed-proof|inputs|cors|confirmation-control|simulation|after-observation-(?:[1-9]|10))$/);
  assert.ok(!requests.some(item => item.name === name), 'Each request name is single-use.');
  const requestedAt = now();
  const request = { requestedAt, endpoint: EXPECTED.endpoint, method,
    credentials: 'omit', redirect: 'error', headers, ...(body ? body : {}) };
  save(name + '-request.json', request);
  const entry = { name, method, requestedAt, checkedSimulation: name === 'simulation' };
  requests.push(entry);
  let response;
  try {
    response = await fetch(EXPECTED.endpoint, {
      method, credentials: 'omit', redirect: 'error', headers,
      signal: AbortSignal.timeout(45000), ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const capturedAt = now();
    save(name + '-response.txt', text);
    const responseHeaders = Object.fromEntries(['content-type', 'date',
      'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']
      .map(key => [key, response.headers.get(key)]));
    let result = null, parseError = null;
    if (method === 'POST') {
      try { result = JSON.parse(text); }
      catch { parseError = 'Response is not JSON.'; }
    }
    const recorded = { ...request, capturedAt, httpStatus: response.status,
      responseHeaders, response: result, ...(parseError ? { parseError } : {}) };
    save(name + '.json', recorded);
    Object.assign(entry, { capturedAt, httpStatus: response.status });
    assert.ok(response.ok, 'Public mainnet HTTP failure: ' + name);
    assert.ok([EXPECTED.origin, '*'].includes(responseHeaders['access-control-allow-origin']),
      'Canonical-origin CORS permission is missing: ' + name);
    if (method === 'POST') {
      assert.equal(response.status, 200);
      assert.equal(parseError, null);
      assert.ok(result?.data && !result.errors?.length, 'Incomplete or failed GraphQL response: ' + name);
    }
    return recorded;
  } catch (error) {
    const failedAt = now();
    entry.failedAt = failedAt;
    save(name + '-error.json', { failedAt, name: error?.name, message: error?.message,
      ...(response ? { httpStatus: response.status } : {}) });
    throw error;
  }
}

async function query(name, source, variables) {
  assert.match(source, /^query\b/);
  assert.ok(!/\bmutation\b|\bexecuteTransaction\b/.test(source), 'Only public queries are allowed.');
  if (source === PROOF_QUERY) {
    assert.equal(name, 'confirmed-proof');
    assert.deepEqual(variables, PROOF_VARIABLES);
  } else if (source === INPUTS_QUERY) {
    assert.ok(name === 'inputs' || /^after-observation-(?:[1-9]|10)$/.test(name));
    if (name !== 'inputs') assert.ok(simulationCapture, 'A post-read requires the completed simulation response.');
    assert.deepEqual(variables, INPUT_VARIABLES);
  } else if (source === SIMULATION_QUERY) {
    assert.equal(name, 'simulation');
    assert.ok(approvedSimulation);
    assert.ok(!requests.some(item => item.checkedSimulation), 'Exactly one simulation is permitted per run.');
    assert.ok(source.includes('checksEnabled:true') && source.includes('doGasSelection:true'));
    assert.deepEqual(variables, { ...INPUT_VARIABLES, transaction: approvedSimulation });
  } else if (source === CONFIRM_QUERY) {
    assert.equal(name, 'confirmation-control');
    assert.deepEqual(variables, { ...CONFIRM_VARIABLES, digest: EXPECTED.setupDigest });
  } else assert.fail('Unrecognized query.');
  return capture(name, 'POST', { 'Content-Type': 'application/json', Accept: 'application/json',
    Origin: EXPECTED.origin }, { query: source, variables });
}

function verifyUnchanged(before, after) {
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']) {
    assert.deepEqual(reference(after[name]), reference(before[name]), name + ' reference changed.');
    assert.deepEqual(after[name].owner, before[name].owner, name + ' owner changed.');
    assert.equal(after[name].asMoveObject.contents.type.repr, before[name].asMoveObject.contents.type.repr,
      name + ' type changed.');
    assert.deepEqual(contents(after[name]), contents(before[name]), name + ' contents changed.');
  }
  assert.equal(after.status, 'ready');
  assert.equal(String(contents(after.registry).version), '1');
  assert.equal(String(contents(after.upgradeCap).version), '12');
  for (const key of ['seasonId', 'storedStartMs', 'rewardPoolMist', 'treasuryMist',
    'totalSeeds', 'growthPoints', 'eligibleGrowthPoints']) {
    assert.equal(String(after.currentState[key]), '0', 'The live first-test state changed: ' + key);
  }
  assert.equal(after.currentState.paused, false);
}

let summary;
try {
  const proof = await query('confirmed-proof', PROOF_QUERY, PROOF_VARIABLES);
  const inputs = await query('inputs', INPUTS_QUERY, INPUT_VARIABLES);
  const before = await validateInputs(inputs, proof);
  const packet = await loadReviewedStart(fs.readFileSync(path.join(root, packetSource), 'utf8'));
  save('unsigned-start-kind.b64', packet.kindBase64 + '\n');
  save('unsigned-packet.json', { kindBase64: packet.kindBase64, kindSha256: packet.kindSha256,
    kindBytes: EXPECTED.kindBytes, simulationTransaction: packet.simulationTransaction });
  const cors = await capture('cors', 'OPTIONS', { Origin: EXPECTED.origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
  assert.ok((cors.responseHeaders['access-control-allow-methods'] ?? '').split(',')
    .some(method => method.trim().toUpperCase() === 'POST'), 'CORS does not permit POST.');
  assert.ok((cors.responseHeaders['access-control-allow-headers'] ?? '').split(',')
    .some(header => ['content-type', '*'].includes(header.trim().toLowerCase())), 'CORS does not permit Content-Type.');
  const control = await query('confirmation-control', CONFIRM_QUERY,
    { ...CONFIRM_VARIABLES, digest: EXPECTED.setupDigest });
  let confirmationControl;
  await assert.rejects(() => validateConfirmedStart(control, EXPECTED.setupDigest, proof), error => {
    if (error?.code !== 'PACKET_MISMATCH') return false;
    confirmationControl = { digest: EXPECTED.setupDigest, correctlyRejectedAsFirstStart: true,
      code: error.code, message: error.message,
      observedTransactionStatus: control.response.data.transaction?.effects?.status };
    return true;
  }, 'The known setup receipt must be rejected specifically because its transaction kind is different.');
  save('confirmation-control-result.json', confirmationControl);
  approvedSimulation = packet.simulationTransaction;
  simulationCapture = await query('simulation', SIMULATION_QUERY,
    { ...INPUT_VARIABLES, transaction: approvedSimulation });
  const simulated = await validateSimulation(simulationCapture, packet, before, proof);
  const postObservationNotBeforeMs = Date.parse(simulationCapture.capturedAt);
  let after;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const name = `after-observation-${attempt}`;
    const observation = await query(name, INPUTS_QUERY, INPUT_VARIABLES);
    const current = await validateInputs(observation, proof);
    verifyUnchanged(before, current);
    if (current.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber &&
        Date.parse(current.checkpoint.timestamp) >= postObservationNotBeforeMs) {
      after = current;
      selectedAfterObservation = name;
      fs.copyFileSync(path.join(output, name + '.json'), path.join(output, 'after.json'), fs.constants.COPYFILE_EXCL);
      break;
    }
    if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(after, 'Indexer did not reach the completed simulation response within ten read-only observations.');
  const afterHashes = sourceHashes();
  save('source-after.json', { capturedAt: now(), sourceSha256: afterHashes });
  assert.deepEqual(afterHashes, beforeHashes, 'Source or reviewed packet changed during the check.');
  assert.equal(requests.filter(item => item.checkedSimulation).length, 1);
  summary = { schemaVersion: 1, startedAt, verifiedAt: now(),
    status: 'OWNER_TEST_SEASON_UNSIGNED_REHEARSAL_PASSED', network: EXPECTED.chain,
    canonicalOrigin: EXPECTED.origin, endpoint: EXPECTED.endpoint,
    packet: { kindSha256: packet.kindSha256, kindBytes: EXPECTED.kindBytes,
      function: 'settlement::start_season_for_duration', durationMs: EXPECTED.durationMs,
      packageId: EXPECTED.packageId, registryId: EXPECTED.registryId, adminCapId: EXPECTED.adminCapId },
    simulated, confirmationControl, postObservationNotBeforeMs, selectedAfterObservation,
    actualAfterRehearsal: { checkpoint: after.checkpoint, packageVersion: '12', inventoryVersion: '1',
      registryId: EXPECTED.registryId, ...after.currentState, protocolObjectsUnchanged: true,
      references: Object.fromEntries(['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap']
        .map(name => [name, reference(after[name])])) },
    sourceSha256: beforeHashes, sourceAfterSha256: afterHashes, requests,
    actualSignaturesRequested: 0, actualTransactionsSubmitted: 0,
    actualGasSpentMist: '0', actualFundsDepositedMist: '0', actualSeasonStarted: false,
    applicationActivationPerformed: false, websiteDeploymentPerformed: false,
    limits: ['Simulation timing and gas are predictions, not a confirmed start or future fee guarantee.',
      'The existing version-1 Registry remains empty and unstarted at the later saved checkpoint.',
      'The owner must separately review and approve any actual start in their wallet.'] };
  save('summary.json', summary);
  console.log(JSON.stringify({ status: summary.status, simulatedFeeSui: simulated.gasEstimateSui,
    observedSeasonId: after.currentState.seasonId, observedPackageVersion: '12',
    observedInventoryVersion: '1', signaturesRequested: 0, transactionsSubmitted: 0, output }, null, 2));
} catch (error) {
  let afterHashes = null;
  try { afterHashes = sourceHashes(); } catch { /* Preserve the original failure if a source disappeared. */ }
  if (!fs.existsSync(path.join(output, 'source-after.json'))) {
    save('source-after.json', { capturedAt: now(), sourceSha256: afterHashes });
  }
  save('failure.json', { schemaVersion: 1, startedAt, failedAt: now(),
    status: 'OWNER_TEST_SEASON_UNSIGNED_REHEARSAL_FAILED',
    error: { name: error?.name, code: error?.code ?? null, message: error?.message },
    sourceSha256: beforeHashes, sourceAfterSha256: afterHashes, requests,
    actualSignaturesRequested: 0, actualTransactionsSubmitted: 0,
    actualGasSpentMist: '0', actualFundsDepositedMist: '0', actualSeasonStartedByDriver: false });
  throw error;
}
