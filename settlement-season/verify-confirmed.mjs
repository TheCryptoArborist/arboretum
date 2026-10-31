// Read-only verification of the owner's actual first-season receipt.
// No wallet, signing, simulation, or execution path is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  START_EXPECTED as EXPECTED, PROOF_QUERY, PROOF_VARIABLES,
  CONFIRM_QUERY, CONFIRM_VARIABLES, validateConfirmedStart,
} from './start-core.mjs';

assert.equal(process.argv.length, 4, 'Usage: node --use-env-proxy settlement-season/verify-confirmed.mjs <digest> <new-output-directory>');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const digest = process.argv[2];
assert.match(digest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: false });
const save = (name, value) => fs.writeFileSync(path.join(output, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const startedAt = new Date().toISOString();
const requests = [];
async function query(name, query, variables) {
  assert.ok(query === PROOF_QUERY || query === CONFIRM_QUERY);
  assert.ok(!/\bmutation\b|\bexecuteTransaction\b|\bsimulateTransaction\b/.test(query));
  const requestedAt = new Date().toISOString();
  save(name + '-request.json', { requestedAt, endpoint: EXPECTED.endpoint, query, variables });
  const response = await fetch(EXPECTED.endpoint, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: EXPECTED.origin },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  save(name + '-response.txt', text);
  const captured = { requestedAt, capturedAt: new Date().toISOString(), httpStatus: response.status,
    endpoint: EXPECTED.endpoint, response: JSON.parse(text) };
  save(name + '.json', captured);
  requests.push({ name, requestedAt, capturedAt: captured.capturedAt, httpStatus: response.status });
  assert.equal(response.status, 200);
  assert.ok(captured.response.data && !captured.response.errors?.length);
  return captured;
}
try {
  const proof = await query('proof', PROOF_QUERY, PROOF_VARIABLES);
  const actual = await query('receipt', CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest });
  const confirmed = await validateConfirmedStart(actual, digest, proof);
  const summary = { schemaVersion: 1, startedAt, verifiedAt: new Date().toISOString(),
    status: 'FIRST_TEST_SEASON_ACTUAL_RECEIPT_VERIFIED', network: EXPECTED.chain,
    digest, confirmed, actualGasMist: confirmed.gasEstimateMist,
    actualGasSui: confirmed.gasEstimateSui, actualRewardFundingMist: '0',
    observedCheckpoint: actual.response.data.checkpoint, requests,
    verificationSignatures: 0, verificationSubmissions: 0, verificationSimulations: 0,
    sourceSha256: Object.fromEntries(['settlement-season/start-core.mjs',
      'settlement-season/verify-confirmed.mjs', 'settlement-setup/setup-core.mjs',
      'settlement-admin/upgrade-core.mjs', 'package-lock.json'].map(name => [name,
        createHash('sha256').update(fs.readFileSync(name)).digest('hex')])) };
  save('summary.json', summary);
  console.log(JSON.stringify({ status: summary.status, digest, start: new Date(Number(confirmed.actualStartMs)).toISOString(),
    cutoff: new Date(Number(confirmed.cutoffMs)).toISOString(), actualGasSui: summary.actualGasSui,
    currentState: confirmed.currentState, output }, null, 2));
} catch (error) {
  save('failure.json', { startedAt, failedAt: new Date().toISOString(), digest, requests,
    error: { name: error?.name, code: error?.code ?? null, message: error?.message },
    verificationSignatures: 0, verificationSubmissions: 0, verificationSimulations: 0 });
  throw error;
}
