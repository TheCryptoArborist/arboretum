// Read-only verification of the new page's actual predecessor and waiting state.
// This script cannot connect a wallet, simulate, sign, or submit a transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  inspectState, contents,
} from './common.mjs';
import { prepareRollover } from './rollover-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'settlement-cycle-three/verification/live-readonly');
fs.mkdirSync(directory, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const queries = new Map([[PROOF_QUERY, PROOF_VARIABLES], [INPUTS_QUERY, INPUT_VARIABLES]]);
const record = { startedAt: new Date().toISOString(), passed: false,
  method: 'Exact read-only predecessor proof, then fresh current inputs; no future state substitution.',
  endpoint: EXPECTED.endpoint, network: EXPECTED.chain, intendedSeason: EXPECTED.seasonId,
  readOnlyQueries: 0, simulations: 0, walletConnections: 0, signatures: 0,
  submittedTransactions: 0, futureWateringLiveTested: false };

async function read(name, query, variables) {
  assert(queries.has(query)); assert.deepEqual(variables, queries.get(query));
  assert(!/\b(mutation|executeTransaction|simulateTransaction)\b/.test(query));
  const request = { query, variables };
  save(name + '-request.json', request);
  const response = await fetch(EXPECTED.endpoint, { method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
  const text = await response.text();
  assert.equal(response.status, 200, 'Read-only GraphQL request failed.');
  const result = JSON.parse(text);
  assert(!result.errors?.length, JSON.stringify(result.errors)); assert(result.data);
  save(name + '.json', result); record.readOnlyQueries += 1;
  return result;
}

try {
  const proof = await read('proof', PROOF_QUERY, PROOF_VARIABLES);
  const inputs = await read('inputs', INPUTS_QUERY, INPUT_VARIABLES);
  const now = Date.now();
  const state = await inspectState(inputs, proof, { now, nowMs: now });
  assert.equal(contents(state.registry).current_season_id, EXPECTED.previousSeasonId,
    'This pre-start check must not be relabeled as an executed Season 3 test.');
  assert.equal(state.confirmedPreviousClaim.digest, EXPECTED.previousClaimDigest);
  assert.equal(state.confirmedPreviousClaim.status, 'confirmed');
  assert.equal(state.confirmedPreviousClaim.rewardMist, '7000000');
  assert.equal(state.confirmedPreviousClaim.eligibleGrowthPoints, '10');
  assert.equal(state.ownedSeeds.length, 2); assert.equal(state.seasonSeeds.length, 0);
  assert.equal(state.ownedNFTs.length, 1);
  assert.equal(state.ownedNFTs[0].objectId, EXPECTED.previousNftId);
  const gateOpen = BigInt(state.clockMs) >= BigInt(state.resetReadyMs);
  assert.equal(state.status, gateOpen ? 'rollover-ready' : 'rollover-wait');
  if (!gateOpen) {
    await assert.rejects(() => prepareRollover(state, { now, nowMs: now }),
      error => error.code === 'NOT_READY' || error.code === 'ROLLOVER_NOT_READY');
  }
  Object.assign(record, { passed: true, completedAt: new Date().toISOString(),
    proofCheckpoint: proof.data.checkpoint, currentCheckpoint: state.checkpoint,
    chainClockMs: state.clockMs, currentSeason: contents(state.registry).current_season_id,
    status: state.status, normalResetReadyMs: state.resetReadyMs,
    earlyRolloverPreparationRejected: !gateOpen, seasonThreeHasStarted: false,
    previousClaim: state.confirmedPreviousClaim, processedPreviousSeeds: state.ownedSeeds.length,
    fixedNftId: EXPECTED.previousNftId });
} catch (error) {
  record.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  save('summary.json', record);
  console.log(JSON.stringify(record, null, 2));
}
